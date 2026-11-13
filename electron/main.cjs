const { app, BrowserWindow, ClipboardItem, Menu, clipboard, dialog, ipcMain, net, protocol, session, shell } = require('electron');
const fs = require('node:fs/promises');
const { existsSync, mkdtempSync } = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');
const { createAssets, scheme: assetScheme } = require('./assets.cjs');
const { createConversion } = require('./conversion.cjs');
const { documentExtension, getDocument, pathKey, saveDocument } = require('./documents.cjs');
const { createFileOperations } = require('./file-operations.cjs');
const { acceptedExtensions: fontExtensions, createFontStore, fontRoute } = require('./fonts.cjs');
const { createStorage } = require('./storage.cjs');
const { createWatcher } = require('./watcher.cjs');
const { findDocuments, listDirectory, searchDirectory } = require('./workspace.cjs');
const { applicationArguments, materializeCommand, parseCommand, readCandidate, readGitBaseline, readReviewSnapshot } = require('./review.cjs');

const appScheme = 'sujian-app';
const smokeTest = process.argv.includes('--smoke-test');
const devUrl = !app.isPackaged && (process.env.SUJIAN_DEV_SERVER_URL || process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL);
const appUrl = `${appScheme}://editor/index.html`;
const appName = '素笺 Sujian';
const extensions = ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdwn', 'mdtxt', 'mdtext', 'rmd', 'qmd', 'txt', 'text'];
const filters = [{ name: 'Markdown / Text', extensions }];
const states = new Map();
const knownDocuments = new Map();
const pendingPaths = [];
const pendingCommands = [];
const launchArguments = applicationArguments(process.argv, { defaultApp: process.defaultApp, appPath: app.getAppPath() });
let quitting = false;
let servicesReady = false;
let remoteMediaAllowed = false;
let currentHotkeys = '';

if (smokeTest) app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'sujian-smoke-')));
app.setName(appName);
if (process.platform === 'win32') app.setAppUserModelId('io.github.peterwangze.sujian');

protocol.registerSchemesAsPrivileged([
  { scheme: appScheme, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, codeCache: true } },
  { scheme: assetScheme, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function trustedRenderer(address) {
  try {
    const url = new URL(address);
    if (devUrl) return url.origin === new URL(devUrl).origin;
    return url.protocol === `${appScheme}:` && url.hostname === 'editor';
  } catch {
    return false;
  }
}

function appProtocol(request, fonts) {
  const url = new URL(request.url);
  if (url.hostname !== 'editor' || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 404 });
  if (url.pathname.startsWith(fontRoute)) return fonts.respond(request);
  const root = path.join(app.getAppPath(), 'dist');
  let target;
  try {
    target = path.resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
  } catch {
    return new Response(null, { status: 400 });
  }
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return new Response(null, { status: 403 });
  return net.fetch(pathToFileURL(target).href, { method: request.method });
}

function safeOpenExternal(href) {
  if (typeof href !== 'string') throw new TypeError('A link is required.');
  const url = new URL(href);
  if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) throw new Error('不支持使用系统浏览器打开此链接。');
  return shell.openExternal(url.href);
}

function remember(document) {
  knownDocuments.set(pathKey(document.path), { hash: document.hash });
  app.addRecentDocument(document.path);
  return document;
}

async function openDocument(filePath) {
  if (!documentExtension.test(filePath)) throw new Error('请选择 Markdown 或纯文本文件。');
  try {
    return remember(await getDocument(filePath));
  } catch (error) {
    if (error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') throw new Error('文件编码无法识别。请使用 UTF-8 或带 BOM 的 UTF-16 文本。');
    throw error;
  }
}

async function openPaths(paths) {
  const documents = [];
  for (const filePath of new Set(paths)) {
    try {
      documents.push(await openDocument(filePath));
    } catch (error) {
      console.warn(`Could not open ${filePath}: ${error.message}`);
    }
  }
  return documents;
}

function commandPaths(arguments_, directory = process.cwd()) {
  return arguments_.filter((argument) => !argument.startsWith('-') && documentExtension.test(argument)).map((argument) => path.resolve(directory, argument));
}

function targetWindowState() {
  const window = BrowserWindow.getFocusedWindow();
  return states.get(window?.id) ?? states.values().next().value;
}

function focusWindow(state) {
  if (state.window.isMinimized()) state.window.restore();
  state.window.focus();
}

async function deliverPaths(paths) {
  if (!paths.length) return;
  if (!servicesReady) {
    pendingPaths.push(...paths);
    return;
  }
  const state = targetWindowState();
  if (!state) {
    await createWindow(paths);
    return;
  }
  focusWindow(state);
  if (!state.consumedInitialPaths) state.initialPaths.push(...paths);
  else {
    const documents = await openPaths(paths);
    if (documents.length && !state.window.isDestroyed()) state.window.webContents.send('sujian:open-files', documents);
  }
}

function reportCommandError(error) {
  console.error(error.message);
  dialog.showErrorBox('无法打开审阅请求', error.message);
}

async function flushCommands(state) {
  if (!state.commandsReady || state.deliveringCommands) return;
  state.deliveringCommands = true;
  try {
    while (state.commands.length && !state.window.isDestroyed()) {
      try {
        const command = await materializeCommand(state.commands.shift());
        if (!state.window.isDestroyed()) state.window.webContents.send('sujian:command', command);
      } catch (error) {
        reportCommandError(error);
      }
    }
  } finally {
    state.deliveringCommands = false;
  }
}

async function deliverCommand(command) {
  if (!servicesReady) {
    pendingCommands.push(command);
    return;
  }
  const state = targetWindowState();
  if (!state) {
    await createWindow([command.path], [command]);
    return;
  }
  focusWindow(state);
  state.commands.push(command);
  await flushCommands(state);
}

function requestClose(window, event) {
  const state = states.get(window.id);
  if (!state?.ready || !state.closeManaged || state.canClose || window.webContents.isCrashed() || smokeTest) return;
  event.preventDefault();
  if (state.closePending) return;
  state.closePending = true;
  window.webContents.send('sujian:before-close');
}

async function createWindow(initialPaths = [], commands = []) {
  const icon = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(app.getAppPath(), 'build', 'icon.png');
  const window = new BrowserWindow({
    width: 1320, height: 900, minWidth: 800, minHeight: 560,
    title: appName, show: false, backgroundColor: '#f7f8fa', autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 11 } } : {
      titleBarOverlay: { color: '#f5f6f9', symbolColor: '#374151', height: 36 },
    }),
    ...(existsSync(icon) ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
      sandbox: true, nodeIntegration: false, spellcheck: true,
    },
  });
  const state = { window, initialPaths: [...initialPaths], commands: [...commands] };
  state.watcher = createWatcher({ knownDocuments, notify: (update) => {
    if (!window.isDestroyed()) window.webContents.send('sujian:external-change', update);
  } });
  states.set(window.id, state);
  const windowId = window.id;
  window.on('focus', () => state.watcher.refresh());
  window.on('close', (event) => requestClose(window, event));
  window.on('closed', () => {
    state.watcher.dispose();
    state.search?.abort();
    states.delete(windowId);
    if (quitting && states.size === 0) app.quit();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void safeOpenExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (trustedRenderer(url)) return;
    event.preventDefault();
    void safeOpenExternal(url).catch(() => {});
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.once('ready-to-show', () => {
    if (!smokeTest && !window.isDestroyed()) window.show();
  });

  await window.loadURL(devUrl || appUrl);
  state.ready = true;
  return window;
}

function buildMenu(hotkeys = {}) {
  const action = (label, name, accelerator) => ({ label,
    accelerator: typeof hotkeys[name] === 'string' && hotkeys[name].trim() ? undefined : accelerator,
    click: (_item, window) => {
      if (states.has(window?.id)) window.webContents.send('sujian:menu-action', name);
    },
  });
  const divider = { type: 'separator' };
  const isMac = process.platform === 'darwin';
  const template = [];
  if (isMac) {
    template.push({ label: appName, submenu: [{ role: 'about' }, action('偏好设置', 'settings', 'Cmd+,'), divider, { role: 'hide' }, { role: 'quit' }] });
  }
  template.push(
    { label: '文件', submenu: [
      action('新建文档', 'new-file', 'CmdOrCtrl+N'),
      { label: '新建窗口', accelerator: hotkeys['new-window'] ? undefined : 'CmdOrCtrl+Shift+N', click: () => void createWindow() },
      action('打开文件…', 'open-files', 'CmdOrCtrl+O'), action('打开文件夹…', 'open-folder', 'CmdOrCtrl+Shift+O'),
      action('快速打开…', 'quick-open', 'CmdOrCtrl+P'), divider,
      action('保存', 'save', 'CmdOrCtrl+S'), action('另存为…', 'save-as', 'CmdOrCtrl+Shift+S'),
      action('关闭标签页', 'close-tab', 'CmdOrCtrl+W'), action('重新打开标签页', 'reopen-tab', 'CmdOrCtrl+Shift+T'), divider,
      action('导入…', 'import'), action('导出…', 'export', 'CmdOrCtrl+Shift+E'), action('打印…', 'print'),
      ...(!isMac ? [divider, action('偏好设置', 'settings', 'Ctrl+,'), { role: 'quit' }] : []),
    ] },
    { label: '编辑', submenu: [
      { role: 'undo' }, { role: 'redo' }, divider, { role: 'cut' }, { role: 'copy' },
      { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'selectAll' }, divider,
      action('查找', 'find', 'CmdOrCtrl+F'), action('替换', 'replace', isMac ? 'Cmd+Alt+F' : 'Ctrl+H'),
      action('搜索文件夹', 'search-folder', 'CmdOrCtrl+Shift+F'), divider,
      action('审阅修订稿…', 'review'),
    ] },
    { label: '视图', submenu: [
      action('实时编辑', 'view-live'), action('源码编辑', 'view-source', 'CmdOrCtrl+/'), action('阅读', 'view-read'), divider,
      action('显示或隐藏侧边栏', 'toggle-sidebar', 'CmdOrCtrl+Shift+L'),
      action('专注模式', 'toggle-focus', 'F8'), action('打字机模式', 'toggle-typewriter', 'F9'), divider,
      action('恢复实际大小', 'reset-zoom'), { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' },
    ] },
  );
  if (isMac) template.push({ role: 'windowMenu' });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function setHotkeys(hotkeys) {
  const mapping = hotkeys && typeof hotkeys === 'object' ? hotkeys : {};
  const signature = JSON.stringify(mapping);
  if (signature === currentHotkeys) return;
  buildMenu(mapping);
  currentHotkeys = signature;
}

function installIpc({ assets, conversion, fonts, storage, operations }) {
  const handle = (name, callback) => ipcMain.handle(`sujian:${name}`, (event, ...args) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const state = states.get(window?.id);
    if (!state || !event.senderFrame || event.senderFrame.parent || !trustedRenderer(event.senderFrame.url)) throw new Error('Untrusted editor frame.');
    return callback(state, ...args);
  });
  handle('open-files-dialog', async ({ window }) => {
    const selected = await dialog.showOpenDialog(window, { title: '打开 Markdown 文档', properties: ['openFile', 'multiSelections'], filters });
    if (selected.canceled) return [];
    return Promise.all(selected.filePaths.map(openDocument));
  });
  handle('open-path', (_state, filePath) => openDocument(filePath));
  handle('initial-documents', async (state) => {
    state.consumedInitialPaths = true;
    return openPaths(state.initialPaths.splice(0));
  });
  handle('initial-command', async (state) => {
    if (state.initialCommandConsumed) return null;
    state.initialCommandConsumed = true;
    try {
      return await materializeCommand(state.commands.shift());
    } finally {
      state.commandsReady = true;
      setImmediate(() => { void flushCommands(state); });
    }
  });
  handle('choose-review-candidate', async ({ window }, purpose) => {
    const selected = await dialog.showOpenDialog(window, {
      title: purpose === 'baseline' ? '选择旧底稿' : '选择修订稿', properties: ['openFile'], filters,
    });
    return selected.canceled || !selected.filePaths.length ? null : readCandidate(selected.filePaths[0]);
  });
  const requireOpenDocument = (state, filePath) => {
    if (typeof filePath !== 'string' || !state.watcher.hasPath(filePath)) throw new Error('请先在当前窗口打开该文档。');
  };
  handle('read-review-snapshot', (state, filePath) => {
    requireOpenDocument(state, filePath);
    return readReviewSnapshot(filePath);
  });
  handle('read-git-baseline', (state, options) => {
    requireOpenDocument(state, options?.documentPath);
    return readGitBaseline(options);
  });
  handle('save-file', async (state, options) => {
    let filePath = options.path;
    let expectedHash = options.expectedHash;
    if (!filePath) {
      const selected = await dialog.showSaveDialog(state.window, {
        title: '保存文档', defaultPath: path.basename(options.defaultName || '未命名.md'), filters,
      });
      if (selected.canceled || !selected.filePath) return { status: 'canceled' };
      filePath = selected.filePath;
      try {
        expectedHash = (await getDocument(filePath)).hash;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const result = await saveDocument({ ...options, path: filePath, expectedHash });
    if (result.document) {
      remember(result.document);
      if (result.status === 'ok') state.watcher.saved(result.document);
    }
    return result;
  });
  handle('open-folder', async ({ window }) => {
    const selected = await dialog.showOpenDialog(window, { title: '打开文件夹', properties: ['openDirectory'] });
    return selected.canceled ? null : selected.filePaths[0] ?? null;
  });
  handle('list-directory', (_state, folder, options) => listDirectory(folder, options));
  handle('find-documents', (_state, folder, options) => findDocuments(folder, options));
  handle('search-directory', async (state, options) => {
    state.search?.abort();
    const search = new AbortController();
    state.search = search;
    try {
      return await searchDirectory(options, { signal: search.signal });
    } finally {
      if (state.search === search) state.search = undefined;
    }
  });
  handle('cancel-search', (state) => state.search?.abort());
  handle('rename-path', (_state, ...args) => operations.renamePath(...args));
  handle('move-path', (_state, ...args) => operations.movePath(...args));
  handle('duplicate-path', (_state, ...args) => operations.duplicatePath(...args));
  handle('trash-path', (_state, ...args) => operations.trashPath(...args));
  handle('create-directory', (_state, ...args) => operations.createDirectory(...args));
  handle('create-file', (_state, parent, name) => operations.createFile(parent, name));
  handle('undo-file-operation', () => operations.undoFileOperation());
  handle('set-watched-files', (state, paths) => state.watcher.setPaths(paths));
  handle('load-drafts', () => storage.loadDrafts());
  handle('save-draft', (_state, draft) => storage.saveDraft(draft));
  handle('delete-draft', (_state, id) => storage.deleteDraft(id));
  handle('load-preferences', () => storage.loadPreferences());
  handle('save-preferences', (_state, preferences) => storage.savePreferences(preferences));
  handle('list-fonts', () => fonts.listFonts());
  handle('import-fonts', async ({ window }) => {
    const selected = await dialog.showOpenDialog(window, {
      title: '导入字体',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '字体文件', extensions: fontExtensions }],
    });
    return fonts.importFonts(selected.canceled ? [] : selected.filePaths);
  });
  handle('remove-font', (_state, id) => fonts.removeFont(id));
  handle('import-image', ({ window }, options) => assets.importImage(window, options));
  handle('resolve-image', (_state, options) => assets.resolveImage(options));
  handle('upload-images', (_state, options) => assets.uploadImages(options));
  handle('import-document', ({ window }, options) => conversion.importDocument(window, options));
  handle('export-document', ({ window }, options) => conversion.exportDocument(window, options));
  handle('open-external', (_state, address) => safeOpenExternal(address));
  handle('show-item-in-folder', (_state, filePath) => shell.showItemInFolder(path.resolve(filePath)));
  handle('write-clipboard', (_state, data) => {
    const allowed = {};
    for (const [type, mime] of [['text', 'text/plain'], ['html', 'text/html'], ['rtf', 'text/rtf']]) {
      if (typeof data?.[type] === 'string') allowed[mime] = data[type];
    }
    if (Object.keys(allowed).length) return clipboard.write([new ClipboardItem(allowed)]);
  });
  handle('edit-clipboard', ({ window }, action) => {
    if (action !== 'paste' && action !== 'pasteAndMatchStyle') throw new Error('不支持的剪贴板操作。');
    window.webContents[action]();
  });
  handle('add-spelling-word', ({ window }, word) => {
    if (typeof word !== 'string' || !word || word.length > 64 || /\s/u.test(word)) return false;
    return window.webContents.session.addWordToSpellCheckerDictionary(word);
  });
  handle('new-window', async (_state, filePath) => { await createWindow(filePath ? [filePath] : []); });
  handle('set-fullscreen', ({ window }, enabled) => { window.setFullScreen(Boolean(enabled)); });
  handle('toggle-fullscreen', ({ window }) => {
    const next = !window.isFullScreen();
    window.setFullScreen(next);
    return next;
  });
  handle('set-title-bar-theme', ({ window }, { dark, background, symbol } = {}) => {
    const color = value => typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value);
    if (process.platform !== 'darwin') window.setTitleBarOverlay({
      color: color(background) ? background : dark ? '#25272c' : '#f5f6f9',
      symbolColor: color(symbol) ? symbol : dark ? '#eceef2' : '#374151',
      height: 36,
    });
  });
  handle('set-spellcheck', ({ window }, enabled) => window.webContents.session.setSpellCheckerEnabled(enabled === true));
  handle('set-hotkeys', (_state, hotkeys) => setHotkeys(hotkeys));
  handle('reset-zoom', ({ window }) => window.webContents.setZoomLevel(0));
  handle('set-menu-shortcuts-ignored', ({ window }, enabled) => {
    window.webContents.setIgnoreMenuShortcuts(Boolean(enabled));
  });
  handle('set-remote-media', (_state, enabled) => { remoteMediaAllowed = Boolean(enabled); });
  handle('manage-close', (state, enabled) => { state.closeManaged = Boolean(enabled); });
  handle('finish-close', (state, shouldClose = true) => {
    state.closePending = false;
    if (!shouldClose) {
      quitting = false;
      return;
    }
    state.canClose = true;
    setImmediate(() => { if (!state.window.isDestroyed()) state.window.close(); });
  });
}

async function launch(initialCommand) {
  const userDataPath = app.getPath('userData');
  const assets = createAssets({ userDataPath, knownDocuments });
  const conversion = createConversion({ assets, userDataPath });
  const fonts = createFontStore(userDataPath, {
    origin: `${appScheme}://editor`,
    devOrigin: devUrl ? new URL(devUrl).origin : undefined,
  });
  protocol.handle(appScheme, request => appProtocol(request, fonts));
  protocol.handle(assetScheme, assets.handleRequest);
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (request, done) => {
    done({ cancel: !remoteMediaAllowed && ['image', 'media'].includes(request.resourceType) });
  });
  const storage = createStorage(userDataPath);
  const preferences = await storage.loadPreferences().catch(() => ({}));
  session.defaultSession.setSpellCheckerEnabled(preferences?.proseSpellcheck === true);
  remoteMediaAllowed = Boolean(preferences?.remoteMedia);
  installIpc({ assets, conversion, fonts, storage, operations: createFileOperations() });
  setHotkeys(preferences?.hotkeys);
  servicesReady = true;
  const timeout = smokeTest ? setTimeout(() => { console.error('Sujian desktop smoke test timed out.'); app.exit(1); }, 20000) : null;
  let exitCode;
  try {
    const initial = [...pendingPaths.splice(0), ...(initialCommand ? [initialCommand.path] : commandPaths(launchArguments))];
    const commands = pendingCommands.splice(0);
    if (initialCommand) commands.unshift(initialCommand);
    const window = await createWindow(initial, commands);
    if (smokeTest) {
      const ready = await window.webContents.executeJavaScript(`new Promise(resolve => {
        const start = Date.now();
        function check() {
          if (window.sujian && document.querySelector('#root')?.childElementCount) return resolve(true);
          if (Date.now() - start > 14000) return resolve(false);
          setTimeout(check, 50);
        }
        check();
      })`);
      if (!ready) throw new Error('Renderer did not mount its application.');
      const sample = path.join(userDataPath, 'smoke.md');
      const openedPath = await window.webContents.executeJavaScript(`(async () => {
        const path = ${JSON.stringify(sample)};
        const root = ${JSON.stringify(userDataPath)};
        const text = '# Sujian desktop smoke';
        const saved = await window.sujian.saveFile({ path, text });
        const opened = await window.sujian.openPath(path);
        const search = await window.sujian.searchDirectory({ path: root, query: 'desktop smoke' });
        return saved.status === 'ok' && opened.text === text && search.matches.length === 1 ? opened.path : null;
      })()`);
      if (!openedPath) throw new Error('The desktop file bridge did not pass the smoke test.');
      const smokeImage = path.join(userDataPath, 'smoke 100% #.png');
      const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n5sAAAAASUVORK5CYII=', 'base64');
      await fs.writeFile(smokeImage, imageBytes);
      const imageBridgeReady = await window.webContents.executeJavaScript(`(async () => {
        const image = await window.sujian.resolveImage({
          documentPath: ${JSON.stringify(openedPath)}, source: 'smoke%20100%25%20%23.png', embed: true,
        });
        return image === ${JSON.stringify('data:image/png;base64,' + imageBytes.toString('base64'))};
      })()`);
      if (!imageBridgeReady) throw new Error('The desktop image export bridge did not pass the smoke test.');
      const fontBridgeReady = await window.webContents.executeJavaScript(`(async () => {
        const fonts = await window.sujian.listFonts();
        const samples = [
          ['Inter', 'Latin'], ['Source Serif 4', 'Latin'], ['JetBrains Mono', 'Latin'],
          ['Noto Sans SC', '中文'], ['Noto Serif SC', '中文'],
        ];
        const loaded = await Promise.all(samples.map(([family, text]) => document.fonts.load('16px "' + family + '"', text)));
        return fonts.length === 0 && loaded.every(faces => faces.some(face => face.status === 'loaded'));
      })()`);
      if (!fontBridgeReady) throw new Error('The desktop font bridge or bundled fonts did not pass the smoke test.');
      console.log('Sujian desktop smoke test passed.');
      window.destroy();
      exitCode = 0;
    }
  } catch (error) {
    console.error(error);
    if (!smokeTest) dialog.showErrorBox('无法启动素笺', error.message);
    exitCode = 1;
  } finally {
    clearTimeout(timeout);
    if (smokeTest) await fs.rm(userDataPath, { recursive: true, force: true }).catch(() => {});
  }
  if (exitCode !== undefined) app.exit(exitCode);
}

let initialCommand;
let invalidCommand;
try {
  if (!smokeTest) initialCommand = parseCommand(launchArguments);
} catch (error) {
  invalidCommand = error;
}

if (invalidCommand) {
  console.error(invalidCommand.message);
  app.exit(2);
} else if (!smokeTest && !app.requestSingleInstanceLock({ sujianArgs: launchArguments })) app.quit();
else {
  app.on('second-instance', (_event, arguments_, directory, data) => {
    try {
      const sent = data?.sujianArgs;
      const exactArgs = Array.isArray(sent) && sent.every((argument) => typeof argument === 'string') ? sent : null;
      const command = exactArgs && parseCommand(exactArgs, directory);
      const delivery = command ? deliverCommand(command) : deliverPaths(commandPaths(exactArgs ?? arguments_, directory));
      void delivery.catch(reportCommandError);
    } catch (error) {
      reportCommandError(error);
    }
  });
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    void deliverPaths(commandPaths([filePath]));
  });
  app.on('activate', () => {
    if (!states.size && servicesReady) void createWindow();
  });
  app.on('before-quit', (event) => {
    if (!states.size || smokeTest) return;
    event.preventDefault();
    quitting = true;
    for (const { window } of states.values()) window.close();
  });
  app.on('window-all-closed', () => {
    if (!smokeTest && process.platform !== 'darwin') app.quit();
  });
  void app.whenReady().then(() => launch(initialCommand));
}

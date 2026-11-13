const { clipboard, dialog, net, shell } = require('electron');
const fs = require('node:fs/promises');
const { COPYFILE_EXCL } = require('node:fs').constants;
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { atomicWrite, pathKey } = require('./documents.cjs');

const run = promisify(execFile);
const scheme = 'sujian-asset';
const types = new Map(Object.entries({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.apng': 'image/apng',
  '.heic': 'image/heic', '.jxl': 'image/jxl', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac',
}));
const imageExtensions = new Map([...types].filter(([, mime]) => mime.startsWith('image/')).reverse().map(([extension, mime]) => [mime, extension]));
const imageTypeAliases = new Map([['image/vnd.microsoft.icon', 'image/x-icon'], ['image/jpg', 'image/jpeg']]);
const maxDownloadBytes = 64 * 1024 * 1024;

function imageFilename(name, mime) {
  const suffix = path.extname(name).toLowerCase();
  const extension = types.get(suffix) === mime ? suffix : imageExtensions.get(mime);
  if (types.has(suffix)) name = name.slice(0, -suffix.length);
  let stem = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim().slice(0, 100).replace(/[. ]+$/g, '') || '图片';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = '_' + stem;
  return stem + extension;
}

async function remoteImageResponse(window, source) {
  const signal = AbortSignal.timeout(45_000);
  let url = new URL(source);
  for (let redirects = 0; redirects < 6; redirects += 1) {
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) break;
    const response = await window.webContents.session.fetch(url.href, { signal, redirect: 'manual', credentials: 'omit' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, url };
    await response.body?.cancel();
    const location = response.headers.get('location');
    if (!location) break;
    const next = new URL(location, url);
    if (url.protocol === 'https:' && next.protocol !== 'https:') break;
    url = next;
  }
  throw new Error('无法下载图片：图片地址的跳转不可用。');
}

async function imageBytes(response) {
  if (!response.body || Number(response.headers.get('content-length')) > maxDownloadBytes) {
    await response.body?.cancel();
    throw new Error('无法另存图片：图片为空或超过 64 MB。');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maxDownloadBytes) throw new Error('无法另存图片：图片超过 64 MB。');
    chunks.push(chunk);
  }
  if (!size) throw new Error('无法另存图片：图片为空。');
  return Buffer.concat(chunks, size);
}

function assetUrl({ documentPath, source, rootPath }) {
  const data = JSON.stringify([documentPath ?? '', source, rootPath ?? '']);
  return `${scheme}://local/${Buffer.from(data, 'utf8').toString('base64url')}`;
}

function safeMediaSource(source) {
  if (typeof source !== 'string' || !source.trim()) return '';
  const trimmed = source.trim();
  if (/^(?:https?:|blob:|data:(?:image|audio|video)\/)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return '';
}

function encodeMarkdownPath(filePath) {
  return filePath.replace(/\\/g, '/').split('/').map((part, index) => {
    if (index === 0 && /^[a-zA-Z]:$/.test(part)) return part;
    return encodeURIComponent(part).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  }).join('/');
}

function createAssets({ userDataPath, knownDocuments }) {
  const unattached = path.join(userDataPath, 'assets');

  async function mediaFile({ documentPath, source, rootPath }) {
    if (typeof source !== 'string' || !source.trim() || safeMediaSource(source)) return null;
    if (documentPath && !knownDocuments.has(pathKey(documentPath))) return null;
    let raw = source.trim();
    if (raw.startsWith('<') && raw.endsWith('>')) raw = raw.slice(1, -1);
    let decoded;
    try {
      if (/^file:/i.test(raw)) decoded = fileURLToPath(raw);
      else {
        decoded = decodeURIComponent(raw);
        if (/^[a-z][a-z+.-]*:/i.test(decoded) && !/^[a-z]:[\\/]/i.test(decoded)) return null;
      }
    } catch {
      return null;
    }
    const base = documentPath ? path.dirname(documentPath) : unattached;
    const root = documentPath && rootPath ? path.resolve(base, rootPath) : '';
    const rootRelative = root && /^\/(?!\/)/.test(decoded) && !/^file:/i.test(raw);
    const candidates = rootRelative ? [path.resolve(root, decoded.slice(1)), path.resolve(base, decoded)] :
      [path.resolve(base, decoded), ...(root && !path.isAbsolute(decoded) ? [path.resolve(root, decoded)] : [])];
    const allowedBase = !documentPath && await fs.realpath(unattached).catch(() => null);
    if (!documentPath && !allowedBase) return null;
    for (const candidate of new Set(candidates)) {
      const absolute = await fs.realpath(candidate).catch(() => null);
      if (!absolute || !types.has(path.extname(absolute).toLowerCase())) continue;
      if (allowedBase) {
        const relative = path.relative(allowedBase, absolute);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
      }
      const stat = await fs.stat(absolute).catch(() => null);
      if (stat?.isFile()) return absolute;
    }
    return null;
  }

  async function resolveImage({ documentPath, source, rootPath, embed = false }) {
    const remote = safeMediaSource(source);
    if (remote) return remote;
    const alreadyResolved = typeof source === 'string' && source.startsWith(`${scheme}://`);
    const local = alreadyResolved ? await fromAssetUrl(source) : await mediaFile({ documentPath, source, rootPath });
    if (!local) return null;
    if (!embed) return alreadyResolved ? source : assetUrl({ documentPath, source, rootPath });
    return embedFile(local);
  }

  async function fromAssetUrl(address) {
    try {
      const url = new URL(address);
      if (url.protocol !== `${scheme}:` || url.hostname !== 'local') return null;
      const [documentPath, source, rootPath] = JSON.parse(Buffer.from(url.pathname.slice(1), 'base64url').toString('utf8'));
      return await mediaFile({ documentPath, source, rootPath });
    } catch {
      return null;
    }
  }

  async function localImageFile(source) {
    const file = await fromAssetUrl(source);
    if (!file || !types.get(path.extname(file).toLowerCase())?.startsWith('image/')) {
      throw new Error('找不到原图片，文件可能已移动或删除。');
    }
    return file;
  }

  async function revealImage(source) {
    shell.showItemInFolder(await localImageFile(source));
  }

  async function saveImageAs(window, { source, alt } = {}, allowRemote = false) {
    if (typeof source !== 'string') throw new Error('无法识别图片来源。');
    let local, bytes, filename;
    if (source.startsWith(`${scheme}://`)) {
      local = await localImageFile(source);
      filename = path.basename(local);
    } else {
      const remote = /^https?:\/\//i.test(source);
      if (remote && !allowRemote) throw new Error('请先在设置中开启「显示网络图片」。');
      if (!remote && !/^data:image\//i.test(source)) throw new Error('无法识别图片来源。');
      const { response, url } = remote ? await remoteImageResponse(window, source) : { response: await fetch(source) };
      const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      const mime = imageTypeAliases.get(type) ?? type;
      if (!response.ok || !imageExtensions.has(mime)) {
        await response.body?.cancel();
        throw new Error('无法另存图片：资源不可用或图片格式不受支持。');
      }
      let name = typeof alt === 'string' ? alt : '';
      if (url) {
        const leaf = url.pathname.split('/').at(-1);
        try { name = decodeURIComponent(leaf) || name; } catch { name = leaf || name; }
      }
      filename = imageFilename(name, mime);
      bytes = await imageBytes(response);
    }

    const extension = path.extname(filename);
    const selected = await dialog.showSaveDialog(window, {
      title: '图片另存为', defaultPath: filename,
      filters: [{ name: extension.slice(1).toUpperCase() + ' 图片', extensions: [extension.slice(1).toLowerCase()] }],
      properties: ['showOverwriteConfirmation'],
    });
    if (selected.canceled || !selected.filePath) return null;
    const appendExtension = !path.extname(selected.filePath);
    const destination = appendExtension ? selected.filePath + extension : selected.filePath;
    try {
      if (local) {
        const original = await fs.stat(local, { bigint: true });
        const existing = await fs.stat(destination, { bigint: true }).catch(error => {
          if (error.code !== 'ENOENT') throw error;
          return null;
        });
        if (pathKey(local) === pathKey(destination) || (existing && original.ino !== 0n &&
            original.dev === existing.dev && original.ino === existing.ino)) return null;
        await fs.copyFile(local, destination, appendExtension ? COPYFILE_EXCL : 0);
      } else if (appendExtension) {
        await fs.writeFile(destination, bytes, { flag: 'wx' });
      } else {
        await atomicWrite(destination, bytes);
      }
    } catch (error) {
      // The dialog only confirmed the path it returned, before any added suffix.
      if (appendExtension && error.code === 'EEXIST') throw new Error('同名图片已存在，请指定完整文件名以确认覆盖，或换一个名称。');
      throw error;
    }
    return destination;
  }

  async function handleRequest(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
    const source = await fromAssetUrl(request.url);
    if (!source) return new Response(null, { status: 404 });
    const range = request.headers.get('Range');
    return net.fetch(pathToFileURL(source).href, { method: request.method, headers: range ? { Range: range } : {} });
  }

  async function importImage(window, { documentPath, bytes, filename, sourcePath, useClipboard = false, assetFolder } = {}) {
    if (documentPath && !knownDocuments.has(pathKey(documentPath))) throw new Error('Open or save the document before attaching local media.');
    let content = bytes ? Buffer.from(bytes) : null;
    if (useClipboard && !content) {
      const items = await clipboard.read();
      const mime = ['image/png', 'image/jpeg', 'image/webp'].find(type => items.some(item => item.types.includes(type)));
      if (!mime) return null;
      const image = await items.find(item => item.types.includes(mime)).getType(mime);
      content = Buffer.from(await image.arrayBuffer());
      filename ??= 'clipboard.' + mime.slice('image/'.length);
    }
    if (!content && !sourcePath) {
      const extensions = [...types.keys()].filter((extension) => types.get(extension).startsWith('image/')).map((extension) => extension.slice(1));
      const selected = await dialog.showOpenDialog(window, {
        title: '插入图片', properties: ['openFile'], filters: [{ name: '图片', extensions }],
      });
      if (selected.canceled || !selected.filePaths.length) return null;
      [sourcePath] = selected.filePaths;
    }
    if (sourcePath) {
      filename ??= path.basename(sourcePath);
      content ??= await fs.readFile(sourcePath);
    }
    if (!content?.length) throw new Error('No image data was provided.');
    const extension = path.extname(filename ?? '').toLowerCase() || '.png';
    if (!types.has(extension)) throw new Error('This media format is not supported.');
    const stem = path.basename(filename ?? 'image', extension).replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim().slice(0, 80) || 'image';
    const directory = documentPath ? path.resolve(path.dirname(documentPath), assetFolder || `${path.parse(documentPath).name}.assets`) : unattached;
    await fs.mkdir(directory, { recursive: true });
    const destination = path.join(directory, `${stem}-${randomUUID().slice(0, 8)}${extension}`);
    await fs.writeFile(destination, content, { flag: 'wx' });
    const markdownPath = encodeMarkdownPath(documentPath ? path.relative(path.dirname(documentPath), destination) : destination);
    return { markdownPath, url: assetUrl({ documentPath, source: markdownPath }) };
  }

  async function embedLocalAssets(html) {
    const pattern = /sujian-asset:\/\/local\/[A-Za-z0-9_-]+/g;
    const replacements = new Map();
    for (const match of new Set(html.match(pattern) ?? [])) {
      const file = await fromAssetUrl(match);
      if (!file) continue;
      const dataUrl = await embedFile(file);
      if (dataUrl) replacements.set(match, dataUrl);
    }
    return html.replace(pattern, (match) => replacements.get(match) ?? match);
  }

  async function embedFile(file) {
    const size = (await fs.stat(file)).size;
    if (size > 32 * 1024 * 1024) throw new Error('该媒体文件超过了 32 MB 的内嵌上限。');
    const contents = await fs.readFile(file);
    return `data:${types.get(path.extname(file).toLowerCase())};base64,${contents.toString('base64')}`;
  }

  async function uploadImages({ documentPath, sources, rootPath, executable, args = [] }) {
    if (typeof executable !== 'string' || !executable.trim() || !Array.isArray(args) || args.some((item) => typeof item !== 'string')) {
      throw new Error('请选择图片上传程序并提供独立的参数。');
    }
    if (!Array.isArray(sources) || !sources.length) return [];
    const paths = [];
    for (const source of sources) {
      const resolved = await mediaFile({ documentPath, source, rootPath });
      if (!resolved) throw new Error(`无法读取本地图片 ${source}`);
      paths.push(resolved);
    }
    const { stdout } = await run(executable, [...args, ...paths], {
      cwd: documentPath ? path.dirname(documentPath) : unattached,
      timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
    });
    const urls = stdout.trim().split(/\r?\n/).slice(-paths.length).map((line) => line.trim());
    if (urls.length !== paths.length || urls.some((url) => !/^https?:\/\/[^\s]+$/i.test(url))) {
      throw new Error('上传程序应在输出末尾为每个文件提供一行 HTTP 或 HTTPS 地址。');
    }
    return sources.map((source, index) => ({ source, url: urls[index] }));
  }

  return { embedLocalAssets, handleRequest, importImage, mediaFile, resolveImage, revealImage, saveImageAs, uploadImages };
}

module.exports = { createAssets, scheme };

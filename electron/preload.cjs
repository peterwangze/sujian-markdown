const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(`sujian:${channel}`, ...args);
const subscribe = (channel) => (callback) => {
  const name = `sujian:${channel}`;
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(name, listener);
  return () => ipcRenderer.removeListener(name, listener);
};

function assetUrl(documentPath, source, rootPath) {
  if (typeof source !== 'string' || !source.trim()) return '';
  const value = source.trim();
  if (/^(?:https?:|blob:|data:(?:image|audio|video)\/|sujian-asset:)/i.test(value)) return value;
  if (value.startsWith('//')) return `https:${value}`;
  if (/^[a-z][a-z+.-]+:/i.test(value) && !/^file:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return '';
  const bytes = new TextEncoder().encode(JSON.stringify([documentPath ?? '', value, rootPath ?? '']));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const address = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return `sujian-asset://local/${address}`;
}

function onBeforeClose(callback) {
  const dispose = subscribe('before-close')(callback);
  const enable = invoke('manage-close');
  void enable(true).catch(() => {});
  return () => {
    dispose();
    void enable(false).catch(() => {});
  };
}

contextBridge.exposeInMainWorld('sujian', {
  platform: process.platform,
  openFiles: invoke('open-files-dialog'),
  openPath: invoke('open-path'),
  initialDocuments: invoke('initial-documents'),
  openFolder: invoke('open-folder'),
  listDirectory: invoke('list-directory'),
  findDocuments: invoke('find-documents'),
  searchDirectory: invoke('search-directory'),
  cancelSearch: invoke('cancel-search'),
  renamePath: invoke('rename-path'),
  movePath: invoke('move-path'),
  duplicatePath: invoke('duplicate-path'),
  trashPath: invoke('trash-path'),
  createDirectory: invoke('create-directory'),
  undoFileOperation: invoke('undo-file-operation'),
  saveFile: invoke('save-file'),
  setWatchedFiles: invoke('set-watched-files'),
  loadDrafts: invoke('load-drafts'),
  saveDraft: invoke('save-draft'),
  deleteDraft: invoke('delete-draft'),
  loadPreferences: invoke('load-preferences'),
  savePreferences: invoke('save-preferences'),
  importImage: invoke('import-image'),
  resolveImage: invoke('resolve-image'),
  uploadImages: invoke('upload-images'),
  importDocument: invoke('import-document'),
  exportDocument: invoke('export-document'),
  printDocument: (options) => invoke('export-document')({ ...options, format: 'print' }),
  assetUrl,
  filePath: (file) => webUtils.getPathForFile(file),
  writeClipboard: invoke('write-clipboard'),
  openExternal: invoke('open-external'),
  showItemInFolder: invoke('show-item-in-folder'),
  newWindow: invoke('new-window'),
  setFullscreen: invoke('set-fullscreen'),
  toggleFullscreen: invoke('toggle-fullscreen'),
  setTitleBarTheme: invoke('set-title-bar-theme'),
  setSpellcheck: invoke('set-spellcheck'),
  setHotkeys: invoke('set-hotkeys'),
  setRemoteMedia: invoke('set-remote-media'),
  finishClose: invoke('finish-close'),
  cancelClose: () => invoke('finish-close')(false),
  onBeforeClose,
  onMenuAction: subscribe('menu-action'),
  onExternalChange: subscribe('external-change'),
  onOpenFiles: subscribe('open-files'),
});

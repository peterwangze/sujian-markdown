const { contextBridge, ipcRenderer, webFrame, webUtils } = require('electron');

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
  appVersion: invoke('app-version'),
  checkForUpdates: invoke('check-for-updates'),
  downloadUpdate: invoke('download-update'),
  cancelUpdateDownload: invoke('cancel-update-download'),
  onUpdateDownloadProgress: subscribe('update-download-progress'),
  installUpdate: invoke('install-update'),
  respondToUpdateInstall: invoke('update-install-response'),
  onUpdateInstallState: subscribe('update-install-state'),
  openFiles: invoke('open-files-dialog'),
  openPath: invoke('open-path'),
  initialDocuments: invoke('initial-documents'),
  initialCommand: invoke('initial-command'),
  chooseReviewCandidate: invoke('choose-review-candidate'),
  readReviewSnapshot: invoke('read-review-snapshot'),
  readGitBaseline: invoke('read-git-baseline'),
  listGitDocumentHistory: invoke('git-document-history'),
  readGitDocumentRevision: invoke('read-git-document-revision'),
  gitWorkspaceStatus: invoke('git-workspace-status'),
  initGitWorkspace: invoke('git-workspace-init'),
  commitGitWorkspace: invoke('git-workspace-commit'),
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
  createFile: invoke('create-file'),
  undoFileOperation: invoke('undo-file-operation'),
  saveFile: invoke('save-file'),
  setWatchedFiles: invoke('set-watched-files'),
  setWatchedDirectories: invoke('set-watched-directories'),
  loadDrafts: invoke('load-drafts'),
  saveDraft: invoke('save-draft'),
  deleteDraft: invoke('delete-draft'),
  loadPreferences: invoke('load-preferences'),
  savePreferences: invoke('save-preferences'),
  listFonts: invoke('list-fonts'),
  importFonts: invoke('import-fonts'),
  removeFont: invoke('remove-font'),
  importImage: invoke('import-image'),
  referenceImage: invoke('reference-image'),
  resolveImage: invoke('resolve-image'),
  saveImageAs: invoke('save-image-as'),
  revealImage: invoke('reveal-image'),
  collectImage: invoke('collect-image'),
  collectImages: invoke('collect-images'),
  finishImageCollection: invoke('finish-image-collection'),
  uploadImages: invoke('upload-images'),
  importDocument: invoke('import-document'),
  exportDocument: invoke('export-document'),
  printDocument: (options) => invoke('export-document')({ ...options, format: 'print' }),
  assetUrl,
  filePath: (file) => webUtils.getPathForFile(file),
  writeClipboard: invoke('write-clipboard'),
  writeClipboardImage: invoke('write-clipboard-image'),
  copyImageAt: invoke('copy-image-at'),
  editClipboard: invoke('edit-clipboard'),
  spellingSuggestions: word => webFrame.isWordMisspelled(word) ? webFrame.getWordSuggestions(word) : null,
  addSpellingWord: invoke('add-spelling-word'),
  openExternal: invoke('open-external'),
  showItemInFolder: invoke('show-item-in-folder'),
  newWindow: invoke('new-window'),
  setFullscreen: invoke('set-fullscreen'),
  toggleFullscreen: invoke('toggle-fullscreen'),
  setTitleBarTheme: invoke('set-title-bar-theme'),
  setSpellcheck: invoke('set-spellcheck'),
  setHotkeys: invoke('set-hotkeys'),
  resetZoom: invoke('reset-zoom'),
  setMenuShortcutsIgnored: invoke('set-menu-shortcuts-ignored'),
  setRemoteMedia: invoke('set-remote-media'),
  finishClose: invoke('finish-close'),
  cancelClose: () => invoke('finish-close')(false),
  onBeforeClose,
  onMenuAction: subscribe('menu-action'),
  onExternalChange: subscribe('external-change'),
  onDirectoryChange: subscribe('directory-change'),
  onOpenFiles: subscribe('open-files'),
  onCommand: subscribe('command'),
});

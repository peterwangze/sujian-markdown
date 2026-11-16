const { createHash } = require('node:crypto');
const { constants } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { maximumInstaller } = require('./updates.cjs');

const formats = new Map([
  ['EXE', { platform: 'win32', extension: '.exe', action: 'installer-opened', error: '无法启动 Windows 安装程序。' }],
  ['DMG', { platform: 'darwin', extension: '.dmg', action: 'disk-image-opened', error: '无法打开 macOS 安装映像。' }],
  ['DEB', { platform: 'linux', extension: '.deb', action: 'package-manager-opened', error: '无法打开 DEB 安装包。请使用系统包管理器打开该文件。' }],
  ['AppImage', { platform: 'linux', extension: '.appimage', action: 'appimage-ready' }],
]);
const preparedFiles = new WeakMap();

function changedPackage() {
  return new Error('安装包已被修改或替换，请重新下载。');
}

function matchingFile(left, right) {
  return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

async function readFileState(filePath) {
  try {
    return await fs.lstat(filePath, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      throw new Error('安装包已移动或删除，请重新下载。', { cause: error });
    }
    throw error;
  }
}

async function prepareUpdateInstall(descriptor, { platform = process.platform, signal } = {}) {
  const { filePath, fileName, format, bytes, sha256 } = descriptor ?? {};
  const kind = formats.get(format);
  if (!kind || typeof filePath !== 'string' || !path.isAbsolute(filePath) || path.basename(filePath) !== fileName ||
      !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > maximumInstaller ||
      typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('请先完成新版安装包的下载。');
  }
  if (kind.platform !== platform || path.extname(fileName).toLowerCase() !== kind.extension) {
    throw new Error('安装包格式与当前系统不匹配。');
  }

  signal?.throwIfAborted();
  const original = await readFileState(filePath);
  if (!original.isFile() || original.size !== BigInt(bytes)) throw changedPackage();
  const handle = await fs.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!matchingFile(original, await handle.stat({ bigint: true }))) throw changedPackage();
    const digest = createHash('sha256');
    let length = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false, signal })) {
      length += chunk.length;
      if (length > bytes) throw changedPackage();
      digest.update(chunk);
    }
    if (length !== bytes || digest.digest('hex') !== sha256 || !matchingFile(original, await handle.stat({ bigint: true }))) {
      throw changedPackage();
    }

    signal?.throwIfAborted();
    if (format === 'AppImage') await handle.chmod((Number(original.mode) & 0o777) | 0o100);
    const verified = await handle.stat({ bigint: true });
    if (!matchingFile(verified, await readFileState(filePath))) throw changedPackage();
    const prepared = Object.freeze({ filePath, format });
    preparedFiles.set(prepared, verified);
    return prepared;
  } finally {
    await handle.close();
  }
}

async function openPreparedUpdate(prepared, { openPath, signal } = {}) {
  const verified = preparedFiles.get(prepared);
  if (!verified) throw new Error('请先校验已下载的安装包。');
  signal?.throwIfAborted();
  const { filePath, format } = prepared;
  if (!matchingFile(verified, await readFileState(filePath))) throw changedPackage();
  signal?.throwIfAborted();

  const kind = formats.get(format);
  if (format !== 'AppImage') {
    let reason;
    try { reason = await openPath(filePath); } catch (error) { throw new Error(kind.error, { cause: error }); }
    if (reason) throw new Error(kind.error, { cause: new Error(reason) });
  }
  return { action: kind.action, filePath };
}

module.exports = { prepareUpdateInstall, openPreparedUpdate };

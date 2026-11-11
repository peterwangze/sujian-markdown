const fs = require('node:fs/promises');
const path = require('node:path');
const { shell } = require('electron');
const { pathKey, serialized } = require('./documents.cjs');

function validateName(name) {
  if (typeof name !== 'string' || !name.trim() || name === '.' || name === '..' || /[<>:"/\\|?*\x00-\x1f]/.test(name)) {
    throw new Error('请输入有效的文件或文件夹名称。');
  }
  return name;
}

async function exists(filePath) {
  return Boolean(await fs.lstat(filePath).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }));
}

function createFileOperations() {
  const undo = [];

  function relocate(from, to, track = true) {
    return serialized(to, async () => {
      if (from === to) return to;
      if (pathKey(from) !== pathKey(to) && await exists(to)) throw new Error('目标位置已有同名文件。');
      await fs.rename(from, to);
      if (track) undo.push({ kind: 'move', from, to });
      return to;
    });
  }

  return {
    renamePath(filePath, name) {
      const from = path.resolve(filePath);
      return relocate(from, path.join(path.dirname(from), validateName(name)));
    },
    movePath(filePath, destinationFolder) {
      const from = path.resolve(filePath);
      return relocate(from, path.join(path.resolve(destinationFolder), path.basename(from)));
    },
    duplicatePath(filePath) {
      const source = path.resolve(filePath);
      return serialized(source, async () => {
        const stat = await fs.lstat(source);
        if (!stat.isFile() && !stat.isDirectory()) throw new Error('无法复制此类型的路径。');
        const parsed = path.parse(source);
        const stem = stat.isDirectory() ? parsed.base : parsed.name;
        const extension = stat.isDirectory() ? '' : parsed.ext;
        let number = 1;
        for (;;) {
          const suffix = number === 1 ? ' - 副本' : ` - 副本 ${number}`;
          const destination = path.join(parsed.dir, stem + suffix + extension);
          try {
            if (stat.isDirectory()) await fs.cp(source, destination, { recursive: true, errorOnExist: true, force: false });
            else await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
            undo.push({ kind: 'copy', to: destination });
            return destination;
          } catch (error) {
            if (!['EEXIST', 'ERR_FS_CP_EEXIST'].includes(error.code)) throw error;
            number += 1;
          }
        }
      });
    },
    async createDirectory(parent, name) {
      const directory = path.join(path.resolve(parent), validateName(name));
      await fs.mkdir(directory);
      return directory;
    },
    async trashPath(filePath) {
      await shell.trashItem(path.resolve(filePath));
      return true;
    },
    async undoFileOperation() {
      const operation = undo.at(-1);
      if (!operation) return null;
      if (operation.kind === 'move') await relocate(operation.to, operation.from, false);
      else await shell.trashItem(operation.to);
      undo.pop();
      return operation;
    },
  };
}

module.exports = { createFileOperations };

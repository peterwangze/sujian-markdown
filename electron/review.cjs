const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const { decode, documentExtension, getDocument, pathKey } = require('./documents.cjs');

const runFile = promisify(execFile);
const maxReviewBytes = 4 * 1024 * 1024;
const objectId = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

function applicationArguments(argv, { defaultApp, appPath, directory = process.cwd() }) {
  if (!defaultApp) return argv.slice(1);
  const application = argv.findIndex((argument, index) => index > 0 && !argument.startsWith('-') &&
    pathKey(path.resolve(directory, argument)) === pathKey(appPath));
  return argv.slice(application < 0 ? 2 : application + 1);
}

function fileArgument(value, directory) {
  if (typeof value !== 'string' || value.startsWith('-') || value.includes('\0') || !documentExtension.test(value)) {
    throw new Error('请指定 Markdown 或纯文本文件的路径。');
  }
  return path.resolve(directory, value);
}

function parseCommand(args, directory = process.cwd()) {
  const first = args.findIndex((argument) => !argument.startsWith('-'));
  if (first < 0) return null;
  const command = args.slice(first);
  const [kind, target, option, value, ...rest] = command;
  if (kind === 'open') {
    if (command.length === 2) return { kind, path: fileArgument(target, directory) };
    const line = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
    if (option !== '--line' || !Number.isSafeInteger(line) || line < 1 || rest.length) {
      throw new Error('用法：open <文件路径> [--line <正整数>]');
    }
    return { kind, path: fileArgument(target, directory), line };
  }
  if (kind === 'review') {
    if (option !== '--candidate' || typeof value !== 'string' || rest.length) {
      throw new Error('用法：review <目标文档> --candidate <候选稿>');
    }
    return { kind, path: fileArgument(target, directory), candidatePath: fileArgument(value, directory) };
  }
  return null;
}

async function readCandidate(filePath) {
  if (!documentExtension.test(filePath)) throw new Error('请选择 Markdown 或纯文本候选稿。');
  const document = await readReviewSnapshot(filePath, { requireCanonical: false });
  if (!document) throw new Error('候选稿文件已移动或删除。');
  return { text: document.text, name: document.name };
}

async function materializeCommand(command) {
  if (!command) return null;
  if (command.kind !== 'review') return command;
  return { kind: command.kind, path: command.path, candidate: await readCandidate(command.candidatePath) };
}

async function readReviewSnapshot(filePath, { requireCanonical = true } = {}) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !documentExtension.test(filePath)) {
    throw new Error('请选择 Markdown 或纯文本文件。');
  }
  try {
    return await getDocument(filePath, { maxBytes: maxReviewBytes, requireCanonical });
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error.code === 'ERR_DOCUMENT_TOO_LARGE') throw new Error('修订稿审阅支持最大 4 MiB 的文档。');
    if (error.code === 'ERR_DOCUMENT_PATH_CHANGED') throw new Error('文件位置已更改，请重新打开后再审阅。');
    if (error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') throw new Error('无法识别文件编码，请使用 UTF-8 或带 BOM 的 UTF-16。');
    throw error;
  }
}

async function findGit() {
  const executable = process.platform === 'win32' ? 'git.exe' : 'git';
  for (const entry of (process.env.PATH || '').split(path.delimiter)) {
    const directory = entry.replace(/^"(.*)"$/, '$1');
    if (!path.isAbsolute(directory)) continue;
    const filePath = path.join(directory, executable);
    try {
      await fs.access(filePath, constants.X_OK);
      if ((await fs.stat(filePath)).isFile()) return filePath;
    } catch {
      // Continue searching the configured executable directories.
    }
  }
  throw new Error('未找到 Git。请安装 Git，并确认应用可以从 PATH 访问它。');
}

function gitEnvironment() {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)));
  return {
    ...inherited, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1',
    GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1',
  };
}

function gitFailure(error, fallback) {
  if (error.killed) return new Error('读取 Git 版本超时。');
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return new Error('修订稿审阅支持最大 4 MiB 的文档。');
  return new Error(fallback, { cause: error });
}

async function readGitBaseline({ documentPath, ref = 'HEAD' }) {
  if (typeof documentPath !== 'string' || !path.isAbsolute(documentPath) || !documentExtension.test(documentPath)) {
    throw new Error('请先打开一个 Git 工作区中的 Markdown 文档。');
  }
  if (typeof ref !== 'string' || !ref || ref.length > 512 || /^-/.test(ref) || /[\u0000-\u0020\u007f:]/.test(ref)) {
    throw new Error('请输入有效的 Git 分支名、标签或提交版本。');
  }

  const filePath = await fs.realpath(documentPath);
  if (pathKey(filePath) !== pathKey(documentPath) || !(await fs.stat(filePath)).isFile()) {
    throw new Error('文件位置已更改，请重新打开后再读取 Git 版本。');
  }
  const executable = await findGit();
  const environment = gitEnvironment();
  const git = async (directory, args, fallback) => {
    try {
      const { stdout } = await runFile(executable, [
        '-C', directory, '--no-pager', '--literal-pathspecs', '-c', 'protocol.allow=never', ...args,
      ], { env: environment, encoding: 'buffer', windowsHide: true, timeout: 7000, maxBuffer: maxReviewBytes + 1024 });
      return stdout;
    } catch (error) {
      throw gitFailure(error, fallback);
    }
  };

  const rootOutput = await git(path.dirname(filePath), ['rev-parse', '--show-toplevel'], '该文档不在可读取的 Git 工作区中。');
  const rootName = rootOutput.toString('utf8').replace(/\r?\n$/, '');
  if (!path.isAbsolute(rootName)) throw new Error('无法确定 Git 工作区路径。');
  const root = await fs.realpath(rootName);
  const relative = path.relative(root, filePath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('所选文档不在 Git 工作区内。');
  }
  const repoPath = relative.split(path.sep).join('/');
  const commit = (await git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], '找不到指定的 Git 提交版本。')).toString('utf8').trim();
  if (!objectId.test(commit)) throw new Error('Git 返回了无法识别的提交版本。');

  const entry = await git(root, ['ls-tree', '-z', '--full-tree', commit, '--', repoPath], '无法读取该 Git 版本中的文档。');
  const tab = entry.indexOf(9);
  const end = entry.indexOf(0, tab + 1);
  const metadata = tab > 0 ? entry.subarray(0, tab).toString('ascii').split(' ') : [];
  const [mode, type, blob] = metadata;
  if (end !== entry.length - 1 || entry.subarray(tab + 1, end).toString('utf8') !== repoPath ||
    !['100644', '100755'].includes(mode) || type !== 'blob' || !objectId.test(blob ?? '')) {
    throw new Error('此文档在指定 Git 版本中不存在，或不是普通文件。');
  }
  const bytes = await git(root, ['cat-file', 'blob', blob], '无法读取本地 Git 对象。');
  if (bytes.length > maxReviewBytes) throw new Error('修订稿审阅支持最大 4 MiB 的文档。');
  try {
    return { text: decode(bytes).text, name: `${ref} · ${commit.slice(0, 8)}` };
  } catch {
    throw new Error('无法识别 Git 版本的文件编码，请使用 UTF-8 或带 BOM 的 UTF-16。');
  }
}

module.exports = { applicationArguments, materializeCommand, parseCommand, readCandidate, readGitBaseline, readReviewSnapshot };

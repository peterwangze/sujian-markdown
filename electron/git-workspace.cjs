const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { promisify } = require('node:util');
const { pathKey, serialized } = require('./documents.cjs');
const { findGit, gitEnvironment } = require('./review.cjs');

const execGit = promisify(execFile);
const commitId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const interruptedOperations = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'BISECT_LOG'];

async function directoryPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) throw new Error('请选择有效的工作区目录。');
  const directory = await fs.realpath(value).catch(() => null);
  if (!directory || !(await fs.stat(directory).catch(() => null))?.isDirectory()) throw new Error('所选目录已移动或不存在。');
  return directory;
}

function gitRunner(executable, directory) {
  const environment = { ...gitEnvironment(), LC_ALL: 'C', LANG: 'C' };
  return async (args, { index, timeout = 12_000 } = {}) => {
    const env = index ? { ...environment, GIT_INDEX_FILE: index } : environment;
    const { stdout } = await execGit(executable, [
      '-C', directory, '--no-pager', '--literal-pathspecs', '-c', 'protocol.allow=never',
      '-c', 'core.fsmonitor=false', ...args,
    ], { env, encoding: 'utf8', maxBuffer: 24 * 1024 * 1024, timeout, windowsHide: true });
    return stdout;
  };
}

function friendlyFailure(error, fallback) {
  if (error.killed) return new Error(fallback + ' Git 操作超时。', { cause: error });
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return new Error(fallback + ' Git 输出超出可读取的上限。', { cause: error });
  // Git hooks and signing tools may write useful diagnostics to either stream.
  const detail = (error.stderr?.trim() || error.stdout?.trim() || '').slice(-1800);
  return new Error(detail ? `${fallback}\n${detail}` : fallback, { cause: error });
}

async function repositoryAt(git, directory) {
  try {
    const output = await git(['rev-parse', '--show-toplevel', '--absolute-git-dir']);
    const lines = output.replace(/\r?\n$/, '').split(/\r?\n/);
    if (lines.length !== 2 || !lines.every(value => path.isAbsolute(value))) throw new Error('无法确定 Git 仓库路径。');
    const [root, gitDirectory] = await Promise.all(lines.map(value => fs.realpath(value)));
    return { root, gitDirectory, scope: pathKey(root) === pathKey(directory) ? 'root' : 'inside' };
  } catch (error) {
    if (error.code === 128 && /not a git repository/i.test(error.stderr)) return { root: null, scope: 'none' };
    throw friendlyFailure(error, '无法读取所选目录的 Git 状态。');
  }
}

function parseStatus(output) {
  const records = output.split('\0');
  const changes = [];
  let head = null;
  let branch = null;
  let detached = false;
  let conflicts = false;
  let nested = false;
  for (let index = 0; index < records.length; index += 1) {
    const value = records[index];
    if (value.startsWith('# branch.oid ')) {
      const hash = value.slice(13);
      if (commitId.test(hash)) head = hash;
    } else if (value.startsWith('# branch.head ')) {
      branch = value.slice(14);
      if (branch === '(detached)') { detached = true; branch = null; }
    } else if (value.startsWith('? ')) {
      const name = value.slice(2);
      if (name.endsWith('/')) nested = true;
      changes.push({ status: '??', path: name });
    } else if (/^[12u] /.test(value)) {
      // Fixed-width metadata precedes the filename, which may contain spaces or newlines.
      const fields = value.split(' ');
      const pathIndex = value[0] === 'u' ? 10 : value[0] === '2' ? 9 : 8;
      const change = { status: fields[1].replaceAll('.', ' '), path: fields.slice(pathIndex).join(' ') };
      if (value[0] === '2') change.previousPath = records[++index];
      if (value[0] === 'u') conflicts = true;
      changes.push(change);
    }
  }
  return { head, branch, detached, conflicts, nested, changes };
}

async function identityConfigured(git) {
  const identity = async name => {
    try {
      await git(['-c', 'user.useConfigOnly=true', 'var', name]);
      return true;
    } catch (error) {
      if (error.code === 128 && /identity unknown|no name was given|no email was given|empty ident name|unable to auto-detect/i.test(error.stderr)) return false;
      throw error;
    }
  };
  return (await Promise.all([identity('GIT_AUTHOR_IDENT'), identity('GIT_COMMITTER_IDENT')])).every(Boolean);
}

async function pausedOperation(gitDirectory) {
  for (const name of interruptedOperations) {
    try {
      await fs.lstat(path.join(gitDirectory, name));
      return true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return false;
}

async function statusFingerprint(root, output, changes) {
  const fingerprint = createHash('sha256').update(output);
  const paths = new Set(changes.flatMap(change => change.previousPath ? [change.path, change.previousPath] : [change.path]));
  const names = [...paths];
  const metadata = async name => {
    const file = path.resolve(root, name);
    const relative = path.relative(root, file);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return 'outside';
    try {
      const { mtimeNs, ctimeNs, size, ino, dev, mode } = await fs.lstat(file, { bigint: true });
      return [mtimeNs, ctimeNs, size, ino, dev, mode].join(':');
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      return 'missing';
    }
  };
  for (let start = 0; start < names.length; start += 32) {
    const rows = await Promise.all(names.slice(start, start + 32).map(metadata));
    for (const row of rows) fingerprint.update(`\0${row}`);
  }
  return fingerprint.digest('hex');
}

async function repositoryStatus(git, directory, repository) {
  try {
    const [output, hasIdentity, paused] = await Promise.all([
      git(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--ignore-submodules=dirty']),
      identityConfigured(git),
      pausedOperation(repository.gitDirectory),
    ]);
    const { head, branch, detached, conflicts, nested, changes } = parseStatus(output);
    let blocked = null;
    if (conflicts || paused) blocked = '仓库存在尚未完成的 Git 操作。请先在 Git 中处理冲突或完成当前操作。';
    else if (detached) blocked = '当前仓库处于分离 HEAD 状态。请先切换到要提交的分支。';
    else if (nested) blocked = '发现未跟踪的嵌套 Git 仓库。请在其自身目录中提交，并在上层仓库忽略该目录。';
    else if (!hasIdentity) blocked = '请先在 Git 中配置提交者姓名和邮箱。';
    const snapshot = await statusFingerprint(repository.root, output, changes);
    return { available: true, directory, scope: repository.scope, root: repository.root,
      head, branch, hasIdentity, changes, blocked, snapshot };
  } catch (error) {
    throw friendlyFailure(error, '无法读取工作区的 Git 改动。');
  }
}

async function inspectGitWorkspace(value) {
  const directory = await directoryPath(value);
  let executable;
  try { executable = await findGit(); } catch (error) {
    return { available: false, directory, scope: 'none', root: null, hasIdentity: false, changes: [], blocked: error.message };
  }
  const git = gitRunner(executable, directory);
  const repository = await repositoryAt(git, directory);
  if (repository.scope !== 'root') {
    return { available: true, directory, scope: repository.scope, root: repository.root,
      branch: null, head: null, hasIdentity: await identityConfigured(git), changes: [], blocked: null };
  }
  return repositoryStatus(git, directory, repository);
}

async function initGitWorkspace(value) {
  const directory = await directoryPath(value);
  const executable = await findGit();
  return serialized(directory, async () => {
    const git = gitRunner(executable, directory);
    const before = await repositoryAt(git, directory);
    if (before.scope === 'inside') throw new Error('所选目录已属于上层 Git 仓库，请在仓库根目录操作。');
    if (before.scope === 'none') {
      const marker = await fs.lstat(path.join(directory, '.git')).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (marker) throw new Error('所选目录已有无法识别的 .git，请在 Git 中检查仓库。');
      try {
        // An empty template avoids introducing hooks into a new repository from configured templates.
        await git(['init', '--quiet', '--template=']);
      } catch (error) {
        throw friendlyFailure(error, '无法初始化 Git 仓库。');
      }
    }
    return repositoryStatus(git, directory, await repositoryAt(git, directory));
  });
}

async function publishIndex(lockPath, indexPath) {
  for (let attempt = 0; ; attempt += 1) {
    try { await fs.rename(lockPath, indexPath); return; } catch (error) {
      if (process.platform !== 'win32' || attempt === 4 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      await delay(30 * 2 ** attempt);
    }
  }
}

async function commitGitWorkspace({ directory: value, message, expectedSnapshot } = {}) {
  if (typeof message !== 'string' || !message.trim() || message.length > 2000 || message.includes('\0')) {
    throw new Error('请输入 1 到 2000 个字符的提交说明。');
  }
  if (typeof expectedSnapshot !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSnapshot)) throw new Error('请先刷新并确认 Git 改动。');
  const directory = await directoryPath(value);
  const executable = await findGit();
  return serialized(directory, async () => {
    const git = gitRunner(executable, directory);
    const repository = await repositoryAt(git, directory);
    if (repository.scope !== 'root') throw new Error('请在目标 Git 仓库的根目录提交。');
    const indexPath = path.join(repository.gitDirectory, 'index');
    const lockPath = `${indexPath}.lock`;
    let temporary, ownsLock = false;
    try {
      try {
        const lock = await fs.open(lockPath, 'wx');
        ownsLock = true;
        await lock.close();
      } catch (error) {
        if (error.code === 'EEXIST') throw new Error('Git 暂存区正在使用，请结束其他 Git 操作后重试。');
        throw error;
      }
      const status = await repositoryStatus(git, directory, repository);
      if (status.snapshot !== expectedSnapshot) return { status: 'changed', workspace: status };
      if (status.blocked) throw new Error(status.blocked);
      if (!status.changes.length) return { status: 'clean', branch: status.branch, hash: status.head, changes: 0 };

      temporary = await fs.mkdtemp(path.join(repository.gitDirectory, 'sujian-commit-'));
      const index = path.join(temporary, 'index');
      try { await fs.copyFile(indexPath, index); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const paths = new Set();
      for (const change of status.changes) {
        if (change.status[1] === ' ') continue;
        paths.add(change.path);
        if (change.previousPath && change.status[1] === 'R') paths.add(change.previousPath);
      }
      if (paths.size) {
        const pathspecs = path.join(temporary, 'paths');
        await fs.writeFile(pathspecs, [...paths].map(name => `${name}\0`).join(''));
        try { await git(['add', '-A', `--pathspec-from-file=${pathspecs}`, '--pathspec-file-nul'], { index, timeout: 60_000 }); } catch (error) {
          throw friendlyFailure(error, '无法暂存已确认的改动。');
        }
      }
      const staged = await git(['diff', '--cached', '--name-only', '-z', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none'], { index });
      const current = await repositoryStatus(git, directory, repository);
      if (current.snapshot !== status.snapshot) return { status: 'changed', workspace: current };
      if (current.blocked) throw new Error(current.blocked);

      // Prepare the replacement before creating a commit. Git commits using the private index, including configured hooks.
      await fs.copyFile(index, lockPath);
      let hash = status.head;
      if (staged) {
        try {
          await git(['-c', 'user.useConfigOnly=true', 'commit', '--message', message.trim()], { index, timeout: 60_000 });
        } catch (error) {
          const afterFailure = await git(['rev-parse', '--verify', 'HEAD']).catch(() => '');
          hash = afterFailure.trim();
          if (!commitId.test(hash) || hash === status.head) throw friendlyFailure(error, '未能提交 Git 改动。');
        }
        const output = await git(['rev-parse', '--verify', 'HEAD']).catch(() => '');
        if (commitId.test(output.trim())) hash = output.trim();
      }
      try {
        // A hook may have modified the private index during commit.
        await fs.copyFile(index, lockPath);
        await publishIndex(lockPath, indexPath);
        ownsLock = false;
      } catch (error) {
        const fallback = staged ? '提交已生成，但暂存区未能同步。请在 Git 中检查当前状态。' : '未能更新 Git 暂存区。';
        throw friendlyFailure(error, fallback);
      }
      return { status: staged ? 'committed' : 'clean', hash, branch: status.branch, changes: staged.split('\0').filter(Boolean).length };
    } finally {
      if (ownsLock) await fs.rm(lockPath, { force: true }).catch(() => {});
      if (temporary) await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
    }
  });
}

module.exports = { commitGitWorkspace, initGitWorkspace, inspectGitWorkspace };

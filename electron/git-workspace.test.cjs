const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { promisify } = require('node:util');
const { commitGitWorkspace, initGitWorkspace, inspectGitWorkspace } = require('./git-workspace.cjs');
const { findGit, gitEnvironment, readGitBaseline } = require('./review.cjs');

const run = promisify(execFile);

async function fixture(context) {
  let executable;
  try { executable = await findGit(); } catch { context.skip('Git executable unavailable'); return null; }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sujian-git-workspace-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  function git(directory, ...args) {
    return run(executable, ['-C', directory, ...args], { env: gitEnvironment(), windowsHide: true }).then(result => result.stdout);
  }
  const identity = async directory => {
    await git(directory, 'config', 'user.name', 'Sujian QA');
    await git(directory, 'config', 'user.email', 'sujian@example.invalid');
    await git(directory, 'config', 'commit.gpgsign', 'false');
    await git(directory, 'config', 'core.hooksPath', path.join(directory, '.git', 'hooks-test'));
  };
  return { root, git, identity };
}

test('initializes the selected folder, stages its changes and exposes the commit to Git review', async context => {
  const setup = await fixture(context);
  if (!setup) return;
  const { root, git, identity } = setup;
  const selected = path.join(root, '选中目录');
  const nested = path.join(selected, '章节');
  const note = path.join(nested, '中文 笔记.md');
  await fs.mkdir(nested, { recursive: true });
  await fs.writeFile(note, '# 已提交的底稿\n');
  await fs.writeFile(path.join(root, '不属于仓库.md'), 'outside');
  await fs.writeFile(path.join(selected, '.gitignore'), 'ignore.bin\n');
  await fs.writeFile(path.join(selected, 'ignore.bin'), 'ignored');

  assert.equal((await inspectGitWorkspace(selected)).scope, 'none');
  const initialized = await initGitWorkspace(selected);
  assert.equal(initialized.scope, 'root');
  assert.equal(initialized.head, null);
  assert.ok(initialized.branch);
  assert.equal((await inspectGitWorkspace(root)).scope, 'none');
  const inside = await inspectGitWorkspace(nested);
  assert.equal(inside.scope, 'inside');
  assert.equal(inside.root, initialized.root);
  await assert.rejects(initGitWorkspace(nested), /已属于上层/);
  await assert.rejects(fs.access(path.join(nested, '.git')), { code: 'ENOENT' });

  await identity(selected);
  const status = await inspectGitWorkspace(selected);
  assert.equal(status.hasIdentity, true);
  assert.equal(status.blocked, null);
  assert.deepEqual(status.changes.map(row => row.path), ['.gitignore', '章节/中文 笔记.md']);
  await assert.rejects(commitGitWorkspace({ directory: nested, message: 'Wrong scope', expectedSnapshot: status.snapshot }), /仓库的根目录/);
  const result = await commitGitWorkspace({ directory: selected, message: '初始化文档仓库', expectedSnapshot: status.snapshot });
  assert.equal(result.status, 'committed');
  assert.equal(result.changes, 2);
  assert.equal((await git(selected, 'rev-parse', 'HEAD')).trim(), result.hash);
  assert.equal((await git(selected, 'log', '-1', '--format=%s')).trim(), '初始化文档仓库');
  assert.deepEqual((await inspectGitWorkspace(selected)).changes, []);
  assert.equal((await readGitBaseline({ documentPath: await fs.realpath(note) })).text, '# 已提交的底稿\n');

  await fs.rename(note, path.join(selected, '移动后.md'));
  await fs.writeFile(path.join(selected, '-安全路径.md'), 'non-option path');
  const secondStatus = await inspectGitWorkspace(selected);
  const second = await commitGitWorkspace({ directory: selected, message: '移动与新增', expectedSnapshot: secondStatus.snapshot });
  assert.equal(second.status, 'committed');
  assert.deepEqual((await git(selected, 'ls-tree', '-r', '--name-only', '-z', 'HEAD')).split('\0').filter(Boolean).sort(),
    ['-安全路径.md', '.gitignore', '移动后.md'].sort());
  assert.deepEqual((await inspectGitWorkspace(selected)).changes, []);
});

test('returns a stale snapshot and leaves the existing staged content intact on a failed commit', async context => {
  const setup = await fixture(context);
  if (!setup) return;
  const { root, git, identity } = setup;
  await initGitWorkspace(root);
  await identity(root);
  const note = path.join(root, 'note.md');
  await fs.writeFile(note, 'base\n');
  let preview = await inspectGitWorkspace(root);
  await commitGitWorkspace({ directory: root, message: 'initial', expectedSnapshot: preview.snapshot });

  await fs.writeFile(note, 'staged\n');
  await git(root, 'add', 'note.md');
  await fs.writeFile(note, 'worktree\n');
  preview = await inspectGitWorkspace(root);
  assert.deepEqual(preview.changes, [{ status: 'MM', path: 'note.md' }]);
  await fs.writeFile(note, 'worktree revised\n');
  const sameStatus = await commitGitWorkspace({ directory: root, message: 'stale bytes', expectedSnapshot: preview.snapshot });
  assert.equal(sameStatus.status, 'changed');
  assert.deepEqual(sameStatus.workspace.changes, preview.changes);
  await fs.writeFile(note, 'worktree\n');
  preview = await inspectGitWorkspace(root);
  const extra = path.join(root, 'new.md');
  await fs.writeFile(extra, 'new\n');
  const stale = await commitGitWorkspace({ directory: root, message: 'stale', expectedSnapshot: preview.snapshot });
  assert.equal(stale.status, 'changed');
  assert.ok(stale.workspace.changes.some(change => change.path === 'new.md'));

  const gitDir = path.join(root, '.git');
  const hooks = path.join(gitDir, 'hooks-test');
  await fs.mkdir(hooks);
  await fs.writeFile(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho "test hook rejected commit" >&2\nexit 1\n', { mode: 0o755 });
  await assert.rejects(commitGitWorkspace({ directory: root, message: 'fail hook', expectedSnapshot: stale.workspace.snapshot }), /test hook rejected commit/);
  assert.equal(await git(root, 'show', ':note.md'), 'staged\n');
  assert.equal(await git(root, 'show', 'HEAD:note.md'), 'base\n');
  assert.equal(await fs.readFile(note, 'utf8'), 'worktree\n');
  await assert.rejects(fs.access(path.join(gitDir, 'index.lock')), { code: 'ENOENT' });
  assert.ok((await fs.readdir(gitDir)).every(name => !name.startsWith('sujian-commit-')));
  const externalLock = path.join(gitDir, 'index.lock');
  await fs.writeFile(externalLock, 'owned by another Git process', { flag: 'wx' });
  await assert.rejects(commitGitWorkspace({ directory: root, message: 'lock exists', expectedSnapshot: stale.workspace.snapshot }), /暂存区正在使用/);
  assert.equal(await fs.readFile(externalLock, 'utf8'), 'owned by another Git process');
});

test('blocks unresolved operations and nested repositories before staging', async context => {
  const setup = await fixture(context);
  if (!setup) return;
  const { root, git, identity } = setup;
  const main = path.join(root, 'main');
  const nested = path.join(main, 'nested');
  await fs.mkdir(nested, { recursive: true });
  // An existing independently initialized child must not be silently staged as an embedded repository.
  await initGitWorkspace(nested);
  await identity(nested);
  await fs.writeFile(path.join(nested, 'child.md'), 'child');
  const child = await inspectGitWorkspace(nested);
  await commitGitWorkspace({ directory: nested, message: 'nested baseline', expectedSnapshot: child.snapshot });
  await initGitWorkspace(main);
  await identity(main);
  const blocked = await inspectGitWorkspace(main);
  assert.match(blocked.blocked, /嵌套 Git 仓库/);
  await assert.rejects(commitGitWorkspace({ directory: main, message: 'never add nested', expectedSnapshot: blocked.snapshot }), /嵌套 Git 仓库/);
  assert.equal(await git(main, 'ls-files'), '');

  await fs.writeFile(path.join(main, '.gitignore'), 'nested/\n');
  const clean = await inspectGitWorkspace(main);
  await commitGitWorkspace({ directory: main, message: 'ignore nested', expectedSnapshot: clean.snapshot });
  await git(main, 'checkout', '--detach');
  assert.match((await inspectGitWorkspace(main)).blocked, /分离 HEAD/);
  await git(main, 'checkout', clean.branch);
  const head = (await git(main, 'rev-parse', 'HEAD')).trim();
  await fs.writeFile(path.join(main, '.git', 'MERGE_HEAD'), head + '\n');
  assert.match((await inspectGitWorkspace(main)).blocked, /尚未完成的 Git 操作/);
});

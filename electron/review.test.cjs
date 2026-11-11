const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { applicationArguments, materializeCommand, parseCommand, readCandidate, readGitBaseline, readReviewSnapshot } = require('./review.cjs');

async function fixture(t) {
  const temporary = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(temporary, 'sujian-review-'));
  t.after(async () => {
    const resolved = await fs.realpath(directory);
    assert.equal(path.dirname(resolved), temporary);
    assert.ok(path.basename(resolved).startsWith('sujian-review-'));
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 3 });
  });
  return directory;
}

test('the CLI parser isolates explicit commands from legacy paths', async (t) => {
  const directory = await fixture(t);
  const target = '包含空格 的文档.md';
  assert.equal(parseCommand([target], directory), null);
  assert.deepEqual(parseCommand(['open', target], directory), { kind: 'open', path: path.join(directory, target) });
  assert.deepEqual(parseCommand(['open', target, '--line', '9'], directory), { kind: 'open', path: path.join(directory, target), line: 9 });
  assert.deepEqual(parseCommand(['--user-data-dir=isolated', 'open', target], directory), { kind: 'open', path: path.join(directory, target) });
  assert.deepEqual(parseCommand(['review', target, '--candidate', '候选稿.txt'], directory), {
    kind: 'review', path: path.join(directory, target), candidatePath: path.join(directory, '候选稿.txt'),
  });
  for (const line of ['0', '-2', '1.3', '1e4', '9007199254740992']) {
    assert.throws(() => parseCommand(['open', target, '--line', line], directory), /正整数/);
  }
  assert.throws(() => parseCommand(['open', '--line'], directory), /文件的路径/);
  assert.throws(() => parseCommand(['review', target, '--candidate', '候选稿.exe'], directory), /文件的路径/);
  assert.throws(() => parseCommand(['review', target, '--candidate', '候选稿.md', '--save'], directory), /用法/);
  assert.deepEqual(applicationArguments(['electron', '--user-data-dir=isolated', directory, 'open', target], {
    defaultApp: true, appPath: directory,
  }), ['open', target]);
  assert.deepEqual(applicationArguments(['Sujian', 'open', target], { defaultApp: false, appPath: directory }), ['open', target]);
});

test('candidate intake preserves files and decodes supported source encodings', async (t) => {
  const directory = await fixture(t);
  const candidate = path.join(directory, '候选稿.md');
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('第一行\r\n第二行 🎉', 'utf16le')]);
  await fs.writeFile(candidate, bytes);
  const command = parseCommand(['review', '底稿.md', '--candidate', '候选稿.md'], directory);
  assert.deepEqual(await materializeCommand(command), {
    kind: 'review', path: path.join(directory, '底稿.md'), candidate: { text: '第一行\n第二行 🎉', name: '候选稿.md' },
  });
  assert.deepEqual(await fs.readFile(candidate), bytes);
  const snapshot = await readReviewSnapshot(candidate);
  assert.equal(snapshot.eol, '\r\n');
  assert.equal(snapshot.bom, true);
  assert.match(snapshot.hash, /^[a-f0-9]{64}$/);

  const large = path.join(directory, 'large.md');
  const handle = await fs.open(large, 'w');
  await handle.truncate(4 * 1024 * 1024 + 1).finally(() => handle.close());
  await assert.rejects(() => readCandidate(large), /4 MiB/);
  await fs.writeFile(large, Buffer.from([0xff]));
  await assert.rejects(() => readCandidate(large), /编码/);
  const missing = path.join(directory, 'missing.md');
  assert.equal(await readReviewSnapshot(missing), null);
  await assert.rejects(() => readCandidate(missing), /已移动或删除/);
});

function git(directory, ...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)));
  return execFileSync('git', ['-C', directory, '--literal-pathspecs', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false',
    '-c', 'user.name=Sujian Test', '-c', 'user.email=test@example.invalid', ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('the selected Git commit is read without changing the worktree', async (t) => {
  const directory = await fixture(t);
  try { git(directory, '--version'); } catch (error) {
    if (error.code === 'ENOENT') return t.skip('Git is unavailable');
    throw error;
  }
  const repository = path.join(directory, '仓库 空格');
  await fs.mkdir(repository);
  git(repository, 'init', '--quiet');
  const notes = path.join(repository, '资料');
  await fs.mkdir(notes);
  const name = '版本 [样例] 🌱.md';
  const documentPath = path.join(notes, name);
  await fs.writeFile(documentPath, '第一版\r\n无结尾换行');
  git(repository, 'add', '--', `资料/${name}`);
  git(repository, 'commit', '--quiet', '--no-verify', '-m', 'Baseline');
  const firstCommit = git(repository, 'rev-parse', 'HEAD').trim();
  await fs.writeFile(documentPath, '第二版\n');
  git(repository, 'add', '--', `资料/${name}`);
  git(repository, 'commit', '--quiet', '--no-verify', '-m', 'Update');
  await fs.writeFile(documentPath, '未提交的编辑');

  assert.deepEqual(await readGitBaseline({ documentPath, ref: firstCommit }), {
    text: '第一版\n无结尾换行', name: `${firstCommit} · ${firstCommit.slice(0, 8)}`,
  });
  assert.equal((await readGitBaseline({ documentPath })).text, '第二版\n');
  assert.equal(await fs.readFile(documentPath, 'utf8'), '未提交的编辑');
  await assert.rejects(() => readGitBaseline({ documentPath, ref: '--help' }), /有效的 Git/);
  await assert.rejects(() => readGitBaseline({ documentPath, ref: 'HEAD:其他文件.md' }), /有效的 Git/);
  await assert.rejects(() => readGitBaseline({ documentPath, ref: 'missing-tag' }), /找不到/);

  const untracked = path.join(notes, '未跟踪.md');
  await fs.writeFile(untracked, '未跟踪文件');
  await assert.rejects(() => readGitBaseline({ documentPath: untracked }), /不存在/);

  const linked = path.join(directory, '工作树');
  git(repository, 'worktree', 'add', '--quiet', '--detach', linked, firstCommit);
  const linkedFile = path.join(linked, '资料', name);
  assert.equal((await readGitBaseline({ documentPath: linkedFile })).text, '第一版\n无结尾换行');

  const alias = path.join(directory, '链接');
  try { await fs.symlink(notes, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return; else throw error; }
  await assert.rejects(() => readGitBaseline({ documentPath: path.join(alias, name) }), /文件位置已更改/);
});

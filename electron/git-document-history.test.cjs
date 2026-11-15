const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { promisify } = require('node:util');
const { listGitDocumentHistory, readGitDocumentRevision } = require('./git-document-history.cjs');
const { findGit, gitEnvironment } = require('./review.cjs');

const run = promisify(execFile);

async function fixture(context) {
  let executable;
  try { executable = await findGit(); } catch { context.skip('Git executable unavailable'); return null; }
  const temporary = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(temporary, 'sujian-git-document-history-'));
  context.after(async () => {
    const resolved = await fs.realpath(directory);
    assert.equal(path.dirname(resolved), temporary);
    assert.ok(path.basename(resolved).startsWith('sujian-git-document-history-'));
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 3 });
  });
  const git = (...args) => run(executable, ['-C', directory, '--literal-pathspecs', '-c', 'user.name=测试作者',
    '-c', 'user.email=history@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args],
  { env: gitEnvironment(), encoding: 'utf8', windowsHide: true }).then(({ stdout }) => stdout);
  return { directory, executable, git };
}

test('lists only commits affecting the selected document, including older paths and deletions', async context => {
  const setup = await fixture(context);
  if (!setup) return;
  const { directory, git } = setup;
  const previous = path.join(directory, '原版 中文.md');
  const documentPath = path.join(directory, '现在的 [版本].md');
  const other = path.join(directory, '其他文档.md');
  const firstVersion = '# 第一版\n\n可直接审阅的内容\n共享正文\n';
  await fs.writeFile(previous, firstVersion);
  assert.deepEqual(await listGitDocumentHistory({ documentPath: previous }), {
    status: 'not-repository', entries: [], nextCursor: null,
  });
  await git('init', '--quiet', '--template=');
  assert.deepEqual(await listGitDocumentHistory({ documentPath: previous }), { status: 'empty', entries: [], nextCursor: null });
  await git('add', '--', path.basename(previous));
  await git('commit', '--quiet', '-m', '建立文档');
  const initial = (await git('rev-parse', 'HEAD')).trim();

  await fs.writeFile(other, 'This document is unrelated.\n');
  await git('add', '--', path.basename(other));
  await git('commit', '--quiet', '-m', '仅修改其他文档');
  const unrelated = (await git('rev-parse', 'HEAD')).trim();

  await git('mv', '--', path.basename(previous), path.basename(documentPath));
  await git('commit', '--quiet', '-m', '重命名文档');
  await git('rm', '--', path.basename(documentPath));
  await git('commit', '--quiet', '-m', '暂时删除文档');
  const deleted = (await git('rev-parse', 'HEAD')).trim();
  await fs.writeFile(documentPath, '恢复后的版本\n');
  await git('add', '--', path.basename(documentPath));
  await git('commit', '--quiet', '-m', '恢复文档');
  await fs.appendFile(documentPath, '磁盘上的改动\n');
  await git('add', '--', path.basename(documentPath));
  await fs.appendFile(documentPath, '仍在编辑的改动\n');
  const before = await git('status', '--porcelain=v2', '-z');
  const indexed = await git('show', `:${path.basename(documentPath)}`);

  const result = await listGitDocumentHistory({ documentPath });
  assert.equal(result.status, 'ready');
  assert.equal(result.nextCursor, null);
  assert.deepEqual(result.entries.map(entry => [entry.subject, entry.available, entry.path]), [
    ['恢复文档', true, undefined],
    ['暂时删除文档', false, undefined],
    ['重命名文档', true, undefined],
    ['建立文档', true, '原版 中文.md'],
  ]);
  assert.equal(result.entries[0].author, '测试作者');
  assert.ok(Number.isFinite(Date.parse(result.entries[0].date)));
  assert.equal((await readGitDocumentRevision({ documentPath, commit: initial })).text, firstVersion);
  await assert.rejects(() => readGitDocumentRevision({ documentPath, commit: deleted }), /删除了文档/);
  await assert.rejects(() => readGitDocumentRevision({ documentPath, commit: unrelated }), /不在当前文档/);
  await assert.rejects(() => readGitDocumentRevision({ documentPath, commit: '--help' }), /无效/);
  assert.equal(await git('status', '--porcelain=v2', '-z'), before);
  assert.equal(await git('show', `:${path.basename(documentPath)}`), indexed);
  assert.equal(await fs.readFile(documentPath, 'utf8'), '恢复后的版本\n磁盘上的改动\n仍在编辑的改动\n');

  const untracked = path.join(directory, '未跟踪的草稿.md');
  await fs.writeFile(untracked, 'Draft');
  assert.equal((await listGitDocumentHistory({ documentPath: untracked })).status, 'empty');
});

function fastImport(executable, directory, data) {
  return new Promise((resolve, reject) => {
    const child = execFile(executable, ['-C', directory, 'fast-import', '--quiet'], {
      env: gitEnvironment(), windowsHide: true, maxBuffer: 1024 * 1024, timeout: 10000,
    }, error => error ? reject(error) : resolve());
    child.stdin.on('error', reject);
    child.stdin.end(data);
  });
}

test('paginates the document history without counting unrelated commits as rows', async context => {
  const setup = await fixture(context);
  if (!setup) return;
  const { directory, executable, git } = setup;
  const documentPath = path.join(directory, 'note.md');
  await git('init', '--quiet', '--template=', '-b', 'history');
  const importLog = [];
  for (let index = 0; index < 53; index++) {
    const commit = (name, subject, content) => importLog.push([
      'commit refs/heads/history', `committer History <test@example.invalid> ${1700000000 + index} +0000`,
      `data ${subject.length}`, subject, `M 100644 inline ${name}`, `data ${content.length}`, content, '',
    ].join('\n'));
    commit('note.md', `note-${index}`, `revision-${index}`);
    commit('other.md', `other-${index}`, `unrelated-${index}`);
  }
  await fastImport(executable, directory, importLog.join('\n') + '\ndone\n');
  await fs.writeFile(documentPath, 'current draft');
  const first = await listGitDocumentHistory({ documentPath });
  assert.equal(first.entries.length, 50);
  assert.equal(first.entries[0].subject, 'note-52');
  assert.equal(first.entries.at(-1).subject, 'note-3');
  assert.ok(first.nextCursor);
  const next = await listGitDocumentHistory({ documentPath, cursor: first.nextCursor });
  assert.deepEqual(next.entries.map(entry => entry.subject), ['note-2', 'note-1', 'note-0']);
  assert.equal(next.nextCursor, null);
  assert.equal((await readGitDocumentRevision({ documentPath, commit: next.entries.at(-1).commit })).text, 'revision-0');
  await git('commit', '--quiet', '--allow-empty', '-m', '更新 HEAD');
  await assert.rejects(() => listGitDocumentHistory({ documentPath, cursor: first.nextCursor }), /已变化/);
});

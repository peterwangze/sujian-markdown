const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { atomicWrite, getDocument, saveDocument } = require('./documents.cjs');
const { createStorage } = require('./storage.cjs');
const { searchDirectory } = require('./workspace.cjs');
const { createWatcher } = require('./watcher.cjs');

async function workspace(t) {
  const folder = await fs.mkdtemp(path.join(tmpdir(), 'sujian-file-test-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  return folder;
}

test('opening and editing preserves BOM, unrelated line endings and absent final newline', async (t) => {
  const file = path.join(await workspace(t), '稿子.md');
  const original = '\uFEFF# 记录\r\nfirst\nsecond\r\nlast';
  await fs.writeFile(file, original);
  const opened = await getDocument(file);
  assert.equal(opened.text, '# 记录\nfirst\nsecond\nlast');
  assert.equal(opened.bom, true);
  const unchanged = await saveDocument({ path: file, text: opened.text, expectedHash: opened.hash });
  assert.equal(unchanged.status, 'ok');
  assert.equal(unchanged.document.hash, opened.hash);
  const edited = await saveDocument({ path: file, text: opened.text.replace('first', '更新'), expectedHash: opened.hash });
  assert.equal(edited.status, 'ok');
  assert.equal(await fs.readFile(file, 'utf8'), original.replace('first', '更新'));
});

test('an external write and a concurrent application save cannot silently overwrite edits', async (t) => {
  const file = path.join(await workspace(t), 'shared.md');
  const first = await saveDocument({ path: file, text: 'original' });
  await fs.writeFile(file, 'external');
  const conflict = await saveDocument({ path: file, text: 'mine', expectedHash: first.document.hash });
  assert.equal(conflict.status, 'conflict');
  assert.equal(conflict.document.text, 'external');
  assert.equal(await fs.readFile(file, 'utf8'), 'external');
  const result = await Promise.all([
    saveDocument({ path: file, text: 'first writer', expectedHash: conflict.document.hash }),
    saveDocument({ path: file, text: 'second writer', expectedHash: conflict.document.hash }),
  ]);
  assert.deepEqual(result.map((attempt) => attempt.status).sort(), ['conflict', 'ok']);
  const winner = result.find((attempt) => attempt.status === 'ok');
  assert.equal(await fs.readFile(file, 'utf8'), winner.document.text);
});

test('file deletion is a conflict until saving to a new destination is confirmed', async (t) => {
  const file = path.join(await workspace(t), 'deleted.md');
  const original = await saveDocument({ path: file, text: 'old' });
  await fs.unlink(file);
  const result = await saveDocument({ path: file, text: 'new', expectedHash: original.document.hash });
  assert.deepEqual(result, { status: 'conflict', document: null });
  await assert.rejects(fs.access(file), { code: 'ENOENT' });
});

test('UTF-16 big-endian documents preserve encoding through edits', async (t) => {
  const file = path.join(await workspace(t), 'utf16.md');
  const bytes = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('中文\r\n😀', 'utf16le').swap16()]);
  await fs.writeFile(file, bytes);
  const doc = await getDocument(file);
  const result = await saveDocument({ path: file, text: `${doc.text}!`, expectedHash: doc.hash });
  assert.equal(result.document.encoding, 'utf-16be');
  assert.deepEqual(await fs.readFile(file), Buffer.concat([bytes, Buffer.from([0, 33])]));
});

test('drafts survive storage reopen and concurrent writes and deletions are sequenced', async (t) => {
  const folder = await workspace(t);
  const storage = createStorage(folder);
  await Promise.all([
    storage.saveDraft({ id: 'a', name: '未命名', text: 'version 1' }),
    storage.saveDraft({ id: 'a', name: '未命名', text: 'version 2' }),
  ]);
  const reopened = createStorage(folder);
  assert.equal((await reopened.loadDrafts())[0].text, 'version 2');
  await Promise.all([storage.saveDraft({ id: 'a', text: 'version 3' }), storage.deleteDraft('a')]);
  assert.deepEqual(await reopened.loadDrafts(), []);
});

test('workspace search handles Unicode whole words, skips binary files and can be canceled', async (t) => {
  const folder = await workspace(t);
  const file = path.join(folder, 'notes.md');
  await fs.writeFile(file, '中文 中文本\nBefore cat after\nBefore catfish after');
  await fs.writeFile(path.join(folder, 'binary.md'), Buffer.from([0x80, 0x81]));
  const result = await searchDirectory({ path: folder, query: 'cat', wholeWord: true });
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.matches.map(({ line, column }) => [line, column]), [[2, 8]]);
  const chinese = await searchDirectory({ path: folder, query: '中文', wholeWord: true });
  assert.equal(chinese.matches.length, 1);
  const controller = new AbortController();
  controller.abort();
  const canceled = await searchDirectory({ path: folder, query: '.' }, { signal: controller.signal });
  assert.equal(canceled.cancelled, true);
});

test('file watcher detects an external replacement with the newest disk contents', { timeout: 6000 }, async (t) => {
  const file = path.join(await workspace(t), 'watched.md');
  await fs.writeFile(file, 'before');
  const initial = await getDocument(file);
  let resolve;
  const change = new Promise((receive) => { resolve = receive; });
  const watcher = createWatcher({ knownDocuments: new Map([[process.platform === 'win32' ? initial.path.toLowerCase() : initial.path, initial]]), notify: resolve });
  t.after(() => watcher.dispose());
  watcher.setPaths([initial.path]);
  await atomicWrite(file, 'outside');
  watcher.refresh();
  assert.equal((await change).document.text, 'outside');
});

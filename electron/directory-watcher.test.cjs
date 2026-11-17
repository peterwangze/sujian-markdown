const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');
const { createDirectoryWatcher } = require('./directory-watcher.cjs');

async function fixture(context) {
  const temporary = await fs.promises.realpath(tmpdir());
  const directory = await fs.promises.mkdtemp(path.join(temporary, 'sujian-directory-watch-'));
  const updates = [];
  const watcher = createDirectoryWatcher({ notify: event => updates.push(event.paths) });
  context.after(async () => {
    watcher.dispose();
    const resolved = await fs.promises.realpath(directory);
    assert.equal(path.dirname(resolved), temporary);
    assert.ok(path.basename(resolved).startsWith('sujian-directory-watch-'));
    await fs.promises.rm(resolved, { recursive: true, force: true, maxRetries: 3 });
  });
  async function nextChange(limit = 3_000) {
    const end = Date.now() + limit;
    while (!updates.length && Date.now() < end) await delay(20);
    assert.ok(updates.length, 'No directory change arrived');
    return updates.shift();
  }
  return { directory, nextChange, updates, watcher };
}

function stubWatches(context, { rejectRecursive = false } = {}) {
  const watchers = [];
  context.mock.method(fs, 'watch', (directory, options, change) => {
    if (options.recursive && rejectRecursive) throw new Error('Recursive watches unsupported');
    const watcher = new EventEmitter();
    watcher.close = () => { watcher.closed = true; watcher.emit('close'); };
    watchers.push({ directory, options, change, watcher });
    return watcher;
  });
  return watchers;
}

test('watches real directories without duplicate aliases and reattaches after recreation', { timeout: 12_000 }, async context => {
  const { directory, nextChange, updates, watcher } = await fixture(context);
  const folder = path.join(directory, '笔记 文件夹');
  const original = folder + path.sep;
  await fs.promises.mkdir(folder);
  watcher.setPaths([{ path: original }, { path: folder }, { path: 'relative' }, null]);
  assert.deepEqual(await nextChange(), [original]);

  const file = path.join(folder, '外部文件.md');
  await fs.promises.writeFile(file, '# 首次创建');
  assert.deepEqual(await nextChange(), [original]);
  await fs.promises.unlink(file);
  assert.deepEqual(await nextChange(), [original]);
  await fs.promises.rmdir(folder);
  assert.deepEqual(await nextChange(), [original]);
  await fs.promises.mkdir(folder);
  assert.deepEqual(await nextChange(), [original]);
  await fs.promises.writeFile(path.join(folder, '重建后的文件.md'), '# 重新监听');
  assert.deepEqual(await nextChange(), [original]);

  watcher.setPaths([]);
  updates.length = 0;
  await fs.promises.writeFile(path.join(folder, '未监听.md'), '# 移除订阅');
  await delay(200);
  assert.deepEqual(updates, []);
});

test('filters hidden and internal flat paths, coalesces visible events, and closes subscriptions', async context => {
  const watches = stubWatches(context);
  const { directory, nextChange, updates, watcher } = await fixture(context);
  watcher.setPaths([{ path: directory, recursive: true }]);
  assert.deepEqual(await nextChange(), [directory]);
  assert.equal(watches.length, 1);
  const native = watches[0];
  assert.equal(native.options.persistent, false);
  assert.equal(native.options.recursive, ['win32', 'darwin'].includes(process.platform));
  native.change('change', '修改正文.md');
  native.change('rename', path.join('.git', 'index'));
  native.change('rename', path.join('node_modules', 'notes.md'));
  native.change('rename', path.join('.settings', '隐藏.md'));
  await delay(200);
  assert.deepEqual(updates, []);

  native.change('rename', path.join('章节', '新增.md'));
  native.change('rename', path.join('章节', '改名.md'));
  assert.deepEqual(await nextChange(), [directory]);
  watcher.setPaths([{ path: directory, recursive: true, showHidden: true, watchContentChanges: true }]);
  await delay(180);
  updates.length = 0;
  native.change('change', '.可见.md');
  assert.deepEqual(await nextChange(), [directory]);
  assert.equal(watches.length, 1);
  watcher.refresh();
  assert.deepEqual(await nextChange(), [directory]);

  native.change('rename', '将被取消.md');
  watcher.dispose();
  assert.equal(native.watcher.closed, true);
  native.change('rename', '未订阅.md');
  await delay(200);
  assert.deepEqual(updates, []);
});

test('poll fallback detects a nested list change and leaves an unchanged tree alone', async context => {
  const realSetInterval = globalThis.setInterval;
  context.mock.method(globalThis, 'setInterval', (callback, interval) => realSetInterval(callback, Math.min(70, interval)));
  const watches = stubWatches(context, { rejectRecursive: true });
  const { directory, nextChange, updates, watcher } = await fixture(context);
  const subfolder = path.join(directory, '第一层', '第二层');
  await fs.promises.mkdir(subfolder, { recursive: true });
  watcher.setPaths([{ path: directory, recursive: true }]);
  assert.deepEqual(await nextChange(), [directory]);
  assert.deepEqual(watches.map(item => item.options.recursive), [false]);

  await delay(260);
  assert.deepEqual(updates, []);
  await fs.promises.writeFile(path.join(subfolder, '外部修改.md'), '# 检测嵌套新增');
  assert.deepEqual(await nextChange(), [directory]);
});

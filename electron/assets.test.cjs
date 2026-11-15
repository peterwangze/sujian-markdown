const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const { createAssets } = require('./assets.cjs');
const { pathKey } = require('./documents.cjs');
const { createStorage } = require('./storage.cjs');

test('resolves local images consistently with and without a configured image root', async (context) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'sujian-assets-test-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const documentPath = path.join(directory, 'notes', '文档.md');
  const name = '图片 100% #1.png';
  const local = path.join(path.dirname(documentPath), name);
  const root = path.join(directory, 'site');
  const website = path.join(root, name);
  const userDataPath = path.join(directory, 'profile');
  const unattached = path.join(userDataPath, 'assets', name);
  const raw = Buffer.from('image data');
  for (const file of [local, website, unattached, path.join(root, 'fallback.png')]) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, raw);
  }
  const resolver = createAssets({ userDataPath, knownDocuments: new Map([[pathKey(documentPath), true]]) });
  const image = (source) => resolver.mediaFile({ documentPath, source, rootPath: '../site' });
  const encoded = encodeURIComponent(name);
  assert.equal(await image(encoded), await fs.realpath(local));
  assert.equal(await image('/' + encoded), await fs.realpath(website));
  assert.equal(await image('fallback.png'), await fs.realpath(path.join(root, 'fallback.png')));
  assert.equal(await image(local.split(path.sep).map(encodeURIComponent).join('/').replace(/%3A/i, ':')), await fs.realpath(local));
  assert.equal(await image(pathToFileURL(local).href), await fs.realpath(local));
  assert.equal(await image(pathToFileURL(website).href), await fs.realpath(website));
  assert.equal(await image('https://example.invalid/image.png'), null);
  assert.equal(await resolver.mediaFile({ documentPath: path.join(directory, 'unknown.md'), source: pathToFileURL(local).href }), null);
  assert.equal(await resolver.mediaFile({ source: pathToFileURL(local).href }), null);
  assert.equal(await resolver.mediaFile({ source: pathToFileURL(unattached).href }), await fs.realpath(unattached));

  const aliasedProfile = path.join(directory, 'aliased-profile');
  await fs.symlink(userDataPath, aliasedProfile, process.platform === 'win32' ? 'junction' : 'dir');
  const aliased = createAssets({ userDataPath: aliasedProfile, knownDocuments: new Map() });
  assert.equal(await aliased.mediaFile({ source: pathToFileURL(unattached).href }), await fs.realpath(unattached));
  assert.equal(await aliased.mediaFile({ source: pathToFileURL(local).href }), null);
});

test('references existing images without creating assets and remembers explicitly pasted draft paths', async (context) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'sujian-image-reference-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const profile = path.join(directory, 'profile');
  const documentPath = path.join(directory, 'notes', 'reference.md');
  const photo = path.join(directory, '图片 100% #1 (示例).png');
  const unrelated = path.join(directory, 'other.png');
  const notImage = path.join(directory, 'other.md');
  await Promise.all([photo, unrelated, notImage].map(file => fs.writeFile(file, 'fixture')));
  const options = { userDataPath: profile, knownDocuments: new Map([[pathKey(documentPath), true]]), storage: createStorage(profile) };
  const assets = createAssets(options);
  const existing = await assets.referenceImage({ documentPath, sourcePath: photo });
  assert.match(existing.markdownPath, /^\.\.\//);
  assert.equal(await assets.mediaFile({ documentPath, source: existing.markdownPath }), await fs.realpath(photo));
  assert.equal(await assets.referenceImage({ documentPath, sourcePath: notImage }), null);
  assert.equal(await assets.referenceImage({ documentPath, source: '../missing.png' }), null);
  await assert.rejects(fs.stat(profile), { code: 'ENOENT' });

  const draft = await assets.referenceImage({ source: pathToFileURL(photo).href });
  const reopened = createAssets(options);
  assert.equal(await reopened.mediaFile({ source: draft.markdownPath }), await fs.realpath(photo));
  assert.equal(await reopened.mediaFile({ source: pathToFileURL(unrelated).href }), null);
  await assert.rejects(fs.stat(path.join(profile, 'assets')), { code: 'ENOENT' });
});

test('collects image aliases once, leaves broken sources alone and resolves assets after moving the document', async (context) => {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'sujian-collect-local-'));
  context.after(() => fs.rm(base, { recursive: true, force: true }));
  const packageDir = path.join(base, '原稿');
  const documentPath = path.join(packageDir, '插图.md');
  const external = path.join(base, '原 图 100%.png');
  const rootPath = path.join(base, 'website');
  const rooted = path.join(rootPath, 'header.svg');
  const managed = path.join(packageDir, '资源');
  const existing = path.join(managed, 'existing.png');
  await Promise.all([managed, rootPath].map(directory => fs.mkdir(directory, { recursive: true })));
  await Promise.all([[documentPath, '# 插图'], [external, 'PNG bytes'], [rooted, 'SVG bytes'], [existing, 'existing bytes']]
    .map(([file, value]) => fs.writeFile(file, value)));
  const knownDocuments = new Map([[pathKey(documentPath), true]]);
  const service = createAssets({ userDataPath: base, knownDocuments });
  const relative = '../' + encodeURIComponent(path.basename(external));
  const absolute = pathToFileURL(external).href;
  const embedded = 'data:image/png;base64,aaaa';
  const remote = 'https://example.invalid/disabled.png';
  const result = await service.collectImages(null, {
    documentPath, assetFolder: '资源', rootPath,
    sources: [relative, absolute, relative, '/header.svg', 'missing.svg', embedded, '资源/existing.png', remote],
  });
  const replacements = new Map(result.replacements.map(({ source, markdownPath }) => [source, markdownPath]));
  assert.equal(result.copied, 2);
  assert.equal(result.alreadyLocal, 1);
  assert.equal(result.usedDefaultFolder, false);
  assert.equal(result.directory, managed);
  assert.deepEqual(result.failures, [
    { source: 'missing.svg', reason: '找不到图片文件。' },
    { source: remote, reason: '未开启「显示网络图片」。' },
  ]);
  assert.equal(replacements.get(relative), replacements.get(absolute));
  assert.equal(replacements.has(embedded), false);
  assert.equal((await fs.readdir(managed)).length, 3);
  await service.finishImageCollection(result.token, true);

  const moved = path.join(base, '移走后的副本');
  await fs.rename(packageDir, moved);
  await fs.rm(external);
  await fs.rm(rooted);
  const movedDocument = path.join(moved, path.basename(documentPath));
  knownDocuments.set(pathKey(movedDocument), true);
  for (const [source, expected] of [[relative, 'PNG bytes'], ['/header.svg', 'SVG bytes'], ['资源/existing.png', 'existing bytes']]) {
    const file = await service.mediaFile({ documentPath: movedDocument, source: replacements.get(source) });
    assert.equal(await fs.readFile(file, 'utf8'), expected);
  }
});

test('collects network aliases once, uses a portable folder and can abandon uncommitted copies', async (context) => {
  const base = await fs.mkdtemp(path.join(tmpdir(), 'sujian-collect-network-'));
  context.after(() => fs.rm(base, { recursive: true, force: true }));
  const documentPath = path.join(base, 'notes', 'remote.md');
  await fs.mkdir(path.dirname(documentPath));
  const service = createAssets({ userDataPath: base, knownDocuments: new Map([[pathKey(documentPath), true]]) });
  const requests = [];
  const window = { webContents: { session: { async fetch(address) {
    requests.push(address);
    if (address.endsWith('/alias.svg')) return Response.redirect('https://example.invalid/image.svg');
    if (address.endsWith('/image.svg')) return new Response('<svg></svg>', { headers: { 'content-type': 'image/svg+xml' } });
    return new Response(null, { status: 404 });
  } } } };
  const sources = ['//example.invalid/image.svg', 'https://example.invalid:443/image.svg', 'https://example.invalid/alias.svg', 'https://example.invalid/missing.png'];
  const result = await service.collectImages(window, { documentPath, sources, assetFolder: '../../outside' }, true);
  assert.equal(result.copied, 1);
  assert.equal(result.alreadyLocal, 0);
  assert.equal(result.usedDefaultFolder, true);
  assert.equal(result.directory, path.join(path.dirname(documentPath), 'remote.assets'));
  assert.deepEqual(result.failures, [{ source: sources.at(-1), reason: '图片资源不可用或格式不受支持。' }]);
  assert.equal(result.replacements.length, 3);
  assert.equal(new Set(result.replacements.map(value => value.markdownPath)).size, 1);
  assert.equal(requests.filter(address => address.endsWith('/image.svg')).length, 2);
  const [file] = await fs.readdir(result.directory);
  assert.equal(await fs.readFile(path.join(result.directory, file), 'utf8'), '<svg></svg>');
  await service.finishImageCollection(result.token, false);
  assert.deepEqual(await fs.readdir(result.directory), []);
});

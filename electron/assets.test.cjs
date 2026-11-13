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

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createUpdater } = require('./updates.cjs');
const { prepareUpdateInstall, openPreparedUpdate } = require('./update-install.cjs');

const latestUrl = 'https://api.github.com/repos/peterwangze/sujian-markdown/releases/latest';
const releaseRoot = 'https://github.com/peterwangze/sujian-markdown/releases';
const releaseTag = 'v1.10.0';
const installer = Buffer.from('fixture installer bytes');
const windowsInstaller = 'Sujian-1.10.0-win-x64.exe';
const cdn = 'https://release-assets.githubusercontent.com/test-release';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function asset(name, bytes = installer, overrides = {}) {
  return {
    name, size: bytes.length, state: 'uploaded', browser_download_url: `${releaseRoot}/download/${releaseTag}/${name}`,
    digest: `sha256:${sha256(bytes)}`, ...overrides,
  };
}

function setup({ assets = [asset(windowsInstaller)], route, version = '1.9.9', platform = 'win32', arch = 'x64', release = {} } = {}) {
  const calls = [];
  const updater = createUpdater({ currentVersion: version, platform, arch, fetchImpl: async (url, options) => {
    calls.push(url);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'manual');
    if (url === latestUrl) return Response.json({
      draft: false, prerelease: false, tag_name: releaseTag, body: '## Changes\n\n- New feature',
      published_at: '2026-11-16T00:00:00Z', assets, ...release,
    });
    assert.ok(route, `Unexpected request to ${url}`);
    return route(url, options);
  } });
  return { updater, calls };
}

async function temporaryFolder(context) {
  const parent = await fs.realpath(tmpdir());
  const directory = await fs.mkdtemp(path.join(parent, 'sujian-update-test-'));
  context.after(async () => {
    const resolved = await fs.realpath(directory);
    assert.equal(path.dirname(resolved), parent);
    assert.ok(path.basename(resolved).startsWith('sujian-update-test-'));
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 3 });
  });
  return directory;
}

test('chooses the exact stable version assets for each platform and architecture', async () => {
  const targets = [
    ['win32', 'x64', [['win-x64.exe', 'EXE']]],
    ['win32', 'arm64', [['win-arm64.exe', 'EXE']]],
    ['darwin', 'x64', [['mac-x64.dmg', 'DMG']]],
    ['darwin', 'arm64', [['mac-arm64.dmg', 'DMG']]],
    ['linux', 'x64', [['linux-x86_64.AppImage', 'AppImage'], ['linux-amd64.deb', 'DEB']]],
    ['linux', 'arm64', [['linux-arm64.AppImage', 'AppImage'], ['linux-arm64.deb', 'DEB']]],
    ['linux', 'ia32', []],
  ];
  const assets = targets.flatMap(([, , installers]) => installers.map(([suffix]) => asset(`Sujian-1.10.0-${suffix}`)));
  for (const [platform, arch, installers] of targets) {
    const { updater, calls } = setup({ platform, arch, assets });
    const checked = await updater.check();
    assert.equal(checked.status, 'update-available');
    assert.equal(checked.latestVersion, '1.10.0');
    assert.equal(checked.releaseUrl, `${releaseRoot}/tag/${releaseTag}`);
    assert.equal(checked.notes, '## Changes\n\n- New feature');
    assert.deepEqual(checked.assets, installers.map(([suffix, format]) => ({ name: `Sujian-1.10.0-${suffix}`, format, size: installer.length })));
    assert.deepEqual(calls, [latestUrl]);
  }
});

test('distinguishes up-to-date, newer local builds and prereleases and rejects draft metadata', async () => {
  for (const [version, status] of [['1.10.0', 'up-to-date'], ['1.10.0+local', 'up-to-date'], ['1.10.1', 'ahead'], ['1.10.0-rc.1', 'update-available']]) {
    const { updater } = setup({ version });
    assert.equal((await updater.check()).status, status);
  }
  const draft = setup({ release: { draft: true } });
  await assert.rejects(draft.updater.check(), /正式发布/);
  const prerelease = setup({ release: { tag_name: 'v1.10.0-rc.1', prerelease: true } });
  await assert.rejects(prerelease.updater.check(), /正式发布/);
});

test('uses the exact verified checksum manifest only when the API asset digest is absent', async () => {
  const manifest = Buffer.from(`${sha256(installer)}  ${windowsInstaller}\n`);
  const manifestAsset = asset('SHA256SUMS.txt', manifest);
  const missingDigest = asset(windowsInstaller, installer, { digest: null });
  const { updater, calls } = setup({ assets: [missingDigest, manifestAsset], route: url => {
    assert.equal(url, manifestAsset.browser_download_url);
    return new Response(manifest);
  } });
  assert.deepEqual((await updater.check()).assets.map(a => a.name), [windowsInstaller]);
  assert.deepEqual(calls, [latestUrl, manifestAsset.browser_download_url]);

  const badManifest = setup({ assets: [missingDigest, manifestAsset], route: () => new Response(Buffer.alloc(manifest.length)) });
  await assert.rejects(badManifest.updater.check(), /校验清单验证失败/);

  for (const assets of [
    [missingDigest],
    [asset(windowsInstaller, installer, { browser_download_url: 'https://example.com/install.exe' })],
    [asset(windowsInstaller), asset(windowsInstaller)],
    [asset(windowsInstaller, installer, { size: 1_073_741_825 })],
  ]) {
    const invalid = setup({ assets });
    assert.deepEqual((await invalid.updater.check()).assets, []);
    assert.deepEqual(invalid.calls, [latestUrl]);
  }
});

test('streams verified assets through a trusted redirect and creates unique complete files', async context => {
  const directory = path.join(await temporaryFolder(context), 'Downloads');
  const approved = asset(windowsInstaller);
  const { updater } = setup({ route: url => {
    if (url === approved.browser_download_url) return Response.redirect(cdn, 302);
    assert.equal(url, cdn);
    return new Response(installer, { headers: { 'content-length': String(installer.length) } });
  } });
  await assert.rejects(updater.download({ assetName: windowsInstaller, directory }), /先检查更新/);
  await updater.check();
  await assert.rejects(updater.download({ assetName: '../../app.exe', directory }), /设备的安装包/);

  const progress = [];
  const first = await updater.download({ assetName: windowsInstaller, directory, onProgress: event => progress.push(event) });
  assert.equal(first.fileName, windowsInstaller);
  assert.equal(first.bytes, installer.length);
  assert.equal(first.format, 'EXE');
  assert.equal(first.sha256, sha256(installer));
  assert.deepEqual(progress[0], { downloadedBytes: 0, totalBytes: installer.length });
  assert.deepEqual(progress.at(-1), { downloadedBytes: installer.length, totalBytes: installer.length });
  await fs.writeFile(first.filePath, 'existing installation package');

  const copies = await Promise.all(Array.from({ length: 2 }, () => updater.download({ assetName: windowsInstaller, directory })));
  assert.deepEqual(new Set(copies.map(copy => copy.fileName)), new Set(['Sujian-1.10.0-win-x64 (2).exe', 'Sujian-1.10.0-win-x64 (3).exe']));
  for (const copy of copies) assert.deepEqual(await fs.readFile(copy.filePath), installer);
  assert.equal(await fs.readFile(first.filePath, 'utf8'), 'existing installation package');
  assert.equal((await fs.readdir(directory)).length, 3);
});

test('rejects untrusted redirects, corrupted sizes and corrupted hashes without leaving partial files', async context => {
  const directory = await temporaryFolder(context);
  const expected = asset(windowsInstaller);
  for (const [respond, error] of [
    [() => Response.redirect('https://expired.example/test.exe', 302), /重定向无效/],
    [() => Response.redirect('http://release-assets.githubusercontent.com/test.exe', 302), /重定向无效/],
    [() => new Response(installer.subarray(0, -1)), /大小与发布记录不符/],
    [() => new Response(Buffer.alloc(installer.length + 1)), /大小与发布记录不符/],
    [() => new Response(Buffer.alloc(installer.length)), /SHA-256 校验失败/],
  ]) {
    const { updater, calls } = setup({ route: url => {
      assert.equal(url, expected.browser_download_url);
      return respond();
    } });
    await updater.check();
    await assert.rejects(updater.download({ assetName: windowsInstaller, directory }), error);
    assert.deepEqual(calls, [latestUrl, expected.browser_download_url]);
    assert.deepEqual(await fs.readdir(directory), []);
  }
});

test('cancels an in-flight download and closes the stream without publishing a file', async context => {
  const directory = await temporaryFolder(context);
  const controller = new AbortController();
  let cancelled = false;
  const { updater } = setup({ route: () => new Response(new ReadableStream({
    start(stream) { stream.enqueue(installer.subarray(0, 5)); },
    cancel() { cancelled = true; },
  })) });
  await updater.check();
  await assert.rejects(updater.download({ assetName: windowsInstaller, directory, signal: controller.signal, onProgress: event => {
    if (event.downloadedBytes > 0) controller.abort();
  } }), { name: 'AbortError' });
  assert.equal(cancelled, true);
  assert.deepEqual(await fs.readdir(directory), []);
});

async function savedInstaller(directory, suffix, format) {
  const fileName = `Sujian-1.10.0-${suffix}`;
  const filePath = path.join(directory, fileName);
  await fs.writeFile(filePath, installer, { mode: 0o600 });
  return { fileName, filePath, bytes: installer.length, sha256: sha256(installer), format };
}

test('hands verified installers to their OS and prepares the portable AppImage for a managed restart', async context => {
  const directory = await temporaryFolder(context);
  for (const [platform, suffix, format, action] of [
    ['win32', 'win-x64.exe', 'EXE', 'installer-opened'],
    ['darwin', 'mac-arm64.dmg', 'DMG', 'disk-image-opened'],
    ['linux', 'linux-arm64.deb', 'DEB', 'package-manager-opened'],
    ['linux', 'linux-arm64.AppImage', 'AppImage', 'appimage-ready'],
  ]) {
    const descriptor = await savedInstaller(directory, suffix, format);
    const opened = [];
    const prepared = await prepareUpdateInstall(descriptor, { platform });
    const result = await openPreparedUpdate(prepared, { openPath: filePath => { opened.push(filePath); return ''; } });
    assert.deepEqual(result, { action, filePath: descriptor.filePath });
    assert.deepEqual(opened, format === 'AppImage' ? [] : [descriptor.filePath]);
    assert.deepEqual(await fs.readFile(descriptor.filePath), installer);
    if (format === 'AppImage' && process.platform !== 'win32') {
      assert.ok((await fs.stat(descriptor.filePath)).mode & 0o100);
    }
  }
});

test('rejects missing, changed and substituted local files at install time', async context => {
  const directory = await temporaryFolder(context);
  const descriptor = await savedInstaller(directory, 'win-x64.exe', 'EXE');
  const platform = 'win32';
  const openPath = () => assert.fail('Unverified file must never be launched');
  await assert.rejects(prepareUpdateInstall(descriptor, { platform: 'darwin' }), /系统不匹配/);
  await assert.rejects(openPreparedUpdate(descriptor, { openPath }), /先校验/);
  await fs.writeFile(descriptor.filePath, Buffer.alloc(installer.length));
  await assert.rejects(prepareUpdateInstall(descriptor, { platform }), /被修改或替换/);

  await fs.writeFile(descriptor.filePath, installer);
  const prepared = await prepareUpdateInstall(descriptor, { platform });
  await fs.rename(descriptor.filePath, `${descriptor.filePath}.old`);
  await fs.writeFile(descriptor.filePath, installer);
  await assert.rejects(openPreparedUpdate(prepared, { openPath }), /被修改或替换/);

  await fs.unlink(descriptor.filePath);
  await assert.rejects(prepareUpdateInstall(descriptor, { platform }), /已移动或删除/);
});

test('refuses a symbolic link substituted for the downloaded installer', async context => {
  const directory = await temporaryFolder(context);
  const descriptor = await savedInstaller(directory, 'win-x64.exe', 'EXE');
  const original = `${descriptor.filePath}.original`;
  await fs.rename(descriptor.filePath, original);
  try {
    await fs.symlink(original, descriptor.filePath, 'file');
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    context.skip('Creating symbolic links is unavailable on this host');
    return;
  }
  await assert.rejects(prepareUpdateInstall(descriptor, { platform: 'win32' }), /被修改或替换/);
});

test('reports a missing system package association and respects cancellation', async context => {
  const directory = await temporaryFolder(context);
  const descriptor = await savedInstaller(directory, 'linux-amd64.deb', 'DEB');
  const cancelled = AbortSignal.abort();
  await assert.rejects(prepareUpdateInstall(descriptor, { platform: 'linux', signal: cancelled }), { name: 'AbortError' });
  const prepared = await prepareUpdateInstall(descriptor, { platform: 'linux' });
  await assert.rejects(openPreparedUpdate(prepared, { openPath: async () => 'No application installed' }), /系统包管理器/);
  await assert.rejects(openPreparedUpdate(prepared, { signal: cancelled, openPath: () => assert.fail() }), { name: 'AbortError' });
});

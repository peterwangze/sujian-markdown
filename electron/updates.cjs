const { createHash } = require('node:crypto');
const { createWriteStream } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const repository = 'peterwangze/sujian-markdown';
const latestUrl = `https://api.github.com/repos/${repository}/releases/latest`;
const releaseRoot = `https://github.com/${repository}/releases`;
const maximumMetadata = 1_048_576;
const maximumChecksums = 131_072;
const maximumInstaller = 1_073_741_824;
const downloadHosts = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com']);
const redirects = new Set([301, 302, 303, 307, 308]);

function validVersion(value) {
  const match = typeof value === 'string' && /^v?(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-([\w.-]+))?(?:\+[\w.-]+)?$/.exec(value);
  if (!match) throw new Error('无法识别素笺版本号。');
  const parts = match.slice(1, 4);
  return { name: parts.join('.'), parts: parts.map(Number), prerelease: Boolean(match[4]) };
}

function compareVersions(current, latest) {
  for (let index = 0; index < latest.parts.length; index++) {
    const difference = current.parts[index] - latest.parts[index];
    if (difference) return Math.sign(difference);
  }
  return current.prerelease ? -1 : 0;
}

function installerNames(version, platform, arch) {
  if (arch !== 'x64' && arch !== 'arm64') return [];
  const prefix = `Sujian-${version}`;
  if (platform === 'win32') return [[`${prefix}-win-${arch}.exe`, 'EXE']];
  if (platform === 'darwin') return [[`${prefix}-mac-${arch}.dmg`, 'DMG']];
  if (platform === 'linux') return [
    [`${prefix}-linux-${arch === 'x64' ? 'x86_64' : arch}.AppImage`, 'AppImage'],
    [`${prefix}-linux-${arch === 'x64' ? 'amd64' : arch}.deb`, 'DEB'],
  ];
  return [];
}

function officialAsset(assets, tag, name, limit) {
  const matches = assets.filter(asset => asset?.name === name);
  if (matches.length !== 1) return null;
  const [asset] = matches;
  const url = `${releaseRoot}/download/${tag}/${name}`;
  if (asset.browser_download_url !== url || asset.state !== 'uploaded' ||
      !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > limit) return null;
  const digest = typeof asset.digest === 'string' ? /^sha256:([a-f0-9]{64})$/i.exec(asset.digest) : null;
  return { name, url, size: asset.size, sha256: digest?.[1].toLowerCase() ?? null };
}

async function discard(response) {
  await response.body?.cancel().catch(() => {});
}

async function request(fetchImpl, url, { signal, headers, allowRedirect = false }) {
  let address = url;
  for (let attempt = 0; attempt <= 4; attempt++) {
    signal.throwIfAborted();
    let response;
    try {
      response = await fetchImpl(address, { signal, headers, cache: 'no-store', credentials: 'omit', redirect: 'manual' });
    } catch (error) {
      signal.throwIfAborted();
      throw new Error('无法连接 GitHub，请检查网络后重试。', { cause: error });
    }
    if (!redirects.has(response.status)) {
      if (response.ok) return response;
      await discard(response);
      if (response.status === 403 || response.status === 429) throw new Error('GitHub 暂时限制了请求，请稍后重试。');
      throw new Error(`GitHub 返回 HTTP ${response.status}，请稍后重试。`);
    }

    const location = response.headers.get('location');
    await discard(response);
    if (!allowRedirect || !location) break;
    let redirected;
    try { redirected = new URL(location, address); } catch { break; }
    const trustedHost = redirected.href === url || downloadHosts.has(redirected.hostname);
    if (!trustedHost || redirected.protocol !== 'https:' || redirected.port || redirected.username || redirected.password) break;
    address = redirected.href;
  }
  throw new Error('GitHub 的下载重定向无效，请稍后重试。');
}

async function readLimited(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) {
    await discard(response);
    throw new Error('GitHub 返回的数据超出大小限制。');
  }
  const chunks = [];
  let length = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      length += chunk.byteLength;
      if (length > limit) throw new Error('GitHub 返回的数据超出大小限制。');
      chunks.push(chunk);
    }
  }
  return Buffer.concat(chunks, length);
}

async function fillChecksums(fetchImpl, releaseAssets, tag, installers, signal) {
  if (installers.every(asset => asset.sha256)) return installers;
  const manifest = officialAsset(releaseAssets, tag, 'SHA256SUMS.txt', maximumChecksums);
  if (!manifest) return installers.filter(asset => asset.sha256);
  const response = await request(fetchImpl, manifest.url, { signal, allowRedirect: true });
  const body = await readLimited(response, maximumChecksums);
  if (body.length !== manifest.size || (manifest.sha256 && createHash('sha256').update(body).digest('hex') !== manifest.sha256)) {
    throw new Error('发布校验清单验证失败，请稍后重试。');
  }

  const checksums = new Map();
  for (const line of body.toString('utf8').split(/\r?\n/)) {
    const match = /^([\da-f]{64}) [ *]([\w.-]+)$/i.exec(line);
    if (!match) continue;
    const [, checksum, name] = match;
    checksums.set(name, checksums.has(name) ? null : checksum.toLowerCase());
  }
  return installers.map(asset => ({ ...asset, sha256: asset.sha256 ?? checksums.get(asset.name) })).filter(asset => asset.sha256);
}

function downloadSignal(signal) {
  const idle = new AbortController();
  let timeout;
  const bump = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => idle.abort(new Error('下载长时间没有响应，请重试。')), 45_000);
    timeout.unref();
  };
  bump();
  return { signal: signal ? AbortSignal.any([signal, idle.signal]) : idle.signal, bump, stop: () => clearTimeout(timeout) };
}

async function saveVerifiedFile(file, name, directory, temporaryDirectory, signal) {
  const { name: basename, ext } = path.parse(name);
  for (let index = 1; index <= 100; index++) {
    signal.throwIfAborted();
    const fileName = index === 1 ? name : `${basename} (${index})${ext}`;
    const filePath = path.join(directory, fileName);
    try {
      await fs.link(file, filePath);
      return { fileName, filePath };
    } catch (error) {
      if (error.code === 'EEXIST') continue;
      if (!['EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(error.code)) throw error;
      break;
    }
  }
  // Some filesystems lack hard links. A new, private directory still permits an atomic rename.
  signal.throwIfAborted();
  const filePath = path.join(temporaryDirectory, name);
  await fs.rename(file, filePath);
  return { fileName: name, filePath };
}

async function downloadAsset(fetchImpl, asset, { directory, signal, onProgress }) {
  const timer = downloadSignal(signal);
  let staging;
  let temporaryFile;
  try {
    timer.signal.throwIfAborted();
    onProgress?.({ downloadedBytes: 0, totalBytes: asset.size });
    await fs.mkdir(directory, { recursive: true });
    const target = await fs.realpath(directory);
    staging = await fs.mkdtemp(path.join(target, 'Sujian-download-'));
    temporaryFile = path.join(staging, 'installer.part');
    const response = await request(fetchImpl, asset.url, { signal: timer.signal, allowRedirect: true });
    const receivedSize = response.headers.get('content-length');
    if (!response.body || (receivedSize !== null && Number(receivedSize) !== asset.size)) {
      await discard(response);
      throw new Error('安装包大小与发布记录不符。');
    }

    let bytes = 0;
    const digest = createHash('sha256');
    const verify = new Transform({
      transform(chunk, _encoding, done) {
        bytes += chunk.length;
        if (bytes > asset.size) return done(new Error('安装包大小与发布记录不符。'));
        try {
          digest.update(chunk);
          timer.bump();
          onProgress?.({ downloadedBytes: bytes, totalBytes: asset.size });
        } catch (error) {
          return done(error);
        }
        done(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), verify, createWriteStream(temporaryFile, { flags: 'wx', mode: 0o600 }), { signal: timer.signal });
    if (bytes !== asset.size) throw new Error('安装包大小与发布记录不符。');
    if (digest.digest('hex') !== asset.sha256) throw new Error('安装包 SHA-256 校验失败，请重新下载。');
    const saved = await saveVerifiedFile(temporaryFile, asset.name, target, staging, timer.signal);
    return { ...saved, bytes };
  } catch (error) {
    timer.signal.throwIfAborted();
    throw error;
  } finally {
    timer.stop();
    if (temporaryFile) await fs.unlink(temporaryFile).catch(() => {});
    if (staging) await fs.rmdir(staging).catch(() => {});
  }
}

function createUpdater({ currentVersion, platform = process.platform, arch = process.arch, fetchImpl = globalThis.fetch }) {
  const current = validVersion(currentVersion);
  let available = new Map();

  return {
    async check({ signal } = {}) {
      const timeout = AbortSignal.timeout(15_000);
      const lookup = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        const response = await request(fetchImpl, latestUrl, { signal: lookup, headers: { Accept: 'application/vnd.github+json' } });
        const body = await readLimited(response, maximumMetadata);
        let release;
        try { release = JSON.parse(body.toString('utf8')); } catch { throw new Error('无法读取 GitHub 发布信息。'); }
        const latest = validVersion(release?.tag_name);
        if (release.draft !== false || release.prerelease !== false || release.tag_name !== `v${latest.name}` || !Array.isArray(release.assets)) {
          throw new Error('GitHub 未返回有效的正式发布版本。');
        }

        const comparison = compareVersions(current, latest);
        const installers = comparison < 0 ? installerNames(latest.name, platform, arch).flatMap(([name, format]) => {
          const asset = officialAsset(release.assets, release.tag_name, name, maximumInstaller);
          return asset ? [{ ...asset, format }] : [];
        }) : [];
        const verified = await fillChecksums(fetchImpl, release.assets, release.tag_name, installers, lookup);
        lookup.throwIfAborted();
        available = new Map(verified.map(asset => [asset.name, asset]));

        return {
          status: comparison < 0 ? 'update-available' : comparison > 0 ? 'ahead' : 'up-to-date',
          currentVersion,
          latestVersion: latest.name,
          notes: typeof release.body === 'string' ? release.body.slice(0, 65_536) : '',
          releaseUrl: `${releaseRoot}/tag/${release.tag_name}`,
          publishedAt: typeof release.published_at === 'string' && Number.isFinite(Date.parse(release.published_at)) ? release.published_at : null,
          assets: verified.map(({ name, format, size }) => ({ name, format, size })),
        };
      } catch (error) {
        signal?.throwIfAborted();
        if (timeout.aborted) throw new Error('检查更新超时，请稍后重试。');
        throw error;
      }
    },
    async download({ assetName, directory, signal, onProgress }) {
      const asset = available.get(assetName);
      if (!asset) throw new Error('请先检查更新，然后选择此设备的安装包。');
      return downloadAsset(fetchImpl, asset, { directory, signal, onProgress });
    },
  };
}

module.exports = { createUpdater };

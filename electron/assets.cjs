const { clipboard, dialog, net } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { pathKey } = require('./documents.cjs');

const run = promisify(execFile);
const scheme = 'sujian-asset';
const types = new Map(Object.entries({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.apng': 'image/apng',
  '.heic': 'image/heic', '.jxl': 'image/jxl', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac',
}));

function assetUrl({ documentPath, source, rootPath }) {
  const data = JSON.stringify([documentPath ?? '', source, rootPath ?? '']);
  return `${scheme}://local/${Buffer.from(data, 'utf8').toString('base64url')}`;
}

function safeMediaSource(source) {
  if (typeof source !== 'string' || !source.trim()) return '';
  const trimmed = source.trim();
  if (/^(?:https?:|blob:|data:(?:image|audio|video)\/)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return '';
}

function encodeMarkdownPath(filePath) {
  return filePath.replace(/\\/g, '/').split('/').map((part, index) => {
    if (index === 0 && /^[a-zA-Z]:$/.test(part)) return part;
    return encodeURIComponent(part).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  }).join('/');
}

function createAssets({ userDataPath, knownDocuments }) {
  const unattached = path.join(userDataPath, 'assets');

  async function mediaFile({ documentPath, source, rootPath }) {
    if (typeof source !== 'string' || !source.trim() || safeMediaSource(source)) return null;
    if (documentPath && !knownDocuments.has(pathKey(documentPath))) return null;
    let raw = source.trim();
    if (raw.startsWith('<') && raw.endsWith('>')) raw = raw.slice(1, -1);
    let decoded;
    try {
      if (/^file:/i.test(raw)) decoded = fileURLToPath(raw);
      else if (/^[a-z][a-z+.-]+:/i.test(raw) && !/^[a-z]:[\\/]/i.test(raw)) return null;
      else decoded = decodeURIComponent(raw);
    } catch {
      return null;
    }
    let base = documentPath ? path.dirname(documentPath) : unattached;
    if (documentPath && rootPath) base = path.resolve(base, rootPath);
    if (rootPath && /^[\\/]/.test(decoded)) decoded = decoded.replace(/^[\\/]+/, '');
    const candidate = path.resolve(base, decoded);
    const absolute = await fs.realpath(candidate).catch(() => null);
    if (!absolute) return null;
    if (!documentPath) {
      const relative = path.relative(unattached, absolute);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    }
    if (!types.has(path.extname(absolute).toLowerCase())) return null;
    const stat = await fs.stat(absolute).catch(() => null);
    if (!stat?.isFile()) return null;
    return absolute;
  }

  async function resolveImage({ documentPath, source, rootPath, embed = false }) {
    const remote = safeMediaSource(source);
    if (remote) return remote;
    const alreadyResolved = typeof source === 'string' && source.startsWith(`${scheme}://`);
    const local = alreadyResolved ? await fromAssetUrl(source) : await mediaFile({ documentPath, source, rootPath });
    if (!local) return null;
    if (!embed) return alreadyResolved ? source : assetUrl({ documentPath, source, rootPath });
    return embedFile(local);
  }

  async function fromAssetUrl(address) {
    try {
      const url = new URL(address);
      if (url.protocol !== `${scheme}:` || url.hostname !== 'local') return null;
      const [documentPath, source, rootPath] = JSON.parse(Buffer.from(url.pathname.slice(1), 'base64url').toString('utf8'));
      return await mediaFile({ documentPath, source, rootPath });
    } catch {
      return null;
    }
  }

  async function handleRequest(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
    const source = await fromAssetUrl(request.url);
    if (!source) return new Response(null, { status: 404 });
    const range = request.headers.get('Range');
    return net.fetch(pathToFileURL(source).href, { method: request.method, headers: range ? { Range: range } : {} });
  }

  async function importImage(window, { documentPath, bytes, filename, sourcePath, useClipboard = false, assetFolder } = {}) {
    if (documentPath && !knownDocuments.has(pathKey(documentPath))) throw new Error('Open or save the document before attaching local media.');
    let content = bytes ? Buffer.from(bytes) : null;
    if (useClipboard && !content) {
      const items = await clipboard.read();
      const mime = ['image/png', 'image/jpeg', 'image/webp'].find(type => items.some(item => item.types.includes(type)));
      if (!mime) return null;
      const image = await items.find(item => item.types.includes(mime)).getType(mime);
      content = Buffer.from(await image.arrayBuffer());
      filename ??= 'clipboard.' + mime.slice('image/'.length);
    }
    if (!content && !sourcePath) {
      const extensions = [...types.keys()].filter((extension) => types.get(extension).startsWith('image/')).map((extension) => extension.slice(1));
      const selected = await dialog.showOpenDialog(window, {
        title: '插入图片', properties: ['openFile'], filters: [{ name: '图片', extensions }],
      });
      if (selected.canceled || !selected.filePaths.length) return null;
      [sourcePath] = selected.filePaths;
    }
    if (sourcePath) {
      filename ??= path.basename(sourcePath);
      content ??= await fs.readFile(sourcePath);
    }
    if (!content?.length) throw new Error('No image data was provided.');
    const extension = path.extname(filename ?? '').toLowerCase() || '.png';
    if (!types.has(extension)) throw new Error('This media format is not supported.');
    const stem = path.basename(filename ?? 'image', extension).replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim().slice(0, 80) || 'image';
    const directory = documentPath ? path.resolve(path.dirname(documentPath), assetFolder || `${path.parse(documentPath).name}.assets`) : unattached;
    await fs.mkdir(directory, { recursive: true });
    const destination = path.join(directory, `${stem}-${randomUUID().slice(0, 8)}${extension}`);
    await fs.writeFile(destination, content, { flag: 'wx' });
    const markdownPath = encodeMarkdownPath(documentPath ? path.relative(path.dirname(documentPath), destination) : destination);
    return { markdownPath, url: assetUrl({ documentPath, source: markdownPath }) };
  }

  async function embedLocalAssets(html) {
    const pattern = /sujian-asset:\/\/local\/[A-Za-z0-9_-]+/g;
    const replacements = new Map();
    for (const match of new Set(html.match(pattern) ?? [])) {
      const file = await fromAssetUrl(match);
      if (!file) continue;
      const dataUrl = await embedFile(file);
      if (dataUrl) replacements.set(match, dataUrl);
    }
    return html.replace(pattern, (match) => replacements.get(match) ?? match);
  }

  async function embedFile(file) {
    const size = (await fs.stat(file)).size;
    if (size > 32 * 1024 * 1024) throw new Error('该媒体文件超过了 32 MB 的内嵌上限。');
    const contents = await fs.readFile(file);
    return `data:${types.get(path.extname(file).toLowerCase())};base64,${contents.toString('base64')}`;
  }

  async function uploadImages({ documentPath, sources, rootPath, executable, args = [] }) {
    if (typeof executable !== 'string' || !executable.trim() || !Array.isArray(args) || args.some((item) => typeof item !== 'string')) {
      throw new Error('请选择图片上传程序并提供独立的参数。');
    }
    if (!Array.isArray(sources) || !sources.length) return [];
    const paths = [];
    for (const source of sources) {
      const resolved = await mediaFile({ documentPath, source, rootPath });
      if (!resolved) throw new Error(`无法读取本地图片 ${source}`);
      paths.push(resolved);
    }
    const { stdout } = await run(executable, [...args, ...paths], {
      cwd: documentPath ? path.dirname(documentPath) : unattached,
      timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
    });
    const urls = stdout.trim().split(/\r?\n/).slice(-paths.length).map((line) => line.trim());
    if (urls.length !== paths.length || urls.some((url) => !/^https?:\/\/[^\s]+$/i.test(url))) {
      throw new Error('上传程序应在输出末尾为每个文件提供一行 HTTP 或 HTTPS 地址。');
    }
    return sources.map((source, index) => ({ source, url: urls[index] }));
  }

  return { embedLocalAssets, handleRequest, importImage, mediaFile, resolveImage, uploadImages };
}

module.exports = { createAssets, scheme };

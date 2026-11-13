const fs = require('node:fs/promises');
const path = require('node:path');
const { BrowserWindow } = require('electron');

const imageTag = /^<img(?=\s|\/?>)(?:[^"'<>]|"[^"]*"|'[^']*')*\/?>$/i;
const sourceSetTag = /^<source\b[^>]*\bsrcset\s*=/i;
const networkImage = /^(?:https?:|\/\/)/i;
const dataImage = /^data:image\//i;
const dimensions = new Set(['width', 'height']);
const dimensionValue = /^(?:\d+(?:\.\d*)?|\.\d+)(?:px|cm|mm|in|pt|pc|em|ex|rem|%)?$/i;
const imageWriters = new Set(['docx', 'epub', 'epub2', 'epub3', 'odt', 'rtf', 'revealjs', 'html', 'html4', 'html5']);
const htmlWriters = new Set(['revealjs', 'html', 'html4', 'html5']);

function walk(value, visit) {
  if (Array.isArray(value)) {
    return value.map(child => walk(child, visit)).filter(child => child !== undefined);
  }
  if (!value || typeof value !== 'object') return value;
  if (typeof value.t !== 'string') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, walk(child, visit)]));
  const node = visit(value);
  return node?.c && typeof node.c === 'object' ? { ...node, c: walk(node.c, visit) } : node;
}

function findRawImage(node) {
  return (node.t === 'RawInline' || node.t === 'RawBlock') && node.c[0] === 'html' &&
    imageTag.test(node.c[1]) ? node.c[1] : null;
}

function portablePath(file) {
  // Pandoc decodes URI escapes in local paths. A Windows file URI behaves
  // differently, so retain the filesystem path and escape its URL separators.
  return file.replaceAll(path.sep, '/').replaceAll('%', '%25').replaceAll('#', '%23');
}

function fallback(node) {
  const [attributes, caption, [source]] = node.c;
  const missingLabel = [{ t: 'Str', c: source.split(/[\\/]/).at(-1) || '图片' }];
  return { t: 'Span', c: [attributes, caption.length ? caption : missingLabel] };
}

function cleanImageAttributes(attributes) {
  const safe = new Map();
  for (const [name, value] of attributes) {
    const key = name.toLowerCase();
    if (dimensions.has(key) && dimensionValue.test(value)) safe.set(key, value);
    if (key === 'style') {
      for (const declaration of value.split(';')) {
        const [property, size] = declaration.toLowerCase().split(':', 2).map(part => part.trim());
        if (dimensions.has(property) && dimensionValue.test(size) && !safe.has(property)) safe.set(property, size);
      }
    }
  }
  return [...safe];
}

function rasterizeFor(writer, source) {
  const format = dataImage.test(source) ? /^data:image\/([^;,]+)/i.exec(source)?.[1].toLowerCase() :
    path.extname(source).slice(1).toLowerCase();
  // The bundled Word writer needs an external converter for SVG. WebP
  // support also varies by Word viewer, so embed a portable PNG for both.
  if (writer === 'docx') return ['svg', 'svg+xml', 'webp'].includes(format);
  if (writer === 'rtf') return !['png', 'jpg', 'jpeg'].includes(format);
  return false;
}

function createRasterizer(temporary) {
  let window;
  let loaded;
  let index = 0;
  return {
    async png(address) {
      if (!window) {
        window = new BrowserWindow({ show: false,
          webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
        });
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        window.webContents.on('will-navigate', (event) => event.preventDefault());
        const csp = "default-src 'none'; img-src data:";
        loaded = window.loadURL('data:text/html,' + encodeURIComponent(`<meta http-equiv="Content-Security-Policy" content="${csp}">`));
      }
      await loaded;
      const data = await window.webContents.executeJavaScript(`(async () => {
        const image = new Image();
        image.src = ${JSON.stringify(address)};
        await image.decode();
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png').split(',')[1];
      })()`);
      const file = path.join(temporary, `image-${index++}.png`);
      await fs.writeFile(file, Buffer.from(data, 'base64'));
      return portablePath(file);
    },
    close() {
      if (window && !window.isDestroyed()) window.destroy();
    },
  };
}

async function normalizePandocMedia(document, { assets, documentPath, rootPath, allowRemoteMedia, writer, temporary, parseHtml }) {
  const rawImages = new Map();
  walk(document, node => {
    const html = findRawImage(node);
    if (html && !rawImages.has(html)) rawImages.set(html, `image-${rawImages.size}`);
    return node;
  });
  const parsedTags = rawImages.size ? await parseHtml([...rawImages].map(([tag, id]) =>
    `<div id="${id}">${tag}</div>`).join('\n')) : [];
  const htmlImages = new Map(parsedTags.filter(node => node.t === 'Div')
    .map(({ c: [[id], [block]] }) => [id, block?.t === 'Plain' ? block.c.find(child => child.t === 'Image') : null]));

  const sources = new Set();
  document = walk(document, node => {
    const html = findRawImage(node);
    if (html) {
      const image = htmlImages.get(rawImages.get(html));
      if (!image) return node;
      sources.add(image.c[2][0]);
      return node.t === 'RawBlock' ? { t: 'Plain', c: [image] } : image;
    }
    // Keep the fallback img inside a picture without fetching a separate set
    // of unresolved responsive candidates from the source document.
    if (node.c?.[0] === 'html' && sourceSetTag.test(node.c[1])) return undefined;
    if (node.t === 'Image') sources.add(node.c[2][0]);
    return node;
  });

  let missingImages = 0;
  const locations = new Map();
  const rasterizer = createRasterizer(temporary);
  try {
    for (const source of sources) {
      const remote = networkImage.test(source);
      if (remote && !allowRemoteMedia) continue;
      if (remote) {
        locations.set(source, source.startsWith('//') ? 'https:' + source : source);
        continue;
      }
      const resource = { documentPath, rootPath, source };
      const local = dataImage.test(source) ? source : await assets.mediaFile(resource);
      if (!local) {
        if (source) missingImages++;
        continue;
      }
      if (rasterizeFor(writer, local)) {
        try {
          const address = dataImage.test(local) ? local : await assets.resolveImage({ ...resource, embed: true });
          if (!address) { missingImages++; continue; }
          locations.set(source, await rasterizer.png(address));
        } catch {
          missingImages++;
        }
      } else {
        locations.set(source, dataImage.test(local) ? local : portablePath(local));
      }
    }
  } finally {
    rasterizer.close();
  }
  document = walk(document, node => {
    if (node.t !== 'Image') return node;
    const [[id, classes, attributes], caption, [source, title]] = node.c;
    const clean = [id, classes.filter(name => name !== 'inline-svg'), cleanImageAttributes(attributes)];
    const location = locations.get(source);
    const image = { ...node, c: [clean, caption, [location ?? source, title]] };
    return location ? image : fallback(image);
  });
  return { document, missingImages };
}

module.exports = { htmlWriters, imageWriters, normalizePandocMedia };

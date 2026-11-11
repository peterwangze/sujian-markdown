const { app, BrowserWindow, dialog, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');
const { atomicWrite } = require('./documents.cjs');

const run = promisify(execFile);
const exportFormats = {
  html: ['html', 'HTML'], 'html-plain': ['html', 'HTML（无样式）'],
  pdf: ['pdf', 'PDF'], png: ['png', 'PNG'],
  docx: ['docx', 'Word', 'docx'], odt: ['odt', 'OpenDocument', 'odt'],
  rtf: ['rtf', 'RTF', 'rtf'], epub: ['epub', 'EPUB', 'epub'],
  latex: ['tex', 'LaTeX', 'latex'], tex: ['tex', 'LaTeX', 'latex'],
  mediawiki: ['wiki', 'MediaWiki', 'mediawiki'], dokuwiki: ['dokuwiki', 'DokuWiki', 'dokuwiki'],
  rst: ['rst', 'reStructuredText', 'rst'], textile: ['textile', 'Textile', 'textile'],
  opml: ['opml', 'OPML', 'opml'], revealjs: ['html', 'Reveal.js', 'revealjs'],
  markdown: ['md', 'Markdown (Pandoc)', 'markdown'], gfm: ['md', 'GitHub Flavored Markdown', 'gfm'],
  commonmark: ['md', 'CommonMark', 'commonmark'], markdown_extra: ['md', 'PHP Markdown Extra', 'markdown_phpextra'],
  org: ['org', 'Org Mode', 'org'], custom: ['txt', 'Pandoc', ''],
};
const importFormats = {
  docx: 'docx', odt: 'odt', rtf: 'rtf', latex: 'latex', tex: 'latex', ltx: 'latex',
  rst: 'rst', rest: 'rst', org: 'org', wiki: 'mediawiki', dokuwiki: 'dokuwiki',
  textile: 'textile', opml: 'opml', epub: 'epub', html: 'html', htm: 'html',
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function htmlDocument(html, title, { options, plain = false }) {
  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src sujian-asset: data: blob: https: http:; media-src sujian-asset: data: blob: https: http:; font-src data:;";
  const security = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  const customCss = String(options.css ?? '').replace(/<\/style/gi, '<\\/style');
  if (/^\s*(?:<!doctype\s+html[^>]*>\s*)?<html[\s>]/i.test(html) && /<head[\s>]/i.test(html)) {
    const document = html.replace(/<head\b[^>]*>/i, (head) => head + security);
    return customCss && !plain ? document.replace(/<\/head>/i, `<style>${customCss}</style></head>`) : document;
  }
  const css = plain ? '' : `
    html { color-scheme: light; background: white; }
    body { box-sizing: border-box; max-width: 920px; margin: 0 auto; padding: 32px 54px;
      color: #24292f; font: 16px/1.7 system-ui, sans-serif; overflow-wrap: break-word; }
    h1,h2,h3,h4,h5,h6 { line-height: 1.3; page-break-after: avoid; }
    pre { white-space: pre-wrap; background: #f5f6f8; padding: 1em; }
    code { font-family: ui-monospace, Consolas, monospace; }
    a { color: #225e9f; }
    img,svg,video { max-width: 100%; }
    table { border-collapse: collapse; }
    td,th { border: 1px solid #c7ced5; padding: .35em .65em; }
    blockquote { border-inline-start: 3px solid #bdc6d4; padding-inline-start: 1em; margin-inline-start: 0; }
    @media print { body { max-width: none; padding: 0; } }
    ${customCss}`;
  return `<!doctype html><html lang="${escapeHtml(options.language ?? 'zh-CN')}"><head><meta charset="utf-8">${security}<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>${css ? `<style>${css}</style>` : ''}</head><body><main class="markdown-body" id="write">${html}</main></body></html>`;
}

async function pandocExecutable(custom) {
  const filename = process.platform === 'win32' ? 'pandoc.exe' : 'pandoc';
  const architecture = `${process.platform}-${process.arch}`;
  const candidates = [
    custom,
    path.join(process.resourcesPath, 'pandoc', filename),
    path.join(process.resourcesPath, 'pandoc', architecture, filename),
    path.join(app.getAppPath(), 'build', 'pandoc', filename),
    path.join(app.getAppPath(), 'build', 'pandoc', architecture, filename),
    path.join(app.getAppPath(), 'resources', 'pandoc', filename),
  ];
  for (const candidate of candidates.filter(Boolean)) {
    try {
      await fs.access(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
      return candidate;
    } catch {
      // Fall through to the packaged binary or the user's PATH.
    }
  }
  return filename;
}

async function usePandoc(args, { cwd, executable } = {}) {
  try {
    const binary = await pandocExecutable(executable);
    return await run(binary, args, { cwd, timeout: 120000, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('未找到 Pandoc。请使用包含 Pandoc 的安装包，或在偏好设置中指定其路径。');
    throw new Error(error.stderr?.trim() || error.message);
  }
}

function diagramFences(text) {
  const lines = text.split('\n');
  const diagrams = [];
  for (let start = 0; start < lines.length; start += 1) {
    const opening = /^( {0,3})(`{3,}|~{3,})[ \t]*([^ \t]*)/.exec(lines[start]);
    if (!opening) continue;
    const [, indent, fence, language] = opening;
    const closing = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`);
    let end = start + 1;
    while (end < lines.length && !closing.test(lines[end])) end += 1;
    if (['mermaid', 'flow', 'flowchart', 'sequence', 'graphviz'].includes(language)) diagrams.push({ start, end, indent, language });
    start = end;
  }
  return { lines, diagrams };
}

function createConversion({ assets, userDataPath }) {
  async function importDocument(window, options = {}) {
    let source = options.path;
    if (!source) {
      const answer = await dialog.showOpenDialog(window, {
        title: '导入文档', properties: ['openFile'], filters: [{ name: '可导入文档', extensions: Object.keys(importFormats) }],
      });
      if (answer.canceled || !answer.filePaths.length) return null;
      [source] = answer.filePaths;
    }
    source = path.resolve(source);
    const format = importFormats[path.extname(source).slice(1).toLowerCase()];
    if (!format) throw new Error('不支持此导入格式。');
    const media = path.join(userDataPath, 'assets', `import-${randomUUID()}`);
    const { stdout } = await usePandoc([
      '--from', format, '--to', 'markdown', '--wrap=none', '--standalone', '--extract-media', media, source,
    ], { cwd: path.dirname(source), executable: options.pandocPath });
    return { name: `${path.parse(source).name}.md`, text: stdout };
  }

  async function printHtml(html, title, format, options) {
    const temporary = await fs.mkdtemp(path.join(tmpdir(), 'sujian-render-'));
    const window = new BrowserWindow({ show: false, useContentSize: true, width: 1024, height: 768,
      webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: format === 'png' },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    try {
      const file = path.join(temporary, 'document.html');
      await fs.writeFile(file, htmlDocument(html, title, { options }), 'utf8');
      await window.loadFile(file);
      await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
      if (format === 'print') {
        await new Promise((resolve, reject) => window.webContents.print({ printBackground: true }, (success, reason) => {
          if (success || reason === 'Print job canceled') resolve();
          else reject(new Error(reason));
        }));
        return null;
      }
      if (format === 'pdf') {
        return await window.webContents.printToPDF({
          printBackground: options.printBackground !== false, pageSize: options.pageSize || 'A4',
          landscape: Boolean(options.landscape), preferCSSPageSize: Boolean(options.preferCSSPageSize),
          ...(options.margins ? { margins: options.margins } : {}),
          ...(options.scale ? { scale: options.scale } : {}),
          ...(options.headerTemplate || options.footerTemplate ? { displayHeaderFooter: true,
            headerTemplate: options.headerTemplate || '<span></span>', footerTemplate: options.footerTemplate || '<span></span>',
          } : {}),
        });
      }
      const size = await window.webContents.executeJavaScript('({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })');
      if (size.height > 16384 || size.width * size.height > 25000000) throw new Error('文档过长，无法导出为单张图片。可导出为 PDF。');
      window.setContentSize(size.width, size.height);
      await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
      const image = await window.webContents.capturePage({ x: 0, y: 0, ...size }, { stayHidden: true });
      if (image.isEmpty()) throw new Error('无法捕获文档图像。');
      return image.toPNG();
    } finally {
      if (!window.isDestroyed()) window.destroy();
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }

  async function preparePandocText(text, html, temporary, options) {
    const { lines, diagrams } = diagramFences(text);
    if (!diagrams.length || !html?.includes('markdown-diagram')) return text;
    const window = new BrowserWindow({ show: false, width: 1100, height: 800,
      webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    try {
      const source = path.join(temporary, 'diagram-assets.html');
      await fs.writeFile(source, htmlDocument(html, 'Diagrams', { options }), 'utf8');
      await window.loadFile(source);
      const images = await window.webContents.executeJavaScript(`(async () => {
        const results = [];
        const hosts = Array.from(document.querySelectorAll('.markdown-diagram'));
        for (const [ordinal, host] of hosts.entries()) {
          const diagram = host.querySelector('svg');
          if (!diagram) continue;
          const viewBox = diagram.viewBox.baseVal;
          const rect = diagram.getBoundingClientRect();
          const width = Math.max(1, viewBox.width || rect.width);
          const height = Math.max(1, viewBox.height || rect.height);
          const scale = Math.min(2, 1800 / Math.max(width, height));
          const source = diagram.cloneNode(true);
          source.setAttribute('width', String(width));
          source.setAttribute('height', String(height));
          source.removeAttribute('class');
          source.style.maxWidth = 'none';
          const blob = new Blob([new XMLSerializer().serializeToString(source)], { type: 'image/svg+xml' });
          const url = URL.createObjectURL(blob);
          try {
            const image = new Image();
            image.src = url;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const index = Number(host.getAttribute('data-source-index') ?? ordinal);
            results.push({ ordinal: index, data: canvas.toDataURL('image/png').split(',')[1] });
          } catch (error) {
            console.warn(error.message);
          } finally {
            URL.revokeObjectURL(url);
          }
        }
        return results;
      })()`);
      const replacements = [];
      for (const { ordinal, data } of images) {
        const diagram = diagrams[ordinal];
        if (!diagram || !data) continue;
        const file = path.join(temporary, `diagram-${ordinal}.png`);
        await fs.writeFile(file, Buffer.from(data, 'base64'));
        replacements.push({ ...diagram, markdown: `${diagram.indent}![${diagram.language}](<${file.replace(/\\/g, '/')}>)` });
      }
      for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
        lines.splice(replacement.start, replacement.end - replacement.start + 1, replacement.markdown);
      }
      return lines.join('\n');
    } finally {
      if (!window.isDestroyed()) window.destroy();
    }
  }

  async function exportDocument(window, { format, html, text, documentPath, defaultName, options = {} }) {
    const target = exportFormats[format];
    if (!target && format !== 'print') throw new Error('不支持此导出格式。');
    const title = path.parse(defaultName || documentPath || '未命名').name;
    const markup = typeof html === 'string' ? html : `<pre>${escapeHtml(text ?? '')}</pre>`;
    if (format === 'print') {
      await printHtml(await assets.embedLocalAssets(markup), title, format, options);
      return { path: null };
    }
    const [extension, name, writer] = target;
    const actualExtension = format === 'custom' && /^[a-zA-Z0-9]{1,16}$/.test(options.extension ?? '') ? options.extension : extension;
    let destination = options.outputPath;
    if (!destination) {
      const selected = await dialog.showSaveDialog(window, {
        title: `导出 ${name}`, defaultPath: path.join(documentPath ? path.dirname(documentPath) : app.getPath('documents'), `${title}.${actualExtension}`),
        filters: [{ name, extensions: [actualExtension] }],
      });
      if (selected.canceled || !selected.filePath) return null;
      destination = selected.filePath;
    }
    destination = path.resolve(destination);
    if (documentPath && path.resolve(documentPath) === destination) throw new Error('导出路径与原文档相同。请选择不同的文件名。');
    if (format === 'html' || format === 'html-plain') {
      const body = await assets.embedLocalAssets(markup);
      await atomicWrite(destination, Buffer.from(htmlDocument(body, title, { options, plain: format === 'html-plain' })));
    } else if (format === 'pdf' || format === 'png') {
      const body = await assets.embedLocalAssets(markup);
      await atomicWrite(destination, await printHtml(body, title, format, options));
    } else {
      const temporary = await fs.mkdtemp(path.join(tmpdir(), 'sujian-convert-'));
      const input = path.join(temporary, 'document.md');
      const output = path.join(temporary, `output.${actualExtension}`);
      try {
        let source = text ?? '';
        if (['docx', 'epub'].includes(format)) source = await preparePandocText(source, html, temporary, options);
        const toc = /^(?: {0,3})\[TOC\][ \t]*$/im.test(source);
        if (toc) source = source.replace(/^(?: {0,3})\[TOC\][ \t]*$/gim, '');
        await fs.writeFile(input, source, 'utf8');
        const formatName = format === 'custom' ? options.writer : writer;
        const args = ['--from', 'markdown+tex_math_dollars+yaml_metadata_block+task_lists+mark', '--standalone'];
        if (formatName) args.push('--to', formatName);
        if (options.referenceDocument && ['docx', 'odt'].includes(format)) args.push('--reference-doc', options.referenceDocument);
        if (options.template) args.push('--template', options.template);
        if (options.toc || toc) args.push('--toc');
        if (format === 'revealjs' && options.revealjsUrl) args.push('--variable', `revealjs-url=${options.revealjsUrl}`);
        if (Array.isArray(options.args) && options.args.every((item) => typeof item === 'string')) args.push(...options.args);
        args.push('--output', output, input);
        await usePandoc(args, { cwd: documentPath ? path.dirname(documentPath) : app.getPath('documents'), executable: options.pandocPath });
        await atomicWrite(destination, await fs.readFile(output));
      } finally {
        await fs.rm(temporary, { recursive: true, force: true });
      }
    }
    if (options.reveal) shell.showItemInFolder(destination);
    if (options.open) await shell.openPath(destination);
    return { path: destination };
  }

  return { exportDocument, importDocument };
}

module.exports = { createConversion };

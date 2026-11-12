import DOMPurify from 'dompurify';
import Vditor from 'vditor';
import editorStyles from 'vditor/dist/index.css?inline';
import { resolveTheme, themeDeclarations } from '../theme/themes.js';

export const vendorRoot = new URL(`${import.meta.env.BASE_URL}vendor/vditor/`, document.baseURI).href.replace(/\/$/, '');
const assets = `${vendorRoot}/dist`;

export const markdownOptions = {
  autoSpace: false,
  fixTermTypo: false,
  footnotes: true,
  inlineMath: true,
  mark: true,
  sanitize: true,
  sub: true,
  sup: true,
  toc: true,
};

const pendingScripts = new Map();

export function loadVendorScript(id, file) {
  if (pendingScripts.has(id)) return pendingScripts.get(id);
  if (document.getElementById(id)) return Promise.resolve();

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${assets}/js/${file}`;
    script.addEventListener('load', () => {
      script.id = id;
      resolve();
    }, { once: true });
    script.addEventListener('error', () => {
      pendingScripts.delete(id);
      script.remove();
      reject(new Error(`Unable to load ${file}`));
    }, { once: true });
    document.head.append(script);
  });

  pendingScripts.set(id, promise);
  return promise;
}

function installMathStyles() {
  if (document.getElementById('vditorKatexStyle')) return;
  const link = document.createElement('link');
  link.id = 'vditorKatexStyle';
  link.rel = 'stylesheet';
  link.href = `${assets}/js/katex/katex.min.css`;
  document.head.append(link);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

const sanitizeOptions = {
  FORBID_TAGS: ['embed', 'form', 'iframe', 'object', 'script', 'style', 'template'],
  FORBID_ATTR: ['autofocus', 'srcdoc', 'srcset'],
};

function sanitizedFragment(html, styles = false) {
  const fragment = DOMPurify.sanitize(html, {
    ...sanitizeOptions,
    FORBID_ATTR: styles ? sanitizeOptions.FORBID_ATTR : [...sanitizeOptions.FORBID_ATTR, 'style'],
    FORBID_TAGS: styles === 'svg' ? sanitizeOptions.FORBID_TAGS.filter((tag) => tag !== 'style') : sanitizeOptions.FORBID_TAGS,
    RETURN_DOM_FRAGMENT: true,
  });
  if (styles === 'svg') {
    for (const style of fragment.querySelectorAll('style, [style]')) {
      const css = style.tagName.toLowerCase() === 'style' ? style.textContent : style.getAttribute('style');
      if (/@(?:import|font-face|namespace)\b|\\|url\(\s*["']?\s*[^#"'\s]|image-set\s*\(/i.test(css)) {
        if (style.tagName.toLowerCase() === 'style') style.remove();
        else style.removeAttribute('style');
      }
    }
  }
  return fragment;
}

function renderError(node, error) {
  const hint = document.createElement('small');
  hint.className = 'markdown-render-error';
  hint.textContent = error instanceof Error ? error.message : String(error);
  node.append(hint);
}

async function renderMath(root) {
  const expressions = [...root.querySelectorAll('.language-math')];
  if (!expressions.length) return;

  installMathStyles();
  try {
    await loadVendorScript('vditorKatexScript', 'katex/katex.min.js');
    await loadVendorScript('vditorKatexChemScript', 'katex/mhchem.min.js');
  } catch (error) {
    expressions.forEach((node) => renderError(node, error));
    return;
  }

  for (const node of expressions) {
    const displayMode = node.tagName === 'DIV' || node.closest('pre') !== null;
    try {
      const html = window.katex.renderToString(node.textContent, { displayMode, trust: false });
      node.replaceChildren(sanitizedFragment(html, true));
    } catch (error) {
      renderError(node, error);
    }
  }
}

function graphvizWorker() {
  const renderer = `${assets}/js/graphviz/full.render.js`;
  const script = new Blob([`importScripts(${JSON.stringify(renderer)});`], { type: 'application/javascript' });
  const url = URL.createObjectURL(script);
  try {
    return new Worker(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

let diagramQueue = Promise.resolve();

function drawFlowchart(host, source, colors) {
  const diagram = window.flowchart.parse(source);
  const measurement = host.ownerDocument.createElement('div');
  measurement.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;';
  measurement.inert = true;
  measurement.append(host);
  // Raphaël uses SVG getBBox to size the shapes around their labels.
  host.ownerDocument.body.append(measurement);
  try {
    diagram.drawSVG(host, {
      'font-color': colors.ink, 'line-color': colors.muted, 'element-color': colors.accent, fill: colors.surface,
    });
    return host.innerHTML;
  } finally {
    measurement.remove();
  }
}

async function renderDiagrams(root, theme, embeddedMediaOnly = false) {
  const languages = ['mermaid', 'flowchart', 'flow', 'graphviz', 'sequence'];
  const diagrams = [...root.querySelectorAll(languages.map((language) => `div.language-${language}, pre > code.language-${language}`).join(', '))];
  if (!diagrams.length) return;
  const { colors, scheme } = resolveTheme(theme);

  // Mermaid's configuration is global. Keep simultaneous previews and exports in order.
  const run = diagramQueue.then(async () => {
    let worker;
    try {
      for (const [sourceIndex, code] of diagrams.entries()) {
        const language = languages.find((name) => code.classList.contains(`language-${name}`));
        const pre = code.closest('pre');
        const block = pre && pre !== root ? pre : code;
        const host = document.createElement('div');
        host.className = 'markdown-diagram';
        host.dataset.sourceIndex = String(sourceIndex);
        host.dataset.diagramLanguage = language;
        try {
          const source = code.textContent;
          if (embeddedMediaOnly && /@\s*\{|%%\s*\{|^\s*---\s*$|(?:https?|file|sujian-asset):|\/\/|<\s*(?:img|image|style)\b|\b(?:url|image-set)\s*\(|\b(?:image|shapefile|href|stylesheet)\s*=/im.test(source)) {
            throw new Error('审阅预览已省略含媒体或自定义配置的图表。可在源码差异中查看。');
          }
          let svg;
          if (language === 'mermaid' || language === 'sequence') {
            await loadVendorScript('vditorMermaidScript', 'mermaid/mermaid.min.js');
            window.mermaid.initialize({
              startOnLoad: false, securityLevel: 'strict', htmlLabels: false, theme: 'base',
              themeVariables: {
                darkMode: scheme === 'dark', background: colors.canvas, textColor: colors.ink,
                primaryColor: colors.surface, primaryTextColor: colors.ink, primaryBorderColor: colors.accent,
                secondaryColor: colors.selected, tertiaryColor: colors['table-head'],
                lineColor: colors.muted, noteBkgColor: colors.quote, noteTextColor: colors.ink,
              },
            });
            const definition = language === 'sequence' ? convertSequence(source) : source;
            ({ svg } = await window.mermaid.render(`diagram-${crypto.randomUUID()}`, definition));
          } else if (language === 'flowchart' || language === 'flow') {
            await loadVendorScript('vditorFlowchartScript', 'flowchart.js/flowchart.min.js');
            svg = drawFlowchart(host, source, colors);
          } else if (language === 'graphviz') {
            await loadVendorScript('vditorGraphVizScript', 'graphviz/viz.js');
            worker ??= graphvizWorker();
            svg = (await new window.Viz({ worker }).renderSVGElement(source)).outerHTML;
          }
          const fragment = sanitizedFragment(svg, 'svg');
          if (embeddedMediaOnly) restrictReviewResources(fragment);
          host.replaceChildren(fragment);
          block.replaceWith(host);
        } catch (error) {
          renderError(block, error);
        }
      }
    } finally {
      worker?.terminate();
    }
  });
  diagramQueue = run.catch(() => {});
  await run;
}

function convertSequence(source) {
  const participants = new Map();
  const getActor = (value, label) => {
    const name = value.trim().replace(/^"|"$/g, '');
    if (!participants.has(name)) participants.set(name, { id: `p${participants.size}`, label: label ?? name });
    return participants.get(name).id;
  };
  const statements = [];
  let title;

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const heading = line.match(/^title\s*:?\s*(.+)$/i);
    const participant = line.match(/^participant\s+(.+?)(?:\s+as\s+(\S+))?$/i);
    const note = line.match(/^note\s+(left of|right of|over)\s+(.+?)\s*:\s*(.+)$/i);
    const signal = line.match(/^(.+?)\s*(-{1,2})(>{0,2})\s*(.+?)\s*:\s*(.+)$/);
    if (heading) title = heading[1];
    else if (participant) getActor(participant[2] ?? participant[1], participant[1].replace(/^"|"$/g, ''));
    else if (note) statements.push(`Note ${note[1].toLowerCase()} ${note[2].split(',').map((name) => getActor(name)).join(',')}: ${note[3]}`);
    else if (signal) statements.push(`${getActor(signal[1])}${signal[2]}${signal[3] === '>' ? '>>' : '>'}${getActor(signal[4])}: ${signal[5]}`);
    else throw new Error(`无法解析时序图行 ${line}`);
  }

  const header = title ? `---\ntitle: ${JSON.stringify(title)}\n---\n` : '';
  const declarations = [...participants.values()].map(({ id, label }) => `participant ${id} as ${label}`);
  return `${header}sequenceDiagram\n${[...declarations, ...statements].join('\n')}`;
}

export function renderLegacyDiagram(preview, theme) {
  void renderDiagrams(preview, theme);
}

export function isLocalImage(source) {
  return Boolean(source) && !/^(?:https?:|data:|blob:|sujian-asset:|\/\/|#)/i.test(source);
}

async function resolveAssets(root, resolveImage, inlineRemote) {
  if (!resolveImage) return;

  const requests = [];
  for (const media of root.querySelectorAll('img[src], audio[src], video[src], source[src], video[poster]')) {
    for (const attribute of ['src', 'poster']) {
      const source = media.getAttribute(attribute);
      if (!source || (!isLocalImage(source) && (!inlineRemote || !/^https?:/i.test(source)))) continue;

      requests.push(Promise.resolve().then(() => resolveImage(source)).then((resolved) => {
        if (typeof resolved === 'string' && /^(?:sujian-asset:\/\/local\/|blob:|data:(?:image|audio|video)\/|https?:)/i.test(resolved)) {
          media.setAttribute(attribute, resolved);
        }
      }).catch(() => {
        // Preserve the address and alt text when an asset is missing.
      }));
    }
  }
  await Promise.all(requests);
}

function highlightCss(theme) {
  return `${assets}/js/highlight.js/styles/${resolveTheme(theme).scheme === 'dark' ? 'github-dark' : 'github'}.min.css`;
}

async function highlightCode(root, theme, preview) {
  const codes = [...root.querySelectorAll('pre > code[class*="language-"]')];
  if (!codes.length) return;

  await loadVendorScript('vditorHljsScript', 'highlight.js/highlight.min.js');
  await loadVendorScript('vditorHljsThirdScript', 'highlight.js/third-languages.js');
  for (const code of codes) {
    const language = [...code.classList].find((name) => name.startsWith('language-')).slice(9);
    if (!window.hljs.getLanguage(language)) continue;
    const html = window.hljs.highlight(code.textContent, { language, ignoreIllegals: true }).value;
    code.replaceChildren(sanitizedFragment(html));
    code.classList.add('hljs');
  }

  if (preview && root.querySelector('.hljs')) {
    const link = document.getElementById('vditorHljsStyle') ?? document.createElement('link');
    link.id = 'vditorHljsStyle';
    link.rel = 'stylesheet';
    link.href = highlightCss(document.documentElement.dataset.theme ?? theme);
    if (!link.isConnected) document.head.append(link);
  }
}

function restrictReviewResources(root) {
  for (const node of root.querySelectorAll('[href], [xlink\\:href]')) {
    for (const attribute of ['href', 'xlink:href']) {
      if (node.localName === 'a' || !node.getAttribute(attribute)?.startsWith('#')) node.removeAttribute(attribute);
    }
  }
  for (const node of root.querySelectorAll('[src], [srcset], [poster], [autoplay]')) {
    node.removeAttribute('autoplay');
    node.removeAttribute('srcset');
    for (const attribute of ['src', 'poster']) {
      const address = node.getAttribute(attribute);
      if (address && !/^data:image\//i.test(address)) node.removeAttribute(attribute);
    }
  }
}

export async function renderPreview(markdown, {
  resolveImage, theme = 'light', inlineRemote = false, allowRemoteMedia = true, preview = true, embeddedMediaOnly = false,
} = {}) {
  await loadVendorScript('vditorLuteScript', 'lute/lute.min.js');
  const html = await Vditor.md2html(markdown, { cdn: vendorRoot, markdown: markdownOptions });
  const root = document.createElement('article');
  root.className = 'vditor-reset';
  const fragment = sanitizedFragment(html);
  if (embeddedMediaOnly) {
    restrictReviewResources(fragment);
  } else if (!allowRemoteMedia) {
    for (const media of fragment.querySelectorAll('img[src], audio[src], video[src], source[src], video[poster]')) {
      for (const attribute of ['src', 'poster']) {
        if (/^(?:https?:|\/\/)/i.test(media.getAttribute(attribute) ?? '')) media.removeAttribute(attribute);
      }
    }
  }
  root.append(fragment);
  for (const item of root.querySelectorAll('.vditor-toc [data-target-id]')) {
    const link = document.createElement('a');
    link.href = `#${encodeURIComponent(item.getAttribute('data-target-id'))}`;
    link.append(...item.childNodes);
    item.replaceWith(link);
  }
  await Promise.all([renderMath(root), renderDiagrams(root, theme, embeddedMediaOnly), resolveAssets(root, embeddedMediaOnly ? undefined : resolveImage, inlineRemote)]);
  await highlightCode(root, theme, preview);
  if (embeddedMediaOnly) restrictReviewResources(root);
  return root;
}

let embeddedMathCss;

function offlineMathCss() {
  embeddedMathCss ??= (async () => {
    const root = `${assets}/js/katex/`;
    const css = await (await fetch(`${root}katex.min.css`)).text();
    const urls = [...new Set([...css.matchAll(/url\((fonts\/[^)]+\.woff2)\)/g)].map((match) => match[1]))];
    const pairs = await Promise.all(urls.map(async (url) => {
      const response = await fetch(root + url);
      if (!response.ok) throw new Error(`Unable to embed math font ${url}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const base64 = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
      return [url, `data:font/woff2;base64,${base64}`];
    }));
    const data = new Map(pairs);
    return css.replace(/src:([^;}]*fonts\/[^;}]+)/g, (_match, value) => {
      const font = value.match(/url\((fonts\/[^)]+\.woff2)\)/)?.[1];
      return font ? `src:url(${data.get(font)}) format('woff2')` : '';
    });
  })();
  return embeddedMathCss;
}

const documentCss = `
  body { margin: 0; color: var(--ink); background: var(--canvas); }
  main { max-width: 46rem; margin: 0 auto; padding: 3rem 2rem; }
  #write { color: var(--ink); font: var(--export-font-size)/var(--export-line-height) system-ui, sans-serif; }
  #write a { color: var(--accent-ink); text-decoration: underline; }
  #write :is(h1,h2) { border-color: var(--border); }
  #write hr { background: var(--border); }
  #write blockquote { color: var(--ink); background: var(--quote); border-color: var(--accent); }
  #write table tr { background: var(--canvas); border-color: var(--border); }
  #write table :is(th,td) { border-color: var(--border); }
  #write table th, #write table tbody tr:nth-child(2n) { background: var(--table-head); }
  #write code:not(.hljs), #write kbd { color: var(--ink); background: var(--chrome); }
  #write ::selection { color: var(--ink); background: var(--selection); }
  img, svg { max-width: 100%; height: auto; }
  pre, table, blockquote, .markdown-diagram { break-inside: avoid; }
  .markdown-diagram { overflow-x: auto; text-align: center; }
  .markdown-render-error { display: block; margin-top: .5em; color: var(--accent-ink); }
`;

export async function renderDocument(markdown, {
  title = 'Markdown', styled = true, theme = 'light', print = false, typography, ...options
} = {}) {
  const appearance = resolveTheme(print ? 'light' : theme);
  const article = await renderPreview(markdown, { ...options, theme: appearance.id, preview: false });
  article.id = 'write';
  const mathCss = article.querySelector('.katex') ? await offlineMathCss() : '';
  const codeCss = styled && article.querySelector('.hljs') ? await (await fetch(highlightCss(appearance.id))).text() : '';
  const fontSize = Number.isFinite(typography?.fontSize) ? Math.min(36, Math.max(12, typography.fontSize)) : 16;
  const lineHeight = Number.isFinite(typography?.lineHeight) ? Math.min(2.4, Math.max(1.25, typography.lineHeight)) : 1.7;
  const paletteCss = `:root{${themeDeclarations(appearance)}--export-font-size:${fontSize}px;--export-line-height:${lineHeight};}`;
  const printCss = '@media print { main { margin: 0; padding: 0; max-width: none; } }';
  const styles = (styled ? editorStyles + paletteCss + documentCss + codeCss + printCss : '') + mathCss;
  const stylesheet = styles ? `<style>${styles.replace(/<\/style/gi, '<\\/style')}</style>` : '';
  const media = options.allowRemoteMedia === false ? 'data: blob: file: sujian-asset:' : 'data: blob: https: http: file: sujian-asset:';
  const csp = `script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'; font-src data:; img-src ${media}; media-src ${media}`;
  return `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${escapeHtml(title)}</title>${stylesheet}</head><body><main>${article.outerHTML}</main></body></html>`;
}

import { markdownLanguage } from '@codemirror/lang-markdown';

export const codeLanguageToken = /^[A-Za-z0-9_+#.-]{1,48}$/;
const cellLanguage = /^\s*([a-z0-9_][a-z0-9_+#.-]{0,47})(?=[\s,]|$)/i;
const attribute = /(?:[^\s"'\\]+|\\.|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')+/g;
const codeOptions = new Set(['numberLines', 'number-lines', 'lineAnchors', 'line-anchors']);

export function fenceInfo(value) {
  const from = value.length - value.trimStart().length;
  const source = value.trim();
  if (!source) return { kind: 'plain', language: '', from, to: from };

  if (!source.startsWith('{')) {
    const language = /^\S+/.exec(source)[0];
    return codeLanguageToken.test(language) ? { kind: 'plain', language, from, to: from + language.length }
      : { kind: 'opaque', language: '' };
  }

  const braceWidth = source.startsWith('{{') ? 2 : 1;
  if (!source.endsWith('}'.repeat(braceWidth))) return { kind: 'opaque', language: '' };
  const body = source.slice(braceWidth, -braceWidth);
  const cell = cellLanguage.exec(body);
  if (cell) {
    const start = from + braceWidth + cell[0].length - cell[1].length;
    return { kind: 'cell', language: cell[1], from: start, to: start + cell[1].length };
  }
  if (braceWidth !== 1 || body.trimStart().startsWith('=')) return { kind: 'opaque', language: '' };

  for (const item of body.matchAll(attribute)) {
    if (!item[0].startsWith('.')) continue;
    const language = item[0].slice(1);
    if (!codeLanguageToken.test(language) || codeOptions.has(language)) continue;
    const start = from + braceWidth + item.index;
    return { kind: 'attributes', language, from: start, to: start + item[0].length };
  }
  const start = from + braceWidth + body.length - body.trimStart().length;
  return { kind: 'attributes', language: '', from: start, to: start };
}

export function replaceFenceLanguage(value, language) {
  if (language && !codeLanguageToken.test(language)) return null;
  const info = fenceInfo(value);
  if (info.kind === 'opaque' || (info.kind === 'cell' && !language)) return null;
  if (info.language === language) return value;

  const before = value.slice(0, info.from);
  const after = value.slice(info.to);
  if (info.kind === 'attributes') {
    if (!language) {
      const remaining = before + after.replace(/^[ \t]+/, '');
      return /^\s*\{\s*\}\s*$/.test(remaining) ? '' : remaining;
    }
    const separator = !info.language && !after.startsWith('}') ? ' ' : '';
    return before + '.' + language + separator + after;
  }
  if (!language) return after.trimStart().startsWith('{') ? before + after.trimStart() : '';
  return before + language + after;
}

export function structuredFenceSources(markdown, includePlain = false) {
  if (!includePlain && !/(?:`{3,}|~{3,})[^\r\n]*\{/.test(markdown)) return [];
  const blocks = [];
  markdownLanguage.parser.parse(markdown).iterate({
    enter(node) {
      if (node.name !== 'FencedCode' && node.name !== 'CodeBlock') return;
      const info = node.node.getChild('CodeInfo');
      const code = node.node.getChild('CodeText');
      const value = info && markdown.slice(info.from, info.to);
      blocks.push(value && (includePlain || value.includes('{')) ? {
        value, from: info.from, to: info.to, index: blocks.length,
        firstLine: code ? markdown.slice(code.from, code.to).split(/\r?\n/, 1)[0].trim() : '',
      } : null);
      return false;
    },
  });
  return blocks;
}

export function completeFenceHeaders(markdown, sources) {
  if (!sources.some(Boolean)) return markdown;
  const headers = structuredFenceSources(markdown, true);
  if (headers.length !== sources.length) return markdown;
  let result = markdown;
  for (let index = headers.length - 1; index >= 0; index--) {
    const header = headers[index];
    const value = sources[index]?.value;
    if (header && value && value !== header.value && /^\S+/.exec(value)?.[0] === header.value) {
      result = result.slice(0, header.from) + value + result.slice(header.to);
    }
  }
  return result;
}

export function normalizeFenceLanguagesForPreview(markdown) {
  const pieces = [];
  let offset = 0;
  for (const block of structuredFenceSources(markdown)) {
    if (!block) continue;
    const info = fenceInfo(block.value);
    if ((info.kind !== 'attributes' && info.kind !== 'cell') || !info.language) continue;
    pieces.push(markdown.slice(offset, block.from), info.language);
    offset = block.to;
  }
  return pieces.length ? pieces.join('') + markdown.slice(offset) : markdown;
}

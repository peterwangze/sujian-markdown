const inlineMarkers = {
  bold: '**', italic: '*', strike: '~~', 'inline-code': '`', highlight: '==',
  superscript: '^', subscript: '~', underline: '<u>',
};

function block(text, beforeLine) {
  return beforeLine.trim() ? `\n\n${text}\n\n` : `${text}\n\n`;
}

function lines(text, transform) {
  return text.split('\n').map(transform).join('\n');
}

function linkDestination(value) {
  const destination = String(value ?? '').replace(/\r?\n/g, '').replace(/\\/g, '/').trim();
  if (!destination) return 'https://';
  if (/[\s()]/.test(destination)) return `<${destination.replace(/</g, '%3C').replace(/>/g, '%3E')}>`;
  return destination;
}

export function formatMarkdown(command, payload, selection, beforeLine = '') {
  const marker = inlineMarkers[command];
  if (marker) {
    const script = command === 'superscript' || command === 'subscript';
    const body = script ? selection.replace(/\\/g, '\\\\').replace(/[\t ^~]/g, '\\$&') : selection;
    const close = command === 'underline' ? '</u>' : marker;
    const text = `${marker}${body}${close}`;
    return { text, offset: marker.length, length: body.length };
  }

  const selected = selection || '';
  let text;
  switch (command) {
    case 'insert':
      text = typeof payload === 'string' ? payload : payload?.text ?? '';
      break;
    case 'link':
    case 'image': {
      const image = command === 'image';
      const href = typeof payload === 'string' ? payload : payload?.href ?? payload?.url ?? payload?.src;
      const label = String((image ? payload?.alt : payload?.label) ?? payload?.text ?? (selected || (image ? '图片' : '链接')))
        .replace(/([\\[\]])/g, '\\$1').replace(/\r?\n/g, ' ');
      text = `${image ? '!' : ''}[${label}](${linkDestination(href)})`;
      break;
    }
    case 'heading': {
      const value = typeof payload === 'object' ? payload?.level : payload;
      const level = Math.max(0, Math.min(6, Number(value ?? 1) || 0));
      text = (level ? `${'#'.repeat(level)} ` : '') + selected.replace(/^#{1,6}\s+/, '');
      break;
    }
    case 'quote': text = lines(selected, (line) => `> ${line}`); break;
    case 'list': text = lines(selected, (line) => `- ${line}`); break;
    case 'ordered-list': text = lines(selected, (line, index) => `${index + 1}. ${line}`); break;
    case 'check': text = lines(selected, (line) => `- [ ] ${line}`); break;
    case 'indent': text = lines(selected, (line) => `  ${line}`); break;
    case 'outdent': text = lines(selected, (line) => line.replace(/^(?: {1,4}|\t)/, '')); break;
    case 'line': text = block('---', beforeLine); break;
    case 'code': {
      const language = String((typeof payload === 'string' ? payload : payload?.language) ?? '').replace(/[^\w+#-]/g, '');
      let length = 3;
      for (const [run] of selected.matchAll(/`+/g)) length = Math.max(length, run.length + 1);
      const fence = '`'.repeat(length);
      text = block(`${fence}${language}\n${selected}\n${fence}`, beforeLine);
      break;
    }
    case 'math':
      text = payload?.inline ? `$${selected || payload?.text || 'x'}$` : block(`$$\n${selected || payload?.text || 'E = mc^2'}\n$$`, beforeLine);
      break;
    case 'mermaid':
      text = block(`\`\`\`mermaid\n${selected || payload?.text || 'flowchart LR\n  A[开始] --> B[完成]'}\n\`\`\``, beforeLine);
      break;
    case 'toc': text = block('[TOC]', beforeLine); break;
    case 'footnote': {
      const id = String(payload?.id ?? 'note').replace(/[^\p{L}\p{N}_-]/gu, '') || 'note';
      text = `[^${id}]\n\n[^${id}]: ${selected || payload?.text || '脚注内容'}`;
      break;
    }
    case 'table': {
      const columns = Math.max(2, Math.min(20, Number(payload?.columns ?? 2) || 2));
      const rows = Math.max(1, Math.min(20, Number(payload?.rows ?? 2) || 2));
      const headings = Array.from({ length: columns }, (_, index) => `列 ${index + 1}`);
      const row = (cells) => `| ${cells.join(' | ')} |`;
      text = block([row(headings), row(headings.map(() => '---')), ...Array.from({ length: rows }, () => row(headings.map(() => ' ')))].join('\n'), beforeLine);
      break;
    }
    default: return null;
  }
  return { text, offset: text.length, length: 0 };
}

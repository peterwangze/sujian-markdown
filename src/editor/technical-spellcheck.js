const technologyNames = new Set([
  'api', 'cli', 'cmake', 'css', 'curl', 'docker', 'git', 'go', 'html', 'http', 'https', 'java',
  'javascript', 'json', 'jsx', 'kubectl', 'kubernetes', 'linux', 'markdown', 'npm', 'npx', 'pip',
  'pnpm', 'python', 'react', 'rust', 'sql', 'ssh', 'sujian', 'toml', 'tsx', 'typescript', 'utf', 'vite', 'yaml',
]);

const tokens = /(?:https?:\/\/|www\.|mailto:)[^\s<>]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|(?:[a-z]:[\\/]|\.{1,2}[\\/])[^\s<>]+|(?<![\w-])--[a-z][\w-]*|[a-z_]\w*(?:(?:::|[.\\/])[a-z_]\w*)*(?:\+\+|#)?/gi;

export function technicalSpellcheckRanges(text) {
  const ranges = [];
  for (const { 0: match, index } of text.matchAll(tokens)) {
    const token = match.replace(/[.,;!?]+$/, '');
    const identifier = /[_./\\:@]|[a-z][A-Z]|[A-Z]{2}[a-z]|[A-Za-z]\d/.test(token);
    if (identifier || token.startsWith('--') || /^C(?:\+\+|#)$/i.test(token) || technologyNames.has(token.toLowerCase()) || text[index + token.length] === '(') {
      ranges.push({ from: index, to: index + token.length });
    }
  }
  return ranges;
}

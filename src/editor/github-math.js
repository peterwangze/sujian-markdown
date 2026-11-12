export function unwrapGithubMath(source) {
  return source.length > 2 && source.startsWith('`') && source.endsWith('`') ? source.slice(1, -1) : source;
}

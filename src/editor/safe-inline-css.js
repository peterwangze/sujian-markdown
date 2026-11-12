const htmlNamespace = 'http://www.w3.org/1999/xhtml';

const textProperties = [
  'font-family', 'font-size', 'font-style', 'font-variant-caps', 'font-weight',
  'letter-spacing', 'line-height', 'text-align', 'text-decoration-line', 'text-decoration-style',
  'text-decoration-thickness', 'text-transform', 'vertical-align', 'white-space', 'word-spacing',
];
const colorProperties = ['color', 'background-color', 'text-decoration-color'];
const colorFunctions = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix', 'light-dark']);

function acceptsValue(value, allowColorFunctions) {
  if (!value || /[\\@{};<>]/u.test(value)) return false;
  const functions = value.matchAll(/([\w-]+)\(/g);
  return Array.from(functions).every(([, name]) => allowColorFunctions && colorFunctions.has(name.toLowerCase()));
}

export function safeInlineStyle(css, document) {
  if (!css) return '';

  // The detached element parses declarations and expands shorthands without
  // applying any style to the document. Only selected longhands leave it.
  const { style } = document.createElement('span');
  style.cssText = css;
  const declarations = [];
  for (const [properties, allowColorFunctions] of [[textProperties, false], [colorProperties, true]]) {
    for (const property of properties) {
      const value = style.getPropertyValue(property);
      if (acceptsValue(value, allowColorFunctions)) declarations.push(`${property}: ${value};`);
    }
  }
  return declarations.join(' ');
}

export function sanitizeInlineStyles(root) {
  const styled = [...root.querySelectorAll('[style]')];
  if (root.matches?.('[style]')) styled.unshift(root);
  for (const element of styled) {
    const style = element.namespaceURI === htmlNamespace && safeInlineStyle(element.getAttribute('style'), element.ownerDocument);
    if (style) element.setAttribute('style', style);
    else element.removeAttribute('style');
  }
}

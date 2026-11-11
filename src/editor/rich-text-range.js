export function offsetAt(element, node, offset) {
  const prefix = element.ownerDocument.createRange();
  prefix.setStart(element, 0);
  prefix.setEnd(node, offset);
  return prefix.toString().length;
}

export function pointAt(element, offset) {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (offset <= node.length) return [node, offset];
    offset -= node.length;
  }
  return [element, element.childNodes.length];
}

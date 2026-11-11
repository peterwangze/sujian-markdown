function itemAt(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  if (element?.closest('td, th, input, textarea, [contenteditable="false"], [data-type="code-block"]')) return null;
  return element?.closest('li');
}

function markerType(list) {
  const marker = list.dataset.marker;
  return list.tagName === 'OL' ? marker?.at(-1) : marker;
}

function liftListItems(editable, engine, selection, list, parent, items, following) {
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
  const destination = parent.parentElement;
  const next = parent.nextSibling;
  for (const item of items) {
    destination.insertBefore(item, next);
  }

  if (following.length) {
    const last = items.at(-1);
    let nested = last.lastElementChild;
    if (nested?.tagName !== list.tagName || markerType(nested) !== markerType(list) || nested.dataset.tight !== list.dataset.tight) {
      nested = list.cloneNode(false);
      nested.removeAttribute('id');
      nested.removeAttribute('data-node-id');
      nested.removeAttribute('data-sujian-active');
      last.append(nested);
    }
    nested.append(...following);
  }

  if (!list.childElementCount) list.remove();
  selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
  // The list structure is already valid. Use Vditor's normal input and undo path.
  engine.ir.preventInput = true;
  editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
}

export function handleRichListKeys(event, editable, engine) {
  if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return false;
  const selection = editable.ownerDocument.getSelection();
  if (!selection?.rangeCount || !editable.contains(selection.anchorNode) || !editable.contains(selection.focusNode)) return false;

  const range = selection.getRangeAt(0);
  const first = itemAt(range.startContainer);
  const last = itemAt(range.endContainer);
  const list = first?.parentElement;
  if (!list?.matches('ul, ol') || last?.parentElement !== list) return false;

  const button = engine.toolbar.elements[event.shiftKey ? 'outdent' : 'indent']?.firstElementChild;
  if (!button) return false;
  event.preventDefault();
  event.stopImmediatePropagation();

  const parent = list.parentElement.closest('li');
  if (event.shiftKey ? !parent : !first.previousElementSibling) return true;

  if (event.shiftKey && parent.parentElement.matches('ul, ol')) {
    const siblings = Array.from(list.children);
    const end = siblings.indexOf(last) + 1;
    const following = siblings.slice(end);
    // The vendor action recursively enumerates all descendants after the
    // selected item. Move sibling nodes here so their subtrees stay intact.
    if (last.querySelector('li') || following.some(item => item.querySelector('li'))) {
      liftListItems(editable, engine, selection, list, parent, siblings.slice(siblings.indexOf(first), end), following);
      return true;
    }
  }

  // Vditor's toolbar highlights asynchronously. The actual selection is valid already.
  button.classList.remove('vditor-menu--disabled');
  button.click();
  return true;
}

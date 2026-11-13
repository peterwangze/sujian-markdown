export function observeWideTables(root) {
  let frame;
  const tableSize = new WeakMap();

  function fit() {
    frame = undefined;
    if (!root.clientWidth) return;
    for (const table of root.querySelectorAll('table')) {
      const parent = table.parentElement;
      if (!parent || !table.rows.length) continue;
      const style = getComputedStyle(parent);
      const available = parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const previous = tableSize.get(table);
      if (previous?.available === available && previous.scrollWidth === table.scrollWidth) continue;

      // Native table layout can exceed its declared width when its columns'
      // minimums do not fit. Keep its cells editable and scroll only that block.
      const scrollLeft = table.scrollLeft;
      table.removeAttribute('data-sujian-wide-table');
      const width = table.getBoundingClientRect().width;
      if (width > 0 && available > 0) {
        table.toggleAttribute('data-sujian-wide-table', width > available + 1);
        if (scrollLeft) table.scrollLeft = scrollLeft;
        tableSize.set(table, { available, scrollWidth: table.scrollWidth });
      }
    }
  }

  function refresh() {
    if (frame === undefined) frame = requestAnimationFrame(fit);
  }

  const resize = new ResizeObserver(refresh);
  resize.observe(root);
  refresh();
  return {
    refresh,
    disconnect() {
      resize.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    },
  };
}

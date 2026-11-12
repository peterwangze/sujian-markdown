import GithubSlugger from 'github-slugger';

const headingSelector = 'h1, h2, h3, h4, h5, h6';
const legacyAliasAttribute = 'data-sujian-legacy-heading-anchor';
const explicitIdAttribute = 'data-sujian-explicit-heading-id';

function explicitIdIn(attributes) {
  const tokens = attributes.match(/(?:[^\s"']|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')+/gu);
  return tokens?.find((token) => /^#[^\s{}"'<>]+$/u.test(token))?.slice(1);
}

export function captureExplicitHeadingIds(lute, explicitIds) {
  return {
    renderHeading(node, entering) {
      const level = node.__internal_object__.HeadingLevel;
      if (!entering) return [`</h${level}>\n`, lute.WalkContinue];
      const legacyId = lute.GetHeadingID(node);
      const explicitId = explicitIdIn(lute.GetHeadingIDRaw(node));
      if (explicitId) explicitIds.set(legacyId, explicitId);
      // Match Vditor's plain heading output while collecting the unmodified marker.
      return [`\n<h${level} id="${lute.EscapeHTMLStr(legacyId)}">`, lute.WalkContinue];
    },
  };
}

function markdownHeadings(root, explicitIds) {
  const slugger = new GithubSlugger();
  return Array.from(root.querySelectorAll(headingSelector), (heading) => {
    const text = heading.cloneNode(true);
    text.querySelectorAll('.vditor-ir__marker, .vditor-anchor, [data-type="html-inline"] > code, wbr')
      .forEach((marker) => marker.remove());
    const title = text.textContent.trim().replace(/\r\n|[\r\n\t]/g, ' ');
    const marker = heading.querySelector(':scope > [data-type="heading-id"]')?.textContent.trim();
    const explicitId = explicitIds?.get(heading.id) ??
      (marker?.startsWith('{') && marker.endsWith('}') ? explicitIdIn(marker.slice(1, -1)) : undefined);
    return { heading, slug: slugger.slug(title), legacyId: heading.id, explicitId };
  });
}

export function installMarkdownHeadingAnchors(root, explicitIds) {
  const entries = markdownHeadings(root, explicitIds);
  const reserved = new Set(Array.from(root.querySelectorAll('[id], a[name]'))
    .flatMap((element) => element.matches(headingSelector) ? [] : [element.id, element.getAttribute('name')])
    .filter(Boolean));
  if (root.id) reserved.add(root.id);
  const explicitHeadings = new Set();
  for (const { heading, explicitId } of entries) {
    if (!explicitId || reserved.has(explicitId)) continue;
    heading.id = explicitId;
    heading.setAttribute(explicitIdAttribute, '');
    reserved.add(explicitId);
    explicitHeadings.add(heading);
  }
  const assigned = new Set(reserved);
  for (const { slug } of entries) {
    if (slug) assigned.add(slug);
  }

  for (const [index, entry] of entries.entries()) {
    const { heading, slug, legacyId } = entry;
    if (explicitHeadings.has(heading)) continue;
    if (slug && !reserved.has(slug)) {
      heading.id = slug;
    } else if (legacyId && !assigned.has(legacyId)) {
      heading.id = legacyId;
      assigned.add(legacyId);
    } else {
      let id = `sujian-heading-${index + 1}`;
      while (assigned.has(id)) id += '-';
      heading.id = id;
      assigned.add(id);
    }
  }

  const destinations = new Map();
  const emitted = new Set([...reserved, ...entries.map(({ heading }) => heading.id)]);
  function addAlias(heading, id) {
    if (!id || emitted.has(id)) return;
    const alias = root.ownerDocument.createElement('span');
    alias.id = id;
    alias.setAttribute(legacyAliasAttribute, '');
    alias.setAttribute('aria-hidden', 'true');
    heading.prepend(alias);
    emitted.add(id);
  }
  for (const { heading, slug } of entries) addAlias(heading, slug);
  for (const { heading, legacyId } of entries) {
    if (legacyId) destinations.set(legacyId, heading.id);
    addAlias(heading, legacyId);
  }
  return destinations;
}

function liveHtmlAnchor(root, name) {
  const template = root.ownerDocument.createElement('template');
  for (const marker of root.querySelectorAll('[data-type="html-inline"] > code')) {
    const html = marker.textContent;
    if (!/^<a(?:\s|>)/i.test(html)) continue;
    template.innerHTML = html;
    const anchor = template.content.firstElementChild;
    if (anchor?.id === name || anchor?.getAttribute('name') === name) {
      return marker.closest('[data-block]') ?? marker.parentElement;
    }
  }
}

export function scrollToMarkdownAnchor(root, fragment) {
  if (!root || !fragment) return false;
  let name = fragment;
  try { name = decodeURIComponent(fragment); } catch { /* malformed fragments can still match literally */ }
  const selector = CSS.escape(name);
  const destination = root.id === name ? root :
    root.querySelector(`[id="${selector}"], [data-id="${selector}"], a[name="${selector}"]`);
  const explicit = destination && (destination.hasAttribute(explicitIdAttribute) ||
    !destination.matches(`${headingSelector}, [${legacyAliasAttribute}]`));
  const headings = explicit ? [] : markdownHeadings(root);
  const target = explicit ? destination : liveHtmlAnchor(root, name) ??
    headings.find(({ explicitId }) => explicitId === name)?.heading ??
    headings.find(({ slug }) => slug === name)?.heading ?? destination;
  if (!target) return false;

  for (let details = target.closest('details'); details; details = details.parentElement?.closest('details')) {
    details.open = true;
  }
  const scrollTarget = target.hasAttribute(legacyAliasAttribute) ? target.parentElement : target;
  scrollTarget.scrollIntoView({ block: 'start' });
  return true;
}

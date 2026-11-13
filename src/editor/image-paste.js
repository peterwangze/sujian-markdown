const imageSuffix = /\.(?:png|jpe?g|gif|webp|avif|bmp|ico|svg|tiff?|apng|heic|jxl)$/i;
const maxAddressLength = 4096;

function usableAddress(value) {
  let address = value?.trim();
  if (!address || address.length > maxAddressLength || /[\u0000-\u001f]/.test(address)) return '';
  if ((address.startsWith('"') && address.endsWith('"')) || (address.startsWith('<') && address.endsWith('>'))) {
    address = address.slice(1, -1);
  }
  if (address.startsWith('//')) address = 'https:' + address;
  if (/^https?:\/\//i.test(address)) {
    try {
      const url = new URL(address);
      return url.username || url.password ? '' : url.href;
    } catch { return ''; }
  }
  if (/^[a-z][a-z+.-]*:/i.test(address) && !/^(?:file:\/\/|[a-z]:[\\/])/i.test(address)) return '';
  return address;
}

function imageAddress(value) {
  const address = usableAddress(value);
  return imageSuffix.test(address) || imageSuffix.test(address.split(/[?#]/, 1)[0]) ? address : '';
}

function onlyHtmlImage(html) {
  if (!html || html.length > 2 * 1024 * 1024 || !/<img[\s/>]/i.test(html)) return null;
  // Template content is inert: parsing clipboard HTML does not load resources.
  const template = document.createElement('template');
  template.innerHTML = html;
  const images = template.content.querySelectorAll('img');
  if (images.length !== 1 || template.content.textContent.trim()) return null;
  const image = images[0];
  const source = usableAddress(image.getAttribute('src'));
  return source ? { source, alt: image.getAttribute('alt') || undefined } : null;
}

export function imageTransfer(transfer, getFilePath, { allowAddress = true } = {}) {
  if (!transfer) return null;
  const plain = transfer.getData('text/plain');
  const uriList = transfer.getData('text/uri-list');
  const fileItems = Array.from(transfer.files, file => ({ file, sourcePath: getFilePath?.(file) || '' }))
    .filter(({ file, sourcePath }) => /^image\//i.test(file.type) || (sourcePath && imageSuffix.test(sourcePath)));
  const linkedFiles = fileItems.filter(item => item.sourcePath);
  if (linkedFiles.length) return { items: linkedFiles, plain };

  if (allowAddress && fileItems.length <= 1) {
    const html = onlyHtmlImage(transfer.getData('text/html'));
    const addresses = uriList.split(/\r?\n/).filter(line => line.trim() && !line.trimStart().startsWith('#'));
    if (!html && !fileItems.length && addresses.length > 1) {
      const imageAddresses = addresses.map(imageAddress).filter(Boolean);
      if (imageAddresses.length) return { items: imageAddresses.map(source => ({ source })), plain };
    }
    // Only auto-convert standalone paths. Keep ordinary prose and Markdown fragments as text.
    const plainPath = !/^\s*(?:[!\[]|<[^>]*\s+[a-z]+\s*=)/i.test(plain) ? imageAddress(plain) : '';
    const listedPath = addresses.length === 1 ? imageAddress(addresses[0]) : '';
    const source = listedPath || plainPath;
    const candidate = html ?? (source ? { source } : null);
    if (candidate) return { items: [{ ...fileItems[0], ...candidate }], plain };
  }
  return fileItems.length ? { items: fileItems, plain } : null;
}

export function imageAltFromAddress(source) {
  try {
    const segment = new URL(source).pathname.split('/').at(-1);
    return decodeURIComponent(segment).replace(imageSuffix, '') || '图片';
  } catch { return '图片'; }
}

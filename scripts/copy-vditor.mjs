import { appendFile, cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve('vditor/package.json'));
const destination = fileURLToPath(new URL('../public/vendor/vditor/', import.meta.url));
await mkdir(destination, { recursive: true });
await cp(join(packageRoot, 'dist'), join(destination, 'dist'), { recursive: true, force: true });
await cp(join(packageRoot, 'LICENSE'), join(destination, 'LICENSE'), { force: true });

// The upstream live renderer initializes Mermaid in loose mode. Local documents
// can contain diagrams from third parties, so every rendering path uses strict mode.
await appendFile(join(destination, 'dist', 'js', 'mermaid', 'mermaid.min.js'), `
;(() => {
  const api = globalThis.mermaid;
  const initialize = api.initialize.bind(api);
  api.initialize = (config) => initialize({
    ...config,
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    secure: ['secure', 'startOnLoad', 'securityLevel', 'themeCSS', 'htmlLabels', 'maxTextSize', 'maxEdges', 'suppressErrorRendering'],
  });
})();
`);

import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';

const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const commonMarkUrl = 'https://spec.commonmark.org/0.31.2/spec.json';
const gfmUrl = 'https://github.github.com/gfm/';
const gfmSections = [
  ['tables-extension-', 'Tables'],
  ['task-list-items-extension-', 'Task list items'],
  ['strikethrough-extension-', 'Strikethrough'],
  ['autolinks-extension-', 'Autolinks'],
  ['disallowed-raw-html-extension-', 'Disallowed raw HTML'],
];

// Disable editor extensions and sanitization so the benchmark measures the
// Markdown engine. Sujian's rendered documents apply additional HTML policies.
const commonSettings = {
  SetAutoSpace: false,
  SetCallout: false,
  SetChineseParagraphBeginningSpace: false,
  SetCodeSyntaxHighlight: false,
  SetEmoji: false,
  SetFixTermTypo: false,
  SetFootnotes: false,
  SetGFMTaskListItemClass: '',
  SetHeadingAnchor: false,
  SetHeadingID: false,
  SetImgPathAllowSpace: false,
  SetInlineMath: false,
  SetMark: false,
  SetParagraphBeginningSpace: false,
  SetRenderListStyle: false,
  SetSanitize: false,
  SetSoftBreak2HardBreak: false,
  SetSub: false,
  SetSup: false,
  SetToC: false,
  SetYamlFrontMatter: false,
};
// Lute has no dedicated GFM tagfilter setter. Its output still gets compared
// against that extension's example, independently of Sujian's sanitization.
const gfmSettings = [
  'SetGFMAutoLink',
  'SetGFMStrikethrough',
  'SetGFMStrikethrough1',
  'SetGFMTable',
  'SetGFMTaskListItem',
];

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/check-markdown-spec.mjs [CommonMark JSON] [GFM HTML] [report JSON]');
  console.log('Run npm run build first. Omitted inputs are downloaded from the official specs. Use - to omit one input.');
  console.log('The optional JSON report includes every difference. The command reports mismatches and exits successfully.');
} else {
  if (args.length > 3) throw new Error('Expected at most three arguments. Run with --help for usage.');
  await run(...args);
}

async function loadFixture(file, url) {
  if (file && file !== '-') return readFile(file, 'utf8');
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error('Failed to download ' + url + ' (HTTP ' + response.status + ')');
  return response.text();
}

async function run(commonMarkFile, gfmFile, reportFile) {
  await access(path.join(project, 'dist', 'index.html')).catch(() => {
    throw new Error('Run npm run build before checking the bundled Markdown parser.');
  });
  const [commonMarkJson, gfmHtml] = await Promise.all([
    loadFixture(commonMarkFile, commonMarkUrl),
    loadFixture(gfmFile, gfmUrl),
  ]);
  const commonMark = JSON.parse(commonMarkJson);
  if (!Array.isArray(commonMark) || commonMark.length !== 652 || commonMark.some((example, index) =>
    example.example !== index + 1 || typeof example.section !== 'string' ||
    typeof example.markdown !== 'string' || typeof example.html !== 'string'
  )) {
    throw new Error('Expected the 652 official CommonMark 0.31.2 examples in order.');
  }

  const tempRoot = path.resolve(tmpdir());
  const profile = await mkdtemp(path.join(tempRoot, 'sujian-markdown-spec-'));
  let app;
  try {
    const electronArgs = ['--user-data-dir=' + profile, project];
    if (process.platform === 'linux' && process.getuid?.() === 0) electronArgs.unshift('--no-sandbox');
    app = await _electron.launch({ args: electronArgs });
    const page = await app.firstWindow();
    await page.waitForFunction(() => typeof window.Lute?.New === 'function');
    const results = await page.evaluate(checkExamples, {
      commonMark, gfmHtml, gfmSections, commonSettings, gfmSettings,
    });
    console.log('Bundled Markdown engine output. Sujian applies additional HTML and presentation rules.');
    for (const result of results) {
      console.log(result.spec + ' — ' + result.matches + '/' + result.total + ' match, ' +
        result.differences.length + ' differ after conservative HTML comparison');
      for (const [section, counts] of Object.entries(result.sections)) {
        const examples = result.differences.filter((example) => example.section === section);
        if (examples.length) console.log('  ' + section + ': ' + examples.length + '/' + counts.total +
          ' differ (' + examples.map((example) => example.example).join(', ') + ')');
      }
    }
    if (reportFile) {
      await writeFile(reportFile, JSON.stringify({ commonMarkUrl, gfmUrl, results }, null, 2) + '\n');
      console.log('Wrote ' + reportFile);
    }
  } finally {
    try {
      await app?.close();
    } finally {
      // Only remove the dedicated temporary profile created by this run.
      if (path.dirname(profile) === tempRoot && path.basename(profile).startsWith('sujian-markdown-spec-')) {
        await rm(profile, { recursive: true, force: true, maxRetries: 3 });
      }
    }
  }
}

function checkExamples({ commonMark, gfmHtml, gfmSections, commonSettings, gfmSettings }) {
  const page = document.createElement('template');
  page.innerHTML = gfmHtml;
  if (!page.content.textContent.includes('Version 0.29-gfm')) {
    throw new Error('Expected the official GFM 0.29-gfm spec HTML.');
  }
  const gfm = gfmSections.flatMap(([id, section]) => {
    const heading = page.content.getElementById(id);
    const examples = [...heading?.closest('div.extension')?.querySelectorAll('div.example') ?? []];
    if (!examples.length) throw new Error('Missing GFM extension examples for ' + section);
    return examples.map((example) => {
      const markdown = example.querySelector('code.language-markdown');
      const html = example.querySelector('code.language-html');
      const number = /^example-(\d+)$/.exec(example.id);
      if (!markdown || !html || !number) throw new Error('Unexpected GFM example markup in ' + section);
      // The GFM specification displays source tabs as arrows.
      return {
        example: Number(number[1]),
        section,
        markdown: markdown.textContent.replaceAll('→', '\t'),
        html: html.textContent.replaceAll('→', '\t'),
      };
    });
  });
  if (gfm.length !== 28 || new Set(gfm.map(({ example }) => example)).size !== 28) {
    throw new Error('Expected 28 distinct examples across the five GFM 0.29 extension sections.');
  }

  function normalize(html) {
    // Preserve all interior text, attributes and raw HTML. Ignore only the
    // optional closing slash on void elements and a final HTML newline.
    const markup = /<(pre|script|style|textarea|xmp|iframe|noembed|noframes|plaintext)\b[\s\S]*?(?:<\/\1\s*>|$)|<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<(?:"[^"]*"|'[^']*'|[^"'<>])*>/gi;
    const voidTag = /^<(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)(?=[\s/>])/i;
    return html.replaceAll('\r\n', '\n').replace(/\n+$/, '').replace(markup, (token) => {
      if (!voidTag.test(token)) return token;
      return token.replace(/^<([a-z]+)\/>$/i, '<$1>').replace(/\s+\/>$/, '>');
    });
  }

  function compare(spec, examples, extensionsEnabled) {
    const lute = window.Lute.New();
    const settings = { ...commonSettings, ...Object.fromEntries(gfmSettings.map((name) => [name, extensionsEnabled])) };
    for (const [name, value] of Object.entries(settings)) {
      if (typeof lute[name] !== 'function') throw new Error('Bundled Lute does not expose ' + name);
      lute[name](value);
    }
    const sections = {};
    const differences = [];
    for (const example of examples) {
      const section = sections[example.section] ??= { total: 0, matches: 0 };
      section.total += 1;
      const actual = lute.Md2HTML(example.markdown);
      if (normalize(actual) === normalize(example.html)) {
        section.matches += 1;
      } else {
        differences.push({ ...example, actual });
      }
    }
    return { spec, settings, total: examples.length, matches: examples.length - differences.length, sections, differences };
  }

  return [compare('CommonMark 0.31.2', commonMark, false), compare('GFM 0.29 extension examples', gfm, true)];
}

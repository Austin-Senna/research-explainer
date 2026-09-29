import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, dirname, extname } from 'node:path';

const here = (p) => new URL(p, import.meta.url);
const read = (p) => readFileSync(here(p), 'utf8');

// Dependency order. tree and storage depend on nothing; quiz and render depend on tree;
// explainer depends on all four.
const MODULES = [
  'lib/tree.js',
  'lib/storage.js',
  'lib/quiz.js',
  'lib/sources.js',
  'lib/typing.js',
  'lib/ask.js',
  'lib/render.js',
  'explainer.js',
];

export function bundle() {
  const body = MODULES
    .map(read)
    .map(src => src.replace(/^\s*import\s[^\n]*\n/gm, '').replace(/^\s*export\s+/gm, ''))
    .join('\n');
  return `(function () {\n${body}\n})();`;
}

// A </script> anywhere in the payload would end the block early.
function embedJson(value) {
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
               '.gif': 'image/gif', '.svg': 'image/svg+xml' };

// Every figure src that points at a local file becomes a data URI, so the published page is one file
// with nothing to upload beside it. A missing file fails the build rather than shipping a broken image.
export function inlineFigures(doc, baseDir) {
  const out = structuredClone(doc);
  for (const n of out.nodes ?? []) {
    for (const f of n.figures ?? []) {
      if (/^(data:|https?:)/.test(f.src ?? '')) continue;
      const file = resolve(baseDir, f.src);
      const mime = MIME[extname(file).toLowerCase()];
      if (!mime) throw new Error(`${n.id}: figure ${f.src} has an unsupported type`);
      if (!existsSync(file)) throw new Error(`${n.id}: figure ${f.src} does not exist`);
      f.src = `data:${mime};base64,${readFileSync(file).toString('base64')}`;
    }
  }
  return out;
}

// `sources` is the full text of every source ([{label, url, text}]). A published page cannot
// fetch, so this is the only way the chat can read them.
export function buildHtml(doc, sources = null) {
  return read('template.html')
    .replace('/*<!--INLINE:explainer.css-->*/', () => read('explainer.css'))
    .replace('/*<!--NODES-->*/ null', () => embedJson(doc))
    .replace('/*<!--SOURCES-->*/ null', () => embedJson(sources))
    .replace('/*<!--INLINE:explainer.js-->*/', () => bundle())
    .replace('<title>Explainer</title>', `<title>${String(doc.meta?.title ?? 'Explainer').replace(/</g, '&lt;')}</title>`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [docPath, outDir] = process.argv.slice(2);
  if (!docPath || !outDir) {
    console.error('usage: node assets/build.mjs <nodes.json> <outDir>');
    process.exit(2);
  }
  const doc = inlineFigures(JSON.parse(readFileSync(docPath, 'utf8')), dirname(resolve(docPath)));
  const sourcesPath = new URL('sources.json', pathToFileURL(docPath));
  const sources = existsSync(sourcesPath) ? JSON.parse(readFileSync(sourcesPath, 'utf8')) : null;
  if (!sources) console.warn('no sources.json beside the nodes: the chat will only see section text');
  mkdirSync(outDir, { recursive: true });
  const out = `${outDir}/index.html`;
  writeFileSync(out, buildHtml(doc, sources));

  // Raster figures extracted in Phase 1 sit beside the page and are referenced relatively.
  // When the build writes back into the source directory they are already in place, and
  // cpSync refuses a copy onto itself.
  const figures = new URL('figures/', pathToFileURL(docPath));
  const dest = resolve(outDir, 'figures');
  if (existsSync(figures)) {
    if (resolve(fileURLToPath(figures)) === dest) {
      console.log('figures/ already in place');
    } else {
      cpSync(figures, dest, { recursive: true });
      console.log('copied figures/');
    }
  }
  console.log(`wrote ${out}`);
}

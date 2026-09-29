import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { buildHtml, bundle, inlineFigures } from '../assets/build.mjs';

const doc = () => JSON.parse(readFileSync(new URL('./fixtures/attention.nodes.json', import.meta.url)));

test('bundling strips import and export keywords', () => {
  const out = bundle();
  assert.ok(!/^\s*import\s/m.test(out), 'no import statements may survive');
  assert.ok(!/^\s*export\s/m.test(out), 'no export keywords may survive');
});

test('bundling preserves the function bodies', () => {
  const out = bundle();
  for (const fn of ['function buildTree', 'function gradeMcq', 'function createStore', 'function renderNode']) {
    assert.ok(out.includes(fn), `${fn} missing from bundle`);
  }
});

test('dependencies are concatenated before their consumers', () => {
  const out = bundle();
  assert.ok(out.indexOf('function linearOrder') < out.indexOf('function scheduleReasks'));
  assert.ok(out.indexOf('function buildTree') < out.indexOf('function renderSidebar'));
});

test('every marker is consumed', () => {
  const html = buildHtml(doc());
  assert.ok(!html.includes('<!--INLINE:'), 'inline markers must be replaced');
  assert.ok(!html.includes('<!--NODES-->'), 'nodes marker must be replaced');
});

test('the stylesheet and the document title are inlined', () => {
  const html = buildHtml(doc());
  assert.ok(html.includes('--measure:'), 'css must be inlined');
  assert.ok(html.includes('Attention Is All You Need'));
});

test('the nodes payload is embedded as json', () => {
  const html = buildHtml(doc());
  const m = html.match(/window\.NODES = (\{[\s\S]*?\});/);
  assert.ok(m, 'NODES assignment not found');
  assert.equal(JSON.parse(m[1].replace(/<\\\//g, '</')).meta.slug, 'attention-is-all-you-need');
});

test('a closing script tag inside content cannot break out of the script block', () => {
  const d = doc();
  d.nodes[0].spiral.intuition = 'careful: </script><img src=x onerror=alert(1)>';
  const html = buildHtml(d);
  assert.ok(!html.includes('</script><img'), 'raw closing tag must be escaped');
  assert.ok(html.includes('<\\/script>'), 'closing tag should be escaped as <\\/script>');
});

test('the output declares a single html document', () => {
  const html = buildHtml(doc());
  assert.equal((html.match(/<!DOCTYPE html>/gi) ?? []).length, 1);
});

test('building into the source directory does not crash on figures', () => {
  const { mkdtempSync, mkdirSync, writeFileSync, existsSync } = require('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'explainer-self-'));
  mkdirSync(join(dir, 'figures'));
  writeFileSync(join(dir, 'figures', 'f.txt'), 'x');
  const docPath = join(dir, 'nodes.json');
  writeFileSync(docPath, readFileSync(new URL('./fixtures/attention.nodes.json', import.meta.url)));
  // outDir === the directory nodes.json lives in
  execFileSync(process.execPath, ['assets/build.mjs', docPath, dir]);
  assert.ok(existsSync(join(dir, 'index.html')));
  assert.ok(existsSync(join(dir, 'figures', 'f.txt')), 'existing figures must survive');
});

test('source texts are embedded so the chat can read them without network', () => {
  const html = buildHtml(doc(), [{ label: 'Paper', url: 'https://x', text: 'full text </script> here' }]);
  assert.match(html, /window\.SOURCES = \[\{"label":"Paper"/);
  assert.ok(!html.includes('full text </script>'), 'an embedded </script> would end the block early');
});

test('a build without sources still produces a page', () => {
  assert.match(buildHtml(doc()), /window\.SOURCES = null/);
});

test('local figures are inlined as data URIs; a missing one fails the build', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'fig-'));
  writeFileSync(join(dir, 'a.png'), Buffer.from([137, 80, 78, 71]));
  const d = doc();
  d.nodes[0].figures = [{ src: 'a.png', alt: 'x', credit: 'y' }];
  const out = inlineFigures(d, dir);
  assert.match(out.nodes[0].figures[0].src, /^data:image\/png;base64,/);
  assert.equal(d.nodes[0].figures[0].src, 'a.png', 'the input document is not mutated');
  d.nodes[0].figures = [{ src: 'missing.png', alt: 'x', credit: 'y' }];
  assert.throws(() => inlineFigures(d, dir), /does not exist/);
});

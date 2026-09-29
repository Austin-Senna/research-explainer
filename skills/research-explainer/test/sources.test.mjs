import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkSources, searchChunks, readSource, catalog, formatExcerpts, terms } from '../assets/lib/sources.js';

const para = (w, n) => Array.from({ length: n }, () => w).join(' ');
const sources = () => [
  { label: 'Attention paper', url: 'https://arxiv.org/abs/1706.03762',
    text: `${para('filler', 200)}\nScaled dot-product attention divides by the square root of d_k.\n${para('padding', 300)}` },
  { label: 'Other paper', url: 'https://example.org/x', text: 'Recurrent networks process tokens one at a time.' },
];

test('stopwords are dropped from query terms', () => {
  assert.deepEqual(terms('What is the square root of d_k?'), ['square', 'root', 'd_k']);
});

test('chunks cover every character of every source, in order', () => {
  const s = sources();
  const chunks = chunkSources(s);
  for (const [i, src] of s.entries()) {
    const joined = chunks.filter(c => c.source === i).map(c => c.text).join('');
    assert.equal(joined, src.text);
  }
});

test('search ranks the passage that contains the query terms first', () => {
  const hits = searchChunks(chunkSources(sources()), 'square root d_k', 3);
  assert.ok(hits.length > 0);
  assert.match(hits[0].text, /square root of d_k/);
  assert.equal(hits[0].label, 'Attention paper');
});

test('a query with no matching terms returns nothing rather than noise', () => {
  assert.deepEqual(searchChunks(chunkSources(sources()), 'zebra quantum', 3), []);
  assert.deepEqual(searchChunks(chunkSources(sources()), 'the of and', 3), []);
});

test('reading a source returns a bounded slice with its position', () => {
  const r = readSource(sources(), 1, 10);
  assert.equal(r.label, 'Other paper');
  assert.equal(r.offset, 10);
  assert.equal(r.text, 'networks process tokens one at a time.');
  assert.ok(readSource(sources(), 0, 0).text.length <= 6000);
});

test('reading a missing source throws so Claude sees the error and carries on', () => {
  assert.throws(() => readSource(sources(), 7), /no source 7/);
});

test('the catalog lists every source with its index and url', () => {
  const c = catalog(sources());
  assert.match(c, /\[0\] Attention paper <https:\/\/arxiv\.org\/abs\/1706\.03762>/);
  assert.match(c, /\[1\] Other paper/);
});

test('excerpts are labelled with source and offset so answers can cite them', () => {
  const out = formatExcerpts(searchChunks(chunkSources(sources()), 'recurrent tokens', 1));
  assert.match(out, /^\[source 1: Other paper, offset 0\]/);
});

test('the tools Claude is offered search and read the embedded sources', async () => {
  const s = sources();
  const [search, read] = (await import('../assets/lib/sources.js')).sourceTools(s, chunkSources(s));
  assert.equal(search.name, 'search_sources');
  assert.equal(read.name, 'read_source');
  const hits = search.execute({ query: 'square root' });
  assert.match(hits[0].text, /square root/);
  assert.equal(read.execute({ source: 1, offset: 0 }).label, 'Other paper');
  assert.ok(JSON.stringify(hits).length < 32000, 'a tool result must stay under the 32 KB cap');
});

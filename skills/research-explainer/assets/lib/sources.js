// Full source texts embedded in the page, and plain keyword search over them. No DOM, no network:
// a published page cannot fetch, so everything the chat can read has to ship inside the page.

const CHUNK_CHARS = 1500;
const READ_CHARS = 6000;
const STOPWORDS = new Set(('a an and are as at be but by for from has have how i in is it its of on or '
  + 'that the their this to was what when where which who why will with does do did can you your we')
  .split(' '));

export function terms(text) {
  // Identifiers like d_k and numbers like 0.071 stay whole; a sentence's trailing period does not
  // stick to the word before it.
  return String(text ?? '').toLowerCase()
    .match(/[a-z0-9](?:[a-z0-9_.\-]*[a-z0-9_])?/g)?.filter(t => !STOPWORDS.has(t)) ?? [];
}

// Chunks break on paragraph boundaries where possible so a hit reads as a whole thought.
export function chunkSources(sources) {
  const chunks = [];
  for (const [index, s] of (sources ?? []).entries()) {
    const text = String(s.text ?? '');
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + CHUNK_CHARS, text.length);
      if (end < text.length) {
        const para = text.lastIndexOf('\n', end);
        if (para > start + CHUNK_CHARS / 2) end = para;
      }
      chunks.push({ source: index, label: s.label, offset: start, text: text.slice(start, end) });
      start = end;
    }
  }
  return chunks;
}

// Term frequency weighted by rarity across chunks. Crude, deterministic, and good enough to
// put the right few passages in front of Claude; the read_source tool covers the rest.
export function searchChunks(chunks, query, k = 5) {
  const q = [...new Set(terms(query))];
  if (!q.length) return [];
  const df = new Map(q.map(t => [t, 0]));
  const counts = chunks.map(c => {
    const tf = new Map();
    for (const t of terms(c.text)) if (df.has(t)) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, df.get(t) + 1);
    return tf;
  });
  const n = chunks.length;
  return chunks
    .map((c, i) => {
      let score = 0;
      for (const [t, f] of counts[i]) score += (1 + Math.log(f)) * Math.log(1 + n / df.get(t));
      return { ...c, score };
    })
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export function readSource(sources, index, offset = 0) {
  const s = sources?.[Number(index)];
  if (!s) throw new Error(`no source ${index}; valid indexes are 0 to ${(sources?.length ?? 0) - 1}`);
  const from = Math.max(0, Math.floor(Number(offset) || 0));
  const text = String(s.text ?? '');
  return { source: Number(index), label: s.label, offset: from, total: text.length,
           text: text.slice(from, from + READ_CHARS) };
}

export function catalog(sources) {
  return (sources ?? []).map((s, i) => `[${i}] ${s.label}${s.url ? ` <${s.url}>` : ''}`).join('\n');
}

export function formatExcerpts(hits) {
  return hits.map(h => `[source ${h.source}: ${h.label}, offset ${h.offset}]\n${h.text.trim()}`).join('\n\n');
}

// The page functions offered to Claude during a chat turn. Results stay small (the platform caps a
// tool result at 32 KB and every round re-reads everything so far).
export function sourceTools(sources, chunks) {
  return [
    {
      name: 'search_sources',
      description: 'Keyword search across the full text of every source this explainer was written from. '
        + 'Returns up to 5 passages, each with its source index, label and character offset.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      execute: ({ query }) => searchChunks(chunks, String(query ?? ''), 5)
        .map(({ source, label, offset, text }) => ({ source, label, offset, text })),
    },
    {
      name: 'read_source',
      description: 'Read about 6,000 characters of one source starting at a character offset. '
        + 'Use it to read around a passage search_sources found, or to read a source from the start (offset 0).',
      inputSchema: {
        type: 'object',
        properties: { source: { type: 'integer' }, offset: { type: 'integer' } },
        required: ['source'],
      },
      execute: ({ source, offset }) => readSource(sources, source, offset),
    },
  ];
}

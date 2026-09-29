import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nodeContext, buildTurns, essayPrompt, copyForError, isFatal, INSTRUCTIONS, MODEL_TIERS, tierLabel, toolStatus, nextTier } from '../assets/lib/ask.js';

const doc = () => JSON.parse(readFileSync(new URL('./fixtures/attention.nodes.json', import.meta.url)));
const node = () => doc().nodes[1];

test('context carries the section title, hook and all three layers', () => {
  const ctx = nodeContext(doc().meta, node());
  assert.match(ctx, /Scaled dot-product attention/);
  assert.match(ctx, /Every token asks/);
  assert.match(ctx, /With three tokens/);
  assert.match(ctx, /Attention of Q/);
});

test('context carries the wrong turn and the source locator', () => {
  const ctx = nodeContext(doc().meta, node());
  assert.match(ctx, /numerical overflow/);
  assert.match(ctx, /3\.2\.1/);
});

test('a node without a wrong turn still builds a context', () => {
  const n = node(); delete n.wrongTurn;
  assert.doesNotThrow(() => nodeContext(doc().meta, n));
});

test('turns start and end on a user turn', () => {
  const turns = buildTurns('ctx', [], 'what is a key?');
  assert.equal(turns[0].role, 'user');
  assert.equal(turns.at(-1).role, 'user');
  assert.equal(turns.at(-1).content, 'what is a key?');
});

test('the instructions turn leads and carries the section', () => {
  const turns = buildTurns('SECTION BODY', [], 'q');
  assert.ok(turns[0].content.includes(INSTRUCTIONS));
  assert.ok(turns[0].content.includes('SECTION BODY'));
});

test('history is preserved between the instructions and the new question', () => {
  const history = [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'answer' },
  ];
  const turns = buildTurns('ctx', history, 'second');
  assert.deepEqual(turns.map(t => t.role), ['user', 'user', 'assistant', 'user']);
  assert.equal(turns[2].content, 'answer');
});

test('long history is trimmed but never leaves a leading assistant turn', () => {
  const history = [];
  for (let i = 0; i < 20; i++) {
    history.push({ role: 'user', content: 'q' + i });
    history.push({ role: 'assistant', content: 'a' + i });
  }
  const turns = buildTurns('ctx', history, 'new');
  assert.equal(turns[0].role, 'user');
  assert.equal(turns[1].role, 'user', 'first history turn kept must be a user turn');
  assert.equal(turns.at(-1).role, 'user');
  assert.ok(turns.length < 12, 'history must be trimmed');
});

test('permanent failures are fatal, transient ones are not', () => {
  for (const c of ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'invalid_request', 'prompt_too_large']) {
    assert.equal(isFatal(c), true, c + ' should be fatal');
  }
  for (const c of ['rate_limited', 'upstream_error', 'refused', 'empty_completion', 'session_expired']) {
    assert.equal(isFatal(c), false, c + ' should not be fatal');
  }
});

test('cancelled produces no viewer-facing message', () => {
  assert.equal(copyForError('cancelled'), '');
  assert.ok(copyForError('rate_limited').length > 0);
  assert.ok(copyForError('some_unknown_code').length > 0, 'unknown codes still get copy');
});

test('context names each source with its locator and url so Claude knows where it came from', () => {
  const n = node();
  n.sources = [{ label: 'Vaswani et al.', url: 'https://arxiv.org/abs/1706.03762', locator: '§3.2.1' }];
  const ctx = nodeContext(doc().meta, n);
  assert.match(ctx, /Vaswani et al\., §3\.2\.1 <https:\/\/arxiv\.org\/abs\/1706\.03762>/);
});

test('the source catalog rides in the instructions turn and excerpts ride with the question', () => {
  const turns = buildTurns('ctx', [], 'why scale?', { catalog: '[0] Paper <u>', excerpts: 'EXCERPT TEXT' });
  assert.match(turns[0].content, /\[0\] Paper <u>/);
  assert.match(turns.at(-1).content, /^why scale\?/);
  assert.match(turns.at(-1).content, /EXCERPT TEXT/);
});

test('without excerpts the question goes through unchanged', () => {
  assert.equal(buildTurns('ctx', [], 'q').at(-1).content, 'q');
});

test('the essay prompt carries the question, the model answer and the reader answer', () => {
  const n = node();
  const p = essayPrompt(doc().meta, n, 'because big dot products saturate softmax');
  assert.ok(p.includes(n.quiz.selfExplain));
  assert.ok(p.includes(n.quiz.selfExplainAnswer));
  assert.match(p, /READER'S ANSWER: because big dot products saturate softmax/);
  assert.match(p, /"verdict"/);
});

test('the instructions tell Claude to cite sources and not invent attributions', () => {
  assert.match(INSTRUCTIONS, /name it and where in it/);
  assert.match(INSTRUCTIONS, /Never attribute to a source/);
});

test('display-only fields in the thread never reach Claude', () => {
  const history = [
    { role: 'user', content: 'q1' },
    { role: 'assistant', content: 'a1', sources: ['Paper'], tier: 'quick' },
  ];
  const turns = buildTurns('ctx', history, 'q2');
  assert.deepEqual(turns[2], { role: 'assistant', content: 'a1' });
});

test('the model picker offers the three viewer tiers by what they trade', () => {
  assert.deepEqual(MODEL_TIERS.map(t => t.id), ['quick', 'default', 'complex']);
  assert.equal(tierLabel('complex'), 'Deep');
  assert.equal(tierLabel('nonsense'), 'Balanced');
});

test('tool status names what is being searched or read', () => {
  const sources = [{ label: 'TuneAhead' }];
  assert.match(toolStatus('search_sources', { query: 'probe' }, sources), /Searching sources for .probe./);
  assert.equal(toolStatus('read_source', { source: 0 }, sources), 'Reading TuneAhead');
  assert.equal(toolStatus('read_source', { source: 9 }, sources), 'Reading a source');
});

test('Shift+Tab cycles the tiers in order and wraps around', () => {
  assert.equal(nextTier('quick'), 'default');
  assert.equal(nextTier('default'), 'complex');
  assert.equal(nextTier('complex'), 'quick');
});

test('the stored conversation is capped, keeping the newest turns', async () => {
  const { appendTurns, MAX_STORED_TURNS } = await import('../assets/lib/ask.js');
  let thread = [];
  for (let i = 0; i < MAX_STORED_TURNS; i++) thread = appendTurns(thread, { role: 'user', content: 'q' + i });
  thread = appendTurns(thread, { role: 'user', content: 'newest' });
  assert.equal(thread.length, MAX_STORED_TURNS);
  assert.equal(thread.at(-1).content, 'newest');
  assert.equal(thread[0].content, 'q1');
});

test('the instructions ask for scannable structure: bullets, nesting, subheadings, tables', () => {
  assert.match(INSTRUCTIONS, /"- " bullets/);
  assert.match(INSTRUCTIONS, /indent two spaces to nest/);
  assert.match(INSTRUCTIONS, /"### " subheading/);
  assert.match(INSTRUCTIONS, /table/);
});

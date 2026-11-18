// "Ask about this" — pure helpers for the sample capability.
// Everything here is testable without a browser; the DOM wiring lives in explainer.js.

// sample takes at most 64 KiB of text per call (sample.d.ts) and rejects prompt_too_large beyond
// it, which this page treats as fatal. Every call is fitted under a budget below that cap; the page
// lowers it further when sample.limits() reports a smaller maxPromptBytes.
export const DEFAULT_PROMPT_BYTES = 64 * 1024;
export function promptBudget(maxPromptBytes) {
  const cap = Number(maxPromptBytes) > 0 ? Number(maxPromptBytes) : DEFAULT_PROMPT_BYTES;
  return Math.floor(cap * 0.85); // headroom for the tool rounds that ride on a call
}
const MAX_SECTION_CHARS = 20000; // one section's text; real sections run 2-5k
const MAX_EXCERPT_CHARS = 12000; // what retrieval may add to one question
const MAX_HISTORY_TURNS = 8;    // drop oldest exchanges, never the instructions turn

// Codes that mean this view will never be able to sample. Hide the feature for good.
const FATAL = new Set([
  'not_granted', 'sampling_disabled', 'not_declared',
  'capability_disabled', 'capability_removed',
]);

// Codes that mean the page is malformed. Hide too — retrying cannot help.
const PAGE_BUG = new Set([
  'invalid_request', 'prompt_too_large', 'transform_error', 'queue_overflow',
]);

export function isFatal(code) { return FATAL.has(code) || PAGE_BUG.has(code); }

export function copyForError(code) {
  switch (code) {
    case 'rate_limited':     return 'That was a lot of questions at once. Give it a minute and try again.';
    case 'session_expired':  return 'Your session expired — sign in again and retry.';
    case 'refused':          return 'Claude declined to answer that one. Try asking it differently.';
    case 'empty_completion': return 'No answer came back. Try asking for something more specific.';
    case 'upstream_error':   return 'Something went wrong on the way. Try again.';
    case 'cancelled':        return '';
    default:                 return 'That did not work. Try again.';
  }
}

// Everything Claude is told about the section being read. Sliced, never measured byte by byte.
export function nodeContext(meta, node) {
  const parts = [
    `EXPLAINER: ${meta?.title ?? ''}`,
    `SECTION: ${node.title}`,
    `Why this section exists: ${node.hook}`,
    '',
    node.spiral?.intuition ?? '',
    '',
    node.spiral?.concrete ?? '',
    '',
    node.spiral?.formal ?? '',
  ];
  if (node.wrongTurn) {
    parts.push('', `A common wrong turn: ${node.wrongTurn.belief} — ${node.wrongTurn.correction}`);
  }
  const sources = (node.sources ?? [])
    .map(s => `- ${s.label}${s.locator ? `, ${s.locator}` : ''}${s.url ? ` <${s.url}>` : ''}`).join('\n');
  if (sources) parts.push('', 'This section was written from:', sources);
  return parts.join('\n').slice(0, MAX_SECTION_CHARS);
}

export const INSTRUCTIONS = [
  'Someone is reading the explainer section below and has a question about it.',
  '',
  'You have the section, the list of sources it was written from, and excerpts from those sources that match the question. Where tools are offered, search_sources and read_source let you read more of any source; use them when the excerpts do not settle the question.',
  'Answer from the section and the sources. When a claim comes from a source, name it and where in it, e.g. (TuneAhead, Table 1). Where neither covers the question, say so in a few words and answer from general knowledge, marked as such. Never attribute to a source something it does not say.',
  'Lead with the answer in one or two sentences. If that settles it, stop there.',
  'When the answer has parts, organize it so it can be scanned: "- " bullets (indent two spaces to nest a detail under a point), "1." for steps in order, a short "### " subheading when there are two or more distinct parts, **bold** for the key term in a bullet, and a small table (| a | b |) when comparing things on the same attributes. Keep it tight: a few bullets beat a long paragraph, and a subheading needs at least two bullets under it.',
  'Plain language. No preamble, no restating their question back, no "great question".',
  'If they ask for an example, give one concrete worked example rather than describing what an example would look like.',
  'If a number or claim appears in the section or a source, use that exact number rather than approximating it.',
].join('\n');

// Turn list for the sample call: a standing instructions turn that is never dropped,
// then the trimmed conversation, ending on the new question with its retrieved excerpts.
export function buildTurns(context, history, question, { catalog = '', excerpts = '', maxBytes = promptBudget() } = {}) {
  return fitTurns(({ history, excerpts, context }) => {
    const lead = {
      role: 'user',
      content: `${INSTRUCTIONS}\n\n--- THE SECTION THEY ARE READING ---\n${context}\n--- END OF SECTION ---`
        + (catalog ? `\n\n--- SOURCES (index, label, url) ---\n${catalog}\n--- END OF SOURCES ---` : ''),
    };
    const tail = excerpts
      ? `${question}\n\n--- SOURCE EXCERPTS MATCHING THIS QUESTION ---\n${excerpts.slice(0, MAX_EXCERPT_CHARS)}\n--- END OF EXCERPTS ---`
      : question;
    return [lead, ...history, { role: 'user', content: tail }];
  }, { history: trimHistory(history), excerpts, context }, maxBytes);
}

// Threads also carry display-only fields (sources shown, tier used); Claude gets role and content.
// A turn list must start and end on a user turn, so a leading assistant turn is dropped.
export function trimHistory(history, turns = MAX_HISTORY_TURNS) {
  const trimmed = (history ?? []).filter(t => t.role === 'user' || t.role === 'assistant')
    .slice(-turns).map(({ role, content }) => ({ role, content }));
  while (trimmed.length && trimmed[0].role !== 'user') trimmed.shift();
  return trimmed;
}

const encoder = new TextEncoder();
export function turnsBytes(turns) {
  return turns.reduce((n, t) => n + encoder.encode(t.content).length, 0);
}

// Shrink one call until it fits the byte budget, giving up what matters least first: the oldest
// exchange (dropping to the next user turn, so the list still starts on one), then the retrieved
// excerpts by halves, then the tail of the section text. The instructions and the new message are
// never cut. `build` turns the three parts into a turn list.
export function fitTurns(build, { history = [], excerpts = '', context = '' }, maxBytes) {
  let turns = build({ history, excerpts, context });
  while (turnsBytes(turns) > maxBytes && history.length) {
    history = history.slice(1);
    while (history.length && history[0].role !== 'user') history = history.slice(1);
    turns = build({ history, excerpts, context });
  }
  while (turnsBytes(turns) > maxBytes && excerpts) {
    excerpts = excerpts.length < 400 ? '' : excerpts.slice(0, Math.floor(excerpts.length / 2));
    turns = build({ history, excerpts, context });
  }
  while (turnsBytes(turns) > maxBytes && context.length > 1000) {
    context = context.slice(0, Math.floor(context.length * 0.75));
    turns = build({ history, excerpts, context });
  }
  return turns;
}

// The viewer's own model tiers: the page cannot pick a specific model or toggle thinking, only
// these three (quick answers at once; default and complex think first, complex longest).
export const MODEL_TIERS = [
  { id: 'quick', label: 'Fast' },
  { id: 'default', label: 'Balanced' },
  { id: 'complex', label: 'Deep' },
];

export function tierLabel(id) {
  return MODEL_TIERS.find(t => t.id === id)?.label ?? 'Balanced';
}

// One conversation for the whole document, kept in the viewer's browser across reloads. Capped so
// storage stays small; Claude only ever sees the last few turns anyway.
export const MAX_STORED_TURNS = 80;
export function appendTurns(thread, ...entries) {
  return [...(thread ?? []), ...entries].slice(-MAX_STORED_TURNS);
}

// Shift+Tab in the composer cycles the tier, the way it cycles modes in Claude Code.
export function nextTier(id) {
  const i = MODEL_TIERS.findIndex(t => t.id === id);
  return MODEL_TIERS[(i + 1) % MODEL_TIERS.length].id;
}

// What the reader sees while a tool runs, so a long answer never looks frozen.
export function toolStatus(name, input, sources) {
  if (name === 'search_sources') return `Searching sources for \u201c${String(input?.query ?? '').slice(0, 60)}\u201d`;
  if (name === 'read_source') return `Reading ${sources?.[Number(input?.source)]?.label ?? 'a source'}`;
  return 'Working';
}

export const QUICK_PROMPTS = [
  'Explain this more simply',
  'Why does this matter?',
  'Give me a concrete example',
];

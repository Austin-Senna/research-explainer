// Tutor mode: pure state, leveling and prompts. No DOM, no storage, no sampling.
//
// The split that makes leveling reliable: Claude only ever (1) grades one answer into a small JSON
// verdict and (2) words the next message. Everything that decides something is decided here, in
// code: what counts as evidence, when a level moves, what the tutor does next, when an earlier
// section comes back for review. A level can therefore never change because of how a reply was
// phrased.
import { nodeContext } from './ask.js';
import { linearOrder } from './tree.js';

export const TUTOR_VARIANTS = ['panel', 'first', 'off'];
export function tutorVariant(value) { return TUTOR_VARIANTS.includes(value) ? value : 'panel'; }

// socratic-tutor's scale, word for word.
export const LEVEL_NAMES = [
  'unaware', 'heard of it', 'can follow along', 'can do with help', 'can do independently', 'can teach it',
];
export const MAX_LEVEL = 5;
export const TARGET_LEVEL = 4;

const CHECKS_TO_RAISE = 2;    // independent correct answers per level
const PAGE_SIGNAL_CEILING = 3; // quiz signals stop counting once a raise would pass "can do with help"
const DEVIL_EVERY = 3;        // every third unprompted right answer gets pushed back on
const REVIEW_GAP = 3;         // graded answers between two spaced reviews, at least
const REVIEW_BASE = 3;        // a level-1 section comes due after this many graded answers; doubles per level
const MAX_MISCONCEPTIONS = 12;
const MAX_NOTE_CHARS = 160;
const MAX_ANSWER_CHARS = 2000;
const MAX_SIDE_CONTEXT = 4000;
const TUTOR_HISTORY_TURNS = 8;
const TUTOR_EXCERPT_CHARS = 12000;

const UNPROMPTED = new Set(['recall', 'defense', 'review']);
const TUTOR_CHECKS = new Set(['recall', 'prompted', 'defense', 'review']);
const PAGE_SIGNALS = new Set(['mcq', 'self']);
const RESULTS = new Set(['correct', 'partial', 'wrong', 'offtopic']);

export const DIFFICULTY_LABELS = { '-2': 'much easier', '-1': 'easier', 0: 'normal', 1: 'harder', 2: 'much harder' };

function clampLevel(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(MAX_LEVEL, Math.max(0, v)) : 0;
}

function normalizeSkill(s) {
  return {
    level: clampLevel(s?.level),
    // Correct checks since the last level change: [{kind, teachable?}]
    evidence: Array.isArray(s?.evidence) ? s.evidence.filter(e => TUTOR_CHECKS.has(e?.kind) || PAGE_SIGNALS.has(e?.kind)) : [],
    strikes: Math.max(0, Number(s?.strikes) || 0), // failed attempts at the question now open
    told: Boolean(s?.told),                        // the answer was just given; the next right answer is not recall
    lastTurn: Math.max(0, Number(s?.lastTurn) || 0),
    covered: Boolean(s?.covered),
    mcqFirst: s?.mcqFirst && typeof s.mcqFirst === 'object' ? { ...s.mcqFirst } : {},
    mcqDone: Boolean(s?.mcqDone),
    selfDone: Boolean(s?.selfDone),
  };
}

// Whatever storage hands back (nothing, an older shape, garbage) becomes a usable state.
export function createTutor(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const skills = {};
  for (const [id, v] of Object.entries(s.skills && typeof s.skills === 'object' ? s.skills : {})) skills[id] = normalizeSkill(v);
  const pending = s.pending && typeof s.pending.node === 'string'
    ? { node: s.pending.node, kind: ['review', 'defense'].includes(s.pending.kind) ? s.pending.kind : 'check' }
    : null;
  return {
    thread: Array.isArray(s.thread) ? s.thread : [],
    skills,
    misconceptions: Array.isArray(s.misconceptions) ? s.misconceptions.filter(m => m?.node && m?.text) : [],
    difficulty: Math.min(2, Math.max(-2, Math.round(Number(s.difficulty)) || 0)),
    turn: Math.max(0, Number(s.turn) || 0),     // graded answers so far; the clock reviews run on
    rights: Math.max(0, Number(s.rights) || 0), // unprompted right answers, for the devil's advocate cadence
    lastReviewTurn: Math.max(0, Number(s.lastReviewTurn) || 0),
    pending,                                    // the question now open: which section, and what kind of check
    pretests: s.pretests && typeof s.pretests === 'object' ? { ...s.pretests } : {},
    pretestOff: Boolean(s.pretestOff),
    started: Boolean(s.started),
  };
}

export function skillOf(tutor, id) { return normalizeSkill(tutor?.skills?.[id]); }
export function levelOf(tutor, id) { return clampLevel(tutor?.skills?.[id]?.level); }

function fork(tutor, id) {
  const next = structuredClone(createTutor(tutor));
  if (id) next.skills[id] = normalizeSkill(next.skills[id]);
  return next;
}

// The grader's reply is untrusted: anything that is not exactly the expected shape is no verdict
// at all, and no verdict never moves a level.
export function validateAssessment(raw) {
  if (!raw || typeof raw !== 'object' || !RESULTS.has(raw.result)) return null;
  const note = typeof raw.misconception === 'string' ? raw.misconception.replace(/\s+/g, ' ').trim() : '';
  return {
    result: raw.result,
    teachable: raw.result === 'correct' && raw.teachable === true,
    misconception: raw.result !== 'correct' && raw.result !== 'offtopic' && note ? note.slice(0, MAX_NOTE_CHARS) : null,
  };
}

// socratic-tutor: raise only on 2+ independent checks, at least one of them unprompted recall.
// The page's own quiz may stand in for one of the two checks, never for the unprompted one, and
// only up to "can do with help": picking an option, or explaining with the text on screen, shows
// recognition rather than independent use. Level 5 additionally needs a defended answer (the
// adversarial question) and an answer the grader judged clear enough to teach from.
export function canRaise(skill) {
  if (skill.level >= MAX_LEVEL) return false;
  const checks = skill.evidence.filter(e => TUTOR_CHECKS.has(e.kind));
  const unprompted = checks.filter(e => UNPROMPTED.has(e.kind));
  const pageCredit = skill.level < PAGE_SIGNAL_CEILING && skill.evidence.some(e => PAGE_SIGNALS.has(e.kind)) ? 1 : 0;
  if (unprompted.length < 1 || checks.length + pageCredit < CHECKS_TO_RAISE) return false;
  if (skill.level === MAX_LEVEL - 1) {
    return checks.some(e => e.kind === 'defense') && checks.some(e => e.teachable);
  }
  return true;
}

// One level at a time, and the evidence is spent: the next level has to be earned from scratch.
function raiseIfEarned(skill, node, changes) {
  if (!canRaise(skill)) return;
  changes.push({ node, from: skill.level, to: skill.level + 1 });
  skill.level += 1;
  skill.evidence = [];
}

export function explainAfter(difficulty) { return difficulty < 0 ? 2 : 3; }

// The section most overdue for an unannounced re-test, or null. Intervals expand with the level
// (3, 6, 12, 24, 48 graded answers), so what is known well comes back rarely and what was only
// just learned comes back soon. Never the section in focus, and never two reviews close together.
export function pickReview(tutor, order, focus) {
  if (tutor.turn - tutor.lastReviewTurn < REVIEW_GAP) return null;
  let best = null;
  for (const id of order) {
    const s = tutor.skills[id];
    if (!s || id === focus || !s.covered || s.level < 1) continue;
    const overdue = (tutor.turn - s.lastTurn) / (REVIEW_BASE * 2 ** (s.level - 1));
    if (overdue >= 1 && (!best || overdue > best.overdue)) best = { id, overdue };
  }
  return best?.id ?? null;
}

function settle(tutor, move, changes = []) {
  tutor.pending = move.type === 'none' ? tutor.pending : { node: move.node, kind: move.kind };
  tutor.started = true;
  return { tutor, move, changes };
}

// THE transition. Given the state, a validated verdict on the open question, and the section the
// reader is on, return the new state, the tutor's next move and any level changes. Pure.
//   move.type: question | narrow | probe | explain | devil | review | reask
export function applyAssessment(tutor, assessment, { focus, order = [] } = {}) {
  const pending = tutor?.pending;
  // Nothing open, or nothing gradable: no evidence, no level change.
  if (!pending) return settle(fork(tutor, focus), { type: 'question', node: focus, kind: 'check' });
  if (!assessment || assessment.result === 'offtopic') {
    return settle(fork(tutor, pending.node), { type: 'reask', node: pending.node, kind: pending.kind });
  }

  const next = fork(tutor, pending.node);
  const skill = next.skills[pending.node];
  const changes = [];
  next.turn += 1;
  skill.lastTurn = next.turn;
  skill.covered = true;

  if (assessment.result === 'correct') {
    const kind = pending.kind === 'review' ? 'review'
      : pending.kind === 'defense' ? 'defense'
      : skill.told || skill.strikes > 0 ? 'prompted' : 'recall';
    skill.evidence.push(assessment.teachable ? { kind, teachable: true } : { kind });
    skill.strikes = 0;
    skill.told = false;
    raiseIfEarned(skill, pending.node, changes);

    if (kind === 'recall') {
      next.rights += 1;
      if (next.rights % DEVIL_EVERY === 0) {
        return settle(next, { type: 'devil', node: pending.node, kind: 'defense' }, changes);
      }
    }
    const review = pickReview(next, order, focus);
    if (review) {
      next.lastReviewTurn = next.turn;
      return settle(next, { type: 'review', node: review, kind: 'review' }, changes);
    }
    return settle(next, { type: 'question', node: focus ?? pending.node, kind: 'check', after: 'correct' }, changes);
  }

  // Wrong, or partial. A vague or half-right answer is not a right answer.
  if (assessment.misconception) {
    const seen = next.misconceptions.some(m => m.node === pending.node && m.text === assessment.misconception);
    if (!seen) {
      next.misconceptions = [...next.misconceptions, { node: pending.node, text: assessment.misconception }]
        .slice(-MAX_MISCONCEPTIONS);
    }
  }
  skill.told = false;
  if (pending.kind === 'review') {
    // socratic-tutor: a failed review lowers the level, and the section is revisited.
    if (skill.level > 0) changes.push({ node: pending.node, from: skill.level, to: skill.level - 1 });
    skill.level = Math.max(0, skill.level - 1);
    skill.evidence = [];
    skill.strikes = 1;
    return settle(next, { type: 'narrow', node: pending.node, kind: 'check', after: 'review' }, changes);
  }
  if (pending.kind === 'defense') {
    // An answer the reader gave up under pressure was not held: take back the credit it earned.
    for (let i = skill.evidence.length - 1; i >= 0; i--) {
      if (skill.evidence[i].kind === 'recall') { skill.evidence.splice(i, 1); break; }
    }
    skill.strikes = 1;
    return settle(next, { type: 'narrow', node: pending.node, kind: 'check', after: 'defense' }, changes);
  }
  skill.strikes += 1;
  if (skill.strikes >= explainAfter(next.difficulty)) {
    skill.strikes = 0;
    skill.told = true;
    return settle(next, { type: 'explain', node: pending.node, kind: 'check' }, changes);
  }
  const type = assessment.result === 'partial' ? 'probe' : 'narrow';
  return settle(next, { type, node: pending.node, kind: 'check' }, changes);
}

// The reader opens the tutor on a section, or asks to be quizzed on it.
export function openMove(tutor, focus) {
  return settle(fork(tutor, focus), { type: 'question', node: focus, kind: 'check', after: 'open' });
}

// "just tell me": the open question is answered directly, for this question only. Being told is
// recorded, so the re-test that follows cannot count as unprompted recall.
export function tellMove(tutor, focus) {
  const node = tutor?.pending?.node ?? focus;
  const next = fork(tutor, node);
  next.skills[node].told = true;
  next.skills[node].strikes = 0;
  return settle(next, { type: 'tell', node, kind: 'check' });
}

// "harder" / "easier": the open question is asked again at the new difficulty. No grading.
export function difficultyMove(tutor, delta, focus) {
  const node = tutor?.pending?.node ?? focus;
  const next = fork(tutor, node);
  next.difficulty = Math.min(2, Math.max(-2, next.difficulty + Math.sign(delta)));
  return settle(next, { type: 'question', node, kind: tutor?.pending?.kind ?? 'check', after: delta > 0 ? 'harder' : 'easier' });
}

// Commands are matched whole, never found inside an answer: "it gets harder to train" is an answer.
export function parseCommand(text) {
  const t = String(text ?? '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  return { harder: 'harder', easier: 'easier', 'just tell me': 'tell', 'show progress': 'progress', 'save state': 'save' }[t] ?? null;
}

// Signals the page already collects count as evidence, conservatively (see canRaise):
//   - every multiple-choice question of a section right on the FIRST try: one check
//   - a self-explanation graded "solid": one check
// Each is counted once per section, a second try at a question changes nothing, and neither can
// raise a level alone, because neither is unprompted.
export function applyPageSignal(tutor, nodeId, signal) {
  const next = fork(tutor, nodeId);
  const skill = next.skills[nodeId];
  const changes = [];
  if (signal?.type === 'mcq') {
    if (!(signal.index in skill.mcqFirst)) skill.mcqFirst[signal.index] = Boolean(signal.correct);
    const firsts = Object.values(skill.mcqFirst);
    if (!skill.mcqDone && signal.total > 0 && firsts.length >= signal.total && firsts.every(Boolean)) {
      skill.mcqDone = true;
      skill.evidence.push({ kind: 'mcq' });
    }
  } else if (signal?.type === 'self' && signal.verdict === 'solid' && !skill.selfDone) {
    skill.selfDone = true;
    skill.evidence.push({ kind: 'self' });
  }
  raiseIfEarned(skill, nodeId, changes);
  return { tutor: next, changes };
}

// --- Pretest (the tutor-first variant) ---

// The prediction question comes from the section's own authored quiz, so it is on screen at once
// with nothing sampled on load, and it is the question the reader will meet again after reading:
// the pretesting effect is strongest for the very items pretested. Stems that only make sense
// with their options in view are passed over.
export function pretestQuestion(node) {
  const needsOptions = /\b(which of|following|these (options|statements)|select|choose)\b/i;
  const stem = (node?.quiz?.mcq ?? []).map(m => String(m?.stem ?? '').trim()).find(s => s && !needsOptions.test(s));
  if (stem) return stem;
  if (node?.quiz?.selfExplain) return String(node.quiz.selfExplain).replace(/^conceptualize in one sentence\s*/i, '').replace(/^./, c => c.toUpperCase());
  return `${node?.hook ?? ''} What do you expect the answer to be?`.trim();
}

export function needsPretest(tutor, nodeId) {
  return !tutor?.pretestOff && !tutor?.pretests?.[nodeId];
}

// A pretest guess is never evidence: this touches no evidence list and no level. What it does
// record is that the section was just revealed, so the first right answer after it is "prompted".
export function recordPretest(tutor, nodeId, { guess = '', question = '' } = {}) {
  const next = fork(tutor, nodeId);
  const text = String(guess).trim().slice(0, MAX_ANSWER_CHARS);
  next.pretests[nodeId] = text ? { guess: text, question } : { skipped: true };
  if (text) next.skills[nodeId].told = true;
  return next;
}

export function pretestMove(tutor, nodeId) {
  const next = fork(tutor, nodeId);
  next.skills[nodeId].told = true;
  next.skills[nodeId].strikes = 0;
  return settle(next, { type: 'pretest', node: nodeId, kind: 'check' });
}

// --- Skill map ---

export function skillRows(tutor, nodes, focus) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const depth = (n, seen = new Set()) =>
    n.parent && byId.has(n.parent) && !seen.has(n.id) ? 1 + depth(byId.get(n.parent), seen.add(n.id)) : 0;
  return linearOrder(nodes).map(n => {
    const s = skillOf(tutor, n.id);
    return { id: n.id, title: n.title, depth: depth(n), level: s.level, name: LEVEL_NAMES[s.level],
             covered: s.covered, focus: n.id === focus };
  });
}

export function overallPercent(tutor, nodes) {
  if (!nodes.length) return 0;
  return Math.round(100 * nodes.reduce((sum, n) => sum + levelOf(tutor, n.id), 0) / (MAX_LEVEL * nodes.length));
}

export function levelChangeCopy(change, title) {
  const verb = change.to > change.from ? 'Level up' : 'Level down';
  return `${verb}: ${title} ${change.from} → ${change.to} (${LEVEL_NAMES[change.to]})`;
}

// The block socratic-tutor's "save state" describes: topic, skill map with levels, misconceptions,
// what has been covered. Plain text, so it survives a paste into `/socratic-tutor resume from:`.
export function saveState(meta, nodes, tutor, focus) {
  const rows = skillRows(tutor, nodes, focus);
  const title = (id) => nodes.find(n => n.id === id)?.title ?? id;
  const covered = rows.filter(r => r.covered).map(r => r.title);
  const untouched = rows.filter(r => !r.covered).map(r => r.title);
  const sources = (meta?.sources ?? []).map(s => s.url || s.label).filter(Boolean).slice(0, 6);
  return [
    `Topic: ${meta?.title ?? ''}`,
    `Target: ${TARGET_LEVEL}/${MAX_LEVEL} . Difficulty: ${DIFFICULTY_LABELS[tutor.difficulty]} . Overall: ${overallPercent(tutor, nodes)}%`,
    `Scale: ${LEVEL_NAMES.map((n, i) => `${i} ${n}`).join(' . ')}`,
    'Skill map:',
    ...rows.map(r => `${'  '.repeat(r.depth)}- [${r.level}/${MAX_LEVEL}] ${r.title}${r.focus ? '  <- current focus' : ''}`),
    'Misconceptions:',
    ...(tutor.misconceptions.length
      ? tutor.misconceptions.map(m => `- ${title(m.node)}: ${m.text}`)
      : ['- none recorded']),
    `Covered (at least one graded answer): ${covered.join('; ') || 'nothing yet'}`,
    `Not yet covered: ${untouched.join('; ') || 'none'}`,
    'Leveling in force: a raise needs 2+ independent right answers, one unprompted; a failed review lowers a level.',
    sources.length ? `Sources: ${sources.join(' ')}` : '',
  ].filter(Boolean).join('\n');
}

// --- Prompts ---

export const TUTOR_INSTRUCTIONS = [
  'You are a Socratic tutor inside an explainer page. The learner is working through the section below. You teach by asking questions that make them predict, explain why, find the flaw in a plausible but wrong claim, apply the idea to a new case, or connect two ideas. You do not lecture.',
  '',
  'Hard rules:',
  '- Ask ONE question per message, and end the message on that question. Nothing after it: no hint, no example answer, no encouragement.',
  '- Every message carries a TUTOR DIRECTION block written by the page. It states how the last answer was graded and what your move is. Follow it exactly. Never contradict the grade, never announce a level, a score or a review, and never mention the direction block.',
  '- When the answer was wrong, do not give the right answer unless the direction says to explain.',
  '- No flattery and no praise words. "Not quite: why would X happen if Y were true?" beats "Great try!". Do not credit the learner with insight they did not state.',
  '- Stay grounded. Ask and assert only what the section or the sources support, and use their exact numbers. Where tools are offered, search_sources and read_source let you check a source before you rely on it. If the learner raises something neither covers, say so in a few words. Never invent a claim, a number or an attribution.',
  '- Prefer questions that cannot be answered by copying a sentence from the section.',
  '- Keep it short: at most three sentences before the question. Plain language.',
].join('\n');

const DIFFICULTY_NOTES = {
  '-2': 'Much easier: one small step at a time, concrete cases, everyday wording.',
  '-1': 'Easier: smaller steps and concrete cases.',
  0: 'Normal: explanation and prediction questions.',
  1: 'Harder: application to new cases and connections between ideas.',
  2: 'Much harder: edge cases, adversarial cases and transfer.',
};

// What the page tells Claude to do next. One move, stated as an instruction.
export function moveDirective(move, { title = '', guess = '', question = '' } = {}) {
  const about = `"${title}"`;
  switch (move.type) {
    case 'question':
      if (move.after === 'open') return `The learner asked to be taught ${about}. Ask your first question on it.`;
      if (move.after === 'harder' || move.after === 'easier') {
        return `The learner asked for ${move.after} questions. Do not grade anything. Ask about the same idea as your last question again, at the new difficulty.`;
      }
      if (move.after === 'correct') {
        return `Grade: CORRECT. Confirm in at most one plain sentence, no praise, then ask one new question on ${about} that tests it from a different angle.`;
      }
      return `The learner's message was not an answer to an open question. Reply to it in a sentence or two from the section, then ask one question on ${about}.`;
    case 'narrow':
      if (move.after === 'review') {
        return `Grade: WRONG, on an idea from the earlier section ${about} that they had before. Do not give the answer. Ask one narrower question on ${about} that exposes the contradiction in what they said.`;
      }
      if (move.after === 'defense') {
        return `Grade: they did not defend their earlier correct answer on ${about} against your objection. Do not tell them who was right. Ask one narrower question that makes them test the objection against the section's reasoning.`;
      }
      return `Grade: WRONG. Do not give the answer. Ask one narrower question on ${about} that exposes the contradiction in what they said.`;
    case 'probe':
      return `Grade: PARTIAL, vague or incomplete, which does not count as correct. Do not fill in the missing part. Ask one question on ${about} that makes them commit to the part they left out or blurred.`;
    case 'explain':
      return `Grade: WRONG again, after several attempts. Now explain the idea directly in two to four sentences from the section. Then immediately ask one question that re-tests the same idea from a different angle.`;
    case 'devil':
      return `Grade: CORRECT. Do not confirm it. Play devil's advocate: raise one plausible-sounding objection to their answer and ask them to defend it. The objection must be one the section's reasoning can defeat.`;
    case 'review':
      return `Grade: CORRECT. Confirm in at most one plain sentence. Then, without announcing a change of topic or a review, ask one question on ${about}, an earlier section, given above as THE SECTION.`;
    case 'reask':
      return `The learner's message was not an attempt at your question. If they asked something, answer it in a sentence or two from the section or sources without giving away the answer to your question. Then ask your open question on ${about} again, reworded.`;
    case 'tell':
      return `The learner said "just tell me". Answer your last question directly in two to four sentences from the section. Then ask one question that re-tests the same idea from a different angle.`;
    case 'pretest':
      return `Before reading ${about} the learner was asked to predict: "${question}". Their prediction: "${guess}". They have now been shown the section. In one or two sentences say where the prediction matches the section and where it diverges, without praise and without grading it. Then ask one question that makes them reconcile the difference, or extend the prediction if it matched.`;
    default:
      return `Ask one question on ${about}.`;
  }
}

// Turn list for one tutor message. Same shape and caps as the Ask chat: a standing lead turn with
// the instructions, the section the NEXT question is about and the source index; the trimmed
// thread; then the learner's message with the page's direction and any retrieved excerpts.
export function tutorTurns(meta, target, history, learnerText, move, {
  catalog = '', excerpts = '', difficulty = 0, answered = null, guess = '', question = '',
} = {}) {
  const side = answered && answered.id !== target.id
    ? `\n\n--- THE SECTION THEIR LAST ANSWER WAS ABOUT ---\n${nodeContext(meta, answered).slice(0, MAX_SIDE_CONTEXT)}\n--- END ---`
    : '';
  const lead = {
    role: 'user',
    content: `${TUTOR_INSTRUCTIONS}\n\n--- THE SECTION ---\n${nodeContext(meta, target)}\n--- END OF SECTION ---${side}`
      + (catalog ? `\n\n--- SOURCES (index, label, url) ---\n${catalog}\n--- END OF SOURCES ---` : ''),
  };
  const trimmed = (history ?? []).filter(t => t.role === 'user' || t.role === 'assistant')
    .slice(-TUTOR_HISTORY_TURNS).map(({ role, content }) => ({ role, content }));
  const direction = `--- TUTOR DIRECTION (from the page, not the learner) ---\n`
    + `${moveDirective(move, { title: target.title, guess, question })}\n`
    + `Difficulty: ${DIFFICULTY_NOTES[difficulty] ?? DIFFICULTY_NOTES[0]}\n--- END OF DIRECTION ---`;
  const tail = [String(learnerText ?? '').slice(0, MAX_ANSWER_CHARS), direction,
    excerpts ? `--- SOURCE EXCERPTS ---\n${excerpts.slice(0, TUTOR_EXCERPT_CHARS)}\n--- END OF EXCERPTS ---` : '']
    .filter(Boolean).join('\n\n');
  return [lead, ...trimmed, { role: 'user', content: tail }];
}

// The grading call. Its only output is a small JSON object, validated by validateAssessment.
export function gradePrompt(meta, node, question, answer, kind = 'check') {
  return [
    'You are grading one answer in a tutoring session on the section below. Be strict: levels are earned.',
    'Reply with only a JSON object: {"result": "correct" | "partial" | "wrong" | "offtopic", "teachable": boolean, "misconception": string | null}.',
    '- "correct": the answer itself states the idea the question asks for, and nothing in it contradicts the section. Wording does not matter; the idea does.',
    '- "partial": vague, hedged, incomplete, or right for a reason they did not give. Do not credit insight the learner did not express.',
    '- "wrong": states something the section contradicts, or misses the point.',
    '- "offtopic": not an attempt at the question at all, such as a question of their own or a comment. "I don\'t know" is "wrong", not "offtopic".',
    kind === 'defense'
      ? '- The tutor was playing devil\'s advocate against a correct answer. "correct" only if the learner kept the correct position AND gave a reason that defeats the objection. Giving in to the objection is "wrong".'
      : '',
    '- "teachable": true only for a correct answer clear and complete enough that someone else could learn the idea from it.',
    '- "misconception": for partial or wrong, one short clause naming the specific wrong belief the answer shows, else null.',
    'Judge against the section only. Do not use outside knowledge to mark an answer wrong.',
    '',
    `--- SECTION ---\n${nodeContext(meta, node)}\n--- END OF SECTION ---`,
    '',
    `TUTOR'S MESSAGE (ends with the question):\n${String(question ?? '').slice(-3000)}`,
    '',
    `LEARNER'S ANSWER: ${String(answer ?? '').slice(0, MAX_ANSWER_CHARS)}`,
  ].filter(l => l !== '').join('\n');
}

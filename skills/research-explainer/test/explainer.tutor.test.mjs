import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  checkpointsFor, createRound, startRound, applyRound,
  trackedNodes, placement, placeTutor, diagnosticLine, weakestAreas, PLACEMENT_LEVEL,
  tutorVariant, createTutor, skillOf, levelOf, validateAssessment, canRaise, applyAssessment, applyPageSignal,
  pickReview, openMove, tellMove, difficultyMove, parseCommand, pretestQuestion, needsPretest, recordPretest,
  pretestMove, skillRows, overallPercent, levelChangeCopy, saveState, tutorTurns, gradePrompt, moveDirective,
  explainAfter, TUTOR_INSTRUCTIONS, LEVEL_NAMES,
} from '../assets/lib/tutor.js';
import { renderSidebar, renderChat, renderNode, renderSkillMap, renderSaveState, renderCheckpoint } from '../assets/lib/render.js';
import { buildHtml } from '../assets/build.mjs';

const doc = () => JSON.parse(readFileSync(new URL('./fixtures/attention.nodes.json', import.meta.url)));
const ids = () => doc().nodes.map(n => n.id);
const A = 'scaled-dot-product';
const B = 'multi-head';
const right = { result: 'correct', teachable: false, misconception: null };
const wrong = { result: 'wrong', teachable: false, misconception: 'thinks scaling prevents overflow' };

// Open a question on `id`, then feed verdicts; returns the last step.
function run(start, id, verdicts, { focus = id, order = ids() } = {}) {
  let step = openMove(start, id);
  for (const v of verdicts) step = applyAssessment(step.tutor, v, { focus, order });
  return step;
}

test('the variant falls back to tutor-first for anything unknown', () => {
  assert.equal(tutorVariant('first'), 'first');
  assert.equal(tutorVariant('off'), 'off');
  assert.equal(tutorVariant(undefined), 'first');
  assert.equal(tutorVariant('nonsense'), 'first');
});

test('state restored from storage is normalized, whatever storage held', () => {
  const t = createTutor({ skills: { x: { level: 99, evidence: [{ kind: 'bogus' }, { kind: 'recall' }] } }, difficulty: 7, pending: { node: 3 } });
  assert.equal(t.skills.x.level, 5);
  assert.deepEqual(t.skills.x.evidence, [{ kind: 'recall' }]);
  assert.equal(t.difficulty, 2);
  assert.equal(t.pending, null);
  assert.deepEqual(createTutor('garbage').thread, []);
  assert.equal(levelOf(createTutor(null), 'missing'), 0);
});

test('a grade that is not exactly the expected shape is no grade', () => {
  assert.equal(validateAssessment(null), null);
  assert.equal(validateAssessment('correct'), null);
  assert.equal(validateAssessment({ result: 'excellent' }), null);
  assert.equal(validateAssessment({ verdict: 'correct' }), null);
  assert.deepEqual(validateAssessment({ result: 'correct', teachable: 'yes', misconception: 'x' }),
    { result: 'correct', teachable: false, misconception: null });
  assert.equal(validateAssessment({ result: 'wrong', misconception: 'a'.repeat(500) }).misconception.length, 160);
});

test('no grade and an off-topic message change nothing and re-ask the open question', () => {
  const opened = openMove(createTutor(), A);
  for (const verdict of [null, { result: 'offtopic', teachable: false, misconception: null }]) {
    const step = applyAssessment(opened.tutor, verdict, { focus: A, order: ids() });
    assert.equal(step.move.type, 'reask');
    assert.deepEqual(step.changes, []);
    assert.deepEqual(step.tutor.skills[A], opened.tutor.skills[A]);
    assert.equal(step.tutor.turn, 0);
  }
});

test('one right answer never raises a level', () => {
  const step = run(createTutor(), A, [right]);
  assert.equal(levelOf(step.tutor, A), 0);
  assert.deepEqual(step.changes, []);
});

test('two unprompted right answers raise exactly one level and spend the evidence', () => {
  const step = run(createTutor(), A, [right, right]);
  assert.deepEqual(step.changes, [{ node: A, from: 0, to: 1 }]);
  assert.equal(levelOf(step.tutor, A), 1);
  assert.deepEqual(skillOf(step.tutor, A).evidence, []);
});

test('the transition does not mutate the state it was given', () => {
  const opened = openMove(createTutor(), A).tutor;
  const snapshot = structuredClone(opened);
  applyAssessment(opened, right, { focus: A, order: ids() });
  assert.deepEqual(opened, snapshot);
});

test('a right answer after a miss is prompted, and two prompted answers do not raise', () => {
  // wrong, right (prompted), wrong, right (prompted): two checks, neither unprompted
  const step = run(createTutor(), A, [wrong, right, wrong, right]);
  assert.deepEqual(skillOf(step.tutor, A).evidence.map(e => e.kind), ['prompted', 'prompted']);
  assert.equal(levelOf(step.tutor, A), 0);
});

test('a right answer straight after "just tell me" is not unprompted recall', () => {
  let step = openMove(createTutor(), A);
  step = tellMove(step.tutor, A);
  assert.equal(step.move.type, 'tell');
  step = applyAssessment(step.tutor, right, { focus: A, order: ids() });
  assert.deepEqual(skillOf(step.tutor, A).evidence.map(e => e.kind), ['prompted']);
  step = applyAssessment(step.tutor, right, { focus: A, order: ids() });
  assert.deepEqual(step.changes, [{ node: A, from: 0, to: 1 }], 'the next clean answer is recall and completes the pair');
});

test('wrong answers narrow first and explain only on the third miss, then re-test as prompted', () => {
  const one = run(createTutor(), A, [wrong]);
  assert.equal(one.move.type, 'narrow');
  const two = run(createTutor(), A, [wrong, wrong]);
  assert.equal(two.move.type, 'narrow');
  const three = run(createTutor(), A, [wrong, wrong, wrong]);
  assert.equal(three.move.type, 'explain');
  assert.equal(skillOf(three.tutor, A).told, true);
  const after = applyAssessment(three.tutor, right, { focus: A, order: ids() });
  assert.deepEqual(skillOf(after.tutor, A).evidence.map(e => e.kind), ['prompted']);
  assert.equal(levelOf(three.tutor, A), 0, 'ordinary misses never lower a level');
});

test('a partial answer is not correct: it is probed and earns nothing', () => {
  const step = run(createTutor(), A, [{ result: 'partial', teachable: false, misconception: null }]);
  assert.equal(step.move.type, 'probe');
  assert.deepEqual(skillOf(step.tutor, A).evidence, []);
  assert.equal(skillOf(step.tutor, A).strikes, 1);
});

test('"easier" explains one miss sooner', () => {
  assert.equal(explainAfter(0), 3);
  assert.equal(explainAfter(-1), 2);
  let step = openMove(createTutor(), A);
  step = difficultyMove(step.tutor, -1, A);
  assert.equal(step.tutor.difficulty, -1);
  assert.equal(step.move.after, 'easier');
  step = applyAssessment(step.tutor, wrong, { focus: A, order: ids() });
  step = applyAssessment(step.tutor, wrong, { focus: A, order: ids() });
  assert.equal(step.move.type, 'explain');
});

test('difficulty is clamped and changing it grades nothing', () => {
  let t = createTutor();
  for (let i = 0; i < 5; i++) t = difficultyMove(t, 1, A).tutor;
  assert.equal(t.difficulty, 2);
  assert.equal(t.turn, 0);
  assert.deepEqual(skillOf(t, A).evidence, []);
});

test('every third unprompted right answer is pushed back on', () => {
  const step = run(createTutor(), A, [right, right, right]);
  assert.equal(step.move.type, 'devil');
  assert.deepEqual(step.tutor.pending, { node: A, kind: 'defense' });
});

test('an answer abandoned under pressure loses the credit it earned', () => {
  const pushed = run(createTutor(), A, [right, right, right]); // level 1, one recall banked, devil open
  assert.deepEqual(skillOf(pushed.tutor, A).evidence.map(e => e.kind), ['recall']);
  const caved = applyAssessment(pushed.tutor, wrong, { focus: A, order: ids() });
  assert.deepEqual(skillOf(caved.tutor, A).evidence, []);
  assert.equal(caved.move.type, 'narrow');
  assert.equal(levelOf(caved.tutor, A), 1, 'a failed defense takes the credit back, not the level');
});

test('a held defense marks the answer it defended and adds no second check', () => {
  const pushed = run(createTutor(), A, [right, right, right]); // level 1, one recall banked, devil open
  const held = applyAssessment(pushed.tutor, right, { focus: A, order: ids() });
  assert.deepEqual(held.changes, [], 'one question pushed on is still one check');
  assert.deepEqual(skillOf(held.tutor, A).evidence, [{ kind: 'recall', defended: true }]);
  const next = applyAssessment(held.tutor, right, { focus: A, order: ids() });
  assert.deepEqual(next.changes, [{ node: A, from: 1, to: 2 }], 'a second, independent question raises');
});

test('a raise waits on the defense: caving takes the credit back before it is spent', () => {
  const at1 = createTutor({ skills: { [A]: { level: 1, evidence: [{ kind: 'prompted' }] } }, rights: 2 });
  const pushed = run(at1, A, [right]); // this recall would raise, but it is the third: devil first
  assert.equal(pushed.move.type, 'devil');
  assert.deepEqual(pushed.changes, []);
  const caved = applyAssessment(pushed.tutor, wrong, { focus: A, order: ids() });
  assert.equal(levelOf(caved.tutor, A), 1);
  assert.deepEqual(skillOf(caved.tutor, A).evidence, [{ kind: 'prompted' }]);
  const held = applyAssessment(pushed.tutor, right, { focus: A, order: ids() });
  assert.deepEqual(held.changes, [{ node: A, from: 1, to: 2 }]);
});

test('level 5 needs a defended answer and a teachable one, not just two right answers', () => {
  const at4 = { level: 4, evidence: [{ kind: 'recall' }, { kind: 'recall' }], strikes: 0 };
  assert.equal(canRaise(at4), false);
  assert.equal(canRaise({ ...at4, evidence: [{ kind: 'recall', defended: true }, { kind: 'recall' }] }), false);
  assert.equal(canRaise({ ...at4, evidence: [{ kind: 'recall', defended: true }, { kind: 'recall', teachable: true }] }), true);
  assert.equal(canRaise({ ...at4, evidence: [{ kind: 'recall', defended: true, teachable: true }] }), false, 'still two checks');
  assert.equal(canRaise({ level: 5, evidence: at4.evidence }), false);
});

test('a review comes due on an expanding interval and never for the section in focus', () => {
  const t = createTutor({ turn: 10, lastReviewTurn: 0, skills: {
    a: { level: 1, covered: true, lastTurn: 6 },  // interval 3, overdue 1.33
    b: { level: 2, covered: true, lastTurn: 1 },  // interval 6, overdue 1.5
    c: { level: 3, covered: true, lastTurn: 2 },  // interval 12, not due
    d: { level: 0, covered: true, lastTurn: 0 },  // nothing to lose yet
  } });
  assert.equal(pickReview(t, ['a', 'b', 'c', 'd'], 'x'), 'b');
  assert.equal(pickReview(t, ['a', 'b', 'c', 'd'], 'b'), 'a');
  assert.equal(pickReview({ ...t, lastReviewTurn: 9 }, ['a', 'b', 'c', 'd'], 'x'), null, 'reviews are spaced apart');
  assert.equal(pickReview(createTutor(), ['a'], 'x'), null);
});

test('a due review is interleaved after a right answer, and passing it counts as unprompted', () => {
  const start = createTutor({ turn: 9, skills: { [A]: { level: 2, covered: true, lastTurn: 1, evidence: [{ kind: 'prompted' }] } } });
  const step = run(start, B, [right], { focus: B });
  assert.equal(step.move.type, 'review');
  assert.deepEqual(step.tutor.pending, { node: A, kind: 'review' });
  const passed = applyAssessment(step.tutor, right, { focus: B, order: ids() });
  assert.deepEqual(passed.changes, [{ node: A, from: 2, to: 3 }]);
  assert.equal(passed.move.node, B, 'after the review the tutor returns to the section in focus');
});

test('a failed review lowers the level, clears the evidence and revisits the section', () => {
  const start = createTutor({ turn: 9, skills: { [A]: { level: 2, covered: true, lastTurn: 1, evidence: [{ kind: 'recall' }] } } });
  const step = run(start, B, [right, wrong], { focus: B });
  assert.deepEqual(step.changes, [{ node: A, from: 2, to: 1 }]);
  assert.equal(levelOf(step.tutor, A), 1);
  assert.deepEqual(skillOf(step.tutor, A).evidence, []);
  assert.deepEqual(step.move, { type: 'narrow', node: A, kind: 'check', after: 'review' });
  assert.deepEqual(step.tutor.misconceptions, [{ node: A, text: wrong.misconception }]);
});

test('misconceptions are recorded once each', () => {
  const step = run(createTutor(), A, [wrong, wrong]);
  assert.equal(step.tutor.misconceptions.length, 1);
});

test('the page quiz counts for one check at most, and never alone', () => {
  let t = createTutor();
  t = applyPageSignal(t, A, { type: 'mcq', index: 0, correct: true, total: 1 }).tutor;
  const self = applyPageSignal(t, A, { type: 'self', verdict: 'solid' });
  assert.deepEqual(skillOf(self.tutor, A).evidence.map(e => e.kind), ['mcq', 'self']);
  assert.deepEqual(self.changes, [], 'two quiz signals are not two checks and are not unprompted');
  assert.equal(levelOf(self.tutor, A), 0);
  // One unprompted tutor answer plus the quiz credit completes the pair.
  const step = run(self.tutor, A, [right]);
  assert.deepEqual(step.changes, [{ node: A, from: 0, to: 1 }]);
});

test('a multiple-choice question counts only on the first try, and only when all of them are right', () => {
  let t = createTutor();
  t = applyPageSignal(t, A, { type: 'mcq', index: 0, correct: false, total: 2 }).tutor;
  t = applyPageSignal(t, A, { type: 'mcq', index: 0, correct: true, total: 2 }).tutor; // the retry
  t = applyPageSignal(t, A, { type: 'mcq', index: 1, correct: true, total: 2 }).tutor;
  assert.deepEqual(skillOf(t, A).evidence, []);
  let u = createTutor();
  u = applyPageSignal(u, A, { type: 'mcq', index: 0, correct: true, total: 2 }).tutor;
  assert.deepEqual(skillOf(u, A).evidence, [], 'not until every question is answered');
  u = applyPageSignal(u, A, { type: 'mcq', index: 1, correct: true, total: 2 }).tutor;
  u = applyPageSignal(u, A, { type: 'mcq', index: 1, correct: true, total: 2 }).tutor;
  assert.deepEqual(skillOf(u, A).evidence, [{ kind: 'mcq' }], 'and only once');
});

test('only a "solid" self-explanation counts, and quiz signals stop counting at level 3', () => {
  const partial = applyPageSignal(createTutor(), A, { type: 'self', verdict: 'partial' });
  assert.deepEqual(skillOf(partial.tutor, A).evidence, []);
  assert.equal(canRaise({ level: 2, evidence: [{ kind: 'recall' }, { kind: 'mcq' }] }), true);
  assert.equal(canRaise({ level: 3, evidence: [{ kind: 'recall' }, { kind: 'mcq' }] }), false);
});

test('commands are matched whole, never found inside an answer', () => {
  assert.equal(parseCommand('Harder'), 'harder');
  assert.equal(parseCommand(' just tell me. '), 'tell');
  assert.equal(parseCommand('show progress'), 'progress');
  assert.equal(parseCommand('save state'), 'save');
  assert.equal(parseCommand('it gets harder to train'), null);
  assert.equal(parseCommand(''), null);
});

test('a pretest guess is never evidence and never moves a level', () => {
  const t = recordPretest(createTutor(), A, { guess: 'softmax saturates', question: 'Why scale?' });
  assert.deepEqual(t.pretests[A], { guess: 'softmax saturates', question: 'Why scale?' });
  assert.deepEqual(skillOf(t, A).evidence, []);
  assert.equal(levelOf(t, A), 0);
  assert.equal(t.turn, 0);
  const step = pretestMove(t, A);
  assert.equal(step.move.type, 'pretest');
  assert.deepEqual(step.changes, []);
  assert.equal(step.tutor.pending, null, 'the reply to a prediction is a statement, not a question');
  // The section was just revealed, so the first right answer after it is prompted.
  const after = run(step.tutor, A, [right]);
  assert.deepEqual(skillOf(after.tutor, A).evidence.map(e => e.kind), ['prompted']);
});

test('a pretest is asked once per section, skipping counts as done, and it can be turned off', () => {
  const t = createTutor();
  const nodeA = doc().nodes.find(n => n.id === A);
  const nodeB = doc().nodes.find(n => n.id === B);
  assert.equal(needsPretest(t, nodeA), true);
  const skipped = recordPretest(t, A, { guess: '   ' });
  assert.deepEqual(skipped.pretests[A], { skipped: true });
  assert.equal(needsPretest(skipped, nodeA), false);
  assert.equal(needsPretest(skipped, nodeB), true);
  assert.equal(needsPretest({ ...t, pretestOff: true }, nodeB), false);
});

test('a section without quiz.predict opens straight into its body', () => {
  const found = doc().nodes.find(x => x.id === A);
  const plain = { ...found, quiz: { ...found.quiz, predict: undefined } };
  assert.equal(pretestQuestion(plain), null);
  assert.equal(needsPretest(createTutor(), plain), false);
  assert.equal(pretestQuestion({ quiz: { predict: '   ' } }), null);
});

test('the skill map lists every section in reading order with depth, level and focus', () => {
  const t = createTutor({ skills: { [A]: { level: 3, covered: true } } });
  const rows = skillRows(t, doc().nodes, A);
  assert.equal(rows.length, doc().nodes.length);
  const a = rows.find(r => r.id === A);
  assert.deepEqual([a.level, a.name, a.focus, a.depth], [3, 'can do with help', true, 0]);
  assert.equal(rows.find(r => r.id === B).depth, 1);
  assert.equal(overallPercent(t, doc().nodes), Math.round(300 / (5 * doc().nodes.length)));
  assert.equal(overallPercent(t, []), 0);
});

test('level changes are announced with the scale wording', () => {
  assert.equal(levelChangeCopy({ from: 2, to: 3 }, 'Attention'), 'Level up: Attention 2 → 3 (can do with help)');
  assert.match(levelChangeCopy({ from: 2, to: 1 }, 'Attention'), /^Level down/);
  assert.equal(LEVEL_NAMES.length, 6);
});

test('save state carries topic, levels, misconceptions and coverage for a terminal resume', () => {
  const t = createTutor({
    skills: { [A]: { level: 3, covered: true } },
    misconceptions: [{ node: A, text: 'thinks scaling prevents overflow' }],
    difficulty: 1,
  });
  const block = saveState(doc().meta, doc().nodes, t, A);
  assert.match(block, /^Topic: Attention Is All You Need/);
  assert.match(block, /Target: 4\/5 \. Difficulty: harder/);
  assert.match(block, /- \[3\/5\] Scaled dot-product attention {2}<- current focus/);
  assert.match(block, /\n {2}- \[0\/5\] /, 'children are indented under their parent');
  assert.match(block, /- Scaled dot-product attention: thinks scaling prevents overflow/);
  assert.match(block, /Covered \(at least one graded answer\): Scaled dot-product attention/);
  assert.match(block, /Not yet covered: /);
  assert.ok(!block.includes('—'), 'no em dashes');
  assert.match(saveState(doc().meta, doc().nodes, createTutor(), A), /- none recorded/);
});

test('the tutor prompt leads with the rules and the section, and ends on the direction', () => {
  const n = doc().nodes.find(x => x.id === A);
  const turns = tutorTurns(doc().meta, n, [], 'because of overflow', { type: 'narrow', node: A, kind: 'check' },
    { catalog: '[0] Paper <u>', excerpts: 'EXCERPT', difficulty: 1 });
  assert.equal(turns[0].role, 'user');
  assert.ok(turns[0].content.includes(TUTOR_INSTRUCTIONS));
  assert.match(turns[0].content, /Scaled dot-product attention/);
  assert.match(turns[0].content, /\[0\] Paper <u>/);
  const tail = turns.at(-1).content;
  assert.match(tail, /^because of overflow/);
  assert.match(tail, /Grade: WRONG\. Do not give the answer/);
  assert.match(tail, /Difficulty: Harder/);
  assert.match(tail, /EXCERPT/);
});

test('the rules cover one question, no flattery, grounding and the source tools', () => {
  assert.match(TUTOR_INSTRUCTIONS, /ONE question per message/);
  assert.match(TUTOR_INSTRUCTIONS, /Nothing after it/);
  assert.match(TUTOR_INSTRUCTIONS, /No flattery/);
  assert.match(TUTOR_INSTRUCTIONS, /search_sources and read_source/);
  assert.match(TUTOR_INSTRUCTIONS, /Never invent a claim/);
});

test('history is trimmed, level notes never reach Claude, and a review carries both sections', () => {
  const nodes = doc().nodes;
  const history = [{ role: 'note', content: 'Level up' }];
  for (let i = 0; i < 12; i++) history.push({ role: 'user', content: 'u' + i }, { role: 'assistant', content: 'a' + i, tier: 'quick' });
  const turns = tutorTurns(doc().meta, nodes.find(n => n.id === A), history, 'answer',
    { type: 'review', node: A, kind: 'review' }, { answered: nodes.find(n => n.id === B) });
  assert.equal(turns.length, 10);
  assert.ok(turns.every(t => t.role === 'user' || t.role === 'assistant'));
  assert.deepEqual(Object.keys(turns[2]), ['role', 'content']);
  assert.match(turns[0].content, /THE SECTION THEIR LAST ANSWER WAS ABOUT/);
  assert.match(turns.at(-1).content, /without announcing a change of topic or a review/);
});

test('every move has a direction, and the pretest one carries the prediction', () => {
  for (const type of ['question', 'narrow', 'probe', 'explain', 'devil', 'review', 'reask', 'tell', 'pretest']) {
    assert.ok(moveDirective({ type }, { title: 'T' }).length > 20, type);
  }
  const d = moveDirective({ type: 'pretest' }, { title: 'T', guess: 'my guess', question: 'the q' });
  assert.match(d, /my guess/);
  assert.match(d, /the q/);
  assert.match(d, /without grading it/);
  assert.match(moveDirective({ type: 'explain' }, { title: 'T' }), /re-tests the same idea from a different angle/);
  assert.match(moveDirective({ type: 'devil' }, { title: 'T' }), /Do not confirm it/);
});

test('the grading prompt asks for JSON only, is strict, and tightens for a defense', () => {
  const n = doc().nodes.find(x => x.id === A);
  const p = gradePrompt(doc().meta, n, 'Why divide by sqrt(d_k)?', 'to stop overflow');
  assert.match(p, /Reply with only a JSON object/);
  assert.match(p, /"correct" \| "partial" \| "wrong" \| "offtopic"/);
  assert.match(p, /Do not credit insight the learner did not express/);
  assert.match(p, /LEARNER'S ANSWER: to stop overflow/);
  assert.ok(!/devil's advocate/.test(p));
  assert.match(gradePrompt(doc().meta, n, 'q', 'a', 'defense'), /devil's advocate/);
});

test('the sidebar shows levels only when the tutor is in use', () => {
  const plain = renderSidebar(doc().nodes, { currentId: A });
  assert.ok(!plain.includes('class="lvl"'));
  const html = renderSidebar(doc().nodes, { currentId: A, levels: new Map([[A, 3], [B, 0]]) });
  assert.match(html, /data-lvl="3"[^>]*aria-label="Level 3 of 5: can do with help"/);
  assert.match(html, /data-lvl="0"/);
  assert.equal(html.match(/data-lvl=/g).length, 2, 'untracked sections carry no meter');
});

test('the skill map tracks core nodes only, and falls back to every node without any', () => {
  const nodes = doc().nodes;
  assert.deepEqual(trackedNodes(nodes).map(n => n.kind), nodes.filter(n => n.kind === 'core').map(() => 'core'));
  const legacy = nodes.map(n => ({ ...n, kind: 'prereq' }));
  assert.equal(trackedNodes(legacy).length, nodes.length);
});

test('the diagnostic places a known core concept at level 2, once, and never lowers a level', () => {
  const d = doc();
  d.concepts = { ...d.concepts, attention: { introducedBy: A }, dots: { introducedBy: 'prereq-dot-product' } };
  d.diagnostic = { results: [{ concept: 'attention', known: true }, { concept: 'dots', known: true }, { concept: 'x', known: false }] };
  assert.deepEqual(placement(d), { [A]: PLACEMENT_LEVEL }, 'prereqs are not placed: they are not tracked');
  const placed = placeTutor(createTutor(), placement(d));
  assert.equal(levelOf(placed, A), 2);
  assert.equal(placed.placed, true);
  const earned = createTutor({ skills: { [A]: { level: 4 } } });
  assert.equal(levelOf(placeTutor(earned, placement(d)), A), 4);
  const again = placeTutor({ ...placed, skills: { [A]: { level: 0 } } }, placement(d));
  assert.equal(levelOf(again, A), 0, 'placement happens once');
  assert.match(diagnosticLine(d), /knows attention, dots; did not know x/);
});

test('with every tracked node at target, a right answer starts the final assessment', () => {
  const order = [A, B];
  const t = createTutor({ skills: { [A]: { level: 4, covered: true }, [B]: { level: 4, covered: true } } });
  const step = run(t, A, [right], { order });
  assert.equal(step.move.type, 'final');
  assert.equal(step.move.first, true);
  assert.deepEqual(step.tutor.pending, { node: A, kind: 'final' });
  const second = applyAssessment(step.tutor, right, { focus: A, order });
  assert.deepEqual(second.move, { type: 'final', node: B, kind: 'final' });
  const integrate = applyAssessment(second.tutor, right, { focus: A, order });
  assert.equal(integrate.move.type, 'integrate');
  assert.deepEqual(integrate.move.nodes, order);
  const done = applyAssessment(integrate.tutor, right, { focus: A, order });
  assert.equal(done.move.type, 'complete');
  assert.equal(done.tutor.pending, null);
  assert.equal(done.tutor.final.done, true);
  const after = run(done.tutor, A, [right], { order });
  assert.notEqual(after.move.type, 'final', 'a passed final does not start again');
});

test('a miss in the final assessment lowers that level and returns to the loop', () => {
  const order = [A, B];
  const t = createTutor({ skills: { [A]: { level: 4, covered: true }, [B]: { level: 4, covered: true } } });
  const started = run(t, A, [right], { order });
  const missed = applyAssessment(started.tutor, wrong, { focus: A, order });
  assert.deepEqual(missed.changes, [{ node: A, from: 4, to: 3 }]);
  assert.equal(missed.tutor.final, null);
  assert.equal(missed.move.type, 'narrow');
});

test('the closing summary names misconceptions first, then the lowest levels', () => {
  const nodes = doc().nodes.filter(n => n.kind === 'core');
  const t = createTutor({ skills: { [A]: { level: 5 }, [B]: { level: 4 } }, misconceptions: [{ node: A, text: 'x' }] });
  const weak = weakestAreas(t, nodes);
  assert.equal(weak[0], nodes.find(n => n.id === A).title);
  assert.match(moveDirective({ type: 'complete' }, { weak }), /weakest areas, which were/);
  assert.match(moveDirective({ type: 'integrate', nodes: [A, B] }, { titleOf: (id) => `T-${id}` }), /"T-scaled-dot-product", "T-multi-head"/);
});

test('the chat panel is Ask only: the tutor lives in quiz time', () => {
  const html = renderChat();
  assert.match(html, /<h3>Ask Claude<\/h3>/);
  assert.ok(!html.includes('data-mode=') && !html.includes('data-tutor-') && !html.includes('data-thread="tutor"'));
});

test('a pretest replaces the body, and always offers a way straight to reading', () => {
  const n = doc().nodes.find(x => x.id === A);
  const gated = renderNode(n, { pretest: 'Why scale?' });
  assert.match(gated, /data-pretest-skip/);
  assert.match(gated, /Why scale\?/);
  assert.ok(!gated.includes('layer-intuition'));
  const open = renderNode(n, { prediction: { guess: 'a <b>guess</b>', reply: 'Close: the **scale** matters.' }, checkpoint: '<section data-checkpoint="cp-x"></section>' });
  assert.match(open, /layer-intuition/);
  assert.match(open, /Your prediction:<\/strong> a &lt;b&gt;guess/);
  assert.match(open, /data-prediction-reply[^>]*>[\s\S]*<strong>scale<\/strong>/);
  assert.match(open, /data-checkpoint="cp-x"/);
  const plain = renderNode(n);
  assert.ok(!plain.includes('data-checkpoint') && !plain.includes('prediction') && !plain.includes('data-pretest'));
});

test('the skill map and the save sheet render escaped', () => {
  const map = renderSkillMap([{ id: 'a', title: 'A <i>', depth: 1, level: 2, name: 'can follow along', focus: true }], 40);
  assert.match(map, /40% overall/);
  assert.match(map, /A &lt;i&gt;/);
  assert.match(map, /2\/5 can follow along · current focus/);
  assert.match(renderSaveState('Topic: <x>'), /Topic: &lt;x&gt;/);
});

test('the build embeds the chosen variant, defaults to tutor-first, and rejects anything else', () => {
  assert.match(buildHtml(doc()), /window\.TUTOR = "first"/);
  assert.match(buildHtml(doc(), null, { tutor: 'checkpoints' }), /window\.TUTOR = "checkpoints"/);
  assert.throws(() => buildHtml(doc(), null, { tutor: 'panel' }), /--tutor must be one of/, 'the panel tutor is gone');
  assert.match(buildHtml(doc(), null, { tutor: 'off' }), /window\.TUTOR = "off"/);
  assert.throws(() => buildHtml(doc(), null, { tutor: 'loud' }), /--tutor must be one of/);
});

test('the build command takes --tutor in any position and refuses an unknown value', async () => {
  const { execFileSync, spawnSync } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const fixture = new URL('./fixtures/attention.nodes.json', import.meta.url).pathname;
  const dir = mkdtempSync(join(tmpdir(), 'explainer-tutor-'));
  execFileSync(process.execPath, ['assets/build.mjs', '--tutor', 'checkpoints', fixture, dir]);
  assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /window\.TUTOR = "checkpoints"/);
  execFileSync(process.execPath, ['assets/build.mjs', fixture, dir]);
  assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /window\.TUTOR = "first"/);
  const bad = spawnSync(process.execPath, ['assets/build.mjs', fixture, dir, '--tutor', 'loud']);
  assert.equal(bad.status, 2);
});

test('an answer shown by the page quiz makes the next tutor answer prompted', () => {
  const quizzed = applyPageSignal(createTutor(), A, { type: 'mcq', index: 0, correct: false, total: 2 }).tutor;
  const step = run(quizzed, A, [right]);
  assert.deepEqual(skillOf(step.tutor, A).evidence, [{ kind: 'prompted' }]);
  const explained = applyPageSignal(createTutor(), A, { type: 'self', verdict: 'partial' }).tutor;
  assert.equal(skillOf(explained, A).told, true);
});

test('the opening prediction is the authored quiz.predict', () => {
  const n = doc().nodes[1];
  assert.equal(pretestQuestion(n), n.quiz.predict);
});

// --- Quiz time ---

const tree = (spec) => spec.map(([id, kind, parent = null], i) => ({ id, kind, parent, order: i + 1, title: id.toUpperCase() }));

test('checkpoints group top-level sections until they cover three tracked ones', () => {
  // The shape of the AI research agents explainer: prereqs, then six core subtrees.
  const nodes = tree([['p1', 'prereq'], ['p2', 'prereq', 'p1'], ['q', 'core'], ['m', 'core'], ['m1', 'core', 'm'], ['m2', 'core', 'm'],
    ['nums', 'core'], ['rpm', 'core'], ['rpm1', 'core', 'rpm'], ['con', 'core'], ['un', 'core']]);
  const cps = checkpointsFor(nodes);
  assert.deepEqual(cps.map(c => c.anchor), ['m2', 'rpm1', 'un']);
  assert.deepEqual(cps[0].nodes, ['q', 'm', 'm1', 'm2']);
  assert.equal(cps[0].title, '4 sections');
  assert.deepEqual(cps[2].nodes, ['con', 'un'], 'a final run of two stands alone');
});

test('a final run of one joins the checkpoint before it, and support nodes never anchor one', () => {
  const nodes = tree([['a', 'core'], ['b', 'core'], ['c', 'core'], ['d', 'core'], ['e', 'extension']]);
  const cps = checkpointsFor(nodes);
  assert.equal(cps.length, 1);
  assert.deepEqual(cps[0].nodes, ['a', 'b', 'c', 'd']);
  assert.equal(cps[0].anchor, 'd');
  assert.deepEqual(checkpointsFor(tree([['x', 'core']])).map(c => c.nodes), [['x']], 'a lone section still gets one');
  assert.equal(checkpointsFor(tree([['x', 'core']]))[0].title, 'X', 'a one-section checkpoint is named after it');
});

test('a round asks each section once, moves on after a right answer, and closes on a statement', () => {
  const cp = { id: 'cp', anchor: B, nodes: [A, B], title: 'T' };
  const order = [A, B];
  let step = startRound(createTutor(), createRound(), cp);
  assert.deepEqual(step.tutor.pending, { node: A, kind: 'check' });
  step = applyRound(step.tutor, step.round, wrong, { cp, order });
  assert.equal(step.move.type, 'narrow');
  assert.deepEqual(step.round.done, []);
  step = applyRound(step.tutor, step.round, right, { cp, order });
  assert.deepEqual(step.round.done, [A]);
  assert.deepEqual(step.tutor.pending, { node: B, kind: 'check' });
  step = applyRound(step.tutor, step.round, right, { cp, order });
  assert.equal(step.move.type, 'round-done');
  assert.equal(step.round.finished, true);
  assert.equal(step.tutor.pending, null);
  assert.match(moveDirective(step.move, { title: 'T' }), /Do not ask a question/);
});

test('another round after a finished one starts from the first section with a fresh thread', () => {
  const cp = { id: 'cp', anchor: B, nodes: [A, B], title: 'T' };
  const finished = createRound({ done: [A, B], finished: true, thread: [{ role: 'assistant', content: 'q' }] });
  const step = startRound(createTutor(), finished, cp);
  assert.deepEqual(step.round.done, []);
  assert.equal(step.round.finished, false);
  assert.deepEqual(step.tutor.pending, { node: A, kind: 'check' });
});

test('the quiz-time block is idle until started, and skippable in every open state', () => {
  const cp = { id: 'cp-x', anchor: B, nodes: [A, B], title: 'Attention' };
  const titles = new Map([[A, 'Scaled'], [B, 'Multi']]);
  const idle = renderCheckpoint(cp, createRound(), { titles });
  assert.match(idle, /data-state="idle"/);
  assert.match(idle, /data-cp-start/);
  assert.match(idle, /data-cp-skip/);
  assert.match(idle, /Scaled[\s\S]*Multi/);
  assert.ok(!idle.includes('data-cp-form'), 'nothing is asked before Start');
  const running = renderCheckpoint(cp, createRound({ active: true }), { titles });
  assert.match(running, /data-cp-form/);
  assert.match(running, /data-cp-skip/);
  for (const a of ['tell', 'easier', 'harder', 'map', 'save']) assert.ok(running.includes(`data-cp-action="${a}"`), a);
  assert.match(renderCheckpoint(cp, createRound({ finished: true }), { titles }), /Another round/);
  assert.match(renderCheckpoint(cp, createRound({ skipped: true }), { titles }), /data-state="skipped"[\s\S]*Start quiz time/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  tutorVariant, createTutor, skillOf, levelOf, validateAssessment, canRaise, applyAssessment, applyPageSignal,
  pickReview, openMove, tellMove, difficultyMove, parseCommand, pretestQuestion, needsPretest, recordPretest,
  pretestMove, skillRows, overallPercent, levelChangeCopy, saveState, tutorTurns, gradePrompt, moveDirective,
  explainAfter, TUTOR_INSTRUCTIONS, LEVEL_NAMES,
} from '../assets/lib/tutor.js';
import { renderSidebar, renderChat, renderNode, renderSkillMap, renderSaveState } from '../assets/lib/render.js';
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

test('the variant falls back to the panel for anything unknown', () => {
  assert.equal(tutorVariant('first'), 'first');
  assert.equal(tutorVariant('off'), 'off');
  assert.equal(tutorVariant(undefined), 'panel');
  assert.equal(tutorVariant('nonsense'), 'panel');
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

test('a defended answer counts as an unprompted check', () => {
  const pushed = run(createTutor(), A, [right, right, right]);
  const held = applyAssessment(pushed.tutor, right, { focus: A, order: ids() });
  assert.deepEqual(held.changes, [{ node: A, from: 1, to: 2 }]);
});

test('level 5 needs a defended answer and a teachable one, not just two right answers', () => {
  const at4 = { level: 4, evidence: [{ kind: 'recall' }, { kind: 'recall' }], strikes: 0 };
  assert.equal(canRaise(at4), false);
  assert.equal(canRaise({ ...at4, evidence: [{ kind: 'recall' }, { kind: 'defense' }] }), false);
  assert.equal(canRaise({ ...at4, evidence: [{ kind: 'recall', teachable: true }, { kind: 'defense' }] }), true);
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
  // The section was just revealed, so the first right answer after it is prompted.
  const after = applyAssessment(step.tutor, right, { focus: A, order: ids() });
  assert.deepEqual(skillOf(after.tutor, A).evidence.map(e => e.kind), ['prompted']);
});

test('a pretest is asked once per section, skipping counts as done, and it can be turned off', () => {
  const t = createTutor();
  assert.equal(needsPretest(t, A), true);
  const skipped = recordPretest(t, A, { guess: '   ' });
  assert.deepEqual(skipped.pretests[A], { skipped: true });
  assert.equal(needsPretest(skipped, A), false);
  assert.equal(needsPretest(skipped, B), true);
  assert.equal(needsPretest({ ...t, pretestOff: true }, B), false);
});

test('the pretest question comes from the section and avoids stems that need their options', () => {
  const n = doc().nodes.find(x => x.id === A);
  assert.equal(pretestQuestion(n), n.quiz.mcq[0].stem);
  const needs = { ...n, quiz: { mcq: [{ stem: 'Which of the following is true?' }], selfExplain: 'Conceptualize in one sentence why scaling helps.' } };
  assert.equal(pretestQuestion(needs), 'Why scaling helps.');
  assert.match(pretestQuestion({ hook: 'Why order matters.', quiz: {} }), /Why order matters\. What do you expect/);
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
  const html = renderSidebar(doc().nodes, { currentId: A, levels: new Map([[A, 3]]) });
  assert.match(html, /data-lvl="3"[^>]*aria-label="Level 3 of 5: can do with help"/);
  assert.match(html, /data-lvl="0"/);
});

test('the panel carries both modes only when the tutor is built in', () => {
  const plain = renderChat();
  assert.ok(!plain.includes('data-mode='));
  assert.ok(!plain.includes('data-tutor-'));
  assert.match(plain, /<h3>Ask Claude<\/h3>/);
  const both = renderChat({ tutor: true });
  assert.match(both, /data-mode="ask" aria-pressed="true"/);
  assert.match(both, /data-mode="tutor"/);
  assert.match(both, /data-thread="tutor"/);
  for (const action of ['tell', 'easier', 'harder', 'map', 'save']) assert.ok(both.includes(`data-tutor-action="${action}"`), action);
});

test('a pretest replaces the body, and always offers a way straight to reading', () => {
  const n = doc().nodes.find(x => x.id === A);
  const gated = renderNode(n, { pretest: 'Why scale?' });
  assert.match(gated, /data-pretest-skip/);
  assert.match(gated, /Why scale\?/);
  assert.ok(!gated.includes('layer-intuition'));
  const open = renderNode(n, { prediction: { guess: 'a <b>guess</b>' }, offer: true });
  assert.match(open, /layer-intuition/);
  assert.match(open, /Your prediction:<\/strong> a &lt;b&gt;guess/);
  assert.match(open, /data-tutor-offer/);
  const plain = renderNode(n);
  assert.ok(!plain.includes('data-tutor-offer') && !plain.includes('prediction') && !plain.includes('data-pretest'));
});

test('the skill map and the save sheet render escaped', () => {
  const map = renderSkillMap([{ id: 'a', title: 'A <i>', depth: 1, level: 2, name: 'can follow along', focus: true }], 40);
  assert.match(map, /40% overall/);
  assert.match(map, /A &lt;i&gt;/);
  assert.match(map, /2\/5 can follow along · current focus/);
  assert.match(renderSaveState('Topic: <x>'), /Topic: &lt;x&gt;/);
});

test('the build embeds the chosen variant, defaults to the panel, and rejects anything else', () => {
  assert.match(buildHtml(doc()), /window\.TUTOR = "panel"/);
  assert.match(buildHtml(doc(), null, { tutor: 'first' }), /window\.TUTOR = "first"/);
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
  execFileSync(process.execPath, ['assets/build.mjs', '--tutor', 'first', fixture, dir]);
  assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /window\.TUTOR = "first"/);
  execFileSync(process.execPath, ['assets/build.mjs', fixture, dir]);
  assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /window\.TUTOR = "panel"/);
  const bad = spawnSync(process.execPath, ['assets/build.mjs', fixture, dir, '--tutor', 'loud']);
  assert.equal(bad.status, 2);
});

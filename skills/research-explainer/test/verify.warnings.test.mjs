import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verify, visibleWords } from '../assets/verify.mjs';

const doc = () => JSON.parse(readFileSync(new URL('./fixtures/attention.nodes.json', import.meta.url)));
const src = () => readFileSync(new URL('./fixtures/attention.source.txt', import.meta.url), 'utf8');

test('the reference fixture produces no warnings', () => {
  const { warnings } = verify(doc(), src());
  assert.deepEqual(warnings, [], `unexpected warnings: ${JSON.stringify(warnings, null, 2)}`);
});

test('a diagram with more than ten cues warns', () => {
  const d = doc();
  d.nodes[1].diagram.cueCount = 11;
  const { errors, warnings } = verify(d, src());
  assert.ok(warnings.some(w => w.code === 'CUE_OVERLOAD' && w.nodeId === 'scaled-dot-product'));
  assert.deepEqual(errors, []);
});

test('a prose block over 250 words warns', () => {
  const d = doc();
  d.nodes[1].spiral.concrete = Array.from({ length: 260 }, (_, i) => `word${i}`).join(' ');
  const { warnings } = verify(d, src());
  assert.ok(warnings.some(w => w.code === 'LONG_BLOCK'));
});

test('250 words split across two blocks does not warn', () => {
  const d = doc();
  const half = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
  d.nodes[1].spiral.concrete = `${half}\n\n${half}`;
  const { warnings } = verify(d, src());
  assert.ok(!warnings.some(w => w.code === 'LONG_BLOCK'));
});

test('three consecutive hooks with no connective warn', () => {
  const d = doc();
  d.nodes[1].hook = 'Then we compute the scores.';
  d.nodes[2].hook = 'Then we add more heads.';
  d.nodes[3].hook = 'Then we add position.';
  const { warnings } = verify(d, src());
  assert.ok(warnings.some(w => w.code === 'AND_THEN_CHAIN'));
});

test('hooks using but and therefore do not warn', () => {
  const { warnings } = verify(doc(), src());
  assert.ok(!warnings.some(w => w.code === 'AND_THEN_CHAIN'));
});

test('bold used for emphasis inside prose does not warn', () => {
  const d = doc();
  d.nodes[1].spiral.intuition =
    'There are several ways to do this. **SFT** imitates examples. ' +
    '**DPO** uses preference pairs. **PPO** optimises against a reward.';
  const { warnings } = verify(d, src());
  assert.ok(!warnings.some(w => w.code === 'TAXONOMY_WITHOUT_AXIS'),
    'emphasis is not a definitional list; flagging it trains readers to ignore the warning');
});

test('a definitional list of three siblings with no axis warns', () => {
  const d = doc();
  d.nodes[1].spiral.intuition =
    'Ways to do this:\n- **SFT** imitates examples.\n- **DPO** uses preference pairs.\n- **PPO** optimises a reward.';
  const { warnings } = verify(d, src());
  assert.ok(warnings.some(w => w.code === 'TAXONOMY_WITHOUT_AXIS' && w.nodeId === 'scaled-dot-product'));
});

test('the same list with an organising axis does not warn', () => {
  const d = doc();
  d.nodes[1].spiral.intuition =
    'They differ by how much machinery each one removes. **PPO** keeps everything. ' +
    '**GRPO** removes the critic. **DPO** removes the whole loop.';
  const { warnings } = verify(d, src());
  assert.ok(!warnings.some(w => w.code === 'TAXONOMY_WITHOUT_AXIS'));
});

test('a plain bulleted list without bolded terms does not warn', () => {
  const d = doc();
  d.nodes[1].spiral.intuition = 'Options:\n- alpha does one thing\n- beta does another\n- gamma does a third';
  const { warnings } = verify(d, src());
  assert.ok(!warnings.some(w => w.code === 'TAXONOMY_WITHOUT_AXIS'), 'a plain list is not a definitional taxonomy');
});

test('naming two siblings without an axis is fine', () => {
  const d = doc();
  d.nodes[1].spiral.intuition = 'Two things matter here: **queries** and **keys**.';
  const { warnings } = verify(d, src());
  assert.ok(!warnings.some(w => w.code === 'TAXONOMY_WITHOUT_AXIS'));
});

test('the real text that confused a reader is caught', () => {
  const d = doc();
  // verbatim from the node that prompted two rounds of "I do not get it"
  d.nodes[1].spiral.concrete = [
    'Post-training: one GPU can be enough, hours to days. The main methods:',
    '',
    '- **SFT** (supervised fine-tuning) - show it (question, good answer) pairs and train it to imitate them.',
    '- **DPO** - show it pairs where one answer is better, and train it to prefer the better one.',
    '- **PPO** and **GRPO** - reinforcement learning, where the model generates attempts and gets scored.',
  ].join('\n');
  const { warnings } = verify(d, src());
  assert.ok(warnings.some(w => w.code === 'TAXONOMY_WITHOUT_AXIS'),
    'the check must fire on the text that actually failed a reader');
});

test('a taxonomy in the concrete layer is caught, not just the intuition', () => {
  const d = doc();
  d.nodes[1].spiral.concrete = 'Three ways:\n- **alpha** does this\n- **beta** does that\n- **gamma** does the other';
  const { warnings } = verify(d, src());
  assert.ok(warnings.some(w => w.code === 'TAXONOMY_WITHOUT_AXIS' && /concrete/.test(w.message)));
});

test('a list whose axis is stated in the plural or as levels does not warn', () => {
  const d = doc();
  d.nodes[1].spiral.concrete =
    'The survey organises these along two axes. Three capability levels:\n' +
    '- **L1 Predictor** learns one-step transitions.\n' +
    '- **L2 Simulator** composes them into rollouts.\n' +
    '- **L3 Evolver** revises its own model.';
  const { warnings } = verify(d, src());
  assert.ok(!warnings.some(w => w.code === 'TAXONOMY_WITHOUT_AXIS'),
    'naming the dimension in the plural still names the dimension');
});

const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

test('length follows importance: a prereq over 220 visible words warns, a core node at the same length does not', () => {
  const d = doc();
  const prereq = d.nodes.find(n => n.kind === 'prereq');
  const core = d.nodes.find(n => n.kind === 'core');
  for (const n of [prereq, core]) {
    n.spiral = { intuition: words(120), concrete: words(120), ...(n.kind === 'core' ? { formal: 'x.' } : {}) };
    delete n.wrongTurn;
  }
  const { warnings } = verify(d, src());
  assert.ok(warnings.some(w => w.code === 'OVER_BUDGET' && w.nodeId === prereq.id));
  assert.ok(!warnings.some(w => w.code === 'OVER_BUDGET' && w.nodeId === core.id));
});

test('the wrong turn counts toward the budget', () => {
  const d = doc();
  const prereq = d.nodes.find(n => n.kind === 'prereq');
  prereq.spiral = { intuition: words(90), concrete: words(90) };
  prereq.wrongTurn = { belief: words(20), correction: words(30) };
  assert.ok(verify(d, src()).warnings.some(w => w.code === 'OVER_BUDGET' && w.nodeId === prereq.id));
});

test('an intuition that opens by naming a bold term warns; naming it after the idea does not', () => {
  const d = doc();
  d.nodes[1].spiral.intuition = 'The **softmax** turns scores into weights. More text follows.';
  assert.ok(verify(d, src()).warnings.some(w => w.code === 'NAME_FIRST' && w.nodeId === d.nodes[1].id));
  d.nodes[1].spiral.intuition = 'Turn scores into weights that sum to one. That step is the **softmax**.';
  assert.ok(!verify(d, src()).warnings.some(w => w.code === 'NAME_FIRST'));
});

test('predictions belong on central nodes, and a document with none warns once', () => {
  const d = doc();
  const prereq = d.nodes.find(n => n.kind === 'prereq');
  prereq.quiz = { predict: 'What would you expect?' };
  assert.ok(verify(d, src()).warnings.some(w => w.code === 'PREDICT_OFF_CENTRAL' && w.nodeId === prereq.id));
  for (const n of d.nodes) delete n.quiz?.predict;
  const none = verify(d, src()).warnings.filter(w => w.code === 'NO_PREDICT');
  assert.equal(none.length, 1);
  assert.equal(none[0].nodeId, null);
});

test('the collapsed Details block does not count toward the visible budget but has its own cap', () => {
  const d = doc();
  const core = d.nodes.find(n => n.kind === 'core');
  core.spiral = { intuition: words(100), concrete: words(100), formal: words(240) };
  delete core.wrongTurn;
  let w = verify(d, src()).warnings;
  assert.ok(!w.some(x => x.nodeId === core.id && /BUDGET|DETAILS/.test(x.code)));
  core.spiral.formal = words(260);
  w = verify(d, src()).warnings;
  assert.ok(w.some(x => x.code === 'LONG_DETAILS' && x.nodeId === core.id));
});

test('page questions sit on central nodes, one multiple-choice each', () => {
  const d = doc();
  const prereq = d.nodes.find(n => n.kind === 'prereq');
  const core = d.nodes.find(n => n.kind === 'core');
  prereq.quiz = { mcq: [structuredClone(core.quiz.mcq[0])] };
  core.quiz.mcq.push(structuredClone(core.quiz.mcq[0]));
  const { warnings, errors } = verify(d, src());
  assert.ok(warnings.some(x => x.code === 'QUIZ_OFF_CENTRAL' && x.nodeId === prereq.id));
  assert.ok(warnings.some(x => x.code === 'TOO_MANY_MCQ' && x.nodeId === core.id));
  delete core.quiz.mcq;
  assert.ok(verify(d, src()).errors.some(e => e.code === 'NO_MCQ' && e.nodeId === core.id));
  assert.ok(!errors.some(e => e.code === 'NO_MCQ' && e.nodeId === prereq.id));
});

test('narration, em dashes, unnamed sources and all-at-once diagrams each warn', () => {
  const d = doc();
  const n = d.nodes[1];
  n.hook = 'Here I am going to take this at face value.';
  n.spiral.concrete = 'It scales \u2014 by design. Researchers have shown it helps.';
  n.diagram = { mermaid: 'flowchart LR\n A-->B', alt: 'x', cueCount: 6 };
  const codes = new Set(verify(d, src()).warnings.filter(w => w.nodeId === n.id).map(w => w.code));
  for (const c of ['NARRATION', 'EM_DASH', 'UNNAMED_SOURCE', 'ALL_AT_ONCE']) assert.ok(codes.has(c), c);
});

test('a named, linked source and a stepped diagram pass', () => {
  const d = doc();
  const n = d.nodes[1];
  n.spiral.concrete = '[Vaswani et al.](https://arxiv.org/abs/1706.03762) found that scaling keeps gradients usable.';
  n.diagram = { alt: 'x', cueCount: 6, steps: [{ mermaid: 'flowchart LR\n A', alt: 'a' }, { mermaid: 'flowchart LR\n A-->B', alt: 'b' }] };
  const codes = verify(d, src()).warnings.filter(w => w.nodeId === n.id).map(w => w.code);
  assert.ok(!codes.includes('UNNAMED_SOURCE'));
  assert.ok(!codes.includes('ALL_AT_ONCE'));
});

test('a link counts as its title toward the word budget, not its URL', () => {
  assert.equal(visibleWords('[PostTrainBench](https://arxiv.org/abs/2603.08640) found it.'), 3);
});

test('a verification note in the explanation warns; in caveats it does not', () => {
  const d = doc();
  const n = d.nodes[1];
  const note = 'The full paper could not be opened, so the sizes come from a search snippet.';
  n.spiral.concrete = `${n.spiral.concrete}\n\n${note}`;
  assert.ok(verify(d, src()).warnings.some(w => w.code === 'CAVEAT_IN_BODY' && w.nodeId === n.id));
  n.spiral.concrete = n.spiral.concrete.replace(`\n\n${note}`, '');
  n.caveats = note;
  assert.ok(!verify(d, src()).warnings.some(w => w.code === 'CAVEAT_IN_BODY'));
});

test('a central node must name the claim it supports', () => {
  const d = doc();
  const n = d.nodes.find(x => x.central);
  n.supports = [9];
  assert.ok(verify(d, src()).errors.some(e => e.code === 'CENTRAL_NO_CLAIM' && e.nodeId === n.id));
  delete n.supports;
  assert.ok(verify(d, src()).errors.some(e => e.code === 'CENTRAL_NO_CLAIM'));
});

test('central is a few nodes; none at all warns and falls back to core', () => {
  const d = doc();
  for (const n of d.nodes) { delete n.central; delete n.supports; }
  const w = verify(d, src()).warnings;
  assert.ok(w.some(x => x.code === 'NO_CENTRAL'));
  assert.ok(!w.some(x => x.code === 'QUIZ_OFF_CENTRAL'), 'the core fallback keeps old documents quiet');
  for (const n of d.nodes) { n.central = true; n.supports = [0]; n.quiz = { ...(n.quiz ?? {}), mcq: d.nodes[1].quiz.mcq }; }
  assert.ok(verify(d, src()).warnings.some(x => x.code === 'TOO_MANY_CENTRAL'));
});

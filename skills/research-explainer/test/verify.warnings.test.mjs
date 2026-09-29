import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verify } from '../assets/verify.mjs';

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

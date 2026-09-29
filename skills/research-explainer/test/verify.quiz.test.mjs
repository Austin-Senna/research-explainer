import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verify } from '../assets/verify.mjs';

const doc = () => JSON.parse(readFileSync(new URL('./fixtures/attention.nodes.json', import.meta.url)));
const src = () => readFileSync(new URL('./fixtures/attention.source.txt', import.meta.url), 'utf8');

test('an mcq with four options is rejected', () => {
  const d = doc();
  d.nodes[1].quiz.mcq[0].options.push({ text: 'None of the above', correct: false, why: 'filler' });
  const { errors } = verify(d, src());
  assert.ok(errors.some(e => e.code === 'MCQ_OPTION_COUNT' && e.nodeId === 'scaled-dot-product'));
});

test('an mcq with two correct answers is rejected', () => {
  const d = doc();
  d.nodes[1].quiz.mcq[0].options[1].correct = true;
  const { errors } = verify(d, src());
  assert.ok(errors.some(e => e.code === 'MCQ_CORRECT_COUNT'));
});

test('a distractor with no why is rejected', () => {
  const d = doc();
  delete d.nodes[1].quiz.mcq[0].options[1].why;
  const { errors } = verify(d, src());
  assert.ok(errors.some(e => e.code === 'MCQ_DISTRACTOR_WHY'));
});

test('a throwaway distractor why is rejected', () => {
  const d = doc();
  d.nodes[1].quiz.mcq[0].options[1].why = 'wrong';
  const { errors } = verify(d, src());
  assert.ok(errors.some(e => e.code === 'MCQ_DISTRACTOR_WHY'));
});

test('a missing mcq explanation is rejected', () => {
  const d = doc();
  delete d.nodes[1].quiz.mcq[0].explanation;
  const { errors } = verify(d, src());
  assert.ok(errors.some(e => e.code === 'NO_EXPLANATION'));
});

test('a leftover cloze is rejected rather than silently dropped', () => {
  const d = doc();
  d.nodes[1].quiz.cloze = { prompt: 'The key dimension is ___.', answers: ['d_k'], explanation: 'x' };
  const { errors } = verify(d, src());
  assert.ok(errors.some(e => e.code === 'CLOZE_UNSUPPORTED'));
});

test('a node without a multiple-choice question is rejected', () => {
  const d = doc();
  d.nodes[1].quiz.mcq = [];
  const { errors } = verify(d, src());
  assert.ok(errors.some(e => e.code === 'NO_MCQ'));
});

test('a locator absent from the node sources is rejected', () => {
  const d = doc();
  d.nodes[1].sources = [];
  const { errors } = verify(d, src());
  assert.ok(errors.some(e => e.code === 'UNGROUNDED'));
});

test('a stem quoting more than eight words verbatim is rejected', () => {
  const d = doc();
  d.nodes[1].quiz.mcq[0].stem =
    'We suspect that for large values of d_k, the dot products grow large in magnitude?';
  const { errors } = verify(d, src());
  assert.ok(errors.some(e => e.code === 'VERBATIM'));
});

test('an eight word overlap is allowed', () => {
  const d = doc();
  d.nodes[1].quiz.mcq[0].stem = 'Why do the dot products grow large in magnitude here?';
  const { errors } = verify(d, src());
  assert.ok(!errors.some(e => e.code === 'VERBATIM'));
});

test('a self-explanation without a model answer is rejected', () => {
  const d = doc();
  delete d.nodes[1].quiz.selfExplainAnswer;
  const { errors } = verify(d, src());
  assert.ok(errors.some(e => e.code === 'NO_MODEL_ANSWER'));
});

test('a borrowed figure without alt text or credit is rejected', () => {
  const d = doc();
  d.nodes[1].figures = [{ src: 'figures/x.png' }];
  const codes = verify(d, src()).errors.map(e => e.code);
  assert.ok(codes.includes('FIGURE_NO_ALT'));
  assert.ok(codes.includes('FIGURE_NO_CREDIT'));
});

test('a diagram with neither svg nor mermaid is rejected', () => {
  const d = doc();
  d.nodes[1].diagram = { alt: 'x' };
  assert.ok(verify(d, src()).errors.some(e => e.code === 'MISSING_FIELD' && /svg or mermaid/.test(e.message)));
});

test('with images on, a node without any visual is flagged', () => {
  const d = doc();
  d.meta.images = 'full';
  d.nodes[1].diagram = null; d.nodes[1].figures = [];
  assert.ok(verify(d, src()).warnings.some(w => w.code === 'NO_VISUAL' && w.nodeId === d.nodes[1].id));
});

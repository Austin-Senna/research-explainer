import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gradeMcq, recordAnswer, scheduleReasks } from '../assets/lib/quiz.js';

const doc = () => JSON.parse(readFileSync(new URL('./fixtures/attention.nodes.json', import.meta.url)));
const nodeById = (id) => doc().nodes.find(n => n.id === id);

test('mcq grading reports the correct index and its why', () => {
  const mcq = nodeById('scaled-dot-product').quiz.mcq[1];
  const right = gradeMcq(mcq, 0);
  assert.equal(right.correct, true);
  assert.equal(right.correctIndex, 0);

  const wrong = gradeMcq(mcq, 1);
  assert.equal(wrong.correct, false);
  assert.equal(wrong.correctIndex, 0);
  assert.match(wrong.why, /softmax already guarantees/);
});

test('every wrong answer schedules a re-ask and right answers do not', () => {
  const nodes = doc().nodes;
  const answers = {
    'prereq-dot-product': { correct: false },
    'scaled-dot-product': { correct: true },
  };
  const schedule = scheduleReasks(answers, nodes, 1);
  assert.deepEqual([...schedule.entries()], [['scaled-dot-product', 'prereq-dot-product']]);
});

test('a re-ask surfaces gap nodes later, clamped to the last node', () => {
  const nodes = doc().nodes;
  const answers = { 'scaled-dot-product': { correct: false } };
  assert.equal(scheduleReasks(answers, nodes, 1).get('multi-head'), 'scaled-dot-product');
  assert.equal(scheduleReasks(answers, nodes, 99).get('positional-encoding'), 'scaled-dot-product');
});

test('a node passes only when every question answered so far is right', () => {
  let a = recordAnswer(undefined, 0, true);
  assert.equal(a.correct, true);
  a = recordAnswer(a, 1, false);
  assert.equal(a.correct, false);
});

test('answering a missed question again can clear the miss', () => {
  let a = recordAnswer(recordAnswer(undefined, 0, true), 1, false);
  a = recordAnswer(a, 1, true);
  assert.equal(a.correct, true);
});

test('answers stored by an older page still schedule by correctness', () => {
  const nodes = doc().nodes;
  const legacy = { 'scaled-dot-product': { correct: false, confident: false } };
  assert.equal(scheduleReasks(legacy, nodes, 1).get('multi-head'), 'scaled-dot-product');
});

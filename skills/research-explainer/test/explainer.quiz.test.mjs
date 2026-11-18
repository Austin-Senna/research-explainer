import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gradeMcq, recordAnswer } from '../assets/lib/quiz.js';

const doc = () => JSON.parse(readFileSync(new URL('./fixtures/attention.nodes.json', import.meta.url)));
const nodeById = (id) => doc().nodes.find(n => n.id === id);

test('mcq grading reports the correct index and its why', () => {
  const mcq = nodeById('scaled-dot-product').quiz.mcq[0];
  const right = gradeMcq(mcq, 0);
  assert.equal(right.correct, true);
  assert.equal(right.correctIndex, 0);

  const wrong = gradeMcq(mcq, 1);
  assert.equal(wrong.correct, false);
  assert.equal(wrong.correctIndex, 0);
  assert.match(wrong.why, /softmax already guarantees/);
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

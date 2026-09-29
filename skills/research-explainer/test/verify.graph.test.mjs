import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verify } from '../assets/verify.mjs';

const doc = () => JSON.parse(readFileSync(new URL('./fixtures/attention.nodes.json', import.meta.url)));
const src = () => readFileSync(new URL('./fixtures/attention.source.txt', import.meta.url), 'utf8');

test('assuming a concept introduced by a later node is rejected', () => {
  const d = doc();
  d.nodes[1].assumes = ['positional-encoding'];
  const { errors } = verify(d, src());
  assert.ok(errors.some(e => e.code === 'ASSUMES_LATER' && e.nodeId === 'scaled-dot-product'));
});

test('assuming a concept nothing introduces is rejected', () => {
  const d = doc();
  d.nodes[1].assumes = ['eigenvector'];
  const { errors } = verify(d, src());
  assert.ok(errors.some(e => e.code === 'ASSUMES_UNKNOWN'));
});

test('assuming a concept the reader passed the diagnostic on is allowed', () => {
  const d = doc();
  d.nodes[1].assumes = ['softmax'];
  const { errors } = verify(d, src());
  assert.ok(!errors.some(e => e.code?.startsWith('ASSUMES')));
});

test('a core node without a wrongTurn is rejected', () => {
  const d = doc();
  delete d.nodes[1].wrongTurn;
  const { errors } = verify(d, src());
  assert.ok(errors.some(e => e.code === 'NO_WRONG_TURN' && e.nodeId === 'scaled-dot-product'));
});

test('a prereq node without a wrongTurn is allowed', () => {
  const d = doc();
  delete d.nodes[0].wrongTurn;
  const { errors } = verify(d, src());
  assert.ok(!errors.some(e => e.code === 'NO_WRONG_TURN'));
});

test('an oversimplification corrected by a nonexistent node is rejected', () => {
  const d = doc();
  d.meta.oversimplifications[0].correctedIn = 'nowhere';
  const { errors } = verify(d, src());
  assert.ok(errors.some(e => e.code === 'UNCORRECTED'));
});

test('an oversimplification corrected before it is declared is rejected', () => {
  const d = doc();
  d.meta.oversimplifications[0].declaredIn = 'multi-head';
  d.meta.oversimplifications[0].correctedIn = 'scaled-dot-product';
  const { errors } = verify(d, src());
  assert.ok(errors.some(e => e.code === 'UNCORRECTED'));
});

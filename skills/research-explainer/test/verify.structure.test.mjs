import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verify } from '../assets/verify.mjs';

const doc = () => JSON.parse(readFileSync(new URL('./fixtures/attention.nodes.json', import.meta.url)));
const src = () => readFileSync(new URL('./fixtures/attention.source.txt', import.meta.url), 'utf8');

test('the reference fixture passes with no errors', () => {
  const { errors } = verify(doc(), src());
  assert.deepEqual(errors, [], `unexpected errors: ${JSON.stringify(errors, null, 2)}`);
});

test('a node missing required fields is reported', () => {
  const d = doc();
  delete d.nodes[1].hook;
  const { errors } = verify(d, src());
  assert.ok(errors.some(e => e.code === 'MISSING_FIELD' && e.nodeId === 'scaled-dot-product'));
});

test('duplicate node ids are reported', () => {
  const d = doc();
  d.nodes[2].id = 'scaled-dot-product';
  const { errors } = verify(d, src());
  assert.ok(errors.some(e => e.code === 'DUPLICATE_ID'));
});

test('duplicate order values are reported', () => {
  const d = doc();
  d.nodes[2].order = 2;
  const { errors } = verify(d, src());
  assert.ok(errors.some(e => e.code === 'DUPLICATE_ORDER'));
});

test('a parent reference that names no node is reported', () => {
  const d = doc();
  d.nodes[2].parent = 'does-not-exist';
  const { errors } = verify(d, src());
  assert.ok(errors.some(e => e.code === 'BAD_PARENT'));
});

test('errors and warnings are always arrays', () => {
  const { errors, warnings } = verify({ meta: {}, nodes: [] }, '');
  assert.ok(Array.isArray(errors));
  assert.ok(Array.isArray(warnings));
});

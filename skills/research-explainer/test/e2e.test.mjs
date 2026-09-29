import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verify } from '../assets/verify.mjs';

const fixture = new URL('./fixtures/attention.nodes.json', import.meta.url);
const source  = new URL('./fixtures/attention.source.txt', import.meta.url);

test('the fixture verifies clean, then builds a usable page', () => {
  const doc = JSON.parse(readFileSync(fixture));
  const { errors } = verify(doc, readFileSync(source, 'utf8'));
  assert.deepEqual(errors, [], 'fixture must verify before it can build');

  const dir = mkdtempSync(join(tmpdir(), 'explainer-'));
  execFileSync(process.execPath, ['assets/build.mjs', fixture.pathname, dir]);

  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.ok(html.includes('id="tree"'));
  assert.ok(html.includes('id="content"'));
  assert.ok(html.includes('window.NODES = {'));
  assert.ok(html.length > 10_000, 'page should carry css, js and payload');
});

test('verification rejects a document that would build a broken page', () => {
  const doc = JSON.parse(readFileSync(fixture));
  doc.nodes[1].quiz.mcq[0].options.pop();
  const { errors } = verify(doc, readFileSync(source, 'utf8'));
  assert.ok(errors.some(e => e.code === 'MCQ_OPTION_COUNT'));
});

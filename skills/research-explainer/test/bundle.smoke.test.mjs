import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bundle } from '../assets/build.mjs';

// A deliberately forgiving DOM: every lookup succeeds and every element answers
// anything. The point is not fidelity — it is that the bundle must EVALUATE without
// throwing. A load-time throw aborts start() and silently kills event wiring.
function fakeDom(nodes) {
  const el = () => {
    const e = {
      textContent: '', innerHTML: '', href: '', hidden: false, disabled: false, value: '',
      className: '', dataset: {}, style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener() {}, removeEventListener() {}, append() {}, remove() {},
      closest: () => null, matches: () => false, getBoundingClientRect: () => ({ width: 0, height: 0 }),
      click() {},
    };
    e.querySelector = () => el();
    e.querySelectorAll = () => [];
    return e;
  };
  const doc = el();
  doc.documentElement = el();
  doc.getElementById = () => el();
  doc.createElement = () => el();
  doc.body = el();
  return doc;
}

function runBundle(nodes) {
  const src = bundle();
  const document = fakeDom(nodes);
  const errors = [];
  const win = {
    NODES: nodes,
    addEventListener() {}, scrollTo() {},
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  const sandbox = {
    window: win, document, location: { hash: '', reload() {} },
    CSS: { escape: (s) => s }, console,
    localStorage: win.localStorage, matchMedia: win.matchMedia,
    setTimeout, clearTimeout, AbortController,
    Element: function () {}, DOMException: Error,
  };
  // `globalThis.localStorage` is read by storage.js via a try/catch, so expose it too.
  const fn = new Function(...Object.keys(sandbox), `${src}`);
  fn(...Object.values(sandbox));
  return errors;
}

test('the bundled page script evaluates without throwing', () => {
  const doc = JSON.parse(readFileSync(new URL('./fixtures/attention.nodes.json', import.meta.url)));
  assert.doesNotThrow(
    () => runBundle(doc),
    'a load-time throw aborts start() and silently disables hashchange and keydown wiring',
  );
});

test('the bundle survives a document with no nodes', () => {
  assert.doesNotThrow(() => runBundle({ meta: { slug: 'x' }, nodes: [] }));
});

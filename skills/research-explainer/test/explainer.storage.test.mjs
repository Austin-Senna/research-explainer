import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../assets/lib/storage.js';

function memoryBacking() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

const throwingBacking = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('quota'); },
  removeItem() { throw new Error('denied'); },
};

test('a fresh store loads an empty object', () => {
  assert.deepEqual(createStore('slug', memoryBacking()).load(), {});
});

test('saved state round-trips', () => {
  const store = createStore('slug', memoryBacking());
  assert.equal(store.save({ done: ['a'] }), true);
  assert.deepEqual(store.load(), { done: ['a'] });
});

test('state is namespaced by slug', () => {
  const backing = memoryBacking();
  createStore('one', backing).save({ v: 1 });
  assert.deepEqual(createStore('two', backing).load(), {});
  assert.deepEqual(createStore('one', backing).load(), { v: 1 });
});

test('a backing that throws on read yields an empty object', () => {
  assert.deepEqual(createStore('slug', throwingBacking).load(), {});
});

test('a backing that throws on write reports false rather than throwing', () => {
  assert.equal(createStore('slug', throwingBacking).save({ v: 1 }), false);
});

test('corrupt stored JSON yields an empty object', () => {
  const backing = memoryBacking();
  backing.setItem('research-explainer:slug', '{not json');
  assert.deepEqual(createStore('slug', backing).load(), {});
});

test('an absent backing is tolerated', () => {
  const store = createStore('slug', undefined);
  assert.deepEqual(store.load(), {});
  assert.equal(store.save({ v: 1 }), false);
});

test('clear removes only this slug', () => {
  const backing = memoryBacking();
  createStore('one', backing).save({ v: 1 });
  createStore('two', backing).save({ v: 2 });
  createStore('one', backing).clear();
  assert.deepEqual(createStore('one', backing).load(), {});
  assert.deepEqual(createStore('two', backing).load(), { v: 2 });
});

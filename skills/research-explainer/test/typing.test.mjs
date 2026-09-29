import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextReveal } from '../assets/lib/typing.js';

const text = 'The probe buys dynamic features that a recipe cannot show.';

test('reveal always stops on a word boundary, never mid-word', () => {
  for (let shown = 0; shown < text.length; shown += 3) {
    const n = nextReveal(shown, text, 16);
    assert.ok(n > shown, 'it always makes progress');
    assert.ok(n === text.length || /\s/.test(text[n]), `stopped mid-word at ${n}`);
  }
});

test('reveal never passes the text that has arrived', () => {
  assert.equal(nextReveal(0, 'short', 10_000), 5);
  assert.equal(nextReveal(5, 'short', 16), 5);
});

test('a large backlog drains within a few hundred milliseconds', () => {
  const big = 'word '.repeat(400);
  let shown = 0;
  let elapsed = 0;
  while (shown < big.length && elapsed < 2000) { shown = nextReveal(shown, big, 16); elapsed += 16; }
  assert.equal(shown, big.length);
  assert.ok(elapsed <= 1600, `took ${elapsed}ms to catch up with 2,000 buffered characters`);
});

test('a small backlog still moves at reading pace, not one character a second', () => {
  const n = nextReveal(0, 'a b c d e f g h i j', 100);
  assert.ok(n >= 4, `only ${n} characters after 100ms`);
});

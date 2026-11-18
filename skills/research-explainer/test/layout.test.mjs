import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampChat, chatMax, chatWidthForKey, CHAT_MIN, MAIN_MIN, CHAT_STEP, CHAT_STEP_BIG } from '../assets/lib/layout.js';

test('the chat is never narrower than its minimum or so wide the reading column shrinks below its own', () => {
  assert.equal(clampChat(100, 1400, 272), CHAT_MIN);
  assert.equal(clampChat(5000, 1400, 272), 1400 - 272 - MAIN_MIN);
  assert.equal(clampChat(500, 1400, 272), 500);
  assert.equal(clampChat(undefined, 1400, 272), null, 'no saved width means the default');
  assert.equal(chatMax(600, 272), CHAT_MIN, 'a narrow window still allows the minimum');
});

test('arrow keys on the left-edge handle widen to the left and narrow to the right', () => {
  const ctx = { viewport: 1400, sidebar: 272 };
  assert.equal(chatWidthForKey(400, 'ArrowLeft', ctx), 400 + CHAT_STEP);
  assert.equal(chatWidthForKey(400, 'ArrowRight', ctx), 400 - CHAT_STEP);
  assert.equal(chatWidthForKey(400, 'ArrowLeft', { ...ctx, shift: true }), 400 + CHAT_STEP_BIG);
  assert.equal(chatWidthForKey(400, 'Home', ctx), CHAT_MIN);
  assert.equal(chatWidthForKey(400, 'End', ctx), chatMax(1400, 272));
  assert.equal(chatWidthForKey(400, 'a', ctx), null);
});

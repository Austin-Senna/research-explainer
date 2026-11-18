// Panel sizes: the reader drags the chat panel wider or narrower, and folds the contents away.
// Pure arithmetic, so the limits are testable; explainer.js does the DOM.

export const CHAT_MIN = 288;      // px: the composer and model picker still fit
export const MAIN_MIN = 360;      // px: the reading column never gets narrower than this
export const CHAT_STEP = 24;      // px per arrow key on the resize handle
export const CHAT_STEP_BIG = 96;  // px with Shift

// The widest the chat may be: whatever leaves the reading column MAIN_MIN wide.
export function chatMax(viewport, sidebar) {
  return Math.max(CHAT_MIN, Math.round(viewport - sidebar - MAIN_MIN));
}

export function clampChat(width, viewport, sidebar) {
  const w = Number(width);
  if (!Number.isFinite(w)) return null;
  return Math.min(Math.max(Math.round(w), CHAT_MIN), chatMax(viewport, sidebar));
}

// The handle sits on the chat's left edge, so moving it left makes the chat wider.
export function chatWidthForKey(width, key, { shift = false, viewport, sidebar }) {
  const step = shift ? CHAT_STEP_BIG : CHAT_STEP;
  const next = {
    ArrowLeft: width + step,
    ArrowRight: width - step,
    Home: CHAT_MIN,
    End: chatMax(viewport, sidebar),
  }[key];
  return next === undefined ? null : clampChat(next, viewport, sidebar);
}

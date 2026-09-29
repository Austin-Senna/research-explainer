// Smooth reveal for streamed answers. The platform delivers text a few times a second in chunks,
// which reads as lurching line-by-line jumps; revealing the buffer word by word at a steady rate
// reads as typing. Pure: the DOM loop lives in explainer.js.

const DRAIN_MS = 300;       // aim to show whatever has arrived within about this long
const MIN_CHARS_PER_S = 45; // floor, so a small backlog still moves at reading pace

// How many characters of `target` to show after `dtMs`, given `shown` are showing. Always ends on a
// word boundary, so a half-typed word never flickers, and never goes past the text that exists.
export function nextReveal(shown, target, dtMs) {
  const total = target.length;
  if (shown >= total) return total;
  const backlog = total - shown;
  const step = Math.max(1, Math.ceil(backlog * dtMs / DRAIN_MS), Math.ceil(MIN_CHARS_PER_S * dtMs / 1000));
  let end = Math.min(total, shown + step);
  if (end < total && /\S/.test(target[end])) {
    const space = target.slice(end).search(/\s/);
    end = space === -1 ? total : end + space;
  }
  return end;
}

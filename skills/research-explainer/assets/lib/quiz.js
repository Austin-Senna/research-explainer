// Pure grading. No DOM, no storage.
import { linearOrder } from './tree.js';

export function gradeMcq(mcq, chosenIndex) {
  const options = mcq.options ?? [];
  const correctIndex = options.findIndex(o => o.correct);
  const chosen = options[chosenIndex];
  return {
    correct: chosenIndex === correctIndex,
    correctIndex,
    why: chosen?.why ?? '',
  };
}

// A node can carry several questions, so its result is kept per question and the node counts
// as passed only when every question answered so far is right. Answering again (a re-ask)
// overwrites that one question, so a later correct answer can clear an earlier miss.
export function recordAnswer(previous, index, correct) {
  const questions = { ...(previous?.questions ?? {}), [index]: correct };
  return { questions, correct: Object.values(questions).every(Boolean) };
}

// Spec §7.1: the retention payoff is concentrated on errors, so every node with a wrong answer
// is asked again `gap` nodes later. Right answers are never rescheduled.
export function scheduleReasks(answers, nodes, gap = 3) {
  const linear = linearOrder(nodes);
  const schedule = new Map();
  for (const [nodeId, a] of Object.entries(answers ?? {})) {
    if (a.correct) continue;
    const i = linear.findIndex(n => n.id === nodeId);
    if (i === -1) continue;
    const target = linear[Math.min(i + gap, linear.length - 1)];
    if (target && target.id !== nodeId) schedule.set(target.id, nodeId);
  }
  return schedule;
}

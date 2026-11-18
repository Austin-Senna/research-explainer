// Pure grading. No DOM, no storage.

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

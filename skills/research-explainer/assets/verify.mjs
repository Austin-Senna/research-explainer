// Spec §8 verification. Blocking errors fail the build; warnings are reported only.
// Deliberately deterministic code, never an LLM judge — see the design doc's cost notes.

const NODE_REQUIRED = ['id', 'title', 'kind', 'order', 'hook', 'spiral', 'quiz', 'sources'];
const SPIRAL_LAYERS = ['intuition', 'concrete', 'formal'];
const KINDS = new Set(['prereq', 'core', 'extension']);

function err(list, code, nodeId, message) { list.push({ code, nodeId, message }); }

export function checkStructure(doc, errors) {
  const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
  if (!doc.meta) err(errors, 'MISSING_FIELD', null, 'meta is absent');

  const seenIds = new Set();
  const seenOrders = new Set();

  for (const n of nodes) {
    const id = n.id ?? '(unnamed)';
    for (const f of NODE_REQUIRED) {
      if (n[f] === undefined || n[f] === null) err(errors, 'MISSING_FIELD', id, `${f} is absent`);
    }
    if (n.kind && !KINDS.has(n.kind)) err(errors, 'BAD_KIND', id, `kind "${n.kind}" is not one of prereq/core/extension`);
    if (n.spiral) {
      for (const layer of SPIRAL_LAYERS) {
        if (!n.spiral[layer]) err(errors, 'MISSING_FIELD', id, `spiral.${layer} is absent`);
      }
    }
    if (n.id) {
      if (seenIds.has(n.id)) err(errors, 'DUPLICATE_ID', n.id, 'two nodes share this id');
      seenIds.add(n.id);
    }
    if (typeof n.order === 'number') {
      if (seenOrders.has(n.order)) err(errors, 'DUPLICATE_ORDER', id, `order ${n.order} is used twice`);
      seenOrders.add(n.order);
    }
  }

  for (const n of nodes) {
    if (n.parent && !seenIds.has(n.parent)) {
      err(errors, 'BAD_PARENT', n.id, `parent "${n.parent}" names no node`);
    }
  }
}

export function normalizeWords(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

const NGRAM = 9; // "more than eight words" means a run of nine matches

function ngrams(words, n) {
  const out = new Set();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '));
  return out;
}

export function checkQuizzes(doc, sourceText, errors) {
  const sourceGrams = ngrams(normalizeWords(sourceText), NGRAM);
  const quotesSource = (text) => {
    for (const g of ngrams(normalizeWords(text), NGRAM)) if (sourceGrams.has(g)) return true;
    return false;
  };

  for (const n of doc.nodes ?? []) {
    const q = n.quiz ?? {};
    const locators = (n.sources ?? []).map(s => s.locator).filter(Boolean);

    // Quizzes are multiple choice only. A leftover cloze would be silently dropped by the
    // renderer, so it fails loudly here instead.
    if (q.cloze) err(errors, 'CLOZE_UNSUPPORTED', n.id, 'cloze is no longer supported; rewrite it as an mcq');
    if (!Array.isArray(q.mcq) || q.mcq.length === 0) err(errors, 'NO_MCQ', n.id, 'node has no multiple-choice question');
    // Spec §7.8: the self-explanation gets feedback like every other question, and the model
    // answer is what the reader compares against when Claude cannot judge it.
    if (q.selfExplain && !String(q.selfExplainAnswer ?? '').trim()) {
      err(errors, 'NO_MODEL_ANSWER', n.id, 'selfExplain has no selfExplainAnswer');
    }

    if (locators.length === 0) {
      err(errors, 'UNGROUNDED', n.id, 'node has no source locator to ground its explanations');
    }

    for (const [i, m] of (q.mcq ?? []).entries()) {
      const where = `mcq[${i}]`;
      if (!m.explanation) err(errors, 'NO_EXPLANATION', n.id, `${where} has no explanation`);

      const opts = m.options ?? [];
      if (opts.length !== 3) err(errors, 'MCQ_OPTION_COUNT', n.id, `${where} has ${opts.length} options, expected exactly 3`);

      const correct = opts.filter(o => o.correct).length;
      if (correct !== 1) err(errors, 'MCQ_CORRECT_COUNT', n.id, `${where} has ${correct} correct options, expected exactly 1`);

      for (const [j, o] of opts.entries()) {
        if (o.correct) continue;
        const why = (o.why ?? '').trim();
        // A why must name a specific misreading, not restate that the option is wrong.
        if (normalizeWords(why).length < 6) {
          err(errors, 'MCQ_DISTRACTOR_WHY', n.id, `${where}.options[${j}] has no substantive why`);
        }
      }

      if (quotesSource(m.stem ?? '')) err(errors, 'VERBATIM', n.id, `${where} stem quotes the source verbatim`);
      for (const [j, o] of opts.entries()) {
        if (quotesSource(o.text ?? '')) err(errors, 'VERBATIM', n.id, `${where}.options[${j}] quotes the source verbatim`);
      }
    }
  }
}

export function checkGraph(doc, errors) {
  const nodes = doc.nodes ?? [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  const concepts = doc.concepts ?? {};
  const known = new Set(
    (doc.diagnostic?.results ?? []).filter(r => r.known).map(r => r.concept)
  );

  for (const n of nodes) {
    for (const c of n.assumes ?? []) {
      if (known.has(c)) continue; // reader already holds it; no node need introduce it
      const intro = concepts[c]?.introducedBy;
      if (!intro) {
        err(errors, 'ASSUMES_UNKNOWN', n.id, `assumes "${c}" but nothing introduces it and the diagnostic did not clear it`);
        continue;
      }
      const introNode = byId.get(intro);
      if (!introNode) {
        err(errors, 'ASSUMES_UNKNOWN', n.id, `assumes "${c}", introduced by missing node "${intro}"`);
      } else if (introNode.order >= n.order) {
        err(errors, 'ASSUMES_LATER', n.id, `assumes "${c}" but it is introduced later, at order ${introNode.order}`);
      }
    }

    if (n.diagram && !n.diagram.svg && !n.diagram.mermaid) {
      err(errors, 'MISSING_FIELD', n.id, 'diagram needs svg or mermaid');
    }
    if (n.diagram && !String(n.diagram.alt ?? '').trim()) {
      err(errors, 'MISSING_FIELD', n.id, 'diagram has no alt text');
    }

    // Spec §9.5: prefer the paper's own figure. Borrowed figures carry alt text for screen readers
    // and a credit naming where they came from.
    for (const [i, f] of (n.figures ?? []).entries()) {
      if (!f.src) err(errors, 'MISSING_FIELD', n.id, `figures[${i}] has no src`);
      if (!String(f.alt ?? '').trim()) err(errors, 'FIGURE_NO_ALT', n.id, `figures[${i}] has no alt text`);
      if (!String(f.credit ?? '').trim()) err(errors, 'FIGURE_NO_CREDIT', n.id, `figures[${i}] has no credit`);
    }

    if (n.kind === 'core' && !n.wrongTurn) {
      err(errors, 'NO_WRONG_TURN', n.id, 'core nodes must declare one common wrong turn');
    }
  }

  for (const o of doc.meta?.oversimplifications ?? []) {
    const d = byId.get(o.declaredIn);
    const c = byId.get(o.correctedIn);
    if (!d) err(errors, 'UNCORRECTED', o.declaredIn, `oversimplification declared in missing node "${o.declaredIn}"`);
    if (!c) err(errors, 'UNCORRECTED', o.declaredIn ?? null, `oversimplification corrected in missing node "${o.correctedIn}"`);
    if (d && c && c.order <= d.order) {
      err(errors, 'UNCORRECTED', o.declaredIn, `oversimplification is corrected at order ${c.order}, before or at its declaration (${d.order})`);
    }
  }
}

const MAX_CUES = 10;
const MAX_BLOCK_WORDS = 250;
const CONNECTIVES = ['but', 'therefore', 'so', 'because', 'however', 'yet', 'instead', 'which is why', 'unless'];

function warn(list, code, nodeId, message) { list.push({ code, nodeId, message }); }

export function checkWarnings(doc, warnings) {
  const nodes = [...(doc.nodes ?? [])].sort((a, b) => a.order - b.order);

  for (const n of nodes) {
    if (n.diagram && typeof n.diagram.cueCount === 'number' && n.diagram.cueCount > MAX_CUES) {
      warn(warnings, 'CUE_OVERLOAD', n.id, `diagram declares ${n.diagram.cueCount} cues; cap is ${MAX_CUES}`);
    }

    for (const [layer, text] of Object.entries(n.spiral ?? {})) {
      // A block is prose between blank lines. Headings, lists and code fences also break a block.
      for (const block of String(text).split(/\n\s*\n/)) {
        const words = normalizeWords(block).length;
        if (words > MAX_BLOCK_WORDS) {
          warn(warnings, 'LONG_BLOCK', n.id, `spiral.${layer} has a ${words}-word block with no break; cap is ${MAX_BLOCK_WORDS}`);
        }
      }
    }
  }

  // Rule 6.17: an intuition layer that names three or more siblings without an organising
  // axis is a taxonomy, not an intuition. Observed to leave a real reader unable to say why
  // anyone would pick one over another.
  // Phrases that signal the author named the dimension before naming the members.
  // A near-miss here is a false alarm on good writing, so the list covers plurals and
  // the ordered-progression case (L1/L2/L3, tiers, stages) as well as explicit contrast.
  const AXIS_WORDS = ['differ', 'unlike', 'whereas', 'instead of', 'each one', 'the difference',
    'varies', 'they vary', 'what distinguishes', 'the choice between', 'compared',
    'axis', 'axes', 'dimension', 'levels', 'tiers', 'stages', 'progression', 'in order',
    'removes', 'minus', 'trade-off', 'tradeoff', 'versus'];
  for (const n of nodes) {
    // Any layer can hold the taxonomy, and in the observed failure it was the concrete
    // layer, not the intuition. Check all three.
    for (const [layer, text] of Object.entries(n.spiral ?? {})) {
      const body = String(text ?? '');
      // The shape that actually failed a reader is a definitional list: bullets each
      // opening with a bolded term. Bold used for emphasis inside prose is NOT this —
      // counting it flagged ten passages in a document that reads fine, and a warning
      // that cries wolf is worse than none.
      const named = (body.match(/^\s*[-*]\s+\*\*[^*]+\*\*/gm) ?? []).length;
      if (named < 3) continue;
      const lower = body.toLowerCase();
      if (!AXIS_WORDS.some(w => lower.includes(w))) {
        warn(warnings, 'TAXONOMY_WITHOUT_AXIS', n.id,
          `spiral.${layer} defines ${named} siblings as a list with no organising axis; see authoring rule 6.17`);
      }
    }
  }

  // Blog standard: when the reader asked for images, every node carries one (a paper figure, a
  // Mermaid diagram or a drawn SVG). Advisory, since a pure-vocabulary node may not need one.
  if ((doc.meta?.images ?? 'none') !== 'none') {
    for (const n of nodes) {
      if (!n.diagram && !(n.figures ?? []).length) warn(warnings, 'NO_VISUAL', n.id, 'images are on but this node has no figure or diagram');
    }
  }

  // Three consecutive hooks with no causal connective means the spine is a list, not an explanation.
  let run = 0;
  for (const n of nodes) {
    const hook = String(n.hook ?? '').toLowerCase();
    const hasConnective = CONNECTIVES.some(c => hook.includes(c));
    run = hasConnective ? 0 : run + 1;
    if (run >= 3) {
      warn(warnings, 'AND_THEN_CHAIN', n.id, 'three consecutive hooks with no but/therefore; the spine reads as a list');
      run = 0;
    }
  }
}

export function verify(doc, sourceText) {
  const errors = [];
  const warnings = [];
  checkStructure(doc, errors);
  checkQuizzes(doc, sourceText ?? '', errors);
  checkGraph(doc, errors);
  checkWarnings(doc, warnings);
  return { errors, warnings };
}

// --- CLI ---------------------------------------------------------------
import { readFileSync as _read } from 'node:fs';
import { pathToFileURL } from 'node:url';

function formatReport({ errors, warnings }) {
  const lines = [];
  for (const e of errors)   lines.push(`  ERROR  [${e.code}] ${e.nodeId ?? '-'}: ${e.message}`);
  for (const w of warnings) lines.push(`  warn   [${w.code}] ${w.nodeId ?? '-'}: ${w.message}`);
  lines.push('');
  lines.push(`  ${errors.length} error(s), ${warnings.length} warning(s)`);
  return lines.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [docPath, ...rest] = process.argv.slice(2);
  if (!docPath) {
    console.error('usage: node assets/verify.mjs <nodes.json> [--source <file>]');
    process.exit(2);
  }
  const srcIdx = rest.indexOf('--source');
  const sourceText = srcIdx >= 0 ? _read(rest[srcIdx + 1], 'utf8') : '';
  const result = verify(JSON.parse(_read(docPath, 'utf8')), sourceText);
  console.log(formatReport(result));
  process.exit(result.errors.length > 0 ? 1 : 0);
}

export { formatReport };

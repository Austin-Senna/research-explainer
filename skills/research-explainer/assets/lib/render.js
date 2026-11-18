// Pure HTML string builders. No DOM access, no storage, no side effects.
import { buildTree } from './tree.js';
import { QUICK_PROMPTS, MODEL_TIERS } from './ask.js';
import { LEVEL_NAMES, MAX_LEVEL, TALK_PER_ROUND } from './tutor.js';

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// A deliberately tiny markdown subset. Anything else is escaped and shown as written.
function inline(escaped) {
  return escaped
    // [text](https://…): a named source at the claim it supports (rule 6.21). Only http(s) URLs
    // become links; anything else stays literal text.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
}

// Line-based so the shapes Claude actually writes render: lists straight under a sentence, nested
// lists (by indentation), numbered lists, headings, quotes, pipe tables and fenced code, as well as
// the explainer's own prose. Everything is escaped first; only this subset becomes markup.
export function renderProse(markdown) {
  const out = [];
  let para = [];
  const lists = []; // open lists, innermost last: { tag, indent, items: [{ text, sub }] }
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(escapeHtml(para.join('\n')))}</p>`);
    para = [];
  };
  const closeList = () => {
    const l = lists.pop();
    const html = `<${l.tag}>${l.items.map(i => `<li>${inline(escapeHtml(i.text))}${i.sub}</li>`).join('')}</${l.tag}>`;
    if (lists.length) lists.at(-1).items.at(-1).sub += html;
    else out.push(html);
  };
  const flushLists = () => { while (lists.length) closeList(); };
  const flushAll = () => { flushPara(); flushLists(); };

  const lines = String(markdown ?? '').replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flushAll();
      const code = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) { flushAll(); continue; }

    const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (heading) { flushAll(); out.push(`<h4>${inline(escapeHtml(heading[1]))}</h4>`); continue; }

    if (/^\s*>/.test(line)) {
      flushAll();
      const quote = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) quote.push(lines[i].replace(/^\s*>\s?/, ''));
      i--;
      out.push(`<blockquote>${renderProse(quote.join('\n'))}</blockquote>`);
      continue;
    }

    // A pipe table needs its |---| separator row, so a stray "|" in prose is left alone.
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      flushAll();
      const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(escapeHtml(c.trim())));
      const head = cells(line);
      const body = [];
      for (i += 2; i < lines.length && /^\s*\|/.test(lines[i]); i++) body.push(cells(lines[i]));
      i--;
      out.push(`<table><thead><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${
        body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }

    const item = line.match(/^(\s*)(?:([-*])|\d+[.)])\s+(.*)$/);
    if (item) {
      flushPara();
      const indent = item[1].replace(/\t/g, '    ').length;
      const tag = item[2] ? 'ul' : 'ol';
      while (lists.length && lists.at(-1).indent > indent) closeList();
      if (lists.length && lists.at(-1).indent === indent && lists.at(-1).tag !== tag) closeList();
      if (!lists.length || lists.at(-1).indent < indent) lists.push({ tag, indent, items: [] });
      lists.at(-1).items.push({ text: item[3], sub: '' });
      continue;
    }
    if (lists.length) { lists.at(-1).items.at(-1).text += ` ${line.trim()}`; continue; } // wrapped item
    para.push(line);
  }
  flushAll();
  return out.join('');
}

// A level as a five-segment meter: compact enough for the sidebar, and read out in words.
export function renderLevel(level) {
  return `<span class="lvl" data-lvl="${level}" role="img" aria-label="Level ${level} of ${MAX_LEVEL}: ${escapeHtml(LEVEL_NAMES[level])}"></span>`;
}

// `levels` is a Map of node id to tutor level, or null when the tutor is not in use: the tree then
// renders exactly as it always has.
export function renderSidebar(nodes, { currentId, passed = new Set(), levels = null } = {}) {
  const item = ({ node, children }) => {
    const classes = ['tree-item'];
    if (node.kind === 'prereq') classes.push('is-prereq');
    if (passed.has(node.id)) classes.push('is-passed');
    if (node.id === currentId) classes.push('is-current');
    const current = node.id === currentId ? ' aria-current="true"' : '';
    const kids = children.length ? `<ul class="tree-children">${children.map(item).join('')}</ul>` : '';
    const tick = passed.has(node.id) ? '<span class="tick" aria-label="passed">✓</span>' : '';
    const level = levels?.has(node.id) ? renderLevel(levels.get(node.id)) : '';
    return `<li><a href="#${escapeHtml(node.id)}" data-id="${escapeHtml(node.id)}" class="${classes.join(' ')}"${current}>${tick}<span class="label">${escapeHtml(node.title)}</span>${level}</a>${kids}</li>`;
  };
  // Top-level sections are grouped under plain headings by kind, in reading order: a new heading
  // wherever the kind changes. A reader sees what is background before reading it, with no
  // symbol to decode.
  const groups = [];
  for (const root of buildTree(nodes)) {
    const kind = root.node.kind;
    if (groups.at(-1)?.kind !== kind) groups.push({ kind, roots: [] });
    groups.at(-1).roots.push(root);
  }
  return groups.map(g => `
    <p class="tree-group">${escapeHtml(GROUP_NAMES[g.kind] ?? '')}</p>
    <ul class="tree-root">${g.roots.map(item).join('')}</ul>`).join('');
}

export const GROUP_NAMES = { prereq: 'Background', core: 'Main', extension: 'Going further' };

// A section's multiple-choice question, as quiz time shows it. Option order is preserved from the
// document; correctness is never emitted here.
export function renderMcqs(node) {
  return (node.quiz?.mcq ?? []).map((m, i) => {
    const options = (m.options ?? []).map((o, j) =>
      `<li><button class="option" data-option="${j}">${escapeHtml(o.text)}</button></li>`).join('');
    return `
      <section class="quiz-item" data-kind="mcq" data-node="${escapeHtml(node.id)}" data-mcq="${i}">
        <p class="prompt">${escapeHtml(m.stem)}</p>
        <ul class="options">${options}</ul>
        <div class="feedback" data-feedback hidden></div>
      </section>`;
  }).join('');
}

// Spec §6.7: front-load the claim. (The §10 note warning that the questions feel slower was
// dropped: the page no longer narrates the reader's experience; authoring rules §6.16.)
export function renderMasthead(meta) {
  const sources = (meta.sources ?? []).map(s =>
    `<li><a href="${escapeHtml(s.url)}">${escapeHtml(s.label)}</a></li>`).join('');
  return `
    <header class="masthead">
      <h1>${escapeHtml(meta.title ?? '')}</h1>
      <p class="claim">${escapeHtml(meta.claimSummary ?? '')}</p>
      <ul class="sources">${sources}</ul>
    </header>`;
}

// The tutor-first variant: one prediction question in place of the body. Skipping is always one
// click away and is the first thing after the answer box, so the pretest can never block reading.
export function renderPretest(question) {
  return `
    <form class="pretest" data-pretest>
      <p class="pretest-kicker">Before you read: a prediction</p>
      <p class="pretest-q" id="pretest-q">${escapeHtml(question)}</p>
      <textarea class="self-explain" rows="3" data-pretest-input aria-labelledby="pretest-q"
        placeholder="A guess is the point. Being wrong here costs nothing and is never scored."></textarea>
      <div class="pretest-actions">
        <button class="self-check is-primary" type="submit">Lock in my guess and read</button>
        <button class="self-check" type="button" data-pretest-skip>Skip to reading</button>
        <button class="link-button" type="button" data-pretest-off>Stop asking before sections</button>
      </div>
    </form>`;
}

export function renderPrediction(pretest) {
  if (!pretest?.guess) return '';
  return `
    <aside class="prediction">
      <p><strong>Your prediction:</strong> ${escapeHtml(pretest.guess)}</p>
      <div class="prediction-reply" data-prediction-reply aria-live="polite">${pretest.reply ? renderProse(pretest.reply) : ''}</div>
    </aside>`;
}

// Quiz time, after a big section: the multiple-choice questions on its central sections first
// (instant, no Claude), then, where Claude is available, a short conversation on what was missed.
// Nothing is asked of Claude until the reader starts the conversation, and skipping is one click.
export function renderCheckpoint(cp, round, { nodes = new Map(), levels = new Map(), talk = false } = {}) {
  const title = (id) => nodes.get(id)?.title ?? id;
  const answered = Object.keys(round.mcq).filter(id => cp.nodes.includes(id));
  const right = answered.filter(id => round.mcq[id]).length;
  const state = round.skipped ? 'skipped' : round.finished ? 'finished' : round.active ? 'talk' : 'mcq';
  const covers = cp.nodes.map(id => `<li>${escapeHtml(title(id))} ${renderLevel(levels.get(id) ?? 0)}</li>`).join('');
  const mcqs = cp.nodes.map(id => nodes.get(id)).filter(Boolean).map(renderMcqs).join('');
  const summary = answered.length
    ? `<p class="checkpoint-lead">Multiple choice: ${right} of ${answered.length} right.</p>` : '';
  const talkCount = Math.min(TALK_PER_ROUND, cp.nodes.length);
  const body = {
    mcq: `
      <p class="checkpoint-lead">${cp.nodes.length === 1 ? 'One question' : `${cp.nodes.length} quick questions`} on the main ideas above${talk ? `, then ${talkCount} to talk through with the tutor` : ''}. Skip it if you have it.</p>
      <div class="checkpoint-mcqs" data-cp-mcqs>${mcqs}</div>
      <div class="checkpoint-actions">
        ${talk ? `<button class="self-check" type="button" data-cp-start>Next: ${talkCount} question${talkCount === 1 ? '' : 's'} from the tutor</button>` : ''}
        <button class="link-button" type="button" data-cp-skip>Skip</button>
      </div>`,
    talk: `
      ${summary}
      <div class="thread checkpoint-thread" data-cp-thread aria-live="polite"></div>
      <div class="checkpoint-sheet" data-cp-sheet hidden></div>
      <form class="composer" data-cp-form>
        <textarea data-cp-input rows="1" placeholder="Answer the tutor…" aria-label="Answer the tutor"></textarea>
        <button type="submit" data-cp-send>Send</button>
      </form>
      <div class="checkpoint-actions" role="group" aria-label="Quiz actions">
        <button class="chip" type="button" data-cp-action="tell" title="Answer the current question directly, this once">Just tell me</button>
        <button class="chip" type="button" data-cp-action="easier">Easier</button>
        <button class="chip" type="button" data-cp-action="harder">Harder</button>
        <button class="chip" type="button" data-cp-action="map" aria-expanded="false">Progress</button>
        <button class="chip" type="button" data-cp-action="save" aria-expanded="false">Save state</button>
        <button class="link-button" type="button" data-cp-skip>Skip</button>
      </div>`,
    finished: `
      ${summary}
      <div class="thread checkpoint-thread" data-cp-thread aria-live="polite"></div>
      <p class="checkpoint-lead">Round done. A level rises after two right answers on a section, one of them without help, so levels move over rounds.</p>
      <ul class="checkpoint-covers">${covers}</ul>
      <div class="checkpoint-actions">
        ${talk ? '<button class="self-check" type="button" data-cp-start>Another round</button>' : ''}
      </div>`,
    skipped: `
      <div class="checkpoint-actions">
        <button class="link-button" type="button" data-cp-reopen>Skipped. Open quiz time</button>
      </div>`,
  }[state];
  return `
    <section class="checkpoint" data-checkpoint="${escapeHtml(cp.id)}" data-state="${state}" aria-label="Quiz time: ${escapeHtml(cp.title)}">
      <header class="checkpoint-head">
        <h3>Quiz time <span class="checkpoint-title">· ${escapeHtml(cp.title)}</span></h3>
      </header>
      ${body}
    </section>`;
}

// The full skill map, shown inside a checkpoint on demand.
export function renderSkillMap(rows, overall) {
  const items = rows.map(r => `
      <li class="map-row${r.focus ? ' is-focus' : ''}" data-depth="${Math.min(r.depth, 2)}">
        <a href="#${escapeHtml(r.id)}">${escapeHtml(r.title)}</a>
        ${renderLevel(r.level)}
        <span class="map-level">${r.level}/${MAX_LEVEL} ${escapeHtml(r.name)}${r.focus ? ' · current focus' : ''}</span>
      </li>`).join('');
  return `
    <div class="sheet-head">
      <h4>Skill map <span class="map-overall">${overall}% overall</span></h4>
      <button class="chat-icon chat-close" type="button" data-sheet-close aria-label="Close skill map">×</button>
    </div>
    <p class="sheet-note">A level rises after two right answers, one of them unprompted. A failed review lowers it.</p>
    <ul class="map">${items}</ul>`;
}

export function renderSaveState(text) {
  return `
    <div class="sheet-head">
      <h4>Save state</h4>
      <button class="chat-icon chat-close" type="button" data-sheet-close aria-label="Close save state">×</button>
    </div>
    <p class="sheet-note" data-save-status role="status">Paste this after <code>/socratic-tutor resume from:</code> in Claude Code.</p>
    <textarea class="save-block" data-save-block readonly rows="12" aria-label="Saved tutor state">${escapeHtml(text)}</textarea>
    <button class="self-check" type="button" data-save-copy>Copy to clipboard</button>`;
}

// `pretest` (a question) replaces the body with the prediction card; `prediction` keeps the
// reader's guess and the tutor's note in view; `checkpoint` is the quiz-time block that closes a
// big section. With none of them the node renders exactly as it always has.
// One drawing: Mermaid source (drawn in the page by explainer.js) or hand-drawn inline SVG.
function renderDrawing(d, { deferred = false } = {}) {
  if (d.mermaid) {
    // A hidden step is not handed to Mermaid until it is shown: Mermaid lays out a hidden element
    // at zero size.
    return `<pre class="mermaid" ${deferred ? 'data-mermaid-deferred' : 'data-mermaid'} data-alt="${escapeHtml(d.alt)}">${escapeHtml(d.mermaid)}</pre>`;
  }
  return d.svg ?? '';
}

// A diagram is one drawing, or (rule 9.9) a short series of steps where each redraws the last
// and adds one part, so the reader watches the system assemble instead of meeting it whole.
// Steps show one at a time behind Back / Next; every step stays in the DOM for print and search.
// Clamp a step move to the series. Pure, so the stepper's edges are testable.
export function stepIndex(current, delta, total) {
  return Math.min(Math.max(0, current + delta), Math.max(0, total - 1));
}

export function renderDiagram(diagram) {
  if (!diagram) return '';
  const steps = Array.isArray(diagram.steps) && diagram.steps.length ? diagram.steps : null;
  if (!steps) {
    return `
    <figure class="diagram${diagram.mermaid ? ' diagram-mermaid' : ''}">${renderDrawing(diagram)}
      <figcaption class="sr-only">${escapeHtml(diagram.alt)}</figcaption>
    </figure>`;
  }
  const panels = steps.map((st, i) => `
      <div class="diagram-step${st.mermaid ? ' diagram-mermaid' : ''}" data-step="${i}"${i ? ' hidden' : ''}>
        ${renderDrawing(st, { deferred: i > 0 })}
        <p class="step-caption">${inline(escapeHtml(st.caption ?? ''))}</p>
        <span class="sr-only">${escapeHtml(st.alt ?? '')}</span>
      </div>`).join('');
  return `
    <figure class="diagram diagram-steps" data-steps="${steps.length}">
      ${panels}
      <div class="step-controls">
        <button type="button" class="step-btn" data-step-go="-1" disabled>Back</button>
        <span class="step-count" aria-live="polite">Step 1 of ${steps.length}</span>
        <button type="button" class="step-btn" data-step-go="1">Next</button>
      </div>
      <figcaption class="sr-only">${escapeHtml(diagram.alt ?? '')}</figcaption>
    </figure>`;
}

// Rule 6.22: what the author could not verify. Small, grey and collapsed: it matters for trust,
// but it is not part of the explanation.
export function renderCaveats(caveats) {
  const text = String(caveats ?? '').trim();
  if (!text) return '';
  return `
      <details class="caveats">
        <summary>What could not be checked</summary>
        ${renderProse(text)}
      </details>`;
}

// Rule 6.21: every section says where it came from, under its subtitle, as links.
export function renderNodeSources(node) {
  const items = (node.sources ?? []).filter(s => s?.label).map(s => {
    const text = `${escapeHtml(s.label)}${s.locator ? `, ${escapeHtml(s.locator)}` : ''}`;
    return /^https?:\/\//.test(s.url ?? '') ? `<a href="${escapeHtml(s.url)}">${text}</a>` : text;
  });
  return items.length ? `<p class="node-sources">From ${items.join(' · ')}</p>` : '';
}

export function renderNode(node, { pretest = null, prediction = null, checkpoint = '' } = {}) {

  // A diagram is either hand-drawn inline SVG or Mermaid source. Mermaid ships as text and is drawn
  // in the page (explainer.js), because process diagrams are where most explainers need a picture
  // and Mermaid states them in a few lines.
  const diagram = renderDiagram(node.diagram);

  // Figures taken from a source paper, or drawn for this node. The build inlines each src as a data
  // URI, so the page stays one self-contained file. The credit line is not optional: these are
  // someone else's figures.
  const figures = (node.figures ?? []).map(f => `
    <figure class="paper-figure">
      <img src="${escapeHtml(f.src)}" alt="${escapeHtml(f.alt)}" loading="lazy">
      <figcaption>${f.caption ? `${inline(escapeHtml(f.caption))} ` : ''}<span class="credit">${
        f.url ? `<a href="${escapeHtml(f.url)}">${escapeHtml(f.credit)}</a>` : escapeHtml(f.credit)}</span></figcaption>
    </figure>`).join('');

  const wrongTurn = node.wrongTurn ? `
    <aside class="wrong-turn">
      <p class="belief">${inline(escapeHtml(node.wrongTurn.belief))}…</p>
      <p class="correction">${inline(escapeHtml(node.wrongTurn.correction))}</p>
    </aside>` : '';

  if (pretest) {
    return `
    <article class="node" id="${escapeHtml(node.id)}" data-kind="${escapeHtml(node.kind)}">
      <header>
        <h2>${escapeHtml(node.title)}</h2>
        <p class="hook">${escapeHtml(node.hook)}</p>
        ${renderNodeSources(node)}
      </header>
      ${renderPretest(pretest)}
    </article>`;
  }

  return `
    <article class="node" id="${escapeHtml(node.id)}" data-kind="${escapeHtml(node.kind)}">
      <header>
        <h2>${escapeHtml(node.title)}</h2>
        <p class="hook">${escapeHtml(node.hook)}</p>
        ${renderNodeSources(node)}
      </header>
      ${renderPrediction(prediction)}
      <div class="layer layer-intuition">${renderProse(node.spiral?.intuition)}</div>
      ${diagram}
      ${figures}
      <div class="layer layer-concrete">${renderProse(node.spiral?.concrete)}</div>
      ${node.spiral?.formal ? `
      <details class="layer layer-formal">
        <summary>Details</summary>
        ${renderProse(node.spiral.formal)}
      </details>` : ''}
      ${wrongTurn}
      ${renderCaveats(node.caveats)}
      ${checkpoint}
    </article>`;
}

// The chat lives in one side panel for the whole document, collapsed behind a tab. Both stay
// hidden until the sample capability resolves: a page opened outside a Claude viewer must never
// show an affordance that cannot work.
// With `tutor` the same panel carries two modes, each with its own thread, so switching is one
// click and loses nothing. Without it the markup is exactly the Ask-only panel.
export function renderChat({ sourceCount = 0, tier = 'default' } = {}) {
  const chips = QUICK_PROMPTS
    .map(p => `<button class="chip" type="button" data-quick="${escapeHtml(p)}">${escapeHtml(p)}</button>`)
    .join('');
  const tiers = MODEL_TIERS
    .map(t => `<option value="${t.id}"${t.id === tier ? ' selected' : ''}>${escapeHtml(t.label)}</option>`)
    .join('');
  const reach = sourceCount
    ? `Claude can search and read the ${sourceCount} source${sourceCount === 1 ? '' : 's'} this explainer was built from.`
    : 'Claude sees this section.';
  return `
    <header class="chat-head">
      <div class="chat-title">
        <h3>Ask Claude</h3>
        <p class="chat-about" data-chat-section></p>
      </div>
      <div class="chat-actions">
        <button class="chat-icon" type="button" data-chat-clear title="Clear this conversation">Clear</button>
        <button class="chat-icon chat-close" type="button" data-chat-close aria-label="Collapse chat">×</button>
      </div>
    </header>
    <div class="thread" data-thread="ask" aria-live="polite"></div>
    <div class="chat-empty" data-chat-empty>
      <p>${escapeHtml(reach)}</p>
      <div class="chips">${chips}</div>
    </div>
    <form class="composer" data-ask-form>
      <textarea data-ask-input rows="1" placeholder="Ask about this section…" aria-label="Ask about this section"></textarea>
      <button type="submit" data-ask-send>Send</button>
    </form>
    <div class="composer-foot">
      <label class="chat-model">
        Model <select data-chat-model>${tiers}</select>
      </label>
      <span>Enter to send · Shift+Tab: model</span>
    </div>`;
}

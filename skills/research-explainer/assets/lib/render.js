// Pure HTML string builders. No DOM access, no storage, no side effects.
import { buildTree } from './tree.js';
import { QUICK_PROMPTS, MODEL_TIERS } from './ask.js';

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// A deliberately tiny markdown subset. Anything else is escaped and shown as written.
function inline(escaped) {
  return escaped
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

export function renderSidebar(nodes, { currentId, passed = new Set() } = {}) {
  const item = ({ node, children }) => {
    const classes = ['tree-item'];
    if (node.kind === 'prereq') classes.push('is-prereq');
    if (passed.has(node.id)) classes.push('is-passed');
    if (node.id === currentId) classes.push('is-current');
    const current = node.id === currentId ? ' aria-current="true"' : '';
    const kids = children.length ? `<ul class="tree-children">${children.map(item).join('')}</ul>` : '';
    const mark = node.kind === 'prereq' ? '<span class="mark" aria-label="added for you">⚡</span>' : '';
    const tick = passed.has(node.id) ? '<span class="tick" aria-label="passed">✓</span>' : '';
    return `<li><a href="#${escapeHtml(node.id)}" data-id="${escapeHtml(node.id)}" class="${classes.join(' ')}"${current}>${tick}${mark}<span class="label">${escapeHtml(node.title)}</span></a>${kids}</li>`;
  };
  return `<ul class="tree-root">${buildTree(nodes).map(item).join('')}</ul>`;
}

export function renderQuiz(node) {
  const q = node.quiz ?? {};
  const parts = [];

  for (const [i, m] of (q.mcq ?? []).entries()) {
    // Option order is preserved from the document; correctness is never emitted here.
    const options = (m.options ?? []).map((o, j) =>
      `<li><button class="option" data-option="${j}">${escapeHtml(o.text)}</button></li>`).join('');
    parts.push(`
      <section class="quiz-item" data-kind="mcq" data-mcq="${i}">
        <p class="prompt">${escapeHtml(m.stem)}</p>
        <ul class="options">${options}</ul>
        <div class="feedback" data-feedback hidden></div>
      </section>`);
  }

  // Spec §7.8: the self-explanation gets feedback too. With Claude available it judges the
  // answer; without, the check reveals the author's model answer to compare against.
  if (q.selfExplain) {
    parts.push(`
      <section class="quiz-item" data-kind="self">
        <p class="prompt">${escapeHtml(q.selfExplain)}</p>
        <textarea class="self-explain" rows="3" data-self-input aria-label="Your answer"></textarea>
        <button class="self-check" type="button" data-self-check>Check my answer</button>
        <div class="feedback" data-feedback hidden></div>
      </section>`);
  }

  return parts.length ? `<div class="quiz"><h3>Check yourself</h3>${parts.join('')}</div>` : '';
}

// Spec §6.7: front-load the claim. Spec §10: the only intervention with evidence against the
// fluency illusion is telling readers in advance that the better version feels worse.
export function renderMasthead(meta) {
  const sources = (meta.sources ?? []).map(s =>
    `<li><a href="${escapeHtml(s.url)}">${escapeHtml(s.label)}</a></li>`).join('');
  return `
    <header class="masthead">
      <h1>${escapeHtml(meta.title ?? '')}</h1>
      <p class="claim">${escapeHtml(meta.claimSummary ?? '')}</p>
      <p class="honesty" data-honesty>Working the questions will feel slower and less pleasant
        than reading an answer. That feeling is not a signal that it is going worse — people
        consistently rate the version that teaches them more as the one they learned less from.</p>
      <ul class="sources">${sources}</ul>
    </header>`;
}

export function renderNode(node, { reaskOf = null } = {}) {
  const reask = reaskOf ? `
    <aside class="reask" data-reask="${escapeHtml(reaskOf.id)}">
      <p>Back to a question you missed earlier: <strong>${escapeHtml(reaskOf.title)}</strong>.</p>
      ${renderQuiz(reaskOf)}
    </aside>` : '';

  // A diagram is either hand-drawn inline SVG or Mermaid source. Mermaid ships as text and is drawn
  // in the page (explainer.js), because process diagrams are where most explainers need a picture
  // and Mermaid states them in a few lines.
  const diagram = node.diagram ? `
    <figure class="diagram${node.diagram.mermaid ? ' diagram-mermaid' : ''}">${
      node.diagram.mermaid
        ? `<pre class="mermaid" data-mermaid data-alt="${escapeHtml(node.diagram.alt)}">${escapeHtml(node.diagram.mermaid)}</pre>`
        : node.diagram.svg}
      <figcaption class="sr-only">${escapeHtml(node.diagram.alt)}</figcaption>
    </figure>` : '';

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
      <p class="belief">${escapeHtml(node.wrongTurn.belief)}…</p>
      <p class="correction">${escapeHtml(node.wrongTurn.correction)}</p>
    </aside>` : '';

  return `
    <article class="node" id="${escapeHtml(node.id)}" data-kind="${escapeHtml(node.kind)}">
      <header>
        <h2>${escapeHtml(node.title)}</h2>
        <p class="hook">${escapeHtml(node.hook)}</p>
      </header>
      ${reask}
      <div class="layer layer-intuition">${renderProse(node.spiral?.intuition)}</div>
      ${diagram}
      ${figures}
      <div class="layer layer-concrete">${renderProse(node.spiral?.concrete)}</div>
      <div class="layer layer-formal">${renderProse(node.spiral?.formal)}</div>
      ${wrongTurn}
      ${renderQuiz(node)}
    </article>`;
}

// The chat lives in one side panel for the whole document, collapsed behind a tab. Both stay
// hidden until the sample capability resolves: a page opened outside a Claude viewer must never
// show an affordance that cannot work.
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
    <div class="thread" data-thread aria-live="polite"></div>
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

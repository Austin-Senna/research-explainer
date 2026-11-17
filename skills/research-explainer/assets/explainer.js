// Thin DOM layer. Everything it decides is decided in lib/.
import { neighbors, linearOrder, ancestorsOf, isOpening } from './lib/tree.js';
import { gradeMcq, recordAnswer, scheduleReasks } from './lib/quiz.js';
import { createStore } from './lib/storage.js';
import { renderSidebar, renderNode, renderMasthead, renderChat, renderProse, renderSkillMap, renderSaveState, escapeHtml } from './lib/render.js';
import { nodeContext, buildTurns, promptBudget, essayPrompt, VERDICT_COPY, copyForError, isFatal, tierLabel, toolStatus, nextTier, appendTurns } from './lib/ask.js';
import { chunkSources, searchChunks, formatExcerpts, catalog, sourceTools } from './lib/sources.js';
import { nextReveal } from './lib/typing.js';
// One import per line: the bundler strips imports line by line.
import { tutorVariant, createTutor, levelOf, validateAssessment, applyAssessment, applyPageSignal } from './lib/tutor.js';
import { openMove, tellMove, difficultyMove, pretestMove, parseCommand, tutorTurns, gradePrompt } from './lib/tutor.js';
import { pretestQuestion, needsPretest, recordPretest, skillRows, overallPercent, levelChangeCopy, saveState } from './lib/tutor.js';

const doc = window.NODES;
if (doc) start(doc);

function start(doc) {
  const nodes = doc.nodes ?? [];
  const store = createStore(doc.meta?.slug ?? 'explainer');
  let state = store.load();
  state.answers ??= {};

  const byId = new Map(nodes.map(n => [n.id, n]));
  const first = linearOrder(nodes)[0];
  let currentId = byId.has(location.hash.slice(1)) ? location.hash.slice(1) : first?.id;

  // Source texts ship inside the page (a published page cannot fetch), chunked once for search.
  const sources = Array.isArray(window.SOURCES) ? window.SOURCES : [];
  const chunks = chunkSources(sources);

  // Ask-about-this state. These MUST be initialised before the first render(), which
  // calls revealAsk(): a `let` read from inside a function that runs before the
  // declaration is evaluated throws ReferenceError, and a throw here aborts start()
  // before the hashchange and keydown listeners below ever register — leaving a page
  // that renders correctly and navigates nowhere.
  let sampleFn = null;
  let mermaidLib = null; // loaded on first use; declared here for the same reason as sampleFn
  let toolsOk = false;
  let maxBytes = promptBudget(); // lowered to fit this view once sample.limits() answers
  // One conversation across the whole document, saved in this browser: [{role, content, section?, sources?, tier?, note?}]
  state.chat = Array.isArray(state.chat) ? state.chat : [];
  state.modelTier ??= 'default';

  // Tutor mode, chosen at build time: 'panel' (a mode the reader opens), 'first' (each section
  // opens with a prediction question) or 'off'. Like the chat it needs the sample capability, and
  // without it every variant is the plain page: nothing below shows or hides anything until
  // sampleFn is set. Declared before the first render() for the same reason as sampleFn.
  const variant = tutorVariant(window.TUTOR);
  state.tutor = createTutor(state.tutor);
  if (state.tutor.pending && !byId.has(state.tutor.pending.node)) state.tutor.pending = null;
  state.chatMode = variant !== 'off' && state.chatMode === 'tutor' ? 'tutor' : 'ask';
  let tutorApi = null;         // set once the chat is wired
  let signalsInFlight = null;  // quiz signals that arrive while a tutor reply is streaming
  const tutorOn = () => Boolean(sampleFn) && variant !== 'off';
  const isNarrow = () => matchMedia('(max-width: 720px)').matches;

  document.querySelector('.doc-title').textContent = doc.meta?.title ?? '';
  document.getElementById('masthead').innerHTML = renderMasthead(doc.meta ?? {});
  document.getElementById('chat').innerHTML = renderChat({ sourceCount: sources.length, tier: state.modelTier, tutor: variant !== 'off' });
  wireTheme();
  render();

  // The chat ships hidden and the page is complete without it. Nothing is sampled
  // here — a call happens on a click, never on load.
  if (window.claude?.use) {
    window.claude.use('sample').then(async (fn) => {
      if (!fn) return;
      sampleFn = fn;
      // Tools are only offered where this view can run them; limits() is local and free.
      const caps = await fn.limits?.().catch(() => null);
      toolsOk = Boolean(caps?.tools) && sources.length > 0;
      maxBytes = promptBudget(caps?.maxPromptBytes);
      revealAsk();
    }).catch(() => {});
  }

  function revealAsk() {
    if (!sampleFn) return;
    const toggle = document.getElementById('chat-toggle');
    if (toggle.hidden) {
      toggle.hidden = false;
      wireChat();
      setChatOpen(Boolean(state.chatOpen));
      // The tutor's inline pieces arrive with the capability. A reader already partway down the
      // first section keeps reading: the prediction question starts with the next section.
      if (variant !== 'off') render({ keepScroll: true, noGate: window.scrollY > 40 });
    }
  }

  // Figures are capped to the text column; a click shows one full size. Esc or any click closes it.
  document.getElementById('content').addEventListener('click', (e) => {
    const target = e.target.closest('.paper-figure img, .diagram svg');
    if (!target || e.target.closest('.lightbox')) return;
    const overlay = document.createElement('div');
    overlay.className = 'lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Enlarged figure');
    const panel = document.createElement('div');
    panel.className = 'lightbox-panel';
    panel.append(target.cloneNode(true));
    overlay.append(panel);
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (k) => { if (k.key === 'Escape') close(); };
    overlay.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
  });

  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (byId.has(id)) { currentId = id; render(); }
  });

  document.addEventListener('keydown', (e) => {
    // The target is not always an Element — a keydown with nothing focused targets the
    // document itself, which has no .matches(), and a throw here kills navigation silently.
    if (e.target instanceof Element && e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowRight' || e.key === 'j') go('next');
    if (e.key === 'ArrowLeft'  || e.key === 'k') go('prev');
  });

  function go(dir) {
    const target = neighbors(nodes, currentId)[dir];
    if (target) location.hash = target.id;
  }

  function passedSet() {
    return new Set(Object.entries(state.answers).filter(([, a]) => a.correct).map(([id]) => id));
  }

  function persist() { store.save(state); }

  function paintTree() {
    // Levels show once the tutor is in play: from the start in the tutor-first variant, and after
    // the reader first uses the tutor in the panel variant, which otherwise reads as it always has.
    const levels = tutorOn() && (variant === 'first' || state.tutor.started)
      ? new Map(nodes.map(n => [n.id, levelOf(state.tutor, n.id)])) : null;
    document.getElementById('tree').innerHTML = renderSidebar(nodes, { currentId, passed: passedSet(), levels });
    for (const a of ancestorsOf(nodes, currentId)) {
      document.querySelector(`[data-id="${CSS.escape(a.id)}"]`)?.classList.add('is-ancestor');
    }
    tutorApi?.refresh();
  }

  // Evidence from the page's own quiz. Counted conservatively by lib/tutor.js.
  function pageSignal(nodeId, signal) {
    if (variant === 'off') return;
    const { tutor, changes } = applyPageSignal(state.tutor, nodeId, signal);
    state.tutor = tutor;
    signalsInFlight?.push({ nodeId, signal });
    persist();
    if (changes.length) paintTree();
  }

  function render({ keepScroll = false, noGate = false } = {}) {
    const node = byId.get(currentId);
    if (!node) return;

    const schedule = scheduleReasks(state.answers, nodes);
    const reaskId = schedule.get(currentId);
    const reaskOf = reaskId && reaskId !== currentId ? byId.get(reaskId) : null;

    // Tutor-first: the section opens on one prediction question in place of its body.
    const gated = tutorOn() && variant === 'first' && !noGate && needsPretest(state.tutor, node.id);
    const question = gated ? pretestQuestion(node) : null;

    // The tree is always fully expanded: spec §10 prefers adjacent depth to hidden depth,
    // since expandable indexes tested ~50% slower. Ancestors are only highlighted.
    paintTree();
    document.getElementById('content').innerHTML = renderNode(node, {
      reaskOf,
      pretest: question,
      prediction: tutorOn() ? state.tutor.pretests[node.id] : null,
      offer: tutorOn(),
    });
    document.getElementById('masthead').hidden = !isOpening(nodes, currentId);
    if (tutorOn()) wireTutorInline(document.getElementById('content'), node, question);

    const { prev, next } = neighbors(nodes, currentId);
    wirePager('.prev', prev);
    wirePager('.next', next);

    wireQuiz(document.getElementById('content'), node);
    drawMermaid(document.getElementById('content'));
    if (reaskOf) wireQuiz(document.querySelector('.reask'), reaskOf);
    revealAsk();
    const about = document.querySelector('[data-chat-section]');
    if (about) about.textContent = node.title;

    if (!keepScroll) window.scrollTo(0, 0);
  }

  // The tutor's pieces inside the article: the prediction card, the note that keeps the reader's
  // prediction in view, and the offer at the end of the section.
  function wireTutorInline(root, node, question) {
    const reveal = (guess) => {
      state.tutor = recordPretest(state.tutor, node.id, { guess, question });
      persist();
      render({ keepScroll: true });
      const heading = document.querySelector('.node h2');
      heading?.setAttribute('tabindex', '-1');
      heading?.focus({ preventScroll: true });
      if (!state.tutor.pretests[node.id]?.guess) return;
      // The body the reader just earned stays in view: at phone width the panel would cover it,
      // so there the follow-up waits behind the note's button.
      if (!isNarrow()) tutorApi?.show({ focus: false });
      tutorApi?.step({ action: 'pretest' });
    };
    const form = root.querySelector('[data-pretest]');
    if (form) {
      form.addEventListener('submit', (e) => { e.preventDefault(); reveal(form.querySelector('[data-pretest-input]').value); });
      form.querySelector('[data-pretest-skip]').addEventListener('click', () => reveal(''));
      form.querySelector('[data-pretest-off]').addEventListener('click', () => {
        state.tutor = { ...state.tutor, pretestOff: true };
        persist();
        render({ keepScroll: true });
      });
    }
    root.querySelector('[data-open-tutor]')?.addEventListener('click', () => tutorApi?.show());
    root.querySelector('[data-tutor-offer]')?.addEventListener('click', () => {
      tutorApi?.show();
      // An open question stays open; otherwise the tutor starts on this section.
      if (state.tutor.pending?.node !== node.id) tutorApi?.step({ action: 'open' });
    });
  }

  // Mermaid loads from the CDN only when a node actually has a Mermaid diagram, and takes its colours
  // from the page's own tokens so diagrams match the theme. If it cannot load, the reader gets the
  // diagram's description instead of raw Mermaid source.
  async function drawMermaid(root) {
    const blocks = [...root.querySelectorAll('[data-mermaid]')];
    if (!blocks.length) return;
    try {
      mermaidLib ??= (await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')).default;
      const css = getComputedStyle(document.documentElement);
      const v = (name) => css.getPropertyValue(name).trim();
      mermaidLib.initialize({
        startOnLoad: false, securityLevel: 'strict', theme: 'base',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        themeVariables: {
          background: v('--bg'), fontSize: '14px',
          primaryColor: v('--accent-soft'), primaryTextColor: v('--ink'), primaryBorderColor: v('--accent'),
          secondaryColor: v('--surface'), tertiaryColor: v('--surface'), tertiaryBorderColor: v('--border'),
          lineColor: v('--ink-soft'), textColor: v('--ink'), mainBkg: v('--accent-soft'), nodeBorder: v('--accent'),
          clusterBkg: v('--surface'), clusterBorder: v('--border'), edgeLabelBackground: v('--bg'),
          noteBkgColor: v('--surface'), noteTextColor: v('--ink'), noteBorderColor: v('--border'),
        },
      });
      await mermaidLib.run({ nodes: blocks.filter(b => b.isConnected) });
    } catch {
      for (const b of blocks) {
        const p = document.createElement('p');
        p.className = 'diagram-fallback';
        p.textContent = b.dataset.alt ?? '';
        b.replaceWith(p);
      }
    }
  }

  function wirePager(sel, target) {
    const el = document.querySelector(sel);
    el.hidden = !target;
    if (target) {
      el.href = `#${target.id}`;
      el.textContent = sel === '.prev' ? `← ${target.title}` : `${target.title} →`;
    }
  }

  function wireTheme() {
    const btn = document.getElementById('theme-toggle');
    const saved = state.theme;
    if (saved) document.documentElement.dataset.theme = saved;
    btn.addEventListener('click', () => {
      const root = document.documentElement;
      const isDark = root.dataset.theme
        ? root.dataset.theme === 'dark'
        : matchMedia('(prefers-color-scheme: dark)').matches;
      root.dataset.theme = isDark ? 'light' : 'dark';
      state.theme = root.dataset.theme;
      persist();
      render(); // Mermaid bakes colours in when it draws, so redraw in the new theme
    });
  }

  function record(nodeId, index, correct) {
    state.answers[nodeId] = recordAnswer(state.answers[nodeId], index, correct);
    persist();
    paintTree();
    pageSignal(nodeId, { type: 'mcq', index, correct, total: byId.get(nodeId)?.quiz?.mcq?.length ?? 0 });
  }

  // Questions whose nearest quiz owner is `root`. A re-ask box sits inside #content, so a plain
  // querySelectorAll from #content would also wire the re-asked node's questions to this node:
  // its handler fires first, grades the click against the wrong question, and records it under
  // the wrong node.
  function owned(root, selector) {
    return [...root.querySelectorAll(selector)].filter(el => el.closest('.reask, #content') === root);
  }

  function wireQuiz(root, node) {
    if (!root) return;

    for (const section of owned(root, '[data-kind="mcq"]')) {
      const mcq = node.quiz.mcq[Number(section.dataset.mcq)];
      section.querySelectorAll('[data-option]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (section.dataset.answered) return;
          section.dataset.answered = 'true';
          const chosen = Number(btn.dataset.option);
          const result = gradeMcq(mcq, chosen);

          section.querySelectorAll('[data-option]').forEach((b, j) => {
            b.classList.toggle('is-correct', j === result.correctIndex);
            b.classList.toggle('is-wrong', j === chosen && !result.correct);
          });

          // Spec §7.1: the explanation always shows, immediately, right or wrong.
          showFeedback(section, result.correct, mcq.explanation, result.correct ? '' : result.why);
          record(node.id, Number(section.dataset.mcq), result.correct);
        });
      });
    }

    for (const section of owned(root, '[data-kind="self"]')) wireSelfExplain(section, node);
  }

  // Spec §7.8: every question gets feedback, the self-explanation included. Claude judges the
  // answer when it can; the author's model answer is shown either way, so a page opened outside
  // a Claude viewer still gives the reader something to check against.
  function wireSelfExplain(section, node) {
    const input = section.querySelector('[data-self-input]');
    const btn = section.querySelector('[data-self-check]');
    const box = section.querySelector('[data-feedback]');
    const model = node.quiz?.selfExplainAnswer ?? '';
    const modelHtml = model ? `<p class="model-answer"><strong>Model answer:</strong> ${escapeHtml(model)}</p>` : '';

    btn.addEventListener('click', async () => {
      const answer = input.value.trim();
      box.hidden = false;
      if (!answer) {
        box.innerHTML = '<p>Write your answer first, then check it.</p>';
        return;
      }
      if (!sampleFn) {
        box.innerHTML = `<p>Compare yours with the author's.</p>${modelHtml}`;
        return;
      }
      btn.disabled = true;
      box.innerHTML = '<p>Checking…</p>';
      try {
        const r = await sampleFn.json(essayPrompt(doc.meta, node, answer));
        const verdict = VERDICT_COPY[r?.verdict] ?? '';
        pageSignal(node.id, { type: 'self', verdict: r?.verdict });
        box.innerHTML = (verdict ? `<p><strong>${escapeHtml(verdict)}</strong></p>` : '')
          + `<p>${escapeHtml(String(r?.feedback ?? ''))}</p>${modelHtml}`;
      } catch (e) {
        const copy = e?.code === 'invalid_json' ? 'Claude could not grade that one.' : copyForError(e?.code);
        box.innerHTML = (copy ? `<p>${escapeHtml(copy)}</p>` : '') + modelHtml;
        if (isFatal(e?.code)) sampleFn = null;
      } finally {
        btn.disabled = false;
      }
    });
  }

  function setChatOpen(open, { focus = true } = {}) {
    const chat = document.getElementById('chat');
    const toggle = document.getElementById('chat-toggle');
    chat.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('chat-open', open);
    state.chatOpen = open;
    persist();
    // preventScroll: focusing inside the sticky panel would otherwise scroll the page, like scrollIntoView.
    if (open && focus) chat.querySelector('[data-ask-input]')?.focus({ preventScroll: true });
  }

  // Each mode has its own message list, so a switch hides one and shows the other and an answer
  // still arriving keeps writing into the list it belongs to.
  function threadEl(mode = state.chatMode) { return document.querySelector(`[data-thread="${mode}"]`); }
  function emptyEl(mode) { return document.querySelector(mode === 'tutor' ? '[data-tutor-empty]' : '[data-chat-empty]'); }
  function threadOf(mode) { return mode === 'tutor' ? state.tutor.thread : state.chat; }

  // Scroll the message list, never the page. scrollIntoView() scrolls every scrollable ancestor,
  // and because the panel is sticky that dragged the whole page back up on every message. Only
  // follow new text when the reader is already at the bottom, so reading back is not yanked away.
  function nearBottom(el) { return el.scrollHeight - el.scrollTop - el.clientHeight < 48; }
  function follow(el, wasNear) { if (wasNear) el.scrollTop = el.scrollHeight; }

  const lastSection = { ask: null, tutor: null }; // the section of the most recent question shown, for dividers

  function addTurn(entry, mode = 'ask', { before = null } = {}) {
    const thread = threadEl(mode);
    if (!thread) return null;
    const wasNear = nearBottom(thread);
    // A divider wherever the reader asked from a different section than the question before.
    if (entry.role === 'user' && entry.section && entry.section !== lastSection[mode]) {
      const divider = document.createElement('p');
      divider.className = 'turn-section';
      divider.textContent = byId.get(entry.section)?.title ?? '';
      thread.append(divider);
      lastSection[mode] = entry.section;
    }
    const el = document.createElement('div');
    const kind = { user: 'q', assistant: 'a', note: 'note' }[entry.role] ?? 'err';
    el.className = `turn ${kind}`;
    if (entry.role === 'assistant') {
      el.innerHTML = '<div class="turn-status" data-status hidden>'
        + '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>'
        + '<span data-status-text></span></div><div class="turn-body" data-body></div>'
        + '<p class="turn-meta" data-meta hidden></p>';
      el.querySelector('[data-body]').innerHTML = renderProse(entry.content ?? '');
      setMeta(el, entry);
    } else if (entry.role === 'user') {
      // The reader's own message gets the same formatting, so bullets they type show as bullets.
      el.innerHTML = `<div class="turn-body">${renderProse(entry.content)}</div>`;
    } else {
      el.textContent = entry.content;
    }
    if (before) before.before(el); else thread.append(el);
    emptyEl(mode).hidden = true;
    follow(thread, wasNear || entry.role === 'user');
    return el;
  }

  function setStatus(el, text) {
    const status = el.querySelector('[data-status]');
    status.hidden = !text;
    if (text) el.querySelector('[data-status-text]').textContent = text;
  }

  function setMeta(el, { sources: used = [], tier, note } = {}) {
    const meta = el.querySelector('[data-meta]');
    const parts = [];
    if (used.length) parts.push(`Sources: ${used.join(' · ')}`);
    if (note) parts.push(note);
    else if (tier) parts.push(tierLabel(tier));
    meta.textContent = parts.join('  —  ');
    meta.hidden = !parts.length;
  }

  function restoreThread(mode = 'ask') {
    const thread = threadEl(mode);
    if (!thread) return;
    thread.innerHTML = '';
    lastSection[mode] = null;
    for (const t of threadOf(mode)) addTurn(t, mode);
    emptyEl(mode).hidden = mode !== state.chatMode || threadOf(mode).length > 0;
    thread.scrollTop = thread.scrollHeight;
  }

  // Streams arrive in chunks a few times a second; showing each chunk as it lands reads as lurching
  // jumps. Instead keep a target, and reveal it word by word each animation frame (lib/typing.js).
  // Reduced-motion readers get the text as it arrives.
  function typewriter(body, thread) {
    const instant = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let target = '';
    let shown = 0;
    let last = 0;
    let frame = 0;
    let settle = null;
    const paint = () => {
      const wasNear = nearBottom(thread);
      body.innerHTML = renderProse(target.slice(0, shown));
      follow(thread, wasNear);
    };
    const tick = (now) => {
      shown = nextReveal(shown, target, last ? Math.min(now - last, 100) : 16);
      last = now;
      paint();
      if (shown < target.length) frame = requestAnimationFrame(tick);
      else { frame = 0; last = 0; settle?.(); settle = null; }
    };
    return {
      set(text) {
        target = text;
        if (instant) { shown = text.length; paint(); return; }
        if (!frame && shown < target.length) frame = requestAnimationFrame(tick);
      },
      // Resolves once everything received is on screen, so the sources line lands after the text.
      done() { return shown >= target.length ? Promise.resolve() : new Promise(r => { settle = r; }); },
      stop() { cancelAnimationFrame(frame); frame = 0; shown = target.length; paint(); settle?.(); settle = null; },
    };
  }

  function wireChat() {
    const panel = document.getElementById('chat');
    const toggle = document.getElementById('chat-toggle');
    const form  = panel.querySelector('[data-ask-form]');
    const input = panel.querySelector('[data-ask-input]');
    const send  = panel.querySelector('[data-ask-send]');
    const model = panel.querySelector('[data-chat-model]');
    let controller = null;
    let activeTyping = null; // the answer still being revealed, so Stop can finish it at once

    restoreThread('ask');
    toggle.addEventListener('click', () => setChatOpen(panel.hidden));
    panel.querySelector('[data-chat-close]').addEventListener('click', () => setChatOpen(false));
    panel.querySelector('[data-chat-clear]').addEventListener('click', () => {
      controller?.abort();
      // Clearing the tutor's conversation drops the open question, never the levels earned.
      if (state.chatMode === 'tutor') state.tutor = { ...state.tutor, thread: [], pending: null };
      else state.chat = [];
      persist();
      restoreThread(state.chatMode);
    });
    model.addEventListener('change', () => { state.modelTier = model.value; persist(); });
    for (const chip of panel.querySelectorAll('[data-quick]')) {
      chip.addEventListener('click', () => ask(chip.dataset.quick));
    }

    // Grows with the text (upwards, since the composer is pinned to the bottom) until 40% of the
    // screen, then scrolls; the latest line always stays in view.
    const grow = () => {
      const max = Math.round(window.innerHeight * 0.4);
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, max)}px`;
      input.style.overflowY = input.scrollHeight > max ? 'auto' : 'hidden';
    };
    input.addEventListener('input', grow);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault(); // cycles the model instead of moving focus backwards
        model.value = nextTier(model.value);
        model.dispatchEvent(new Event('change'));
      }
    });
    // One button: Send when idle, Stop while an answer is coming.
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (controller) { controller.abort(); activeTyping?.stop(); return; }
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      grow();
      if (state.chatMode === 'tutor') tutorStep({ text: q });
      else ask(q);
    });

    function busy(on) {
      send.textContent = on ? 'Stop' : 'Send';
      send.classList.toggle('is-stop', on);
    }

    // One exchange in either mode: show the reader's message, stream Claude's reply into the
    // mode's own thread, and keep both only once the reply has fully arrived. `plan` builds the
    // turn list (the tutor grades the answer there first) and says how to commit the result.
    async function exchange(mode, asked, plan) {
      if (!sampleFn || controller) return;
      addTurn(asked, mode);
      const answerEl = addTurn({ role: 'assistant', content: '' }, mode);
      const body = answerEl.querySelector('[data-body]');
      setStatus(answerEl, 'Thinking');

      const tier = state.modelTier;
      controller = new AbortController(); // a fresh controller per exchange
      const signal = controller.signal;
      busy(true);
      const typing = typewriter(body, threadEl(mode));
      activeTyping = typing;
      try {
        const { turns, used, commit } = await plan({ signal, tier, answerEl, status: (text) => setStatus(answerEl, text) });
        const options = {
          signal,
          cache: false, // a conversation must not replay a stale answer
          modelTier: tier,
          onText: ({ text }) => {
            setStatus(answerEl, '');
            typing.set(text); // whole answer so far; the typewriter reveals it smoothly
          },
        };
        if (toolsOk) {
          // Each tool reports what it is doing, so a long multi-round answer never looks frozen.
          options.tools = sourceTools(sources, chunks).map(tool => ({
            ...tool,
            execute: async (args, ctx) => {
              setStatus(answerEl, toolStatus(tool.name, args, sources));
              const result = await tool.execute(args, ctx);
              for (const r of [].concat(result)) if (r?.label) used.add(r.label);
              setStatus(answerEl, 'Thinking');
              return result;
            },
          }));
        }
        const { text, truncated, modelTierApplied } = await sampleFn(turns, options);
        typing.set(text);
        await typing.done();
        const notes = [];
        if (modelTierApplied && modelTierApplied !== tier) {
          notes.push(`Answered by ${tierLabel(modelTierApplied)}; ${tierLabel(tier)} is not available on this plan`);
        }
        if (truncated) notes.push('Cut short: ask for less at a time');
        const entry = { role: 'assistant', content: text, sources: [...used], tier: modelTierApplied ?? tier,
                        note: notes.join('. ') || undefined };
        setMeta(answerEl, entry);
        commit(entry);
        persist();
      } catch (e) {
        setStatus(answerEl, '');
        if (e?.text) {
          typing.set(e.text);
          typing.stop(); // show what may be kept at once; a stopped answer should not keep typing
        } else {
          typing.stop();
          answerEl.remove();
        }
        if (e?.code === 'tools_unavailable') toolsOk = false;
        const copy = copyForError(e?.code);
        if (copy) addTurn({ role: 'error', content: copy }, mode);
        // A permanent refusal means this view can never sample. Hide it rather than
        // leaving a control that will fail every time; the tutor's inline pieces go with it.
        if (isFatal(e?.code)) {
          sampleFn = null;
          setChatOpen(false);
          toggle.hidden = true;
          render({ keepScroll: true });
        }
      } finally {
        controller = null;
        activeTyping = null;
        busy(false);
      }
    }

    function ask(question) {
      const nodeId = currentId;
      const node = byId.get(nodeId);
      if (!node) return;
      const history = state.chat.filter(t => t.role === 'user' || t.role === 'assistant');
      const asked = { role: 'user', content: question, section: nodeId };
      return exchange('ask', asked, async () => {
        // Retrieval happens here, not in Claude: the passages most relevant to this question go
        // into the prompt every time, so answers are grounded even where tools are unavailable.
        // The question alone searches best; a content-free prompt ("Explain this more simply")
        // falls back to the section title so it still gets relevant passages.
        let hits = searchChunks(chunks, question, 4);
        if (!hits.length) hits = searchChunks(chunks, `${question} ${node.title}`, 4);
        const turns = buildTurns(nodeContext(doc.meta, node), history, question, {
          catalog: catalog(sources),
          excerpts: formatExcerpts(hits),
          maxBytes,
        });
        return {
          turns,
          used: new Set(hits.map(h => h.label)),
          commit: (entry) => { state.chat = appendTurns(state.chat, asked, entry); },
        };
      });
    }

    if (variant === 'off') return;

    // ---- Tutor mode. Everything it decides is decided in lib/tutor.js. ----
    const sheet = panel.querySelector('[data-tutor-sheet]');
    const bar = panel.querySelector('[data-tutor-bar]');
    const drafts = { ask: '', tutor: '' };
    let sheetKind = null;
    const order = linearOrder(nodes).map(n => n.id);

    restoreThread('tutor');
    for (const btn of panel.querySelectorAll('[data-mode]')) {
      btn.addEventListener('click', () => setMode(btn.dataset.mode));
    }
    panel.querySelector('[data-tutor-start]').addEventListener('click', () => tutorStep({ action: 'open' }));
    for (const btn of bar.querySelectorAll('[data-tutor-action]')) {
      btn.addEventListener('click', () => {
        const action = btn.dataset.tutorAction;
        if (action === 'map' || action === 'save') toggleSheet(action);
        else tutorStep({ action });
      });
    }
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetKind) closeSheet(); });

    function setMode(mode) {
      if (mode !== state.chatMode) {
        drafts[state.chatMode] = input.value;
        state.chatMode = mode;
        input.value = drafts[mode];
        grow();
        persist();
      }
      const tutoring = mode === 'tutor';
      closeSheet();
      for (const btn of panel.querySelectorAll('[data-mode]')) {
        btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
      }
      for (const m of ['ask', 'tutor']) {
        threadEl(m).hidden = m !== mode;
        emptyEl(m).hidden = m !== mode || threadOf(m).length > 0 || threadEl(m).childElementCount > 0;
      }
      bar.hidden = !tutoring;
      const hint = tutoring ? 'Answer the tutor…' : 'Ask about this section…';
      input.placeholder = hint;
      input.setAttribute('aria-label', hint.replace('…', ''));
      const thread = threadEl(mode);
      thread.scrollTop = thread.scrollHeight;
    }

    // The skill map and the save-state block share one sheet that takes the thread's place.
    function toggleSheet(kind) { if (sheetKind === kind) closeSheet(); else openSheet(kind); }

    function paintSheet() {
      if (sheetKind === 'map') {
        sheet.innerHTML = renderSkillMap(skillRows(state.tutor, nodes, currentId), overallPercent(state.tutor, nodes));
        for (const link of sheet.querySelectorAll('.map a')) {
          // At phone width the panel covers the page, so following a link has to put it away.
          link.addEventListener('click', () => { if (isNarrow()) setChatOpen(false); });
        }
      } else if (sheetKind === 'save') {
        sheet.innerHTML = renderSaveState(saveState(doc.meta, nodes, state.tutor, currentId));
        sheet.querySelector('[data-save-copy]').addEventListener('click', copySaved);
      }
      sheet.querySelector('[data-sheet-close]')?.addEventListener('click', closeSheet);
    }

    function openSheet(kind) {
      sheetKind = kind;
      paintSheet();
      sheet.hidden = false;
      threadEl('tutor').hidden = true;
      emptyEl('tutor').hidden = true;
      for (const btn of bar.querySelectorAll('[aria-expanded]')) {
        btn.setAttribute('aria-expanded', String(btn.dataset.tutorAction === kind));
      }
      if (kind === 'save') copySaved();
      sheet.querySelector('[data-sheet-close]').focus({ preventScroll: true });
    }

    function closeSheet() {
      if (!sheetKind) return;
      const opener = bar.querySelector(`[data-tutor-action="${sheetKind}"]`);
      sheetKind = null;
      sheet.hidden = true;
      sheet.innerHTML = '';
      for (const btn of bar.querySelectorAll('[aria-expanded]')) btn.setAttribute('aria-expanded', 'false');
      if (state.chatMode === 'tutor') {
        threadEl('tutor').hidden = false;
        emptyEl('tutor').hidden = state.tutor.thread.length > 0 || threadEl('tutor').childElementCount > 0;
        opener?.focus({ preventScroll: true });
      }
    }

    async function copySaved() {
      const block = sheet.querySelector('[data-save-block]');
      const status = sheet.querySelector('[data-save-status]');
      if (!block) return;
      try {
        await navigator.clipboard.writeText(block.value);
        status.textContent = 'Copied. Paste it after /socratic-tutor resume from: in Claude Code.';
      } catch {
        block.select();
        status.textContent = 'The clipboard is not available here. The text is selected: copy it by hand.';
      }
    }

    function tutorStep({ action = 'answer', text = '' } = {}) {
      if (!sampleFn || controller) return;
      const focus = currentId;
      if (!byId.has(focus)) return;
      if (action === 'answer') {
        const command = parseCommand(text);
        if (command === 'progress') return openSheet('map');
        if (command === 'save') return openSheet('save');
        if (command) action = command;
      }
      const before = state.tutor;
      if (action === 'tell' && !before.pending) action = 'open';
      const pretest = action === 'pretest' ? before.pretests[focus] : null;
      const said = pretest ? `My prediction: ${pretest.guess}`
        : { open: 'Quiz me on this section.', tell: 'Just tell me.', harder: 'Harder.', easier: 'Easier.' }[action] ?? text;
      const asked = { role: 'user', content: said, section: focus };
      const lastQuestion = before.thread.findLast(t => t.role === 'assistant')?.content ?? '';
      closeSheet();
      signalsInFlight = [];

      return exchange('tutor', asked, async ({ signal, tier, answerEl, status }) => {
        let step;
        if (action === 'answer') {
          // The answer is graded first, into JSON, and the transition function decides what that
          // grade means. Claude then only words the move it is handed.
          let raw = null;
          if (before.pending) {
            status('Checking your answer');
            try {
              raw = await sampleFn.json(
                gradePrompt(doc.meta, byId.get(before.pending.node), lastQuestion, text, before.pending.kind),
                { signal, modelTier: tier, cache: false });
            } catch (e) {
              if (e?.code !== 'invalid_json') throw e; // an unreadable grade is no grade
            }
            status('Thinking');
          }
          step = applyAssessment(before, validateAssessment(raw), { focus, order });
        } else if (action === 'tell') step = tellMove(before, focus);
        else if (action === 'harder' || action === 'easier') step = difficultyMove(before, action === 'harder' ? 1 : -1, focus);
        else if (action === 'pretest') step = pretestMove(before, focus);
        else step = openMove(before, focus);

        const target = byId.get(step.move.node);
        const hits = searchChunks(chunks, `${target.title} ${action === 'answer' ? text : ''}`, 3);
        const turns = tutorTurns(doc.meta, target, before.thread, said, step.move, {
          catalog: catalog(sources),
          excerpts: formatExcerpts(hits),
          difficulty: step.tutor.difficulty,
          answered: before.pending ? byId.get(before.pending.node) : null,
          guess: pretest?.guess,
          question: pretest?.question,
          maxBytes,
        });
        return {
          turns,
          // Only sources the tutor actually opened are listed under its message: a line of
          // retrieved labels under every question would be something after the question.
          used: new Set(),
          commit: (entry) => {
            // Quiz clicks and pretests that landed while the reply was streaming changed the live
            // state, not the copy this step was computed from. Carry them over.
            let next = step.tutor;
            for (const s of signalsInFlight ?? []) next = applyPageSignal(next, s.nodeId, s.signal).tutor;
            next = { ...next, pretests: { ...next.pretests, ...state.tutor.pretests }, pretestOff: state.tutor.pretestOff };
            const notes = step.changes.map(c => ({ role: 'note', content: levelChangeCopy(c, byId.get(c.node)?.title ?? c.node) }));
            for (const n of notes) addTurn(n, 'tutor', { before: answerEl });
            state.tutor = { ...next, thread: appendTurns(before.thread, asked, ...notes, entry) };
            paintTree();
          },
        };
      }).finally(() => { signalsInFlight = null; });
    }

    tutorApi = {
      step: tutorStep,
      // Open the panel on the tutor without moving keyboard focus out of the page.
      show({ focus = true } = {}) { setChatOpen(true, { focus }); setMode('tutor'); },
      refresh() { if (sheetKind) paintSheet(); },
    };
    setMode(state.chatMode);
  }

  function showFeedback(section, correct, explanation, why) {
    const box = section.querySelector('[data-feedback]');
    const verdict = correct ? 'Right.' : 'Not quite.';
    box.innerHTML =
      `<p><strong>${verdict}</strong></p>` +
      (why ? `<p>${escapeHtml(why)}</p>` : '') +
      `<p>${escapeHtml(explanation)}</p>`;
    box.hidden = false;
  }
}

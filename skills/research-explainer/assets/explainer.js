// Thin DOM layer. Everything it decides is decided in lib/.
import { neighbors, linearOrder, ancestorsOf, isOpening } from './lib/tree.js';
import { gradeMcq, recordAnswer } from './lib/quiz.js';
import { createStore } from './lib/storage.js';
import { renderSidebar, renderNode, renderMasthead, renderChat, renderProse, renderSkillMap, renderSaveState, renderCheckpoint, escapeHtml, stepIndex } from './lib/render.js';
import { nodeContext, buildTurns, promptBudget, copyForError, isFatal, tierLabel, toolStatus, nextTier, appendTurns } from './lib/ask.js';
import { chunkSources, searchChunks, formatExcerpts, catalog, sourceTools } from './lib/sources.js';
import { nextReveal } from './lib/typing.js';
// One import per line: the bundler strips imports line by line.
import { tutorVariant, createTutor, levelOf, validateAssessment, applyPageSignal } from './lib/tutor.js';
import { tellMove, difficultyMove, pretestMove, parseCommand, tutorTurns, gradePrompt } from './lib/tutor.js';
import { pretestQuestion, needsPretest, recordPretest, skillRows, overallPercent, levelChangeCopy, saveState } from './lib/tutor.js';
import { trackedNodes, placement, placeTutor, diagnosticLine, weakestAreas } from './lib/tutor.js';
import { checkpointsFor, createRound, startRound, applyRound, recordRoundMcq } from './lib/tutor.js';

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
  // The skill map is the core nodes; the Phase 3 diagnostic sets where it starts, once.
  const tracked = trackedNodes(nodes);
  state.tutor = placeTutor(createTutor(state.tutor), placement(doc));
  if (state.tutor.pending && !byId.has(state.tutor.pending.node)) state.tutor.pending = null;
  // Quiz time: the tutor runs inline after each big section (lib/tutor.js checkpointsFor), one
  // round of questions per checkpoint, each round kept in this browser.
  const checkpoints = checkpointsFor(nodes);
  const cpByAnchor = new Map(checkpoints.map(c => [c.anchor, c]));
  const cpOfNode = new Map(checkpoints.flatMap(c => c.nodes.map(id => [id, c])));
  state.rounds = state.rounds && typeof state.rounds === 'object' ? state.rounds : {};
  delete state.chatMode; // the panel is Ask only
  let signalsInFlight = null;  // quiz signals that arrive while a tutor reply is streaming
  const order = tracked.map(n => n.id); // what reviews and the final assessment draw on
  // One conversation at a time across the page: the Ask panel and every quiz-time block share it.
  let controller = null;
  let activeTyping = null; // the answer still being revealed, so Stop can finish it at once
  const lastSection = new WeakMap(); // per thread: the section of the most recent question, for dividers
  const tutorOn = () => Boolean(sampleFn) && variant !== 'off';

  document.querySelector('.doc-title').textContent = doc.meta?.title ?? '';
  document.getElementById('masthead').innerHTML = renderMasthead(doc.meta ?? {});
  document.getElementById('chat').innerHTML = renderChat({ sourceCount: sources.length, tier: state.modelTier });
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

  // Step-by-step diagrams (rule 9.9): Back / Next show one step at a time. A step's Mermaid is
  // drawn the first time it is shown, since Mermaid cannot lay out a hidden element.
  document.getElementById('content').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-step-go]');
    if (!btn) return;
    const fig = btn.closest('.diagram-steps');
    const panels = [...fig.querySelectorAll('.diagram-step')];
    const current = panels.findIndex(p => !p.hidden);
    const next = stepIndex(current, Number(btn.dataset.stepGo), panels.length);
    panels.forEach((p, i) => { p.hidden = i !== next; });
    for (const pre of panels[next].querySelectorAll('[data-mermaid-deferred]')) {
      pre.removeAttribute('data-mermaid-deferred');
      pre.setAttribute('data-mermaid', '');
    }
    drawMermaid(panels[next]);
    fig.querySelector('[data-step-go="-1"]').disabled = next === 0;
    fig.querySelector('[data-step-go="1"]').disabled = next === panels.length - 1;
    fig.querySelector('.step-count').textContent = `Step ${next + 1} of ${panels.length}`;
  });

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
    // Levels show on the tracked sections whenever the tutor is available.
    const levels = tutorOn() ? levelMap() : null;
    document.getElementById('tree').innerHTML = renderSidebar(nodes, { currentId, passed: passedSet(), levels });
    for (const a of ancestorsOf(nodes, currentId)) {
      document.querySelector(`[data-id="${CSS.escape(a.id)}"]`)?.classList.add('is-ancestor');
    }
  }

  function levelMap() { return new Map(tracked.map(n => [n.id, levelOf(state.tutor, n.id)])); }
  function roundOf(cp) { return createRound(state.rounds[cp.id]); }
  function checkpointHtml(cp) {
    return renderCheckpoint(cp, roundOf(cp), { nodes: byId, levels: levelMap(), talk: tutorOn() });
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

    // Tutor-first: the section opens on one prediction question in place of its body.
    const gated = tutorOn() && variant === 'first' && !noGate && needsPretest(state.tutor, node);
    const question = gated ? pretestQuestion(node) : null;

    // The tree is always fully expanded: spec §10 prefers adjacent depth to hidden depth,
    // since expandable indexes tested ~50% slower. Ancestors are only highlighted.
    paintTree();
    // Quiz time shows in every variant: its multiple choice needs no Claude.
    const cp = cpByAnchor.get(node.id) ?? null;
    document.getElementById('content').innerHTML = renderNode(node, {
      pretest: question,
      prediction: tutorOn() ? state.tutor.pretests[node.id] : null,
      checkpoint: cp ? checkpointHtml(cp) : '',
    });
    document.getElementById('masthead').hidden = !isOpening(nodes, currentId);
    if (tutorOn()) wireTutorInline(document.getElementById('content'), node, question);
    if (cp) wireCheckpoint(cp);

    const { prev, next } = neighbors(nodes, currentId);
    wirePager('.prev', prev);
    wirePager('.next', next);

    drawMermaid(document.getElementById('content'));
    revealAsk();
    const about = document.querySelector('[data-chat-section]');
    if (about) about.textContent = node.title;

    if (!keepScroll) window.scrollTo(0, 0);
  }

  // The prediction card, and the note that keeps the reader's guess in view with the tutor's
  // short reply under it. The reply is a statement, not a question: questioning happens at quiz time.
  function wireTutorInline(root, node, question) {
    const reveal = (guess) => {
      state.tutor = recordPretest(state.tutor, node.id, { guess, question });
      persist();
      render({ keepScroll: true });
      const heading = document.querySelector('.node h2');
      heading?.setAttribute('tabindex', '-1');
      heading?.focus({ preventScroll: true });
      if (state.tutor.pretests[node.id]?.guess) predictionReply(node);
    };
    const form = root.querySelector('[data-pretest]');
    if (!form) return;
    form.addEventListener('submit', (e) => { e.preventDefault(); reveal(form.querySelector('[data-pretest-input]').value); });
    form.querySelector('[data-pretest-skip]').addEventListener('click', () => reveal(''));
    form.querySelector('[data-pretest-off]').addEventListener('click', () => {
      state.tutor = { ...state.tutor, pretestOff: true };
      persist();
      render({ keepScroll: true });
    });
  }

  function predictionReply(node) {
    const box = document.querySelector('[data-prediction-reply]');
    if (!box) return;
    const pretest = state.tutor.pretests[node.id];
    const surface = { thread: box, quiet: true };
    const step = pretestMove(state.tutor, node.id);
    return exchange(surface, null, async () => ({
      turns: tutorTurns(doc.meta, node, [], `My prediction: ${pretest.guess}`, step.move, {
        guess: pretest.guess, question: pretest.question, diagnostic: diagnosticLine(doc), maxBytes,
      }),
      used: new Set(),
      commit: (entry) => {
        // recordPretest already marked the section as just told; only the reply is new.
        state.tutor = { ...state.tutor, pretests: { ...state.tutor.pretests, [node.id]: { ...pretest, reply: entry.content } } };
      },
    }));
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
    const cp = cpOfNode.get(nodeId);
    if (cp) state.rounds[cp.id] = recordRoundMcq(roundOf(cp), nodeId, correct);
    persist();
    paintTree();
    pageSignal(nodeId, { type: 'mcq', index, correct, total: byId.get(nodeId)?.quiz?.mcq?.length ?? 0 });
  }

  // Quiz time's multiple-choice questions: each graded on the first click, with the explanation
  // shown at once, right or wrong (spec §7.1).
  function wireQuiz(root) {
    for (const section of root.querySelectorAll('[data-kind="mcq"]')) {
      const node = byId.get(section.dataset.node);
      const mcq = node?.quiz?.mcq?.[Number(section.dataset.mcq)];
      if (!mcq) continue;
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
          showFeedback(section, result.correct, mcq.explanation, result.correct ? '' : result.why);
          record(node.id, Number(section.dataset.mcq), result.correct);
        });
      });
    }
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

  // A surface is where one conversation shows: the Ask panel, a checkpoint's quiz-time block, or
  // the note under a prediction. { thread, empty?, dividers?, busy?(on) }

  // Scroll the message list, never the page. scrollIntoView() scrolls every scrollable ancestor,
  // and because the panel is sticky that dragged the whole page back up on every message. Only
  // follow new text when the reader is already at the bottom, so reading back is not yanked away.
  function nearBottom(el) { return el.scrollHeight - el.scrollTop - el.clientHeight < 48; }
  function follow(el, wasNear) { if (wasNear) el.scrollTop = el.scrollHeight; }

  function addTurn(entry, surface, { before = null } = {}) {
    const thread = surface.thread;
    if (!thread) return null;
    const wasNear = nearBottom(thread);
    // A divider wherever the reader asked from a different section than the question before.
    if (surface.dividers && entry.role === 'user' && entry.section && entry.section !== lastSection.get(thread)) {
      const divider = document.createElement('p');
      divider.className = 'turn-section';
      divider.textContent = byId.get(entry.section)?.title ?? '';
      thread.append(divider);
      lastSection.set(thread, entry.section);
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
      setMeta(el, entry, surface);
    } else if (entry.role === 'user') {
      // The reader's own message gets the same formatting, so bullets they type show as bullets.
      el.innerHTML = `<div class="turn-body">${renderProse(entry.content)}</div>`;
    } else {
      el.textContent = entry.content;
    }
    if (before) before.before(el); else thread.append(el);
    if (surface.empty) surface.empty.hidden = true;
    follow(thread, wasNear || entry.role === 'user');
    return el;
  }

  function setStatus(el, text) {
    const status = el.querySelector('[data-status]');
    status.hidden = !text;
    if (text) el.querySelector('[data-status-text]').textContent = text;
  }

  function setMeta(el, { sources: used = [], tier, note } = {}, { quiet = false } = {}) {
    const meta = el.querySelector('[data-meta]');
    const parts = [];
    if (used.length) parts.push(`Sources: ${used.join(' · ')}`);
    if (note) parts.push(note);
    else if (tier && !quiet) parts.push(tierLabel(tier));
    meta.textContent = parts.join('  ·  ');
    meta.hidden = !parts.length;
  }

  function restoreThread(surface, turns) {
    const thread = surface.thread;
    if (!thread) return;
    thread.innerHTML = '';
    lastSection.delete(thread);
    for (const t of turns) addTurn(t, surface);
    if (surface.empty) surface.empty.hidden = turns.length > 0;
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

  // Grows with the text until 40% of the screen, then scrolls; the latest line always stays in view.
  function autoGrow(input) {
    const grow = () => {
      const max = Math.round(window.innerHeight * 0.4);
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, max)}px`;
      input.style.overflowY = input.scrollHeight > max ? 'auto' : 'hidden';
    };
    input.addEventListener('input', grow);
    return grow;
  }

  function stopExchange() { controller?.abort(); activeTyping?.stop(); }

  // One exchange on any surface: show the reader's message (if any), stream Claude's reply, and keep
  // both only once the reply has fully arrived. `plan` builds the turn list (the tutor grades the
  // answer there first) and says how to commit the result.
  async function exchange(surface, asked, plan) {
    if (!sampleFn || controller) return;
    if (asked) addTurn(asked, surface);
    const answerEl = addTurn({ role: 'assistant', content: '' }, surface);
    const body = answerEl.querySelector('[data-body]');
    setStatus(answerEl, 'Thinking');

    const tier = state.modelTier;
    controller = new AbortController(); // a fresh controller per exchange
    const signal = controller.signal;
    surface.busy?.(true);
    const typing = typewriter(body, surface.thread);
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
      setMeta(answerEl, entry, surface);
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
      if (copy) addTurn({ role: 'error', content: copy }, surface);
      // A permanent refusal means this view can never sample. Hide everything that would fail
      // every time: the chat, and with the re-render, the tutor's inline pieces.
      if (isFatal(e?.code)) {
        sampleFn = null;
        setChatOpen(false);
        document.getElementById('chat-toggle').hidden = true;
        render({ keepScroll: true });
      }
    } finally {
      controller = null;
      activeTyping = null;
      surface.busy?.(false);
    }
  }

  function sendButtonBusy(btn) {
    return (on) => {
      if (!btn) return;
      btn.textContent = on ? 'Stop' : 'Send';
      btn.classList.toggle('is-stop', on);
    };
  }

  function wireChat() {
    const panel = document.getElementById('chat');
    const toggle = document.getElementById('chat-toggle');
    const form  = panel.querySelector('[data-ask-form]');
    const input = panel.querySelector('[data-ask-input]');
    const model = panel.querySelector('[data-chat-model]');
    const surface = {
      thread: panel.querySelector('[data-thread="ask"]'),
      empty: panel.querySelector('[data-chat-empty]'),
      dividers: true,
      busy: sendButtonBusy(panel.querySelector('[data-ask-send]')),
    };

    restoreThread(surface, state.chat);
    toggle.addEventListener('click', () => setChatOpen(panel.hidden));
    panel.querySelector('[data-chat-close]').addEventListener('click', () => setChatOpen(false));
    panel.querySelector('[data-chat-clear]').addEventListener('click', () => {
      stopExchange();
      state.chat = [];
      persist();
      restoreThread(surface, state.chat);
    });
    model.addEventListener('change', () => { state.modelTier = model.value; persist(); });
    for (const chip of panel.querySelectorAll('[data-quick]')) {
      chip.addEventListener('click', () => ask(chip.dataset.quick));
    }

    const grow = autoGrow(input);
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
      if (controller) { stopExchange(); return; }
      const q = input.value.trim();
      if (!q) return;
      input.value = '';
      grow();
      ask(q);
    });

    function ask(question) {
      const nodeId = currentId;
      const node = byId.get(nodeId);
      if (!node) return;
      const history = state.chat.filter(t => t.role === 'user' || t.role === 'assistant');
      const asked = { role: 'user', content: question, section: nodeId };
      return exchange(surface, asked, async () => {
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
  }

  // ---- Quiz time. Everything the tutor decides is decided in lib/tutor.js. ----

  function checkpointBox(cp) { return document.querySelector(`[data-checkpoint="${CSS.escape(cp.id)}"]`); }

  function checkpointSurface(box) {
    // quiet: the model tier is not shown under quiz questions.
    return { thread: box.querySelector('[data-cp-thread]'), quiet: true, busy: sendButtonBusy(box.querySelector('[data-cp-send]')) };
  }

  function repaintCheckpoint(cp) {
    const box = checkpointBox(cp);
    if (!box) return;
    box.outerHTML = checkpointHtml(cp);
    wireCheckpoint(cp);
  }

  function wireCheckpoint(cp) {
    const box = checkpointBox(cp);
    if (!box) return;
    const surface = checkpointSurface(box);
    const round = roundOf(cp);
    if (surface.thread && round.thread.length) restoreThread(surface, round.thread);
    const mcqs = box.querySelector('[data-cp-mcqs]');
    if (mcqs) wireQuiz(mcqs);
    box.querySelector('[data-cp-start]')?.addEventListener('click', () => roundStep(cp, { action: 'start' }));
    box.querySelector('[data-cp-reopen]')?.addEventListener('click', () => {
      state.rounds[cp.id] = { ...roundOf(cp), skipped: false };
      persist();
      repaintCheckpoint(cp);
    });
    box.querySelector('[data-cp-skip]')?.addEventListener('click', () => {
      stopExchange();
      state.rounds[cp.id] = { ...roundOf(cp), active: false, skipped: true };
      persist();
      repaintCheckpoint(cp);
    });
    const form = box.querySelector('[data-cp-form]');
    if (form) {
      const input = form.querySelector('[data-cp-input]');
      const grow = autoGrow(input);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (controller) { stopExchange(); return; }
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        grow();
        roundStep(cp, { text });
      });
    }
    for (const btn of box.querySelectorAll('[data-cp-action]')) {
      btn.addEventListener('click', () => {
        const action = btn.dataset.cpAction;
        if (action === 'map' || action === 'save') toggleSheet(cp, action);
        else roundStep(cp, { action });
      });
    }
  }

  // The skill map and the save-state block open inside the checkpoint, in place of nothing: the
  // thread stays where it is.
  function toggleSheet(cp, kind) {
    const box = checkpointBox(cp);
    const sheet = box?.querySelector('[data-cp-sheet]');
    if (!sheet) return;
    const open = sheet.dataset.kind === kind && !sheet.hidden;
    for (const b of box.querySelectorAll('[data-cp-action][aria-expanded]')) b.setAttribute('aria-expanded', String(!open && b.dataset.cpAction === kind));
    if (open) { sheet.hidden = true; sheet.innerHTML = ''; delete sheet.dataset.kind; return; }
    sheet.dataset.kind = kind;
    sheet.innerHTML = kind === 'map'
      ? renderSkillMap(skillRows(state.tutor, tracked, currentId), overallPercent(state.tutor, tracked))
      : renderSaveState(saveState(doc.meta, tracked, state.tutor, currentId));
    sheet.hidden = false;
    sheet.querySelector('[data-sheet-close]')?.addEventListener('click', () => toggleSheet(cp, kind));
    sheet.querySelector('[data-save-copy]')?.addEventListener('click', () => copySaved(sheet));
    if (kind === 'save') copySaved(sheet);
  }

  async function copySaved(sheet) {
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

  function roundStep(cp, { action = 'answer', text = '' } = {}) {
    if (!sampleFn || controller) return;
    if (action === 'answer') {
      const command = parseCommand(text);
      if (command === 'progress') return toggleSheet(cp, 'map');
      if (command === 'save') return toggleSheet(cp, 'save');
      if (command) action = command;
    }
    const before = state.tutor;
    if ((action === 'tell' || action === 'harder' || action === 'easier') && !before.pending) action = 'start';
    let round = roundOf(cp);
    if (action === 'start') {
      // A new round after a finished one starts a fresh thread; levels and answers carry on.
      round = { ...(round.finished ? createRound({ mcq: round.mcq }) : round), thread: round.finished ? [] : round.thread, active: true, skipped: false, finished: false };
      state.rounds[cp.id] = round;
      persist();
      repaintCheckpoint(cp);
    }
    const box = checkpointBox(cp);
    if (!box) return;
    const surface = checkpointSurface(box);
    const said = { start: 'Quiz me on this part.', tell: 'Just tell me.', harder: 'Harder.', easier: 'Easier.' }[action] ?? text;
    const asked = { role: 'user', content: said };
    const lastQuestion = round.thread.findLast(t => t.role === 'assistant')?.content ?? '';
    signalsInFlight = [];

    return exchange(surface, asked, async ({ signal, tier, answerEl, status }) => {
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
        step = before.pending ? applyRound(before, round, validateAssessment(raw), { order }) : startRound(before, round, cp);
      } else if (action === 'tell') step = { ...tellMove(before, before.pending.node), round };
      else if (action === 'harder' || action === 'easier') step = { ...difficultyMove(before, action === 'harder' ? 1 : -1, before.pending.node), round };
      else step = startRound(before, round, cp);

      const target = byId.get(step.move.node);
      const hits = searchChunks(chunks, `${target.title} ${action === 'answer' ? text : ''}`, 3);
      const turns = tutorTurns(doc.meta, target, round.thread, said, step.move, {
        catalog: catalog(sources),
        excerpts: formatExcerpts(hits),
        difficulty: step.tutor.difficulty,
        answered: before.pending ? byId.get(before.pending.node) : null,
        diagnostic: diagnosticLine(doc),
        titleOf: (id) => byId.get(id)?.title ?? id,
        weak: weakestAreas(step.tutor, tracked),
        seed: target.quiz?.selfExplain ?? '',
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
          for (const n of notes) addTurn(n, surface, { before: answerEl });
          state.tutor = next;
          const finished = step.round.finished;
          state.rounds[cp.id] = { ...step.round, active: !finished, thread: appendTurns(round.thread, asked, ...notes, entry) };
          paintTree();
          if (finished) { persist(); repaintCheckpoint(cp); }
        },
      };
    }).finally(() => { signalsInFlight = null; });
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

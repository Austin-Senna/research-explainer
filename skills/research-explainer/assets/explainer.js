// Thin DOM layer. Everything it decides is decided in lib/.
import { neighbors, linearOrder, ancestorsOf, isOpening } from './lib/tree.js';
import { gradeMcq, recordAnswer, scheduleReasks } from './lib/quiz.js';
import { createStore } from './lib/storage.js';
import { renderSidebar, renderNode, renderMasthead, renderChat, renderProse, escapeHtml } from './lib/render.js';
import { nodeContext, buildTurns, essayPrompt, VERDICT_COPY, copyForError, isFatal, tierLabel, toolStatus, nextTier, appendTurns } from './lib/ask.js';
import { chunkSources, searchChunks, formatExcerpts, catalog, sourceTools } from './lib/sources.js';
import { nextReveal } from './lib/typing.js';

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
  // One conversation across the whole document, saved in this browser: [{role, content, section?, sources?, tier?, note?}]
  state.chat = Array.isArray(state.chat) ? state.chat : [];
  state.modelTier ??= 'default';

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

  function render() {
    const node = byId.get(currentId);
    if (!node) return;

    const schedule = scheduleReasks(state.answers, nodes);
    const reaskId = schedule.get(currentId);
    const reaskOf = reaskId && reaskId !== currentId ? byId.get(reaskId) : null;

    document.getElementById('tree').innerHTML = renderSidebar(nodes, { currentId, passed: passedSet() });
    document.getElementById('content').innerHTML = renderNode(node, { reaskOf });
    document.getElementById('masthead').hidden = !isOpening(nodes, currentId);

    // The tree is always fully expanded: spec §10 prefers adjacent depth to hidden depth,
    // since expandable indexes tested ~50% slower. Ancestors are only highlighted.
    for (const a of ancestorsOf(nodes, currentId)) {
      document.querySelector(`[data-id="${CSS.escape(a.id)}"]`)?.classList.add('is-ancestor');
    }

    const { prev, next } = neighbors(nodes, currentId);
    wirePager('.prev', prev);
    wirePager('.next', next);

    wireQuiz(document.getElementById('content'), node);
    drawMermaid(document.getElementById('content'));
    if (reaskOf) wireQuiz(document.querySelector('.reask'), reaskOf);
    revealAsk();
    const about = document.querySelector('[data-chat-section]');
    if (about) about.textContent = node.title;

    window.scrollTo(0, 0);
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
    document.getElementById('tree').innerHTML =
      renderSidebar(nodes, { currentId, passed: passedSet() });
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

  function setChatOpen(open) {
    const chat = document.getElementById('chat');
    const toggle = document.getElementById('chat-toggle');
    chat.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('chat-open', open);
    state.chatOpen = open;
    persist();
    // preventScroll: focusing inside the sticky panel would otherwise scroll the page, like scrollIntoView.
    if (open) chat.querySelector('[data-ask-input]')?.focus({ preventScroll: true });
  }

  function threadEl() { return document.querySelector('[data-thread]'); }

  // Scroll the message list, never the page. scrollIntoView() scrolls every scrollable ancestor,
  // and because the panel is sticky that dragged the whole page back up on every message. Only
  // follow new text when the reader is already at the bottom, so reading back is not yanked away.
  function nearBottom(el) { return el.scrollHeight - el.scrollTop - el.clientHeight < 48; }
  function follow(el, wasNear) { if (wasNear) el.scrollTop = el.scrollHeight; }

  let lastSection = null; // the section of the most recent question shown, for dividers

  function addTurn(entry) {
    const thread = threadEl();
    if (!thread) return null;
    const wasNear = nearBottom(thread);
    // A divider wherever the reader asked from a different section than the question before.
    if (entry.role === 'user' && entry.section && entry.section !== lastSection) {
      const divider = document.createElement('p');
      divider.className = 'turn-section';
      divider.textContent = byId.get(entry.section)?.title ?? '';
      thread.append(divider);
      lastSection = entry.section;
    }
    const el = document.createElement('div');
    el.className = `turn ${entry.role === 'user' ? 'q' : entry.role === 'error' ? 'err' : 'a'}`;
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
    thread.append(el);
    document.querySelector('[data-chat-empty]').hidden = true;
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

  function restoreThread() {
    const thread = threadEl();
    if (!thread) return;
    thread.innerHTML = '';
    lastSection = null;
    document.querySelector('[data-chat-empty]').hidden = state.chat.length > 0;
    for (const t of state.chat) addTurn(t);
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

    restoreThread();
    toggle.addEventListener('click', () => setChatOpen(panel.hidden));
    panel.querySelector('[data-chat-close]').addEventListener('click', () => setChatOpen(false));
    panel.querySelector('[data-chat-clear]').addEventListener('click', () => {
      controller?.abort();
      state.chat = [];
      persist();
      restoreThread();
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
      if (q) { input.value = ''; grow(); ask(q); }
    });

    function busy(on) {
      send.textContent = on ? 'Stop' : 'Send';
      send.classList.toggle('is-stop', on);
    }

    async function ask(question) {
      if (!sampleFn || controller) return;
      const nodeId = currentId;
      const node = byId.get(nodeId);
      if (!node) return;

      const history = state.chat.filter(t => t.role === 'user' || t.role === 'assistant');
      const asked = { role: 'user', content: question, section: nodeId };
      addTurn(asked);
      const answerEl = addTurn({ role: 'assistant', content: '' });
      const body = answerEl.querySelector('[data-body]');
      setStatus(answerEl, 'Thinking');

      // Retrieval happens here, not in Claude: the passages most relevant to this question go
      // into the prompt every time, so answers are grounded even where tools are unavailable.
      // The question alone searches best; a content-free prompt ("Explain this more simply")
      // falls back to the section title so it still gets relevant passages.
      let hits = searchChunks(chunks, question, 4);
      if (!hits.length) hits = searchChunks(chunks, `${question} ${node.title}`, 4);
      const used = new Set(hits.map(h => h.label));
      const turns = buildTurns(nodeContext(doc.meta, node), history, question, {
        catalog: catalog(sources),
        excerpts: formatExcerpts(hits),
      });

      const tier = state.modelTier;
      controller = new AbortController(); // a fresh controller per call
      busy(true);
      const thread = threadEl();

      const typing = typewriter(body, thread);
      activeTyping = typing;
      try {
        const options = {
          signal: controller.signal,
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
        state.chat = appendTurns(state.chat, asked, entry);
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
        if (copy) addTurn({ role: 'error', content: copy });
        // A permanent refusal means this view can never sample. Hide it rather than
        // leaving a control that will fail every time.
        if (isFatal(e?.code)) {
          sampleFn = null;
          setChatOpen(false);
          toggle.hidden = true;
        }
      } finally {
        controller = null;
        activeTyping = null;
        busy(false);
      }
    }
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

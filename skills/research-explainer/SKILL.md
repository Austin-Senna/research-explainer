---
name: research-explainer
description: Use when turning a paper, topic, or arXiv ID into an interactive HTML explainer to learn from - generating a tailored topic tree with prerequisite scaffolding, spiral explanations and retrieval quizzes. Triggers on "explain this paper", "help me learn X", "make me an explainer".
---

# Building a research explainer

## Ground rules

**Two gates, neither optional.** Phase 4 is the cost gate: show the tree and the proposed
resources with their costs, and stop before spending anything on research. Phase 7 is the quality gate: never build or
publish a document that `verify.mjs` fails.

**Depth defaults to `quick`**: no research subagents unless the user picks resources at the gate,
and no spend beyond reading the source and one search. Research is opted into, never out of.

**Never turn Phase 7 into an LLM judge.** It is deterministic Node code and costs nothing. That
is deliberate.

## Requirements

- **Required:** Node.js 20 or later.
- **Optional:**
  - `pdftoppm` (poppler), only for cropping figures the arXiv HTML dropped.
  - A browser tool (Playwright MCP or Claude in Chrome) for screenshotting inline-SVG figures and
    for the Phase 6b visual check.
  - The Artifact tool (Claude Code connected to claude.ai) for publishing. Without it the result is
    the local `index.html`.
- **Outside claude.ai:** the chat panel and essay grading use the claude.ai viewer's `sample`
  capability and hide themselves when it is unavailable. Mermaid diagrams load from jsDelivr, so a
  local file needs internet for them.

## Invocation

```
/research-explainer                         # no argument → ask what to learn
/research-explainer 1706.03762              # arXiv ID
/research-explainer ~/papers/vllm.pdf       # local PDF
/research-explainer https://…               # URL
/research-explainer "KV cache eviction"     # bare topic → search, user picks
/research-explainer explain PPO to me       # natural language → treated as a bare topic
/research-explainer <src> --add <url> …     # extra sources
/research-explainer <src> --depth deep      # skip the depth prompt
```

With no argument, first ask what the user wants to learn, in one plain question, and wait. Treat
the answer, like any natural-language request ("explain PPO to me", "help me understand KV
caches"), as a bare topic: strip it to the subject before searching.

An unambiguous handle (arXiv ID, DOI, path, URL) is used directly with no questions. A bare topic
triggers a search and presents 4–6 candidates. Either way, print the final source set and let the
user add or drop before anything is spent.

If a bare-topic search turns up no source of adequate quality, **stop and ask for one.** Do not
build an explainer from your own recollection and present it as sourced.

### Explore or deepen

Read the request's intent; ask only if it is unclear.

- **Explore** (the default: "help me learn X", a paper you have not read): a broad tree across the
  topic, shaped by the depth dial.
- **Deepen** ("go deeper on PPO's clipping", "I know the basics, explain why X works"): a narrow
  tree around the one idea, with more levels under it and few siblings. Skip what the reader has
  shown they know. At the Phase 4 gate, propose resources more widely than usual, since one
  mechanism is best explained from several angles: the original derivation, a worked example, a
  critique or ablation. The breadth goes into the sources, not the tree.

## The eight phases

`<base>` is this skill's base directory, shown as "Base directory for this skill" when the skill
loads. Run every script as `node <base>/assets/...`.

### 1. Resolve source
Source → plain text.

**For arXiv, fetch `arxiv.org/html/<id>v<n>` — never `/abs/`.** The abs page is a landing page and
returns only the abstract, which looks like a successful fetch and silently starves every later
phase. Get the version number from the API first (`export.arxiv.org/api/query?id_list=<ids>`,
which takes several ids in one call and returns titles, authors, dates and abstracts). If the HTML
rendering does not exist for a paper, fall back to the PDF and say so.

A fetch that returns only an abstract when you asked for methods and results is a **failed fetch**.
Notice it and retry rather than authoring from it.

Save every source's full text to `sources.json` beside `nodes.json`, as
`[{ "label", "url", "text" }]` with labels and URLs matching the ones nodes cite. The build embeds it
so the page's chat can search and read the sources: a published page cannot fetch anything, so a
source missing here is a source the chat cannot read. Include supplementary sources a node cites.

Local paths get PDF extraction; other URLs get a plain fetch.

**Capture figures now** (skip when images are `none`; see 3a). The paper's own figure is usually the
best diagram of its own mechanism, so collect before drawing anything. List every `<figure>` in the
arXiv HTML with its caption, pick the ones that show a mechanism or the key result, and save each to
`figures/` beside `nodes.json`:

- **`<img>` figures:** download `arxiv.org/html/<id>v<n>/<src>` directly; resize to 1600px wide.
- **Inline-SVG figures:** screenshot the `<figure>` element with the browser tool, after hiding its
  `<figcaption>` (the page writes its own caption).
- **Figures the HTML dropped** (an empty `<figure>`, or a box with no content): find the page with
  `pdftotext`, locate the figure with `pdftotext -bbox-layout`, and crop it with
  `pdftoppm -r 250 -x -y -W -H -singlefile`.

Look at every capture before using it. Empty frames, caption-only crops and cut-off content all
happen, and all look like success in a file listing.

### 2. Skim
One read producing three artifacts:
- **candidate tree** — 8–12 top-level nodes, each with 2–4 children
- **prerequisite inventory** — concepts the source assumes without introducing
- **unexplained claims** — assertions it makes but does not justify. These are the *only*
  legitimate targets for research fan-out

### 3. Diagnose
Two steps, and the second only runs on a yes.

**3a. Experience gate.** One `AskUserQuestion` call carrying:
1. **"Any experience with <topic>?"**: yes or no, naming the topic concretely.
2. **The depth dial.**
3. **Images**, since they are the largest cost after research fan-out:
   - **Figures and diagrams** (recommended): paper figures, Mermaid for every process, and
     subagent-drawn SVGs where neither fits. Every node gets a visual, as in a good blog post.
   - **Paper figures only**: no drawing, no Mermaid.
   - **Text only**.

   Record the answer as `meta.images`: `full`, `figures` or `none`.

On **no**, skip 3b: mark every inventory concept `known: false`, give each prerequisite a full
node, and go to Phase 4. A "no" is trustworthy because self-report errs upward (r = .29 with a
constant upward bias), so people rarely deny experience they have. A "yes" is not trustworthy for
the same reason, which is why it earns a check instead of being believed.

**3b. Rapid verification** (only after a yes). One `AskUserQuestion` call with **4–5 statements
about the actual content**, mixed true and false, answered fast. This correlates r = .71–.92 with
a full knowledge test at a third of the time. Never ask anyone to rate their own expertise here.
The tool allows at most 4 questions of 2–4 options with unique labels, so group the statements
into `multiSelect` questions ("which of these are true?") of 2–3 statements each. Treat "I don't
know" as `known: false` for every statement in that group.

The inventory is usually larger than five items. Rank prerequisites by how many nodes declare
them in `assumes`, probe the top 4–5, and give everything unprobed a **collapsed one-paragraph
refresher by default**. When in doubt, include the scaffolding.

The score sets **defaults**, never forks content.

### 4. Plan and gate
Merge failed items into prereq nodes. Prune or extend the tree by depth. Print the tree.

**Then propose resources and let the user pick.** Run one search for named resources that close
this reader's gaps: prerequisites they failed or were not probed on, and claims the source asserts
without justification. Propose only resources that do something the source does not: a textbook
chapter or tutorial for a prerequisite, the paper a claim leans on, a replication or critique of a
result. Never propose one to re-explain what the source already explains well.

Present them in one `AskUserQuestion` call, `multiSelect`, grouped into questions by purpose
("fill prerequisites", "check the claims", "go further"). Each option is one resource: the label is
its short name, the description says what it adds to *this* explainer and its estimated cost
(about $1 per resource a subagent reads; more for a long paper). Size the list by depth: 2–4 for
`quick`, up to 8 for `standard`, up to 12 for `deep`. The tool caps each question at 4 options, so
leave out the weakest candidates rather than padding. Anything unpicked is dropped. If no pick is
made, build from the source alone.

**Stop and wait for the picks.** Nothing beyond reading the source and the one search has been
spent yet.

### 5. Research fan-out
Parallel subagents dispatched **in a single message**, on a mid-tier model such as Sonnet (or a
small model such as Haiku for a prerequisite needing only a plain definition). Targets are exactly the
resources the user picked at Phase 4, one resource per agent. Each agent reports what its
resource says about the gap it was picked for, with locators. Add every picked resource to
`meta.sources` as `supplementary` and its full text to `sources.json`.

**Cap fetches per agent, not just output length.** Cumulative input across an agent's turns
dominates the cost — six fetches means every later turn re-reads everything fetched so far.

### 6. Author
On the session's most capable model. **Read `reference/authoring-rules.md` before writing any node.** Its first
three rules are the ones Phase 7 fails the build on.

Three more earn special attention because they come from watching this tool actually fail a
reader, not from the literature (§6.17–6.19): **teach the axis, never the list**; **tell
confusable pairs apart in a sentence of their own**; and **when B modifies A, derive B from A
rather than listing them side by side**. Every place a real reader got stuck traced back to one
of those three.

### 6b. Visuals (images `full` or `figures`)
Treat the explainer like a blog post: a picture beside every idea that has a shape. For each node,
in this order of preference:

1. **The paper's own figure** (`figures: [{src, alt, caption, credit, url}]`) when one shows the
   node's mechanism or result. Write a caption that says what to look at, not the paper's caption.
2. **Mermaid** (`diagram: {mermaid, alt}`) for any process, pipeline, loop or decision: most
   nodes. See authoring rules §9.7 for layout; it is drawn in the page from the CDN, themed from
   the page's tokens.
3. **A drawn SVG** (`diagram: {svg, alt}`) for anything quantitative or structural Mermaid cannot
   state: distributions, splits, ladders with measured values. Dispatch these to subagents in one
   message, two or three nodes each, with the brief in `reference/diagram-subagent.md`. They write
   `figures/<id>.svg` and `figures/<id>.alt.txt`; you wire them in.

Then **render every visual in the browser and look at it**, in both themes. Subagents cannot see
their own output. Measure each Mermaid diagram's natural size: over about 680 by 560px gets re-laid-out
(§9.7), since the column and height cap scale it down. With images `full`, the verifier warns `NO_VISUAL`
on any node without one.

### 7. Verify
```bash
node <base>/assets/verify.mjs <nodes.json> --source <source.txt>
```
Non-zero exit means fix and re-run. Never ship past it. Warnings are advisory; errors are not.

### 8. Ship
```bash
node <base>/assets/build.mjs <nodes.json> ~/explainers/<slug>
```
Output defaults to `~/explainers/<slug>`; use another folder if the user names one.
The build reads `sources.json` from beside `nodes.json` and warns if it is missing. Publish with
`capabilities: {"sample": {}}`: the chat panel and the essay check both need it, and both hide
themselves when it is unavailable. Open the local file, then publish the Artifact. Report both
locations.

## Sharing

Published artifacts are private to the publisher. Pages embed the full text of their sources
(`sources.json`) so the chat can read them, and many papers' licences do not allow redistributing
full text. Before sharing a page publicly, rebuild without `sources.json` (move it aside and rerun
the build; the build warns and the chat falls back to section text), or share only pages whose
sources are openly licensed. Viewers not signed in to Claude will not get the chat.

## Depth dial

| | Tree | Resources offered | Nodes | Adds | Approx cost |
|---|---|---|---|---|---|
| **quick** (default) | ≤2 levels | 2–4 | 6–8 | core mechanism only | ~$1.50–2 with no picks |
| **standard** | ≤3 levels | ≤8 | 10–15 | results, limitations | ~$4.50–6 with 3–5 picks |
| **deep** | ≤4 levels | ≤12 | 18–25 | extensions, open questions, related work | ~$10–12 with ~10 picks |

Each pick adds or removes about $1.

Depth 4 is the documented degradation point, so reach it only where the subject genuinely
branches. Breadth is cheap; depth is expensive. 10–20 items per level is fine — any "no more than
7 sections" rule has no empirical basis.

## Node schema

`nodes.json` is the only thing generation produces; `build.mjs` injects it into the template.

```jsonc
{
  "meta": {
    "title", "slug", "generatedAt", "depth", "images": "full | figures | none",
    "claimSummary": "5 sentences: what this claims, and whether it held up",
    "sources": [{ "label", "url", "kind": "primary|supplementary" }],
    "oversimplifications": [{ "declaredIn", "correctedIn", "what" }]
  },
  "diagnostic": {
    "items":   [{ "statement", "truth": true, "concept" }],
    "results": [{ "concept", "known": false }]
  },
  "concepts": { "<concept-id>": { "introducedBy": "<node-id>" } },
  "nodes": [{
    "id", "title",
    "kind": "prereq | core | extension",
    "parent": "<node-id>|null",
    "order": 7,
    "hook": "one sentence: why this node exists at all",
    "assumes": ["<concept-id>"],
    "spiral": { "intuition": "…", "concrete": "…", "formal": "…" },
    "wrongTurn": { "belief": "If you're thinking X here…", "correction": "…why that's wrong" },
    "diagram": { "svg" | "mermaid", "alt", "cueCount": 7, "kind": "onion|dataflow|comparison|result" },
    "figures": [{ "src": "figures/x.png", "alt", "caption", "credit", "url" }],  // inlined by the build
    "quiz": {
      "mcq":   [{ "stem", "options": [{ "text", "correct", "why" }], "explanation" }],  // 1-3 per node, multiple choice only
      "selfExplain": "Conceptualize in one sentence why …",
      "selfExplainAnswer": "the author's one-sentence model answer"  // required: Claude grades against it, and it is shown as feedback
    },
    "sources": [{ "label", "url", "locator": "§3.2.1" }]
  }]
}
```

`kind: "prereq"` earns the ⚡ marker in the sidebar — it exists only because the reader failed a
diagnostic item. Making that visible lets them skip it if the diagnostic was wrong about them.

## Where to look

- `reference/authoring-rules.md` — what to write and what never to write. Read before Phase 6.
- `reference/evidence.md` — how much each rule is worth, and which popular claims are hollow.
- `reference/diagram-subagent.md` — the brief for subagents drawing SVG diagrams (Phase 6b).
- `docs/2026-09-16-research-explainer-design.md` — the full argument behind every decision.

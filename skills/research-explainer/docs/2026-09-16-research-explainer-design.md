# research-explainer — design

**Date:** 2026-09-16
**Status:** approved, pending implementation plan

A Claude Code skill that turns a topic or research paper into a single interactive HTML
explainer, tailored at generation time to what the reader actually knows.

Design decisions below are graded for evidence strength:

| Grade | Meaning |
|---|---|
| **[A]** | Multiple independent meta-analyses agree, no strong contrary finding |
| **[B]** | One meta-analysis or several controlled studies, with known caveats |
| **[C]** | Convergent practice across best-in-class exemplars; no controlled test |
| **[D]** | Contested — credible findings point both ways. Pick deliberately, don't over-claim |

---

## 1. Purpose

Given a paper, URL, or topic, produce an explainer that:

- starts at the right place for this reader, by diagnosing prior knowledge rather than asking for it
- organizes the subject as a tree of topics and subtopics, with a linear default path through it
- teaches each idea at escalating formality in one pass, rather than in switchable difficulty modes
- checks understanding with retrieval questions that always explain themselves
- ships as a local file and a published Artifact

**Non-goals.** Not a literature review generator, not a paper summarizer, not a flashcard
system with scheduled review. One document, one sitting, no return-visit scheduling.

---

## 2. Invocation

```
/research-explainer 1706.03762                 # arXiv ID
/research-explainer ~/papers/vllm.pdf          # local PDF
/research-explainer https://…                  # URL
/research-explainer "KV cache eviction"        # bare topic → search, user picks
/research-explainer <src> --add <url> …        # extra sources
/research-explainer <src> --depth deep         # skip the depth prompt
```

**Resolution rules.** An unambiguous handle (arXiv ID, DOI, path, URL) is used directly with
no questions. A bare topic triggers a search and presents 4–6 candidates. In both cases the
final source set is printed for add/drop before anything is spent.

**Defaults.** Depth defaults to **`quick`** — no research fan-out, no spend beyond reading the
source. Research costs money, so it is opted into, never out of. Phase 3 still offers the dial;
`quick` is only what happens when the question is skipped or the session is non-interactive. If a bare-topic search turns up no source of adequate quality, **stop and ask
for one** — do not build an explainer from the model's own recollection of the topic and
present it as sourced.

---

## 3. Pipeline

### Phase 1 — Resolve source
Source → plain text. arXiv API for IDs, PDF extraction for paths, fetch for URLs. Extract
figures to `figures/` at this stage; the paper's own figures are often the best available
diagram and should not be redrawn by default.

### Phase 2 — Skim
One read of the source producing three artifacts:
- **candidate tree** — 8–12 top-level nodes, each with 2–4 children
- **prerequisite inventory** — concepts the source assumes without introducing
- **unexplained claims** — assertions the source makes but does not justify; these are the
  only legitimate targets for research fan-out

### Phase 3 — Diagnose  **[B]**
A single `AskUserQuestion` call carrying:

1. **4–5 rapid-verification items.** Statements about the actual content, mixed true and
   false, answered fast. Kalyuga's rapid verification method correlates r = .71–.92 with a
   full knowledge test at 1/3–1/5 the time. Self-report correlates r = .29 (Zell & Krizan
   2014, 22 meta-analyses) with a constant upward bias — which is why this is not a
   checklist.
2. **The depth dial** — quick / standard / deep.

**Covering more prerequisites than fit in 5 items.** The inventory from Phase 2 is usually
larger than the diagnostic. Rank prerequisites by how load-bearing they are — how many nodes
declare them in `assumes` — and probe the top 4–5. For prerequisites left unprobed, **include
a collapsed one-paragraph refresher by default** rather than omitting them. This follows the
meta-analysts' own prescription below, and costs a reader who doesn't need it one line of
sidebar.

Score sets **defaults**, never forks content. Kalyuga (2006a) and Salden et al. (2006) both
found no significant difference between adaptation algorithms while both beat non-adaptive;
the return is in having two paths at all, not in routing sophistication.

> **Caveat [D]:** only 5 of 60 studies in Tetzlaff et al. (2025) used self-evaluation to
> determine prior knowledge, and it was not a significant moderator. There is no direct
> meta-analytic evidence that any diagnostic is *sufficient* to drive adaptation. Treat the
> diagnostic as a defaults-setter, and when in doubt include the scaffolding — the
> meta-analysts' own prescription is "rather provide assistance than to withhold it."

### Phase 4 — Plan and gate
Merge failed diagnostic items → prereq nodes. Prune/extend the candidate tree by depth.
**Print the resulting tree and the implied fan-out budget, and stop.** Nothing has been spent
on research yet. This is the only cost gate and it is not optional.

### Phase 5 — Research fan-out
Parallel Sonnet subagents, dispatched in one message. Targets are restricted to:
- prerequisite concepts the reader failed the diagnostic on
- claims the source asserts without justification

Never fan out on material the source already explains well. Ungated fan-out does not
overspend so much as pad the output with researched restatements of things already said.

### Phase 6 — Author
Nodes, diagrams, quizzes, per §5–§7.

### Phase 7 — Verify
See §8. This phase is load-bearing and must not be skipped for speed.

### Phase 8 — Ship
Write `~/explainers/<slug>/` (or a folder the user names), open the local file, publish the Artifact, report
both locations.

---

## 4. Depth dial

| | Tree | Fan-out | Nodes | Adds | Approx cost |
|---|---|---|---|---|---|
| **quick** (default) | ≤2 levels | none | 6–8 | core mechanism only | ~$1.50–2 |
| **standard** | ≤3 levels | 3–5 agents | 10–15 | results, limitations | ~$4.50–6 |
| **deep** | ≤4 levels | ≤10 agents | 18–25 | extensions, open questions, related work | ~$10–12 |

**Model assignment.** Authoring (Phase 6) runs on **the session's most capable model** — §8 establishes that
distractor and explanation quality is the highest-leverage problem in this product, and a
question whose explanation is wrong is worth g = 0.03 instead of g = 0.73. Research subagents
(Phase 5) run on **a mid-tier model such as Sonnet**; a prerequisite that needs only a
plain definition with no synthesis can go to **a small model such as Haiku**. Phase 7 costs nothing at
all — the verifier is a Node script, not an LLM judge, which is the single largest cost saving
in the design.

**Where the money actually goes.** The dominant term is cumulative input across a subagent's
turns, not the length of the report it returns: six web fetches means every later turn re-reads
everything fetched so far. Capping fetches per agent is a bigger lever than capping output.

Depth of 4 is the documented degradation point (HCIL TR 99-15: performance holds at depths
2–3, degrades at 4), so `deep` should reach level 4 only where the subject genuinely
branches. **[B]**

Breadth is cheap and depth is expensive, but "flatter is always better" is a mis-citation —
Larson & Czerwinski found a *medium* breadth/depth condition outperformed the broadest
shallow structure. 10–20 items per level is fine. Any rule of the form "no more than 7
sections" has no empirical basis; 7±2 was about serial recall of unrelated items held in the
head, not a recognition task with the items visible on screen. **[A]**

---

## 5. Data model

`nodes.json`, injected into the template as a `NODES` literal.

```jsonc
{
  "meta": {
    "title": "Attention Is All You Need",
    "slug": "attention-is-all-you-need",
    "generatedAt": "2026-09-16T…",
    "depth": "standard",
    "claimSummary": "…5 sentences: what this claims, and whether it held up…",
    "sources": [{ "label": "…", "url": "…", "kind": "primary|supplementary" }],
    "oversimplifications": [
      { "declaredIn": "node-id", "correctedIn": "node-id", "what": "…" }
    ]
  },

  "diagnostic": {
    "items": [{ "statement": "…", "truth": true, "concept": "concept-id" }],
    "results": [{ "concept": "concept-id", "known": false }]
  },

  "concepts": {
    "softmax": { "introducedBy": "node-prereq-softmax" }
  },

  "nodes": [{
    "id": "scaled-dot-product",
    "title": "Scaled dot-product attention",
    "kind": "prereq | core | extension",
    "parent": "method",
    "order": 7,

    "hook": "One sentence: why this node exists at all.",
    "assumes": ["softmax", "dot-product"],

    "spiral": {
      "intuition": "markdown — the idea in plain language, no notation",
      "concrete": "markdown — one worked instance with real numbers",
      "formal":   "markdown — the notation, and why each piece is there"
    },

    "wrongTurn": {
      "belief": "If you're thinking X here…",
      "correction": "…here's why that's wrong, and what's true instead."
    },

    "diagram": {
      "svg": "<svg …>",
      "alt": "…",
      "cueCount": 7,
      "kind": "onion | dataflow | comparison | result"
    },

    "quiz": {
      "cloze": {
        "prompt": "Attention is computed as softmax(Q___ᵀ / √___) V",
        "answers": ["K", "d_k"],
        "explanation": "…always present, never optional…"
      },
      "mcq": [{
        "stem": "…paraphrased, never quoted…",
        "options": [
          { "text": "…", "correct": false, "why": "why a half-informed reader picks this, and why it's wrong" },
          { "text": "…", "correct": true,  "why": "…" },
          { "text": "…", "correct": false, "why": "…" }
        ],
        "explanation": "…the full causal explanation, shown immediately…"
      }],
      "selfExplain": "Explain in one sentence why …"
    },

    "sources": [{ "label": "…", "url": "…", "locator": "§3.2.1, footnote 4" }]
  }]
}
```

`kind: "prereq"` earns the ⚡ marker in the sidebar — it exists only because the reader failed
a diagnostic item. Making that visible is honest and lets the reader skip it if the
diagnostic was wrong about them.

---

## 6. Content authoring rules

### 6.1 Spiral restatement, not level-forking **[C]**
Every core node states its idea three times **in reading order**: intuition → concrete worked
instance → formalism. Not three switchable versions; three consecutive paragraphs.

The Illustrated Transformer does exactly this — self-attention appears at 265 words
conversational, 573 words as a numbered 6-step recipe on literal vectors, then 114 words of
matrix notation. The expert skims the first two, the novice reads all three, and nobody has
to classify themselves. Across Distill, Alammar, Nicky Case, Bret Victor, 3Blue1Brown,
Google PAIR, Seeing Theory, Setosa, Ciechanowski, Lilian Weng and Quanta, **not one offers a
difficulty toggle.**

> Convergent convention, not a controlled result. Nobody has A/B tested spiral restatement
> against level forking.

**How this interacts with §6.2 and §6.11.** All three layers are generated for every reader.
What the diagnostic removes is never a whole layer — it is specific *elements* inside one,
most often the analogy inside the intuition layer. A reader the diagnostic places above the
material gets a shorter intuition paragraph, not zero paragraphs. Deleting a layer outright
would reintroduce level-forking through the back door.

### 6.2 Where content genuinely differs by expertise, it is these swaps — not "more detail" **[B]**
Kalyuga (2007), Table 1, 26 studies / >2,200 participants. Expert values are *negative* —
active harm, not indifference.

| Dimension | Low prior knowledge | High prior knowledge | d(nov) / d(exp) |
|---|---|---|---|
| Text beside a diagram | Integrate it *into* the diagram | **Delete it** — not shorten | +1.89 / −0.88 |
| Representation | Concrete, iconic, analogical | **Abstract, symbolic** | +1.60 / −1.39 |
| Procedure | Fully worked example | **A problem to solve** | +1.20 / −0.36 |
| Complex material | Isolated elements, then assembled | **Straight to the interacting form** | +1.13 / −0.56 |
| Navigation | Structured, restricted | **Free / linear** | +1.66 / −0.17 |
| Organizers, knowledge maps | Provide | **Remove** — a plain term list beats a map | +0.61 / −0.85 |

The pattern: an expert wants the artifact with nothing wrapped around it, and wants to be
made to generate rather than read. The cost is not reading time — it is that the reader's
schema and the text both claim jurisdiction over the same information, and this load is
imposed *even when the reader recognizes the material as redundant and decides to ignore it*.

> **[D] This premise is weakest in exactly this medium.** It was established with fixed
> printed diagrams and system-paced narrated animation. A web page with headings and a
> scrollbar is the most skippable medium there is; learner-paced instruction demonstrably
> reduces redundancy harms. Noetel et al. found prior knowledge did *not* moderate design
> principle effects (p = 0.14), and Schneider et al.'s signaling meta-analysis says
> explicitly that prior knowledge was not a moderator. Do not over-tune on this.

### 6.3 Check element interactivity before applying any of it **[B]**
The worked-example apparatus only pays on **high element-interactivity** material — pieces
that only make sense together. With low-EI material (independent facts) the effect reverses:
generation beats worked examples even for novices. Design principles are worth g = 0.70 on
complex material vs g = 0.20 on simple.

*Applied:* "here are the hyperparameters of the base model" → just list them. "why does
multi-head attention help" → spend the budget.

### 6.4 Fade worked examples backward across consecutive nodes **[B]**
Full worked example → same shapes with the last step blank → full problem. Backward fading
(drop the last step first) is more time-efficient than forward fading for equal transfer.

> **[D]** Fixed fading did not beat plain problem-solving in either of the two Salden
> studies; only *adaptive* fading did (posttest d = 0.49, delayed 0.59, transfer 0.91). Since
> this tool cannot adapt mid-document, expect fading to buy less here than the literature
> headline suggests.

### 6.5 Pre-train vocabulary before mechanism **[B]**
Node 0 is terms only — one sentence each, no mechanism. Mark it collapsed by default when the
diagnostic says the reader has them; it is precisely the redundant guidance §6.2 says to
delete. Payoff is on transfer, not recall — a 2025 meta-analysis found pre-training effects
on factual learning were smaller and non-significant.

### 6.6 Lead with motivation, never a definition **[C]**
Universal across every exemplar; none does the opposite. "Topic definitions should not be
seen as a starting point, but an ending point" (Sanderson).

### 6.7 The paper spine **[C]**
Front-load a 5-sentence "what this paper claims, and whether it held up" — this doubles as
the triage exit-criterion — then:

**problem → why prior approaches fail → the one key insight → mechanism → results → limitations**

No controlled experiment compares this to alternatives. What exists is convergent practice
(The Batch's literal labels: *What's new → Key insight → How it works → Results → Behind the
news → Why it matters*) plus evidence for its components: explicit section labels (median
d = 0.41, **strongest for low-prior-knowledge readers**) and coherence, the largest and most
consistent effect in the corpus.

On front-loading vs. building suspense: the one direct experiment (N=58, underpowered) found
chronological structure consumed *more* cognitive resources and scored *lower* on
comprehension. **There is no experimental support for suspense beating front-loading.** For a
self-paced document with voluntary attrition, front-load.

### 6.8 Short units **[C]**
No unbroken block over ~250 words. Measured from exemplars: Alammar's median section ~210
words with an image every ~95; *Evolution of Trust* ~103 words/slide in ~15-word blocks;
Google PAIR ~80-word scroll steps; Ciechanowski 2–5 sentences per figure. **Nobody in this
set writes a 600-word unbroken block.**

Segment on conceptual seams, not word counts. There is no magic number in the research —
segment length has never been tested as a moderator, and the "6-minute video" rule is a
watch-time correlation its own authors disclaimed as evidence about learning. But
instructor-segmented is worth d = 0.42 and learner-segmented d = 0.19 (n.s.), so **do the
segmenting rather than handing over a scrubber.** **[A]**

### 6.9 Signal structure heavily **[A]**
The single best-evidenced lever available: g+ = 0.53 retention / 0.33 transfer across 103
studies, N = 12,201, and **the only principle that survives the learner-paced moderator
cleanly**. Bold key terms, headings that match the outline, explicit "there are three steps"
advance sentences, inserted enumeration.

Dose has a ceiling: 27 graphic organizers → d = −0.03; 18 → d = 0.58; 10 → d = 0.45.
Highlighting everything highlights nothing.

> **[B] Caveat:** signaled texts produce recall better organized by topic and covering more
> topics, but *less recalled about each topic*. Signaling redistributes attention; it doesn't
> create it.

### 6.10 Misconceptions: state and refute adjacently **[A]**
Refutation structure — state the misconception, cue the refutation, give the causal
alternative, in that order, visually adjacent. Repeating the myth once is safe; the backfire
effect is not a real design constraint here.

**Never activate prior knowledge without immediately correcting it.** Activation without
refutation is the documented failure mode, and one study found learners with confident-wrong
prior knowledge *dropped concepts from further study* — they stopped studying exactly what
they had wrong.

> **[D] Magnitudes:** refutation text is g = 0.41 overall — but **g = 0.11, non-significant,
> in unpublished dissertations**, and publication type was the only significant moderator.
> Conceptual-change strategies are g = 1.10 in the literature but 0.64 in true experiments
> and 0.71 after trim-and-fill. Direction survives; magnitude mostly doesn't.

### 6.11 Analogies: map explicitly, break explicitly, prefer two **[B]**
Every analogy must state **how** it fails, not merely that it does. Boilerplate disclaimers do
not work: misconceptions from analogies occur "even when teachers and texts are explicit in
stressing the inadequacy of an analogy… when analogies are used to 'start simple,' the
knowledge ultimately acquired often stays simple."

Where one analogy misleads, pair it with a second chosen to correct that specific distortion.
Novices map surface features, so the structural mapping must be made explicit rather than
left to the reader.

**Delete analogies for readers the diagnostic places above the material** — §6.2's row 2. For
a reader who already has adequate understanding of the target, an analogy "adds unnecessary
information."

### 6.12 Declare oversimplifications, correct them later **[C]**
"For the next three sections I'm going to pretend there's one attention head and no
positional information. Both are wrong and I'll fix them in §5 and §6." Tracked in
`meta.oversimplifications`; §8 verifies each declared one is actually corrected.

### 6.13 Every node carries its assumptions and one wrong turn **[B]**
The structural fix for expert blind spot, which does not respond to telling the author to be
clearer. Experts mispredict novice difficulty badly (tappers predicted 50% recognition,
listeners got 2.5%; salespeople predicted <13 min, novices took ~30), **intermediates predict
better than experts**, and debiasing only partially corrects it. More domain education made
teachers' predictions *worse* — high-school teachers' difficulty rankings were unrelated to
actual student performance while middle-school teachers' correlated at τ = .733.

So don't rely on the generator's judgment about difficulty. Force `assumes` and `wrongTurn`
on every node and check them mechanically.

### 6.14 The and/but/therefore test **[C]**
Run over the outline: if adjacent nodes connect with "and then… and then…", the spine is a
list, not an explanation. Replace with "therefore" and "but". Institutional adoption, no
controlled evidence, but it's a cheap test that can run programmatically.

### 6.15 End on next actions, not a recap **[C]**
Alammar's ending is 144 words of pure link dump. Where a recap exists across exemplars it is
three numbered lines maximum. Deep-link out rather than explaining down.

### 6.16 Banned outright
- **Fun asides, fun facts, decorative imagery.** g = −0.16 to −0.33, worst when persistent on
  screen (−0.43), text+image combined (−0.87), placed at the end (−0.70), and **for novices
  (−0.52)**. Every graphic type raises satisfaction by d ≈ 0.85–1.25; only instructive ones
  raise recall (11.08 vs 6.66 for seductive, out of 25). **[A]**
  *The instinct this preserves:* emotional design of the **essential** graphics is worth
  g = 0.35 and conversational second-person voice g = 0.33. Make the content charming; do not
  bolt charm onto the side.
- **Points, badges, leaderboards, streaks.** Under high-rigor designs only the cognitive
  effect survives gamification meta-analysis; motivational g = .22 (p = .20) and behavioral
  g = .27 (p = .22) both go non-significant, and pure competition goes negative (g = −.09).
  Badges, leaderboards, competition and points are the four mechanics most implicated in
  documented negative effects. Completion-contingent rewards run d = −0.36 on intrinsic
  motivation while **informational feedback runs +0.33** — same pixel, opposite sign. Ship
  the one that reports competence. **[B]**
- **Any satisfaction rating, thumbs-up, or "was this helpful".** Felt learning runs −0.56 SD
  against measured learning (+0.46 SD), and only *perceived fluency* predicted felt learning.
  Predicted recall was 4.8/4.2/4.0 where actual recall was 40%/56%/61% — a perfect rank-order
  reversal. The illusion **survives explicit warning**. A rating widget would systematically
  select the version that teaches less. **[A]**
- **Reading timers, countdowns, estimated-time-remaining.** Screen inferiority (g = −0.21)
  *increases under time pressure* and vanishes when self-paced, and is concentrated in
  expository text — this exact genre. **[A]**
- **Answer-until-correct.** Tested head-to-head against standard feedback: .71 vs .71 final
  recall, .53 vs .52 correction rate. Identical, at the cost of extra exposure to lures. **[A]**
- **Progress gating on score.** See §7.
- **Concept-map navigation.** Hyperlinked maps vs. hyperlinked outlines: g = 0.017, n.s. **[B]**

---

## 7. Quiz rules

### 7.1 Every question ships its explanation, immediately **[A]**
Non-negotiable, and the highest-leverage rule in the document. A question the reader is
likely to fail, **with no feedback, is worth g = 0.03** (p = .79). With feedback, g = 0.73.
Right/wrong-only feedback d = 0.05; correct answer d = 0.32; **explanation d = 0.49.**

Spend the budget on errors, not confirmations: supplying the correct answer after an error
raised 1-week retention by 494%, while feedback after correct answers did essentially nothing.

**On timing** — the delayed-feedback literature is a lab artifact here. ManyClasses 1
randomized immediate vs. delayed across 38 authentic college classes: effect of timing
**0.002 [−0.05, 0.05]**, no reliable moderators. Show it immediately.

### 7.2 Three options, all genuinely competitive **[A]**
Never four. ~2/3 of items on real standardized tests have only 1–2 effective distractors and
the modal number of functioning distractors is **one**; lure intrusions rise linearly with the
number of alternatives.

**And the distractors must be competitive, which inverts common practice.** MC practice with
competitive alternatives improved final recall of information corresponding to the *incorrect*
options — questions never previously asked — at d = 0.43 and d = 0.59. Cued recall produced no
such benefit. The reader must retrieve why each wrong option is wrong, which makes distractors
into retrieval cues. **Implausible distractors forfeit the only unique learning advantage MCQ
has.**

The risk being traded against: MC testing raises lure production from 7% to 16%, and errors
produced by *reasoning* persist at 36%. **Feedback is the resolution** — it cuts intrusions
(d = .65–.81) while roughly doubling correct responses. Which is §7.1 again.

*Good item:* "In the decoder, self-attention is masked. Why?" — (a) to prevent attending to
padding tokens [masking *is* used for padding, elsewhere]; (b) to prevent position i attending
to positions > i [correct]; (c) to reduce the O(n²) cost [a real motivation for *other*
attention variants]. All three are things a half-informed reader actually believes.

*Worthless item:* "How many encoder layers? (a) 6 (b) 400 (c) purple."

### 7.3 Paraphrase, never quote **[A]**
Rephrased questions still deliver g = 0.558 vs 0.512 for verbatim — paraphrasing is free in
learning terms and buys validity, since verbatim items measure text-matching.

### 7.4 Format: cloze default **[D]**
Three meta-analyses produce three mutually incompatible orderings (lab: free recall 0.81 >>
recognition 0.36; Adesope: MC 0.70 > short answer 0.48; classroom: fill-in-blank .773 > MC
.567 > free recall .238). What survives the disagreement is that **format-match matters**
(matched g = 0.531 vs mismatched .399) and that four experiments found no significant
difference among short-answer, MC and hybrid at one week.

Cloze is chosen because it is high-success (success rate matters enormously per §7.1), cheap
to generate, and scores second in the only classroom meta-analysis. **This is the weakest
recommendation in the document.** Do not over-invest in format.

### 7.5 Ungated, always **[A]**
High-stakes quizzes g = 0.441, low-stakes g = 0.477 — no significant difference across 222
studies / 48,478 students. **The full retrieval benefit is available from ungraded, ungated
questions.** Meanwhile 32 studies compared completion under gating; **23 of 32 found higher
completion in the ungated control** (mean h = −0.14, p < .01), and the achievement gain was
checked and is *not* a survivorship artifact — so both effects are real and independent. You
would be paying completion for nothing.

Give mastery *feedback* without mastery *gating*: "you missed 3 of these — revisit §4?"

> **[D]** Nicky Case reports the opposite from playtests, having added content gating
> because explorers skimmed past things they didn't know. The difference is audience — his
> readers came to play a game. If gating at all, gate on *narrative dependency*, never score.

### 7.6 Confidence toggle routing **[D]**
"Sure / not sure" beside each answer. Wrong + sure → the long explanation, refutation framing,
and a re-ask several nodes later. Wrong + not sure → correct answer and a pointer.

High-confidence errors are corrected more often than low-confidence ones via surprise and
richer semantic networks — **but this is genuinely contested for conceptual material**, where
one study got the reverse (low-confidence 61.0% corrected, high-confidence 35.8%).
Hypercorrection may be a fact-retrieval phenomenon. And it is not durable: the effect persists
a week **but high-confidence errors return**. Hence the re-ask.

### 7.7 Dosage: one retrieval opportunity per conceptual segment **[D]**
Quiz dosage is contested three ways (1 > many; n.s.; monotonic increase), probably a spacing
confound — extra tests *within* a session add little, extra tests *across* days add a lot.
**Don't assert a number.**

What is solid: testing at segment boundaries improved cumulative performance and integration
(82.2% vs 66.2% clustering, d = 0.70) with *lower* reported anxiety and cognitive demand.

**This document is a single session, so calibrate expectations down.** Quantum Country is the
nearest exemplar — 112 questions every 400–800 words — and only **29% of readers who finished
the in-text level finished the 1-month level.**

### 7.8 A self-explanation box may be as good as a quiz, and is safer to generate **[B]**
Retrieval practice vs. no activity: g = 0.610. Vs. restudying: g = 0.330. **Vs. other
elaborative strategies (concept mapping, note-taking, self-explanation): g = 0.095.**
Self-explanation prompts independently measure g = 0.552, and work identically with or without
an interface or diagrams — *the prompt does the work, not the interface.*

Given §8's generation risk, a "explain in one sentence why X" box is cheap, has no wrong
answer to get wrong, and is not clearly worse. Include one per core node. Say "conceptualize",
not "reflect".

### 7.9 Pre-questions sparingly, never as a gate **[D]**
2–3 items on the central claims only. Lab evidence is strong (5/5 experiments beat extended
study; n = 1,573 replication across formats, with and without feedback). **Field evidence is
much weaker:** pre-class quizzes g = 0.186 vs post-class g = 0.536.

And they are narrow: specific effect g = 0.54 on prequestioned content, **general effect
g = 0.04 on everything else** — in reading tasks they may *impair* learning of
non-prequestioned content. Prequestions don't help you learn the document; they help you learn
the three facts you asked about. So ask only about the central claims, and make sure the
answers appear prominently soon after.

"Does pretesting demotivate?" — **no direct evidence either way.** Don't claim it in either
direction.

---

## 8. Phase 7 verification

The report's one product-specific warning: for an LLM-generated explainer, **distractor and
explanation quality is a higher-leverage engineering problem than the adaptation logic.** The
recurring failure modes named across 2024–25 papers on LLM-generated MCQs are hallucinated
facts, inconsistent rationales, and superficial distractors — and §7.1 says a wrong
explanation is worse than no question, while §7.2 says an implausible distractor forfeits
MCQ's entire unique benefit.

**Blocking checks** — build fails, must be repaired:

1. Every quiz `explanation` is grounded in a `sources[].locator` that exists in the source.
2. Every MCQ has exactly 3 options, exactly 1 correct, and every distractor's `why` names a
   specific misreading a half-informed reader would hold.
3. No stem or option contains a verbatim span >8 words from the source.
4. Every `assumes` id resolves to a concept introduced by a lower-`order` node, a prereq node,
   or a diagnostic item the reader passed.
5. Every core node has a `wrongTurn`.
6. Every entry in `meta.oversimplifications` has a `correctedIn` that exists.

**Warnings** — reported, not blocking:

7. `diagram.cueCount` > 10.
8. Any prose block > 250 words without a visual or structural break.
9. Adjacent nodes connected by "and then" rather than "but"/"therefore" (§6.14).

---

## 9. Diagram rules

### 9.1 Parts *and* causal actions, or don't draw it **[A]**
The definitive study ran four conditions — none / parts labeled / steps labeled /
parts-and-steps. Only **parts-and-steps** improved performance, on recall of *conceptual*
information and creative problem-solving (not verbatim retention), and mainly for
**low-prior-knowledge** readers. **Labeling the parts alone did nothing.**

A box diagram of "Encoder → Decoder" is parts-only and useless. Q/K/V flowing through
matmul → scale → mask → softmax → matmul, with tensor shapes annotated on each edge, is
parts-and-steps.

### 9.2 Labels on the graphic, not in a caption **[A]**
Spatial contiguity g = 0.63 [0.55, 0.71], k = 58; contiguity overall g = 0.74, k = 46. The
cheapest, highest-return change available to any figure, and it beats animation by 3×.

### 9.3 Spreading color along a path — not arrows **[B]**
Arrows are the weakest common cue and repeatedly null: spreading-color d = 0.75 vs. arrows
**d = −0.03** in the same lesson; arrows d = 0.24 elsewhere with eye-tracking confirming the
arrows *did* direct attention. Attention moved; learning didn't.

Cues emphasizing a **progressive path** measure d = 1.42 vs. cues highlighting a **sequence of
individual entities** d = 0.21. Also near-null: color change alone (d = −0.07), spotlighting a
mechanism (d = 0.04). Working: spotlighting *processes* d = 0.81, zoom-to-relevant d = 0.63,
temporarily color-changing labels d = 0.74, text–diagram integration signals d = 0.85.

### 9.4 Simplify below realism; static sequences over animation **[A]**
Simplified structural diagrams beat detailed more-accurate ones on factual learning and
information integration. Animation vs. static is g = 0.226 overall and **decorational
animation is g = −0.05** — flat zero; animation earns its cost mainly for procedural-motor
content. **System-paced beat learner-paced animation (g = 0.309, p = .003) — giving people a
scrubber does not help.** If chunking is needed, use discrete "continue" steps.

### 9.5 The four diagram types that carry a paper **[C]**
1. **Onion** — black box, then one layer deeper, **redrawing the same diagram with one more
   thing in it.** Never replace the reader's mental image; annotate it. (Alammar's cascade;
   Ciechanowski's "Mechanical Watch" adds exactly one part across 14 sections.)
2. **Data flow with shapes on the edges** — where §9.2 pays.
3. **Before/after on the same axes** — this is the *problem statement* rendered visually and
   belongs early, not in results.
4. **The result figure redrawn honestly** — keep the error bars, name the baseline.

Prefer the paper's own figure where it is already the clearest thing; extract rather than
redraw.

---

## 10. The template

`assets/template.html` — debugged once, carries all CSS and JS. Generation produces only the
`NODES` literal. This keeps page logic from being re-derived and re-broken on every run, makes
generation cheap, and makes every explainer behave identically.

**Layout.** Persistent sidebar tree (folder-style, expand arrows, ⚡ prereq, ✓ passed) +
content pane showing one node at a time. Overview stays visible; depth is adjacent, not hidden
— expandable indexes tested ~50% slower than sequential menus and "drastically worse" at depth
4, while a persistent overview produced higher essay grades and 19/20 preference. **[B]**

**Navigation.** A prominent `Next` makes forward the path of least resistance; the tree stays
fully clickable. The reader lands on node 1, not on a chooser. Free hypertext navigation
actively harms low-prior-knowledge readers — a coherence-driven reading order beat an
interest-driven one on inference questions, with no difference for readers who already knew
the area, and the mediator is reading-order coherence rather than link count. **[A]**

Keyboard: `←`/`→` or `j`/`k`. A persistent "jump back to §N" affordance, since
low-working-memory readers are disproportionately hurt by scrolling.

**State.** `localStorage`, keyed by slug: which nodes are done, quiz answers, confidence
flags, tree expansion. Every read and write wrapped in try/catch; the page must render
correctly with storage unavailable.

**Theme.** Tokens on `:root`, redefined under `@media (prefers-color-scheme: dark)` guarded by
`:root:not([data-theme="light"])` and under `:root[data-theme="dark"]`. Explicit toggle.
`body` gets an explicit background.

**Print.** Expands everything, prints linearly, quizzes render with answers in an appendix.

**Not present:** timers, estimated reading time, ratings, badges, points, streaks, scrubbers.

**One honesty note at the top of every document,** per the only intervention with evidence
behind it against the fluency illusion: a short up-front line telling the reader that the
version that teaches better will feel worse than being told the answer.

---

## 11. Files

```
skills/research-explainer/
  SKILL.md
  assets/template.html
  reference/authoring-rules.md      # §6–§9, with evidence grades
  reference/evidence.md             # calibration table, what NOT to build on
  docs/2026-09-16-research-explainer-design.md

~/explainers/<slug>/
  index.html
  nodes.json
  figures/
  sources.md
```

---

## 12. Calibration — do not build on these

| Claim | Status |
|---|---|
| "Chunk into N-minute pieces" | Folk wisdom. Segment size never tested as a moderator |
| "6-minute videos" | Watch-time correlation, n=4 courses, disclaimed by its own authors |
| "7±2 items" | Wrong memory system, wrong task, wrong number |
| "Flatter is always better" | Mis-citation — medium breadth/depth beat broadest-shallow |
| "Pagination aids comprehension" | Well-powered 2025 replication: p = 0.93 |
| Progressive disclosure "30–50% faster" | Unsourced agency-blog numbers; Nielsen's article has no data |
| Mayer's effect sizes | Unweighted medians of his own lab, ~2–5× independent estimates (g ≈ 0.37) |
| Advance organizers | d ≈ 0.21, badly-defined construct, dropped from Hattie's updated list |
| Concept maps vs. outlines | g = 0.278; **in hypertext g = 0.017, n.s.** |
| Hypercorrection on conceptual content | Contested — one study got the reverse |
| Question format rankings | Three meta-analyses, three incompatible orderings |
| Quiz dosage | 1 > many / n.s. / monotonic. Probably a spacing confound |
| Bloom's 2-sigma | Does not replicate; modern tutoring meta-analyses ~d = 0.36 |
| ICAP ordering | A *hypothesis* supported by post-hoc reinterpretation; published 2023 critique |
| KWL | No meta-analysis in 40 years; citation count reflects adoption, not validation |
| "Knowledge shields" | Unverifiable — theoretical construct, no empirical test found |
| Expertise reversal itself | I² = 88–91%; two meta-analyses found prior knowledge was *not* a moderator |

**The one-line version of the whole evidence base:** wherever a headline effect size appears,
the quality-adjusted figure is roughly half. The *direction* of nearly every finding survives;
the *magnitudes* mostly do not.

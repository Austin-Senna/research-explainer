# Authoring rules

Read this before writing any node. Evidence grades are defined in `evidence.md`; the caveats
matter as much as the rules.

## Enforced by the verifier — a violation fails the build

1. **Every quiz question carries an explanation.** Without one, a question the reader is likely
   to fail is worth **g = 0.03** instead of **g = 0.73**. (§7.1)
2. **Every MCQ has exactly three options, one correct, and each distractor carries a `why`**
   that names a specific misreading. Implausible distractors forfeit the only unique learning
   advantage MCQ has. (§7.2)
3. **Every node declares what it `assumes`, and nothing may assume a concept introduced later.**
   This is the structural fix for expert blind spot, which does not respond to being told to
   write more clearly. (§6.13)

---

## Content

### 6.1 Spiral restatement, not level-forking **[C]**
State each idea three times **in reading order**: intuition → concrete worked instance →
formalism. Three consecutive paragraphs, never three switchable versions. The Illustrated
Transformer does exactly this: self-attention at 265 words conversational, 573 words as a
numbered recipe on literal vectors, then 114 words of matrix notation. The expert skims the
first two, the novice reads all three, nobody classifies themselves. Across Distill, Alammar,
Nicky Case, Bret Victor, 3Blue1Brown, Google PAIR, Seeing Theory, Setosa, Ciechanowski, Lilian
Weng and Quanta, **not one offers a difficulty toggle.**

All three layers ship to every reader **of a core node**, but not all on screen: the intuition
and the concrete instance are the body, and the formal layer renders collapsed under **Details**,
opened by the reader who wants it (`teach`'s "smallest complete account first, add layers when
asked"). A reader who wants more than Details asks the chat or the tutor; the page does not try
to pre-answer every follow-up. A `prereq` or `extension` node is
support, not the paper: it gets the intuition and one concrete instance, and a formal layer only
when the core nodes lean on its notation. What the diagnostic removes is never a whole layer of a
core node. It is specific *elements* inside one, most often the analogy in the intuition layer.

### 6.2 Where content differs by expertise, it is these swaps — not "more detail" **[B]**
Expert values are *negative*: active harm, not indifference.

| Dimension | Low prior knowledge | High prior knowledge | d(nov) / d(exp) |
|---|---|---|---|
| Text beside a diagram | Integrate it *into* the diagram | **Delete it** — not shorten | +1.89 / −0.88 |
| Representation | Concrete, iconic, analogical | **Abstract, symbolic** | +1.60 / −1.39 |
| Procedure | Fully worked example | **A problem to solve** | +1.20 / −0.36 |
| Complex material | Isolated elements, then assembled | **Straight to the interacting form** | +1.13 / −0.56 |
| Organizers, knowledge maps | Provide | **Remove** — a plain term list beats a map | +0.61 / −0.85 |

The cost to an expert is not reading time. Their schema and the text both claim jurisdiction
over the same information, and the load is imposed *even when they recognize the material as
redundant and decide to ignore it*.

> **[D] Weakest in this exact medium.** Established with fixed printed diagrams and
> system-paced narration. A web page with headings and a scrollbar is the most skippable medium
> there is. Two meta-analyses found prior knowledge was *not* a moderator. Don't over-tune.

### 6.3 Check element interactivity first **[B]**
The worked-example apparatus only pays on **high element-interactivity** material — pieces that
only make sense together. On low-EI material the effect reverses: generation beats worked
examples even for novices. Design principles are worth g = 0.70 on complex material vs 0.20 on
simple. *"Here are the hyperparameters"* → just list them. *"Why does multi-head help"* → spend
the budget.

### 6.4 Fade worked examples backward **[B]**
Full worked example → same shapes with the last step blank → full problem. Backward fading is
more time-efficient than forward for equal transfer.
> **[D]** Only *adaptive* fading beat plain problem-solving in the two Salden studies; fixed
> fading did not. Expect less here than the headline suggests.

### 6.5 The idea first, then its name **[B] + [U]**
Explain what a thing does in plain words, then name it: "compare each attempt with how the group
did on average, and keep the margin. That margin is called the **advantage**." Never the
reverse ("The **advantage** is..."): a term met before its idea is one more thing to hold while
the reader waits for it to mean something. The verifier warns `NAME_FIRST` when an intuition
opens on a bold term.

The pre-training evidence (knowing the names and parts before the mechanism helps transfer) is
still honoured, inside the node instead of in front of it: each part is named the moment it has
been explained, before the mechanism uses it. There is no terms-only node 0. A real reader found
one dense with jargon and skipped it.

Name only what the rest of the page uses again. A term used once does not need a name; say what
it means and move on. Give each concept one name and keep it.

### 6.6 Lead with motivation, never a definition **[C]**
Universal across every exemplar; none does the opposite. *"Topic definitions should not be seen
as a starting point, but an ending point."*

### 6.7 The paper spine **[C]**
Front-load a five-sentence *"what this paper claims, and whether it held up"*, then:
**problem → why prior approaches fail → the one key insight → mechanism → results → limitations.**

No controlled experiment compares this to alternatives. The components have evidence: explicit
section labels (median d = 0.41, **strongest for low-prior-knowledge readers**) and coherence,
the largest and most consistent effect in the corpus. On suspense vs. front-loading: the one
direct experiment found chronological structure consumed *more* cognitive resources and scored
*lower* on comprehension. **There is no experimental support for suspense.**

### 6.8 Short units, and length follows importance **[C] + [U]**
Budgets per node, counting the spiral and the wrong turn (the verifier warns `OVER_BUDGET`):
**prereq 150 words, extension 200, core 350.** A real reader found every section the same
length and the background as long as the paper's own claims; measured, prereqs averaged 335
words against 313 for core. Support should be skimmable in under a minute. Spend the words where
the paper is. If a prereq needs more than 150 words, it is either two prereqs or the reader
should be sent to a resource at the Phase 4 gate.

Write in the plain spoken register of a senior engineer explaining to a colleague: the smallest
complete account first, then stop. No framing labels ("the key insight", "the one idea to hold
onto", "here is where it gets interesting"), no announcing that something is hard or important,
no preview of what is coming. Periods over commas; one or two commas a sentence.

No unbroken block over ~250 words. Alammar's median section is ~210 words with an image every
~95; *Evolution of Trust* runs ~103 words per slide in ~15-word blocks; Google PAIR uses ~80-word
scroll steps. **Nobody in this set writes a 600-word unbroken block.** Segment on conceptual
seams, not word counts — there is no magic number in the research. But do the segmenting
yourself: instructor-segmented d = 0.42, learner-segmented d = 0.19 (n.s.). **[A]**

### 6.9 Signal structure heavily **[A]**
The best-evidenced lever available: g+ = 0.53 retention across 103 studies, N = 12,201, and the
only principle that survives the learner-paced moderator cleanly. Bold key terms, headings that
match the outline, explicit "there are three steps" advance sentences, inserted enumeration.
Dose has a ceiling: 27 organizers → d = −0.03; 18 → 0.58; 10 → 0.45.
> **[B]** Signaling redistributes attention, it doesn't create it — signaled texts recall more
> topics but *less about each topic*.

### 6.10 State misconceptions and refute them adjacently **[A]**
Misconception → refutation cue → causal alternative, in that order, visually adjacent. Repeating
the myth once is safe; the backfire effect is not a real design constraint here.
**Never activate prior knowledge without immediately correcting it.** Activation without
refutation is the documented failure mode, and learners with confident-wrong prior knowledge
*dropped concepts from further study* — they stopped studying exactly what they had wrong.

### 6.11 Analogies: map explicitly, break explicitly, prefer two **[B]**
State **how** it fails, not merely that it does. Boilerplate disclaimers do not work:
misconceptions from analogies occur *"even when teachers and texts are explicit in stressing the
inadequacy of an analogy… when analogies are used to 'start simple,' the knowledge ultimately
acquired often stays simple."* Where one analogy misleads, pair it with a second chosen to
correct that specific distortion. Novices map surface features, so make the structural mapping
explicit. **Delete analogies for readers the diagnostic places above the material** — for them
an analogy "adds unnecessary information."

### 6.12 Declare oversimplifications in the data, correct them plainly **[C] + [U]**
Simplifying first and correcting later is still right. Record each one in
`meta.oversimplifications`; the verifier checks it is actually corrected. What changed is the
voice: state the simplification as a fact about the subject ("these numbers are as reported,
before any contamination audit"), never as the author narrating a plan ("I am going to take every
number at face value, which is wrong, and I will fix it"). The correcting section states the
correction; it does not recall the earlier pretence. A real reader found the narrated version
odd, and `NARRATION` warns on it.

### 6.13 Every node carries its assumptions and one wrong turn **[B]**
Experts mispredict novice difficulty badly — tappers predicted 50% recognition, listeners got
2.5%; **intermediates predict better than experts**; debiasing only partially corrects it. More
domain education made teachers' predictions *worse*. So don't rely on your own judgment about
difficulty: emit `assumes` on every node and let the verifier check it. Emit `wrongTurn` on every
core node; on a prereq or extension only when there is a misconception worth its share of the
150 or 200 words.

### 6.14 The and/but/therefore test **[C]**
If adjacent nodes connect with "and then… and then…", the spine is a list, not an explanation.
Replace with "therefore" and "but".

### 6.15 End on next actions, not a recap **[C]**
Alammar's ending is 144 words of pure link dump. Where a recap exists across exemplars it is
three numbered lines maximum. Deep-link out rather than explaining down.

### 6.17 Teach the axis, never the list **[U]**
When a node introduces several related things — methods, approaches, variants — **name the
dimension they vary along before naming any of them.** A flat list is a memorisation task; an axis
is an explanation.

*Observed failure:* a node listed SFT, DPO, PPO and GRPO with a one-line description each. The
reader could not work out why anyone would pick one, asked twice, and only understood once the
node was rewritten around a single axis: **each one removes a component.** PPO holds four models;
GRPO deletes the critic; DPO deletes the whole loop. Same four things, same facts, now a structure
that predicts which you would reach for.

The test to run on any node introducing three or more siblings: *if the reader remembered the
axis and forgot every name, could they reconstruct the list?* If not, you wrote a list.

### 6.18 Two confusable things must be told apart explicitly **[U]**
If a node uses two terms a reader could conflate, **say what distinguishes them in a sentence of
its own** — do not rely on the definitions being adjacent.

*Observed failure:* a node used *reward model* and *critic* in consecutive paragraphs without
ever stating they are different objects. The reader concluded the critic **was** the reward model,
and therefore that GRPO deleting the critic meant GRPO had no way to score anything. One sentence
prevented it: *the reward model scores a finished answer; the critic predicts how a partial attempt
will turn out.*

This is where discrimination actually fails — not on hard concepts, but on adjacent ones with
overlapping roles. Candidates to check in any node: two things that both "score"; two that both
"predict"; an object and the process that produces it; a method and the pipeline containing it.

### 6.19 When B is a modification of A, derive it — never present them side by side **[U]**
GRPO is PPO minus the critic. DPO is RLHF minus the loop. Presented as three peers in a list, a
reader has to hold three independent objects and guess at their relationships — and will guess
wrong, because the names give no clue that two of them descend from the third.

Build A fully, including *why each of its parts exists*, then introduce B as a deletion or
substitution. The reader then gets B nearly free, and — more importantly — understands what B
gave up.

*The tell that you got this wrong:* the reader asks whether X is an improved version of Y, when X
and Y are actually siblings that both modify Z.

### 6.21 Name the source at the claim **[U]**
A claim from someone else names them, with a link, in the sentence that makes it:
"[PostTrainBench](https://arxiv.org/abs/2603.08640) found agents editing their own evaluation in
23 runs", never "one of these papers found" or "researchers have shown". The reader should never
have to guess whose result a number is. Write links as `[title](url)`; the page renders them.
Every node also lists its `sources` under its subtitle, with locators, so the section's origin is
visible before the body. The verifier warns `UNNAMED_SOURCE` on an attribution with no link.
*Observed failure:* a reader could not tell who "the researchers" were.

### 6.22 What could not be checked goes in `caveats` **[U]**
Notes about verification (a paper that could not be opened, a number taken from a search snippet,
a claim nobody could locate, a test that was not run) go in the node's `caveats` field, never in
the explanation. The page shows them collapsed, small and grey, under "What could not be checked".
They matter for trust and stay honest, but a reader learning the idea should not have to read
past them. Write them as plain statements of what is uncertain and what not to rely on. The
verifier warns `CAVEAT_IN_BODY` when such a note sits in the spiral. They do not count toward the
word budget.

### 6.16 Banned outright

- **Fun asides, fun facts, decorative imagery.** g = −0.16 to −0.33, worst when persistent on
  screen (−0.43), text+image combined (−0.87), at the end (−0.70), and **for novices (−0.52)**.
  Every graphic type raises satisfaction by d ≈ 0.85–1.25; only instructive ones raise recall.
  *What this preserves:* emotional design of the **essential** graphics is worth g = 0.35, and
  conversational second-person voice g = 0.33. Make the content charming; don't bolt charm on. **[A]**
- **Points, badges, leaderboards, streaks.** Under high-rigor designs the motivational and
  behavioral effects go non-significant and pure competition goes negative. Completion-contingent
  rewards run d = −0.36 on intrinsic motivation while **informational feedback runs +0.33** —
  same pixel, opposite sign. **[B]**
- **Any satisfaction rating or "was this helpful".** Felt learning runs −0.56 SD against
  measured learning, only *perceived fluency* predicted felt learning, and the illusion
  **survives explicit warning**. A rating widget selects for the version that teaches less. **[A]**
- **Reading timers, countdowns, estimated time remaining.** Screen inferiority increases under
  time pressure and vanishes when self-paced. **[A]**
- **Answer-until-correct.** Tested head-to-head: .71 vs .71 final recall, .53 vs .52 correction
  rate. Identical, at the cost of extra exposure to lures. **[A]**
- **Score-based progress gating.** See §7.5.
- **Concept-map navigation.** In hypertext, g = 0.017 against a plain outline. **[B]**
- **Narrating the page or the reader's feelings.** No "I am going to", no "this will feel
  slower", no framing labels ("the key insight", "here is where it gets interesting", "this is the
  tricky part", "at its core"), no announcing that a part is hard or important. Just say it.
  The verifier warns `NARRATION`. (The masthead's old note that the questions "feel slower" had
  evidence behind it, spec §10; it was dropped once the effortful part moved into the opt-in
  tutor.) **[U]**
- **Em dashes.** Use a period, a colon or a comma. Prefer periods: one or two commas a sentence,
  and split a sentence whose clauses pile up. The verifier warns `EM_DASH`. **[U]**

---

## Quizzes

### 7.1 Every question ships its explanation, immediately **[A]**
Non-negotiable and the highest-leverage rule here. No feedback → **g = 0.03** (p = .79). With
feedback → **g = 0.73**. Right/wrong only d = 0.05; correct answer d = 0.32; **explanation
d = 0.49**. Spend the budget on errors: the correct answer after a mistake raised one-week
retention by **494%**, while feedback after correct answers did essentially nothing.
**Show it immediately** — ManyClasses randomized timing across 38 real classes and got an effect
of **0.002**.

### 7.2 Three options, all genuinely competitive **[A]**
Never four. Two thirds of items on real standardized tests have only 1–2 effective distractors,
and lure intrusions rise linearly with option count. **And the distractors must be competitive.**
MC practice with competitive alternatives improved recall of information corresponding to the
*incorrect* options — questions never asked — at d = 0.43 and 0.59. The reader must retrieve why
each wrong option is wrong, which turns distractors into retrieval cues.

*Good:* "In the decoder, self-attention is masked. Why?" — (a) to prevent attending to padding
tokens [masking *is* used for padding, elsewhere]; (b) to prevent position i attending to
positions > i [correct]; (c) to reduce the O(n²) cost [a real motivation for *other* variants].
All three are things a half-informed reader actually believes.

*Worthless:* "How many encoder layers? (a) 6 (b) 400 (c) purple."

### 7.3 Paraphrase, never quote **[A]**
Rephrased g = 0.558 vs verbatim 0.512 — paraphrasing is free and buys validity, since verbatim
items measure text-matching.

### 7.4 Multiple choice only **[D] + [U]**
Every question is a three-option MCQ (§7.2). No cloze, no free-text blanks.

The format evidence is weak in every direction: three meta-analyses give three incompatible
orderings, and four experiments found no significant difference among short-answer, MC and hybrid
at one week. With format a wash, the observed failure decides it.

*Observed failure:* a reader got "Not quite." on a cloze ("short ___ loops") whose only accepted
answer was the author's exact word, and asked for multiple choice instead. A typed blank grades
recall of one word, so a reader who understood the idea in other words still fails it. MCQ grades
the idea, and its distractors carry the misreadings (§7.2). A leftover `cloze` fails the build (`CLOZE_UNSUPPORTED`).

### 7.5 Ungated, always **[A]**
High-stakes g = 0.441 vs low-stakes g = 0.477 across 222 studies — **the full retrieval benefit
comes from ungraded, ungated questions.** Meanwhile **23 of 32 studies found higher completion
in the ungated control**, and the achievement gain was checked and is not a survivorship
artifact. Gating pays completion for nothing. Give mastery *feedback* without mastery *gating*.

### 7.6 Re-ask every miss, no confidence rating **[D] + [U]**
Any wrong answer is asked again three nodes later; right answers never are. Spend the budget on
errors (§7.1).

Confidence routing (wrong + sure gets a re-ask, wrong + unsure does not) was removed. Its evidence
was contested on conceptual material, where one study got the reverse, and a reader asked for the extra
"How sure are you?" step on every question to go.

### 7.7 Questions only where the claims rest: central nodes **[D] + [U]**
A node is **central** when a sentence of `meta.claimSummary` depends on it: remove the node and
that claim is left unexplained. Mark it `central: true` with `supports: [i]`, the 0-based indexes
of those sentences (the verifier fails `CENTRAL_NO_CLAIM` otherwise). Write the claimSummary
first; centrality follows from it, not from how interesting a node is. Keep it to the few the
claims rest on, at most about half the core nodes (`TOO_MANY_CENTRAL`).

Only central nodes carry questions, and none of them sit on the section page. Each central node
gets **one** multiple-choice question and a `selfExplain` prompt with its model answer. Quiz time,
after each big section, asks the multiple choice first (instant, no Claude), then two
conversational questions aimed at what the multiple choice missed; the `selfExplain` prompt seeds
the tutor's question for its section. Other nodes carry none (`QUIZ_OFF_CENTRAL`). A real reader
found a quiz after every section heavy, and the page's quiz duplicated the tutor's.
Dosage is contested three ways; don't assert a number.

### 7.8 A self-explanation box may be as good as a quiz **[B]**
Retrieval vs. no activity g = 0.610; vs. restudy 0.330; **vs. other elaborative strategies
0.095.** Self-explanation prompts independently measure g = 0.552 and work the same with or
without an interface — *the prompt does the work, not the interface.* Include one per core node.
Say "conceptualize", not "reflect".

### 7.9 Pre-questions sparingly, never as a gate **[D]**
2–3 items on central claims only. Field evidence is much weaker than lab: pre-class g = 0.186 vs
post-class 0.536. And narrow: **specific effect g = 0.54 on prequestioned content, general effect
g = 0.04 on everything else.** They don't help you learn the document; they help you learn the
three facts you asked about.

### 7.10 The opening prediction: few, reasoned from the overview, aimed at the central claim **[D] + [U]**
The default tutor opens a node with `quiz.predict` only when the node has one, and most nodes
should not. Write it only for **central** nodes (§7.7), and not necessarily all of them (the
verifier warns `PREDICT_OFF_CENTRAL`). A prediction before every section is a toll on reading, and §7.9's
evidence says the benefit lands only on what was asked. Everything else opens straight into its
body. Given §7.9's narrow effect, it targets the
node's central claim, never a side detail. And because the reader has only read the overview and
the hook, it must be answerable by reasoning from those two, not by recall: "if you ran RL on a
model that has only been pretrained, why might it learn almost nothing?", never "on RE-Bench at 32
hours, how did experts compare?". One question, ending in "?", no options. A wrong guess is fine;
the follow-up works from it.

---

## Diagrams

### 9.1 Parts *and* causal actions, or don't draw it **[A]**
Four conditions were tested — none / parts labeled / steps labeled / parts-and-steps. Only
**parts-and-steps** improved performance, on *conceptual* information and transfer, and mainly
for **low-prior-knowledge** readers. **Labeling the parts alone did nothing.** "Encoder →
Decoder" is parts-only and useless; Q/K/V through matmul → scale → mask → softmax → matmul with
tensor shapes on each edge is parts-and-steps.

### 9.2 Labels on the graphic, not in a caption **[A]**
Spatial contiguity g = 0.63, k = 58. The cheapest, highest-return change available to any
figure, and it beats animation threefold.

### 9.3 Spreading color along a path — not arrows **[B]**
Arrows are repeatedly null: spreading-color d = 0.75 vs **arrows d = −0.03** in the same lesson,
with eye-tracking confirming the arrows *did* direct attention. Attention moved; learning didn't.
Cues emphasizing a **progressive path** measure d = 1.42 vs **individual entities** d = 0.21.
Working: spotlighting processes 0.81, zoom-to-relevant 0.63, temporarily color-changing labels
0.74, text–diagram integration 0.85. Cap at ~10 cues per figure.

### 9.4 Simplify below realism; static over animation **[A]**
Simplified structural diagrams beat detailed more-accurate ones. Animation vs static is g = 0.226
overall and **decorational animation is g = −0.05**. **System-paced beat learner-paced animation
(p = .003) — a scrubber does not help.** Use discrete "continue" steps if you need chunking.

### 9.5 The four diagram types that carry a paper **[C]**
1. **Onion** — black box, then one layer deeper, **redrawing the same diagram with one more
   thing in it.** Never replace the reader's mental image; annotate it.
2. **Data flow with shapes on the edges** — where §9.2 pays.
3. **Before/after on the same axes** — this is the *problem statement* rendered visually. It
   belongs early, not in results.
4. **The result figure redrawn honestly** — keep the error bars, name the baseline.

Prefer the paper's own figure where it is already the clearest thing. Extract rather than redraw.

### 9.6 A length is a claim about a number **[U]**
Every bar, dot position or area in a figure must be a real value from a source, drawn to a stated
scale. If you do not have the number, do not draw the bar. Write the sentence instead.

*Observed failure:* a "where agents land" figure used hand-picked bar widths to mean "does well"
and "does badly", put two scores from different benchmarks on one bar, and drew RE-Bench
human-versus-agent splits from no data at all. The reader could not tell what the lengths meant,
because they meant nothing.

Rules that follow from it:
- One bar, one value, one unit. Never merge scores from different benchmarks onto one bar.
- Panels on different scales say so on the figure.
- A conceptual ordering (cheap to expensive, simple to complex) is drawn with even spacing and
  labelled *ordered, not to scale*. Uneven spacing reads as magnitude.
- Before publishing, check each width against its value: width / value is constant within a panel.

### 9.7 Figures stay in the column; Mermaid is laid out to fit it **[U]**
Every figure and diagram sits inside the 34rem text column under a height cap (24rem for paper
figures, 28rem for diagrams), and opens full size on click. No picture outweighs the prose beside it.

Mermaid scales down to fit both the column and the height cap, so its layout must keep the
scale-down small: **natural size at most about 680 by 560px**, which keeps 14px labels at 11px or
more. A tall top-down chain fails the height limit the way a wide fan-out fails the width.

- **Fan-outs go `LR`**, so branches stack vertically and width stops growing with branch count.
  A `TD` fan-out of four or five boxes side by side overflowed every time it was tried.
- **Long chains go `TD`.** An `LR` chain of four labelled boxes plus a side path measured 1,475px.
- Two or three short lines per label with `<br/>`; long edge labels widen the whole row.
- Measure each rendered diagram's natural width before shipping; over 680px means re-lay-out.

*Observed failures:* shrunk-to-fit diagrams at 7-10px text; then, after letting figures run to
46rem, a reader found them "pretty ugly" and too big. Column width plus click-to-enlarge fixes both.

### 9.8 A visual beside every idea with a shape **[U]**
When the reader asks for images, each node gets one, the way a good blog post does: the paper's
own figure first, Mermaid for processes, a drawn SVG for quantities and structures. A node that is
pure vocabulary may go without; the verifier warns (`NO_VISUAL`) rather than fails.

*Observed failure:* a reader called nodes without pictures "hard to understand or lacking images".

### 9.9 Build a picture up one part at a time **[B] + [U]**
A diagram with five or more parts (`cueCount` ≥ 5) is a short series, not one drawing:
`diagram.steps`, each step a full redraw that adds one part, with a one-line caption saying what
was added. The reader steps through with Back / Next. To teach a flow from A to B to C, draw it
three times: A to B, then add C, then add the return edge. One all-at-once diagram, especially
one saved for the end, is a reference, not teaching. The verifier warns `ALL_AT_ONCE`. Every step
needs its own `svg` or `mermaid` and `alt`.

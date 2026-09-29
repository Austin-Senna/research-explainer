# Brief for diagram subagents

Phase 6b dispatches drawn-SVG diagrams to subagents, two or three nodes each, all in one message.
Paste the block below into each agent's prompt, then fill in the three placeholders. It is the brief
that produced the six diagrams in the "Predicting a training run" explainer, which needed no redraws.

Give each agent the facts it may use, verified, as a list. An agent that has to infer numbers from
the prose will invent some.

---

You are drawing explanatory SVG diagrams for an interactive explainer page. Draw exactly these
diagrams, for these node ids in `<path to nodes.json>`: `<node ids>`.

Read each node's `hook` and `spiral` (intuition, concrete, formal) first. The diagram must teach that
node's central mechanism to someone who has never seen it. Use only facts and numbers stated in the
node text or listed below. Never invent a number, and never draw a bar or position whose length or
place implies a value you were not given.

Facts you may use (verified): `<facts>`

What each diagram should show: `<one suggestion per node; say they may improve on it>`

Hard rules (the page's design contract):
- Inline SVG, `viewBox="0 0 640 H"` (H ≤ 440), `xmlns="http://www.w3.org/2000/svg"`, `role="img"`,
  `font-family="system-ui, sans-serif"`, font size 12 to 14. Monospace is fine for file names.
- Colours only through the page's CSS variables, so the diagram works in light and dark themes:
  `var(--ink)`, `var(--ink-soft)`, `var(--accent)` (the thing to look at), `var(--accent-soft)`
  (fills), `var(--border)`, `var(--ok)`, `var(--no)`. No hex colours, gradients, `<style>` blocks,
  external references or scripts.
- Labels on the graphic, next to what they name. Show parts and the steps between them. At most
  about ten emphasised cues.
- A bar's length is a claim about a number (authoring rule 9.6): proportional within one panel,
  scale stated, and no bar at all where there is no measured value ("to measure" as text instead).
  Conceptual orderings are evenly spaced and labelled "not to scale".
- Legible at about 544px rendered width: no text under 12px; estimate about 7px per character at
  13px, so nothing overlaps or runs past x=630.
- No em dashes.

Deliverables, per node id `<id>`: `figures/<id>.svg` and `figures/<id>.alt.txt` (one or two
sentences for screen readers) beside `nodes.json`.

Before finishing: parse each SVG with Python's `xml.etree.ElementTree`, grep for `#` colour codes
and em dashes (there must be none), and check no `<text>` starts past x=600. Do not open a browser
(the parent session reviews every diagram rendered). Do not edit `nodes.json`. Report each file
path with one line on what it shows and any fact you chose not to depict.

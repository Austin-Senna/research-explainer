# research-explainer

A Claude Code plugin that turns a paper, arXiv ID or topic into an interactive explainer you learn from, not just read. It checks what you already know, adds prerequisite nodes for the gaps, explains each idea at three levels, quizzes you as you go, and publishes the result as a single HTML page (a Claude artifact, or a local file).

![Demo: scrolling an explainer built from four 2026 papers on AI agents doing AI research, answering a quiz question, then asking the side chat about the section in view](docs/demo.gif)

*The explainer was built from four 2026 papers. In the demo you read a section, answer a check, move to a node with a paper figure, then ask the side chat about reward hacking. It answers from the sources and cites them. Recorded from a local build with the chat backed by Claude. On claude.ai the chat runs through the artifact viewer.*

## Install

```
claude plugin marketplace add Austin-Senna/research-explainer
claude plugin install research-explainer@research-explainer
```

Manual install: clone this repo and copy or symlink `skills/research-explainer` into `~/.claude/skills/research-explainer`.

## What it's for

- **Exploring a topic.** You are new to a paper or field and want the map: what it claims, what you need to know first, and whether the claims hold up.
- **Deepening one idea.** You know the basics and want one mechanism properly ("go deeper on PPO's clipping"). The tree stays narrow and goes several levels down, and it pulls in extra sources (the original derivation, a worked example, a critique) to explain that one thing from several angles.

Say which you want in the request. It infers it otherwise, and asks if it can't tell.

## Use

The easiest start is to just ask:

```
/research-explainer                         # asks what you want to learn
/research-explainer explain PPO to me       # plain language works
```

Or hand it a source directly:

```
/research-explainer 1706.03762              # arXiv ID
/research-explainer ~/papers/x.pdf          # local PDF
/research-explainer <src> --add <url>       # extra sources
/research-explainer <src> --depth deep      # quick (default), standard or deep
```

### How a run goes

1. **Find the source.** A topic triggers a search, and you pick from 4 to 6 candidates. An arXiv ID, path or URL is used as is.
2. **Probe what you know.** It asks whether you have experience with the topic, plus depth and image settings. If you say yes, it checks with 4 or 5 quick true-or-false statements about the actual content instead of trusting a self-rating. Gaps become prerequisite nodes, marked ⚡ so you can skip any it got wrong.
3. **You pick extra resources.** It shows the planned tree and proposes named resources that fill your specific gaps: a tutorial for a missing prerequisite, the paper a claim leans on, a replication of a result. Each comes with what it adds and an estimated cost (about $1 each). Nothing beyond the source and one search is spent until you choose.
4. **Research and write.** Subagents read only what you picked. The explanation is then written from the source and those resources.
5. **Verify, then ship.** A deterministic checker (plain code, not a model) must pass before anything is built. You get a local page at `~/explainers/<slug>/` (or a folder you name) and, if connected to claude.ai, a published artifact.

A quick run with no extra resources costs about $1.50 to $2.

## Requirements

- **Required:** Node.js 20 or later.
- **Optional:** `pdftoppm` (poppler) for cropping figures the arXiv HTML dropped; a browser tool (Playwright MCP or Claude in Chrome) for screenshotting inline-SVG figures and checking visuals; the Artifact tool (Claude Code connected to claude.ai) for publishing. Without it you get a local `index.html`.
- **Outside claude.ai:** the chat panel and essay grading need the claude.ai viewer and hide themselves otherwise. Mermaid diagrams load from jsDelivr, so a local file needs internet for them.

## What you get

- Prerequisite scaffolding, sized to what you already know
- Spiral explanations: intuition, then a concrete case, then the formal version
- Multiple-choice checks with explanations for every option
- Graded one-sentence self-explanations
- The paper's own figures, plus diagrams where they help
- A side chat that reads the sources

## Sharing and copyright

Artifacts are private to you by default. A page embeds the full text of its sources so the chat can read them, and many papers' licences do not allow redistributing that. Before sharing a page publicly, move `sources.json` aside and rebuild (the chat falls back to section text), or share only pages built from openly licensed sources. Viewers not signed in to Claude will not get the chat.

## Development

```
cd skills/research-explainer && npm test
```

## License

MIT

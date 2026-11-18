import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { escapeHtml, renderProse, renderSidebar, renderNode, renderMcqs, renderMasthead, renderChat, renderDiagram, stepIndex, renderNodeSources } from '../assets/lib/render.js';

const doc = () => JSON.parse(readFileSync(new URL('./fixtures/attention.nodes.json', import.meta.url)));
const nodeById = (id) => doc().nodes.find(n => n.id === id);

test('html special characters are escaped', () => {
  assert.equal(escapeHtml('<script>&"'), '&lt;script&gt;&amp;&quot;');
});

test('prose escapes before applying markdown', () => {
  const out = renderProse('a <b> tag and **bold**');
  assert.match(out, /&lt;b&gt;/);
  assert.match(out, /<strong>bold<\/strong>/);
});

test('prose splits paragraphs on blank lines', () => {
  const out = renderProse('one\n\ntwo');
  assert.equal((out.match(/<p>/g) ?? []).length, 2);
});

test('prose renders code spans and lists', () => {
  assert.match(renderProse('use `d_k` here'), /<code>d_k<\/code>/);
  const list = renderProse('- alpha\n- beta');
  assert.match(list, /<ul>/);
  assert.equal((list.match(/<li>/g) ?? []).length, 2);
});

test('the sidebar nests children under their parent', () => {
  const html = renderSidebar(doc().nodes, { currentId: 'scaled-dot-product', passed: new Set() });
  const parentIdx = html.indexOf('data-id="scaled-dot-product"');
  const childIdx  = html.indexOf('data-id="multi-head"');
  const nextRoot  = html.indexOf('data-id="positional-encoding"');
  assert.ok(parentIdx < childIdx && childIdx < nextRoot, 'child must sit between its parent and the next root');
});

test('the sidebar marks the current node and passed nodes, and groups sections under plain headings', () => {
  const html = renderSidebar(doc().nodes, { currentId: 'multi-head', passed: new Set(['prereq-dot-product']) });
  assert.match(html, /data-id="multi-head"[^>]*aria-current="true"/);
  assert.match(html, /data-id="prereq-dot-product"[^>]*class="[^"]*is-passed/);
  const b = html.indexOf('>Background<'), m = html.indexOf('>Main<'), g = html.indexOf('>Going further<');
  assert.ok(b >= 0 && b < html.indexOf('prereq-dot-product') && html.indexOf('prereq-dot-product') < m);
  assert.ok(m < html.indexOf('data-id="scaled-dot-product"') && html.indexOf('data-id="multi-head"') < g);
  assert.ok(g < html.indexOf('data-id="positional-encoding"'));
  assert.doesNotMatch(html, /⚡/);
});

test('a node renders all three spiral layers in reading order', () => {
  const html = renderNode(nodeById('scaled-dot-product'));
  const i = html.indexOf('Every token asks');
  const c = html.indexOf('With three tokens');
  const f = html.indexOf('Attention of Q');
  assert.ok(i >= 0 && i < c && c < f, 'intuition, then concrete, then formal');
});

test('a node renders its wrong turn', () => {
  const html = renderNode(nodeById('scaled-dot-product'));
  assert.match(html, /numerical overflow/);
  assert.match(html, /variance proportional/);
});

test('a section page carries no quiz: questions live in quiz time', () => {
  const html = renderNode(nodeById('scaled-dot-product'));
  assert.doesNotMatch(html, /data-kind="mcq"|data-kind="self"|Conceptualize in one sentence/);
});

test('mcq options render with exactly three choices each and no correct answer leaked', () => {
  const node = nodeById('scaled-dot-product');
  const html = renderMcqs(node);
  assert.match(html, /data-node="scaled-dot-product" data-mcq="0"/);
  assert.equal((html.match(/data-option=/g) ?? []).length, 3 * node.quiz.mcq.length);
  assert.ok(!html.includes('data-correct="true"'), 'correctness must not be in the initial markup');
});

test('the quiz is multiple choice only, with no confidence toggle or free-text blank', () => {
  const html = renderMcqs(nodeById('scaled-dot-product'));
  assert.doesNotMatch(html, /data-confidence|type="radio"|class="blank"/);
  assert.doesNotMatch(html, /data-kind="cloze"/);
});

test('the masthead front-loads the claim summary', () => {
  const html = renderMasthead(doc().meta);
  assert.match(html, /sequence transduction needs no recurrence/);
});

test('the masthead states the claim and does not narrate how learning will feel', () => {
  const html = renderMasthead(doc().meta);
  assert.ok(html.includes(doc().meta.claimSummary));
  assert.doesNotMatch(html, /data-honesty|will feel/i);
});

test('the formal layer renders collapsed under Details', () => {
  const n = doc().nodes.find(x => x.spiral?.formal);
  const html = renderNode(n);
  assert.match(html, /<details class="layer layer-formal">\s*<summary>Details<\/summary>/);
  assert.doesNotMatch(html, /<details[^>]*open/);
});

test('a stepped diagram shows step one, defers the rest, and clamps at both ends', () => {
  const html = renderDiagram({ alt: 'build-up', steps: [
    { mermaid: 'flowchart LR\n A-->B', alt: 'a', caption: 'One part' },
    { mermaid: 'flowchart LR\n A-->B-->C', alt: 'b', caption: 'Add **C**' },
  ] });
  assert.match(html, /data-steps="2"/);
  assert.match(html, /data-step="0">[\s\S]*data-mermaid /);
  assert.match(html, /data-step="1" hidden>[\s\S]*data-mermaid-deferred/);
  assert.match(html, /Step 1 of 2/);
  assert.match(html, /<strong>C<\/strong>/);
  assert.equal(stepIndex(0, -1, 2), 0);
  assert.equal(stepIndex(0, 1, 2), 1);
  assert.equal(stepIndex(1, 1, 2), 1);
});

test('a single diagram renders as before', () => {
  const html = renderDiagram({ mermaid: 'flowchart LR\n A-->B', alt: 'x' });
  assert.match(html, /data-mermaid /);
  assert.doesNotMatch(html, /step-controls/);
});

test('the masthead lists the sources it was built from', () => {
  const html = renderMasthead(doc().meta);
  assert.match(html, /Vaswani et al\. 2017/);
  assert.match(html, /href="https:\/\/arxiv\.org\/abs\/1706\.03762"/);
});


test('the chat is not rendered inside a node; it is one collapsible panel', () => {
  assert.doesNotMatch(renderNode(nodeById('scaled-dot-product')), /data-ask-form/);
  const chat = renderChat();
  assert.match(chat, /data-ask-form/);
  assert.match(chat, /data-chat-close/);
  assert.match(chat, /data-chat-section/);
  assert.match(chat, /<textarea data-ask-input/);
});

test('a list directly under a sentence renders as a list, not literal dashes', () => {
  const html = renderProse('Two things:\n- alpha\n- beta');
  assert.match(html, /<p>Two things:<\/p><ul><li>alpha<\/li><li>beta<\/li><\/ul>/);
});

test('numbered lists, headings and fenced code render', () => {
  assert.match(renderProse('1. first\n2. second'), /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(renderProse('### Why'), /<h4>Why<\/h4>/);
  const code = renderProse('```\nx = <1>\n\ny\n```');
  assert.match(code, /<pre><code>x = &lt;1&gt;\n\ny<\/code><\/pre>/);
});

test('bold at the start of a line is not mistaken for a bullet', () => {
  assert.match(renderProse('**Static features** cost little'), /^<p><strong>Static features<\/strong>/);
});

test('the chat panel carries a model picker with the saved tier selected', () => {
  const html = renderChat({ sourceCount: 7, tier: 'complex' });
  assert.match(html, /<option value="complex" selected>Deep<\/option>/);
  assert.match(html, /read the 7 sources/);
  assert.match(html, /data-chat-clear/);
});

test('a paper figure renders with alt text, caption and a linked credit', () => {
  const n = nodeById('scaled-dot-product');
  n.figures = [{ src: 'data:image/png;base64,AA', alt: 'The attention block', caption: 'Figure 2 of the paper.',
                 credit: 'Vaswani et al. 2017', url: 'https://arxiv.org/abs/1706.03762' }];
  const html = renderNode(n);
  assert.match(html, /<img src="data:image\/png;base64,AA" alt="The attention block"/);
  assert.match(html, /Figure 2 of the paper\./);
  assert.match(html, /<a href="https:\/\/arxiv\.org\/abs\/1706\.03762">Vaswani et al\. 2017<\/a>/);
});

test('a mermaid diagram ships as escaped source for the page to draw, with its alt text', () => {
  const n = nodeById('scaled-dot-product');
  n.diagram = { mermaid: 'flowchart LR\n  Q --> S["scores <x>"]', alt: 'Q feeds the scores' };
  const html = renderNode(n);
  assert.match(html, /<pre class="mermaid" data-mermaid data-alt="Q feeds the scores">flowchart LR\n  Q --&gt; S\[&quot;scores &lt;x&gt;&quot;\]<\/pre>/);
});

test('indented bullets nest inside the item above them', () => {
  const html = renderProse('- parent\n  - child one\n  - child two\n- sibling');
  assert.equal(html, '<ul><li>parent<ul><li>child one</li><li>child two</li></ul></li><li>sibling</li></ul>');
});

test('a numbered list can hold nested bullets', () => {
  const html = renderProse('1. first\n   - detail\n2. second');
  assert.equal(html, '<ol><li>first<ul><li>detail</li></ul></li><li>second</li></ol>');
});

test('pipe tables render with a header row, and a stray pipe in prose does not', () => {
  const html = renderProse('| Rung | GSM8K |\n|---|---|\n| constant | **0.209** |');
  assert.match(html, /<table><thead><tr><th>Rung<\/th><th>GSM8K<\/th><\/tr><\/thead><tbody><tr><td>constant<\/td><td><strong>0\.209<\/strong><\/td><\/tr><\/tbody><\/table>/);
  assert.match(renderProse('a | b'), /^<p>a \| b<\/p>$/);
});

test('quotes render as blockquotes and stay escaped', () => {
  assert.equal(renderProse('> the paper says <this>'), '<blockquote><p>the paper says &lt;this&gt;</p></blockquote>');
});

test('a node without a formal layer renders no empty formal block', () => {
  const d = JSON.parse(readFileSync(new URL('./fixtures/attention.nodes.json', import.meta.url)));
  const n = d.nodes.find(x => x.kind === 'prereq');
  delete n.spiral.formal;
  assert.ok(!renderNode(n, d).includes('layer-formal'));
});

test('prose links to http(s) sources only', () => {
  const html = renderProse('[AIRS-Bench](https://arxiv.org/abs/2602.06855) found it. [x](javascript:alert(1))');
  assert.match(html, /<a href="https:\/\/arxiv.org\/abs\/2602.06855">AIRS-Bench<\/a> found it/);
  assert.doesNotMatch(html, /href="javascript/);
});

test('each section lists its sources as links under the subtitle', () => {
  const n = doc().nodes[1];
  const html = renderNode(n);
  assert.match(html, /<p class="hook">[\s\S]*<p class="node-sources">From <a href="https?:/);
  assert.equal(renderNodeSources({ sources: [{ label: 'Notes', url: 'ftp://x' }] }), '<p class="node-sources">From Notes</p>');
});

test('caveats render collapsed under their own small heading, and nothing renders without them', () => {
  const n = { ...nodeById('scaled-dot-product'), caveats: 'The group sizes come from a **search snippet**.' };
  const html = renderNode(n);
  assert.match(html, /<details class="caveats">\s*<summary>What could not be checked<\/summary>[\s\S]*<strong>search snippet<\/strong>/);
  assert.doesNotMatch(html, /<details class="caveats" open/);
  assert.doesNotMatch(renderNode(nodeById('scaled-dot-product')), /caveats/);
});

test('a wrong turn renders links and emphasis like the body does', () => {
  const n = { ...nodeById('scaled-dot-product'), wrongTurn: { belief: 'If you think **X**', correction: '[Vafa et al.](https://arxiv.org/abs/2406.03689) show otherwise.' } };
  const html = renderNode(n);
  assert.match(html, /<p class="belief">If you think <strong>X<\/strong>/);
  assert.match(html, /<p class="correction"><a href="https:\/\/arxiv.org\/abs\/2406.03689">Vafa et al.<\/a> show otherwise/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTree, linearOrder, neighbors, ancestorsOf, isOpening } from '../assets/lib/tree.js';

const nodes = () => JSON.parse(readFileSync(new URL('./fixtures/attention.nodes.json', import.meta.url))).nodes;

test('roots are the parentless nodes, in order', () => {
  const tree = buildTree(nodes());
  assert.deepEqual(tree.map(t => t.node.id), ['prereq-dot-product', 'scaled-dot-product', 'positional-encoding']);
});

test('children hang off their parent', () => {
  const tree = buildTree(nodes());
  const sdp = tree.find(t => t.node.id === 'scaled-dot-product');
  assert.deepEqual(sdp.children.map(c => c.node.id), ['multi-head']);
});

test('linear order is strictly ascending by order', () => {
  const ids = linearOrder(nodes()).map(n => n.id);
  assert.deepEqual(ids, ['prereq-dot-product', 'scaled-dot-product', 'multi-head', 'positional-encoding']);
});

test('linear order crosses tree levels rather than following the tree', () => {
  const ids = linearOrder(nodes()).map(n => n.id);
  assert.equal(ids.indexOf('multi-head'), ids.indexOf('scaled-dot-product') + 1);
});

test('neighbors returns the linear predecessor and successor', () => {
  const { prev, next } = neighbors(nodes(), 'multi-head');
  assert.equal(prev.id, 'scaled-dot-product');
  assert.equal(next.id, 'positional-encoding');
});

test('the first node has no previous and the last has no next', () => {
  assert.equal(neighbors(nodes(), 'prereq-dot-product').prev, null);
  assert.equal(neighbors(nodes(), 'positional-encoding').next, null);
});

test('an unknown id yields null neighbours rather than throwing', () => {
  assert.deepEqual(neighbors(nodes(), 'nope'), { prev: null, next: null });
});

test('ancestors are listed outermost first', () => {
  assert.deepEqual(ancestorsOf(nodes(), 'multi-head').map(n => n.id), ['scaled-dot-product']);
  assert.deepEqual(ancestorsOf(nodes(), 'scaled-dot-product'), []);
});

test('only the first node in reading order is the opening page', () => {
  const ns = nodes();
  const [first, second] = linearOrder(ns);
  assert.equal(isOpening(ns, first.id), true);
  assert.equal(isOpening(ns, second.id), false);
  assert.equal(isOpening(ns, 'no-such-node'), false);
});

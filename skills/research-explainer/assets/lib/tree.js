// Pure tree and ordering helpers. No DOM, no storage.

export function linearOrder(nodes) {
  return [...nodes].sort((a, b) => a.order - b.order);
}

export function buildTree(nodes) {
  const wrap = new Map(nodes.map(n => [n.id, { node: n, children: [] }]));
  const roots = [];
  for (const n of linearOrder(nodes)) {
    const self = wrap.get(n.id);
    const parent = n.parent ? wrap.get(n.parent) : null;
    if (parent) parent.children.push(self);
    else roots.push(self);
  }
  return roots;
}

export function neighbors(nodes, id) {
  const linear = linearOrder(nodes);
  const i = linear.findIndex(n => n.id === id);
  if (i === -1) return { prev: null, next: null };
  return { prev: linear[i - 1] ?? null, next: linear[i + 1] ?? null };
}

// The masthead (title, claim summary, sources) is the document's front page, not a banner.
// Repeating it above every node pushes each node's own content below the fold.
export function isOpening(nodes, id) {
  return linearOrder(nodes)[0]?.id === id;
}

export function ancestorsOf(nodes, id) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const chain = [];
  let cur = byId.get(id);
  const guard = new Set(); // a malformed parent cycle must not hang the page
  while (cur?.parent && !guard.has(cur.parent)) {
    guard.add(cur.parent);
    const parent = byId.get(cur.parent);
    if (!parent) break;
    chain.unshift(parent);
    cur = parent;
  }
  return chain;
}

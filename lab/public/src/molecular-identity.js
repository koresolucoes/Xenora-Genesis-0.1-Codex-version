import { ATOMIC_ELEMENTS } from './atomic-elements.js';
import { molecularFormula } from './atomic-observer.js';

// The full code is an identity for the labelled bond graph. Coordinates,
// stereochemistry, conformations and electronic states beyond charge are outside this model.
export const MOLECULAR_IDENTITY_LIMITS = Object.freeze({
  maxAtoms: 384, maxSearchNodes: 2048, maxRefinementVisits: 100000
});

function requireGraph(condition) {
  if (!condition) throw new TypeError('Grafo molecular inválido.');
}

function atomLabel(atom, element) {
  const massNumber = atom.massNumber ?? atom.isotope ?? (
    atom.neutrons == null ? element.massNumber : element.atomicNumber + atom.neutrons
  );
  const charge = atom.charge ?? (
    atom.electrons == null ? 0 : element.atomicNumber - atom.electrons
  );
  requireGraph(Number.isSafeInteger(massNumber) && massNumber >= element.atomicNumber &&
    Number.isSafeInteger(charge) && (atom.protons == null || atom.protons === element.atomicNumber) &&
    (atom.neutrons == null || atom.neutrons === massNumber - element.atomicNumber) &&
    (atom.isotope == null || atom.isotope === massNumber) &&
    (atom.electrons == null || atom.electrons === element.atomicNumber - charge));
  const isotope = massNumber === element.massNumber ? '' : '.' + massNumber;
  return atom.element + isotope + (charge ? (charge > 0 ? '+' : '') + charge : '');
}

function readGraph(atoms, bonds) {
  requireGraph(Array.isArray(atoms) && atoms.length > 0 && atoms.length <= MOLECULAR_IDENTITY_LIMITS.maxAtoms &&
    Array.isArray(bonds));
  const indices = new Map(), composition = {}, labels = [], adj = atoms.map(() => []);
  for (const atom of atoms) {
    requireGraph(atom && Number.isSafeInteger(atom.id) && !indices.has(atom.id) &&
      Object.hasOwn(ATOMIC_ELEMENTS, atom.element));
    indices.set(atom.id, labels.length);
    labels.push(atomLabel(atom, ATOMIC_ELEMENTS[atom.element]));
    composition[atom.element] = (composition[atom.element] ?? 0) + 1;
  }
  const seenEdges = new Set();
  for (const { a, b, order } of bonds) {
    const i = indices.get(a), j = indices.get(b);
    const edge = Math.min(i, j) * atoms.length + Math.max(i, j);
    requireGraph(i !== undefined && j !== undefined && i !== j && !seenEdges.has(edge) &&
      Number.isInteger(order) && order >= 1 && order <= 3);
    seenEdges.add(edge);
    adj[i].push({ to: j, order });
    adj[j].push({ to: i, order });
  }
  const visited = new Set([0]);
  for (const i of visited) for (const { to } of adj[i]) visited.add(to);
  requireGraph(visited.size === atoms.length);
  return { adj, labels, formula: molecularFormula(composition) };
}

// Peel pendant trees towards the centre in complete layers. Each removed root
// gets a bracketed encoding of its sorted children and their bond orders.
// An acyclic molecule ends at its unique centre or a central bonded pair.
function peelBranches(labels, adj) {
  const remaining = new Set(labels.keys());
  const degrees = adj.map(edges => edges.length);
  const children = labels.map(() => []);
  const decoration = i => labels[i] + '(' + children[i].sort().join('') + ')';
  let leaves = [...remaining].filter(i => degrees[i] === 1);
  while (remaining.size > 2 && leaves.length) {
    for (const i of leaves) remaining.delete(i);
    const next = [];
    for (const i of leaves) {
      const parent = adj[i].find(e => remaining.has(e.to));
      children[parent.to].push(parent.order + decoration(i));
      if (--degrees[parent.to] === 1) next.push(parent.to);
    }
    leaves = next;
  }
  const core = [...remaining];
  const index = new Map(core.map((v, i) => [v, i]));
  return {
    labels: core.map(decoration),
    adj: core.map(v => adj[v].filter(e => remaining.has(e.to)).map(e => ({ to: index.get(e.to), order: e.order })))
  };
}

// Compare rotations in linear time, including homogeneous rings. Each token
// records its vertex decoration and the bond leading to the next vertex.
function leastRotation(tokens) {
  const n = tokens.length;
  let i = 0, j = 1, offset = 0;
  while (i < n && j < n && offset < n) {
    const a = tokens[(i + offset) % n], b = tokens[(j + offset) % n];
    if (a === b) { offset++; continue; }
    if (a > b) {
      i += offset + 1;
      if (i === j) i++;
    } else {
      j += offset + 1;
      if (i === j) j++;
    }
    offset = 0;
  }
  const start = Math.min(i, j);
  return tokens.slice(start).concat(tokens.slice(0, start)).join('/');
}

function ringCode(labels, adj) {
  const encodings = adj[0].map(first => {
    let at = 0, bond = first;
    const tokens = [];
    do {
      tokens.push(labels[at] + '>' + bond.order);
      const last = at;
      at = bond.to;
      bond = adj[at].find(e => e.to !== last);
    } while (at !== 0);
    return leastRotation(tokens);
  });
  return encodings.sort()[0];
}

function splitBy(vertices, signature) {
  const groups = new Map();
  for (const vertex of vertices) {
    const key = signature(vertex);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(vertex);
  }
  return [...groups.keys()].sort().map(k => groups.get(k));
}

function refine(partition, adj, budget) {
  while (true) {
    const colors = new Uint16Array(adj.length);
    partition.forEach((cell, i) => cell.forEach(v => { colors[v] = i; }));
    const next = [];
    for (const cell of partition) {
      if (cell.length === 1) { next.push(cell); continue; }
      budget.visits += cell.length;
      if (budget.visits > MOLECULAR_IDENTITY_LIMITS.maxRefinementVisits) return null;
      next.push(...splitBy(cell, v => adj[v].map(e => 4 * colors[e.to] + e.order)
        .sort((a, b) => a - b).join(',')));
    }
    if (next.length === partition.length) return next;
    partition = next;
  }
}

// The transposition is an actual automorphism when both vertices in the
// chosen cell have identical coloured edges to all vertices outside the pair.
function interchangeable(a, b, adj) {
  return adj[a].length === adj[b].length && adj[a].every(edge => edge.to === b ||
    adj[b].some(other => other.to === edge.to && other.order === edge.order));
}

function sortedGraphCode(order, labels, adj) {
  const rank = new Uint16Array(order.length);
  order.forEach((vertex, i) => { rank[vertex] = i; });
  return order.map((v, i) => {
    const forward = adj[v].filter(e => rank[e.to] > i).map(e => 4 * rank[e.to] + e.order)
      .sort((a, b) => a - b);
    return labels[v] + ':' + forward.join(',');
  }).join('/');
}

// Refinement narrows the search but never establishes equality by itself.
// Every remaining candidate labelling is explored (apart from proven twins).
// If either deterministic budget runs out, discard every provisional answer.
function canonicalCore(labels, adj, maxSearchNodes) {
  const budget = { nodes: 0, visits: 0 };
  let best = null;
  function search(partition) {
    if (++budget.nodes > maxSearchNodes) return false;
    const refined = refine(partition, adj, budget);
    if (!refined) return false;
    let chosen = -1;
    for (let i = 0; i < refined.length; i++) {
      const count = refined[i].length;
      if (count > 1 && (chosen < 0 || count < refined[chosen].length)) chosen = i;
    }
    if (chosen < 0) {
      const code = sortedGraphCode(refined.map(cell => cell[0]), labels, adj);
      if (best === null || code < best) best = code;
      return true;
    }
    const cell = refined[chosen], representatives = [];
    for (const v of cell) {
      if (representatives.some(u => interchangeable(u, v, adj))) continue;
      representatives.push(v);
      const children = refined.slice();
      children.splice(chosen, 1, [v], cell.filter(other => other !== v));
      if (!search(children)) return false;
    }
    return true;
  }
  const initial = splitBy([...labels.keys()], v => labels[v]);
  return search(initial) ? best : null;
}

// Supply one connected AtomicWorld component, including its complete edge list.
// Monomers have an empty edge list. Missing isotope and charge mean the
// element's configured isotope and a neutral atom. An unresolved result has no
// species identity and must stay outside counts of verified identical species.
export function identifyMolecularGraph(atoms, bonds, { maxSearchNodes = MOLECULAR_IDENTITY_LIMITS.maxSearchNodes } = {}) {
  requireGraph(Number.isSafeInteger(maxSearchNodes) && maxSearchNodes >= 0);
  const graph = readGraph(atoms, bonds);
  const { labels, adj } = peelBranches(graph.labels, graph.adj);
  let key;
  if (labels.length === 1) key = 'mi1:t/' + labels[0];
  else if (labels.length === 2) key = 'mi1:t/' + labels.slice().sort().join('/' + adj[0][0].order + '/');
  else if (adj.every(edges => edges.length === 2)) key = 'mi1:r/' + ringCode(labels, adj);
  else {
    const code = canonicalCore(labels, adj, Math.min(maxSearchNodes, MOLECULAR_IDENTITY_LIMITS.maxSearchNodes));
    if (code === null) return { status: 'unresolved', key: null, formula: graph.formula, reason: 'search-budget' };
    key = 'mi1:g/' + code;
  }
  return { status: 'exact', key, formula: graph.formula };
}

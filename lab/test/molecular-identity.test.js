import assert from 'node:assert/strict';
import test from 'node:test';
import { identifyMolecularGraph, MOLECULAR_IDENTITY_LIMITS } from '../public/src/molecular-identity.js';

function graph(symbols, links) {
  return {
    atoms: Array.from(symbols, (element, id) => ({ id, element })),
    bonds: links.map(([a, b, order = 1]) => ({ a, b, order }))
  };
}
const identify = ({ atoms, bonds }, options) => identifyMolecularGraph(atoms, bonds, options);
function renumber(g) {
  const ids = new Map(g.atoms.map((a, i) => [a.id, 737 - 23 * i]));
  return {
    atoms: g.atoms.map(v => ({ ...v, id: ids.get(v.id) })).reverse(),
    bonds: g.bonds.map(e => ({ a: ids.get(e.b), b: ids.get(e.a), order: e.order })).reverse()
  };
}
function sameWithNewIds(g) {
  const before = structuredClone(g);
  const result = identify(g);
  assert.equal(result.status, 'exact');
  assert.deepEqual(result, identify(renumber(g)));
  assert.deepEqual(g, before);
  return result;
}

test('constitutional isomers retain their separate identities through arbitrary atom ID and input order changes', () => {
  const ethanol = graph('CCOHHHHHH', [[0,1],[1,2],[0,3],[0,4],[0,5],[1,6],[1,7],[2,8]]);
  const ether = graph('CCOHHHHHH', [[0,2],[1,2],[0,3],[0,4],[0,5],[1,6],[1,7],[1,8]]);
  const a = sameWithNewIds(ethanol), b = sameWithNewIds(ether);
  assert.equal(a.formula, 'C2H6O');
  assert.equal(b.formula, a.formula);
  assert.notEqual(a.key, b.key);
  // Geometry and numeric mass round-off are irrelevant to identity by connectivity.
  const posed = structuredClone(ethanol);
  for (const atom of posed.atoms) Object.assign(atom, { x: atom.id, y: atom.id / 3, massU: 12.0001 });
  assert.equal(identify(posed).key, a.key);
  const carbonyl = graph('CO', [[0,1,2]]);
  assert.notEqual(sameWithNewIds(carbonyl).key, sameWithNewIds(graph('CO', [[0,1]])).key);
});

test('isotope, atom-local charge and element are labels even when gross formula is unchanged', () => {
  const single = (metadata) => identifyMolecularGraph([{ id: -5, element: 'H', ...metadata }], []);
  assert.deepEqual(single({}), single({ protons: 1, neutrons: 0, electrons: 1 }));
  assert.deepEqual(single({ neutrons: 1 }), single({ massNumber: 2 }));
  assert.deepEqual(single({ isotope: 2 }), single({ neutrons: 1 }));
  assert.notEqual(single({ neutrons: 1 }).key, single({}).key);
  assert.notEqual(single({ charge: 1 }).key, single({}).key);
  assert.deepEqual(single({ charge: 1 }), single({ electrons: 0 }));
  const first = graph('CON', [[0,1],[1,2]]);
  first.atoms[0].charge = 1;
  const other = graph('CON', [[0,1],[1,2]]);
  other.atoms[2].charge = 1;
  assert.notEqual(sameWithNewIds(first).key, sameWithNewIds(other).key);
  assert.throws(() => single({ isotope: 2, neutrons: 0 }));
});

test('cyclic isomers with identical one-dimensional colour refinement are resolved by their full adjacency', () => {
  // These connected, uniformly carbon, 3-regular graphs have six vertices and nine single bonds.
  const prism = graph('CCCCCC', [[0,1],[1,2],[2,0],[3,4],[4,5],[5,3],[0,3],[1,4],[2,5]]);
  const bipartite = graph('CCCCCC', [0,1,2].flatMap(i => [3,4,5].map(j => [i,j])));
  const a = sameWithNewIds(prism), b = sameWithNewIds(bipartite);
  assert.equal(a.formula, b.formula);
  assert.notEqual(a.key, b.key);
  for (const g of [prism, bipartite]) {
    const unresolved = identify(g, { maxSearchNodes: 1 });
    assert.deepEqual(unresolved, { status: 'unresolved', key: null, formula: 'C6', reason: 'search-budget' });
    assert.deepEqual(identify(renumber(g), { maxSearchNodes: 1 }), unresolved);
  }
});

test('maximum-size trees and rings resolve without exhaustive search, including attached branches', () => {
  const n = MOLECULAR_IDENTITY_LIMITS.maxAtoms;
  const path = Array.from({ length: n - 1 }, (_, i) => [i, i + 1]);
  const chain = graph('C'.repeat(n), path);
  const ring = graph('C'.repeat(n), [...path, [n - 1, 0]]);
  const decorated = graph('CCNCOOHH', [[0,1,2],[1,2],[2,3],[3,0],[0,4],[2,5],[4,6],[5,7]]);
  for (const g of [chain, ring, decorated]) {
    assert.deepEqual(identify(g, { maxSearchNodes: 0 }), sameWithNewIds(g));
  }
  const orderMoved = structuredClone(decorated);
  orderMoved.bonds[0].order = 1;
  orderMoved.bonds[1].order = 2;
  assert.notEqual(identify(decorated).key, identify(orderMoved).key);
});

test('full keys agree with the counts of connected unlabelled simple graphs through five vertices', () => {
  const classCount = [0, 1, 1, 2, 6, 21], labelledCount = [0, 1, 1, 4, 38, 728];
  for (let n = 1; n <= 5; n++) {
    const possible = [];
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) possible.push([a,b]);
    const keys = new Set();
    let accepted = 0;
    for (let mask = 0; mask < 2 ** possible.length; mask++) {
      const links = possible.filter((_, i) => mask & 2 ** i);
      const reachable = new Set([0]);
      for (const v of reachable) for (const [a,b] of links) {
        if (a === v) reachable.add(b);
        if (b === v) reachable.add(a);
      }
      if (reachable.size < n) continue;
      const result = identify(graph('C'.repeat(n), links));
      assert.equal(result.status, 'exact');
      keys.add(result.key);
      accepted++;
    }
    assert.equal(accepted, labelledCount[n]);
    assert.equal(keys.size, classCount[n]);
  }
});

test('rejects incomplete or ambiguous input rather than assigning an unrelated species', () => {
  assert.throws(() => identify(graph('CO', [])));
  assert.throws(() => identify(graph('CC', [[0,1],[1,0]])));
  assert.throws(() => identify(graph('H', [[0,0]])));
  assert.throws(() => identify(graph('CC', [[0,2]])));
  assert.throws(() => identify(graph('HH', [[0,1,0]])));
  assert.throws(() => identifyMolecularGraph([{id:2, element:'H'}, {id:2, element:'H'}], []));
});

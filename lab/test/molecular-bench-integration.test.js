import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { ATOMIC_ELEMENTS } from "../public/src/atomic-elements.js";
import { AtomicWorld, ATOMIC_PHYSICS } from "../public/src/atomic-world.js";
import { observeAtomicWorld } from "../public/src/atomic-observer.js";
import { identifyMolecularGraph } from "../public/src/molecular-identity.js";
import { updateReactionBench, getReactionBenchReport } from "../public/src/reaction-bench.js";

function atom(id, element) {
  const e = ATOMIC_ELEMENTS[element];
  return {
    id,
    element,
    protons: e.protons,
    neutrons: e.neutrons,
    electrons: e.electrons,
    charge: 0,
    massU: e.massU,
    x: (((id * 13) % 89) + 1) / 91,
    y: (((id * 17) % 83) + 1) / 89,
    z: (((id * 19) % 73) + 1) / 79,
  };
}
function bond(a, b, order = 1) {
  return { a, b, order };
}

// These are detector fixtures. Constructing these species here says nothing
// about their likelihood of formation in the independent atomic simulation.
function alcoholOrEther(linearAlcohol, offset, permutation) {
  const elements = ["C", "C", "O", "H", "H", "H", "H", "H", "H"];
  const links = linearAlcohol
    ? [
        [0, 1],
        [1, 2],
        [0, 3],
        [0, 4],
        [0, 5],
        [1, 6],
        [1, 7],
        [2, 8],
      ]
    : [
        [0, 2],
        [1, 2],
        [0, 3],
        [0, 4],
        [0, 5],
        [1, 6],
        [1, 7],
        [1, 8],
      ];
  const ids = permutation.map((n) => n + offset);
  return {
    atoms: elements.map((e, i) => atom(ids[i], e)).reverse(),
    bonds: links.map(([a, b]) => bond(ids[b], ids[a])).reverse(),
  };
}
function update(world, tick, bonds) {
  const key = (b) => [Math.min(b.a, b.b), Math.max(b.a, b.b)].join("/");
  const previous = new Map(world.bonds.map((b) => [key(b), b]));
  const next = new Map(bonds.map((b) => [key(b), b]));
  world.flux = {
    formed: bonds.filter((b) => !previous.has(key(b))),
    broken: world.bonds.filter((b) => !next.has(key(b))),
    upgraded: bonds.filter((b) => previous.has(key(b)) && previous.get(key(b)).order !== b.order),
  };
  world.tick = tick;
  world.bonds = bonds;
  world.observer = observeAtomicWorld(world, world.observer);
  world.reactionBench = updateReactionBench(world, world.reactionBench);
  return getReactionBenchReport(world);
}
function fixture(particles, tick = 0, bonds = []) {
  const world = {
    seed: 42,
    particles,
    bonds: [],
    tick,
    observer: null,
    reactionBench: null,
    getMetrics() {
      return { timeFs: this.tick * ATOMIC_PHYSICS.tickFs };
    },
  };
  update(world, tick, bonds);
  return world;
}

test("reaction groups use identical connectivity across atom IDs and distinguish same-formula isomers", () => {
  const order = [1, 2, 3, 4, 5, 6, 7, 8, 9],
    scrambled = [9, 3, 6, 8, 2, 5, 1, 7, 4];
  const ethanol = alcoholOrEther(true, 0, order),
    ether = alcoholOrEther(false, 10, scrambled),
    secondEther = alcoholOrEther(false, 30, order);
  const a = identifyMolecularGraph(ethanol.atoms, ethanol.bonds),
    b = identifyMolecularGraph(ether.atoms, ether.bonds);
  assert.equal(a.status, "exact");
  assert.equal(b.status, "exact");
  assert.equal(a.formula, "C2H6O");
  assert.equal(a.formula, b.formula);
  assert.notEqual(a.key, b.key);
  const reordered = identifyMolecularGraph(
    secondEther.atoms.slice().reverse(),
    secondEther.bonds.slice().reverse(),
  );
  assert.equal(reordered.key, b.key);
  const world = fixture([...ether.atoms, ...ethanol.atoms, ...secondEther.atoms]);
  const edges = [...ether.bonds, ...ethanol.bonds, ...secondEther.bonds];
  const report = update(world, 1, edges);
  const groups = report.groups.filter(
    (group) => group.type === "association" && group.products[0]?.formula === "C2H6O",
  );
  assert.equal(report.eventCount, 3);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((group) => group.occurrences).sort((x, y) => x - y),
    [1, 2],
  );
  const byProduct = new Map(groups.map((g) => [g.products[0].key, g]));
  assert.equal(byProduct.get(a.key).occurrences, 1);
  assert.equal(byProduct.get(b.key).occurrences, 2);
  world.reactionBench = updateReactionBench(world, world.reactionBench);
  const same = getReactionBenchReport(world);
  assert.deepEqual(same, report);
  const quiet = update(world, 2, edges);
  assert.equal(quiet.eventCount, 3);
  assert.equal(quiet.comparedSteps, 2);
});

test("rupture and reformation on the same atom IDs create two distinct residence intervals", () => {
  const w = fixture([atom(1, "H"), atom(2, "H")]),
    pair = [bond(1, 2)];
  const inspect = (report) => {
    const g = report.groups.find((g) => g.type === "association");
    assert.ok(g);
    const win = g.persistence.find((p) => p.windowFs === 24);
    assert.ok(win);
    return { g, win };
  };
  for (let t = 1; t <= 3; t++) update(w, t, pair);
  for (let t = 4; t <= 5; t++) update(w, t, []);
  for (let t = 6; t <= 8; t++) update(w, t, pair);
  let { g, win } = inspect(getReactionBenchReport(w));
  assert.equal(g.occurrences, 2);
  assert.equal(win.reached, 0);
  assert.equal(win.endedBefore, 1);
  assert.equal(win.censoredBefore, 1);
  for (let t = 9; t <= 13; t++) update(w, t, pair);
  ({ g, win } = inspect(getReactionBenchReport(w)));
  assert.equal(win.reached, 1);
  assert.equal(win.endedBefore, 1);
  assert.equal(win.censoredBefore, 0);
  assert.equal(g.occurrences, 2);
  assert.equal(g.residence.completedCount, 1);
  assert.equal(g.residence.ongoingCount, 1);
  assert.ok(Math.abs(g.residence.completedMeanFs - 3 * ATOMIC_PHYSICS.tickFs) < 1e-9);
  assert.ok(Math.abs(g.residence.ongoingMaxFs - 7 * ATOMIC_PHYSICS.tickFs) < 1e-9);
});

test("restored baseline has its own observation coverage and viewing is neutral to the physical replay", () => {
  const archived = new URL("./fixtures/atomic-v2-pre-bench.json.gz", import.meta.url);
  const baseline = JSON.parse(gunzipSync(readFileSync(archived)));
  assert.equal(baseline.reactionBench, undefined);
  const source = new AtomicWorld(baseline.seed, {
    physicsVersion: 2,
    count: baseline.particles.length,
    temperatureK: baseline.initialTemperatureK,
    volumeNm3: baseline.initialVolumeNm3,
    ...baseline.controls,
  });
  for (let i = 0; i < baseline.tick; i++) source.step();
  const checkpoint = source.serialize();
  assert.deepEqual(checkpoint.particles, baseline.particles);
  assert.deepEqual(checkpoint.bonds, baseline.bonds);
  const resumed = AtomicWorld.restore(baseline),
    continuous = AtomicWorld.restore(checkpoint);
  const report = getReactionBenchReport(resumed);
  assert.equal(report.startTick, baseline.tick);
  assert.equal(report.tick, baseline.tick);
  assert.equal(report.coverageFs, 0);
  assert.equal(report.eventCount, 0);
  assert.equal(report.comparedSteps, 0);
  assert.ok(resumed.bonds.length > 0);
  for (let i = 0; i < 40; i++) {
    const before = JSON.stringify(resumed.serialize());
    getReactionBenchReport(resumed);
    getReactionBenchReport(resumed);
    assert.equal(JSON.stringify(resumed.serialize()), before);
    resumed.step();
    continuous.step();
  }
  for (const field of ["particles", "bonds", "flux"]) {
    assert.deepEqual(resumed[field], continuous[field]);
  }
  assert.deepEqual(resumed.getMetrics(), continuous.getMetrics());
  const after = getReactionBenchReport(resumed);
  assert.equal(after.comparedSteps, 40);
  assert.equal(after.coverageFs, ATOMIC_PHYSICS.tickFs * 40);
  assert.equal(after.startTick, baseline.tick);
  for (let i = 0; i < 30; i++) {
    resumed.reactionBench = updateReactionBench(resumed);
    resumed.step();
    continuous.step();
  }
  assert.deepEqual(resumed.particles, continuous.particles);
  assert.deepEqual(resumed.bonds, continuous.bonds);
  assert.deepEqual(resumed.flux, continuous.flux);
});

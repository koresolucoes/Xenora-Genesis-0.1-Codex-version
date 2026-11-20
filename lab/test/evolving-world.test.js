import test from "node:test";
import assert from "node:assert/strict";
import { EvolvingWorld } from "../public/src/evolving-world.js";

function advance(world, n) {
  for (let i = 0; i < n; i++) world.step();
}

function livingCounts(world) {
  const counts = Array(11).fill(0);
  for (const org of world.organisms) counts[org.genome.allele]++;
  return counts;
}

test("descendants inherit lineages, span generations and vary by one heritable allele step", () => {
  const world = new EvolvingWorld(42);
  const founder = new Map(world.organisms.map((o) => [o.id, o]));
  const known = new Map(
    world.organisms.map((o) => [
      o.id,
      { generation: o.generation, lineage: o.lineage, allele: o.genome.allele },
    ]),
  );
  let mutations = 0,
    oldestGeneration = 0;
  const allFrequencies = [];
  for (let tick = 0; tick < 450; tick++) {
    world.step();
    for (const organism of world.organisms) {
      assert.ok(founder.has(organism.lineage));
      assert.equal(organism.trait, organism.genome.allele / 10);
      if (known.has(organism.id)) continue;
      const parent = known.get(organism.parentId);
      assert.ok(parent);
      assert.equal(organism.lineage, parent.lineage);
      assert.equal(organism.generation, parent.generation + 1);
      const jump = Math.abs(organism.genome.allele - parent.allele);
      assert.ok(jump === 0 || jump === 1);
      if (jump) mutations++;
      oldestGeneration = Math.max(oldestGeneration, organism.generation);
      known.set(organism.id, {
        generation: organism.generation,
        lineage: organism.lineage,
        allele: organism.genome.allele,
      });
    }
    const m = world.getMetrics(),
      counts = livingCounts(world);
    assert.deepEqual(m.traitCounts, counts);
    assert.equal(m.population, m.founderCount + m.births - m.deaths);
    assert.equal(m.mutations, mutations);
    assert.equal(m.maxGeneration, oldestGeneration);
    assert.ok(Math.abs(m.massError) < 1e-8);
    assert.ok(Math.abs(m.energyError) < 1e-7);
    if (m.population)
      for (let allele = 0; allele < counts.length; allele++)
        assert.ok(Math.abs(m.traitFrequencies[allele] - counts[allele] / m.population) < 1e-12);
    if (tick % 25 === 0) allFrequencies.push(JSON.stringify(m.traitFrequencies));
  }
  assert.ok(oldestGeneration >= 2 && mutations > 0);
  assert.ok(new Set(allFrequencies).size > 1);
});

test("the neutral physiological control is invariant to swapping every inherited label", () => {
  const options = { selectionEnabled: false, mutationEnabled: false, learningEnabled: false };
  const original = new EvolvingWorld(42, options),
    flipped = new EvolvingWorld(42, options);
  for (const org of flipped.organisms) {
    org.genome.allele = 10 - org.genome.allele;
    org.trait = org.genome.allele / 10;
  }
  for (const lineage of flipped.lineages) lineage.trait = 1 - lineage.trait;
  for (let t = 0; t < 130; t++) {
    original.step();
    flipped.step();
  }
  const material = (o) => [o.id, o.parentId, o.lineage, o.generation, o.age, o.x, o.y, o.mass, o.energy];
  assert.deepEqual(original.organisms.map(material), flipped.organisms.map(material));
  assert.equal(original.rng, flipped.rng);
  assert.deepEqual(livingCounts(original), livingCounts(flipped).reverse());
  assert.ok(original.getMetrics().births > 0);
});

test("external interventions and heritable competition survive checkpoint replay; a fork is independent", () => {
  const original = new EvolvingWorld(719);
  advance(original, 65);
  original.addNutrientPulse(0.25, 0.75, 1);
  const snapshot = original.serialize();
  const resumed = EvolvingWorld.restore(JSON.parse(JSON.stringify(snapshot)));
  const fork = original.fork({ selectionEnabled: false });
  assert.deepEqual(fork.organisms, original.organisms);
  assert.equal(fork.rng, original.rng);
  assert.notEqual(fork.organisms, original.organisms);
  if (fork.organisms.length) assert.notEqual(fork.organisms[0].genome, original.organisms[0].genome);
  fork.setLightForcing(0);
  advance(fork, 25);
  assert.deepEqual(original.serialize(), snapshot);
  for (const branch of [original, resumed]) {
    branch.setLightForcing(1.3);
    advance(branch, 150);
    branch.addNutrientPulse(0.66, 0.35, 0.5);
    advance(branch, 135);
  }
  assert.deepEqual(resumed.serialize(), original.serialize());
  const bad = structuredClone(snapshot);
  bad.organisms[0].genome.allele = 49;
  assert.throws(() => EvolvingWorld.restore(bad));
});

test("sterile and extinct worlds keep a physical clock and never repopulate by themselves", () => {
  const sterile = new EvolvingWorld(1, { founderCount: 0 });
  for (const light of [1, 0, 1.3]) {
    sterile.setLightForcing(light);
    advance(sterile, 900);
    assert.equal(sterile.organisms.length, 0);
    assert.equal(sterile.getMetrics().births, 0);
    assert.equal(sterile.getMetrics().extinct, false);
  }
  assert.equal(sterile.tick, 2700);
  assert.ok(sterile.history[0].tick > 0);
  const sterileCheckpoint = JSON.parse(JSON.stringify(sterile.serialize()));
  assert.deepEqual(EvolvingWorld.restore(sterileCheckpoint).serialize(), sterileCheckpoint);
  const occupied = new EvolvingWorld(42);
  assert.ok(occupied.organisms.length > 0);
  occupied.setLightForcing(0);
  for (let i = 0; i < 2400 && occupied.organisms.length; i++) occupied.step();
  assert.ok(occupied.getMetrics().founderCount > 0);
  assert.equal(occupied.organisms.length, 0);
  assert.equal(occupied.getMetrics().extinct, true);
  assert.equal(occupied.getMetrics().extinctionTick, occupied.tick);
  const before = occupied.tick;
  const resumed = EvolvingWorld.restore(occupied.serialize());
  for (const w of [occupied, resumed]) {
    w.setLightForcing(1.3);
    w.addNutrientPulse(0.5, 0.5, 1);
    advance(w, 500);
  }
  assert.equal(occupied.tick, before + 500);
  assert.equal(occupied.organisms.length, 0);
  assert.deepEqual(occupied.serialize(), resumed.serialize());
});

test("thermal selection shifts inherited frequencies in occupied paired climates", () => {
  for (const seed of [1, 2, 3]) {
    const initial = new EvolvingWorld(seed, { mutationEnabled: false, learningEnabled: false });
    const selected = initial.fork({ lightForcing: 1.3, selectionEnabled: true });
    const neutral = initial.fork({ lightForcing: 1.3, selectionEnabled: false });
    assert.equal(initial.getMetrics().founderCount, 24);
    assert.deepEqual(selected.organisms, neutral.organisms);
    assert.equal(selected.rng, neutral.rng);
    assert.deepEqual(selected.environment.serialize(), neutral.environment.serialize());
    advance(selected, 400);
    advance(neutral, 400);
    for (const world of [selected, neutral]) {
      assert.equal(world.mutations, 0);
      assert.ok(world.getMetrics().maxGeneration >= 2 && world.organisms.length > 0);
    }
    const thermalMismatch = (world) =>
      world.organisms.reduce((sum, org) => {
        const temperatureK = world.environment.sample(org.x, org.y).temperatureK;
        return sum + Math.abs(temperatureK - (266 + 4.8 * org.genome.allele));
      }, 0) / world.organisms.length;
    assert.ok(thermalMismatch(selected) < thermalMismatch(neutral));
    assert.ok(selected.getMetrics().traitFrequencies[8] > neutral.getMetrics().traitFrequencies[8]);
    assert.notDeepEqual(neutral.getMetrics().traitFrequencies, initial.getMetrics().traitFrequencies);
  }
});

test("checkpoint validation rejects contradictory science samples and missing recording intervals", () => {
  const world = new EvolvingWorld(42);
  advance(world, 90);
  const checkpoint = world.serialize();
  for (const change of [
    (h) => {
      h[1].meanTemperatureK = -1;
    },
    (h) => {
      h[1].absorbedEnergy = Number.NaN;
    },
    (h) => {
      h.splice(3, 1);
    },
    (h) => {
      h.at(-1).traitCounts.reverse();
      h.at(-1).traitFrequencies.reverse();
    },
  ]) {
    const bad = structuredClone(checkpoint);
    change(bad.history);
    assert.throws(() => EvolvingWorld.restore(bad));
  }
  advance(world, 3);
  const betweenSamples = JSON.parse(JSON.stringify(world.serialize()));
  assert.deepEqual(EvolvingWorld.restore(betweenSamples).serialize(), betweenSamples);
});

import assert from "node:assert/strict";
import test from "node:test";
import { World } from "../public/src/engine.js";
import { createCell, divideMolecules, makeGenome, molecularTraits, remodelFromReserve } from "../public/src/molecular.js";
import { readLegacyWorld } from "./fixtures/previous-worlds.mjs";

const pools = {
  membrane: "membraneMass", pigment: "pigmentMass",
  transporters: "transporterMass", reserve: "reserveMass"
};

function near(actual, expected, tolerance = 1e-8) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to equal ${expected} within ${tolerance}`);
}

function phenotype(allocation) {
  const world = new World(111);
  const org = world.organisms[0];
  org.genome = makeGenome(allocation);
  org.cell = createCell(org.mass, org.genome);
  world.setLight(org.x, org.y);
  return { world, org };
}

test("realised pigment and transporters determine capture, uptake and their energetic costs", () => {
  const pigment = phenotype(1), transport = phenotype(0);
  assert.equal(pigment.org.mass, transport.org.mass);
  assert.ok(pigment.org.cell.pigment > transport.org.cell.pigment);
  assert.ok(pigment.org.cell.transporters < transport.org.cell.transporters);
  const p = molecularTraits(pigment.org), t = molecularTraits(transport.org);
  // Changing only the inherited recipe does not instantly rebuild the cell.
  const changedGenome = { ...pigment.org, genome: makeGenome(0) };
  const sameCell = molecularTraits(changedGenome);
  for (const key of ["lightFactor", "uptakeFactor"]) assert.equal(sameCell[key], p[key]);
  assert.ok(p.lightFactor > t.lightFactor && t.uptakeFactor > p.uptakeFactor);
  assert.ok(pigment.world.energyShares().get(pigment.org.id) >
    transport.world.energyShares().get(transport.org.id));

  function uptake({ world, org }) {
    const traits = molecularTraits(org), massBefore = org.mass, energyBefore = org.energy;
    const { waste: wasteBefore } = world.environment.totals();
    assert.equal(world.absorbNutrient(org), 0);
    world.addNutrientPulse(org.x, org.y, 0.25);
    const captured = world.absorbNutrient(org), growth = org.mass - massBefore;
    assert.ok(captured > 0 && growth > 0);
    near(growth, captured * traits.assimilationYield);
    near(energyBefore - org.energy, growth * traits.synthesisCost);
    near(world.environment.totals().waste - wasteBefore + growth, captured);
    near(Object.values(org.cell).reduce((a, b) => a + b), org.mass);
    near(world.getMetrics().massError, 0);
    near(world.getMetrics().energyError, 0);
    return captured;
  }
  assert.ok(uptake(transport) > uptake(pigment));
});

test("energy-limited synthesis leaves available dissolved material in the water", () => {
  const { world, org } = phenotype(0.5);
  world.addNutrientPulse(org.x, org.y, 1);
  const { assimilationYield, synthesisCost } = molecularTraits(org);
  const availableEnergy = 0.0001;
  world.dissipatedEnergy += org.energy - availableEnergy;
  org.energy = availableEnergy;
  const massBefore = org.mass;
  const used = world.absorbNutrient(org);
  near(used, availableEnergy / (synthesisCost * assimilationYield));
  near(org.mass - massBefore, used * assimilationYield);
  near(org.energy, 0);
  near(world.absorbNutrient(org), 0);
  assert.ok(world.environment.totals().nutrient > 0.9);
  near(world.getMetrics().energyError, 0);
  near(world.getMetrics().massError, 0);
});

test("different tapes produce different new material before the realised phenotype diverges", () => {
  // Two cells start with the same physical machinery. Only their instructions
  // for the next round of synthesis differ.
  function feed(allocation) {
    const { world, org } = phenotype(0.5);
    org.genome = makeGenome(allocation);
    const before = molecularTraits(org), pigmentBefore = org.cell.pigment;
    const transportBefore = org.cell.transporters, massBefore = org.mass;
    world.addNutrientPulse(org.x, org.y, 0.2);
    const uptake = world.absorbNutrient(org);
    return {
      before, after: molecularTraits(org), uptake, growth: org.mass - massBefore,
      newPigment: org.cell.pigment - pigmentBefore,
      newTransporters: org.cell.transporters - transportBefore
    };
  }
  const pigment = feed(1), transport = feed(0);
  near(pigment.before.lightFactor, transport.before.lightFactor);
  near(pigment.before.uptakeFactor, transport.before.uptakeFactor);
  near(pigment.uptake, transport.uptake);
  near(pigment.growth, transport.growth);
  assert.ok(pigment.growth > 0 && pigment.newPigment > transport.newPigment);
  assert.ok(pigment.newTransporters < transport.newTransporters);
  assert.ok(pigment.after.lightFactor > transport.after.lightFactor);
  assert.ok(pigment.after.uptakeFactor < transport.after.uptakeFactor);
});

test("scarcity reallocates reserve with a measured energy cost, while feeding replenishes it", () => {
  const { world, org } = phenotype(0.5);
  // Store the initial grains as a single, freshly formed piece of detritus. On
  // the first tick there can be no food intake and the pond keeps its material.
  world.addDetritus(0.5, 0.5, world.grains.reduce((sum, grain) => sum + grain.mass, 0));
  world.grains = [];
  const before = structuredClone(org), expected = structuredClone(org);
  const cost = remodelFromReserve(expected);
  const transferred = before.cell.reserve - expected.cell.reserve;
  near(transferred, 0.0006 * org.mass);
  near(cost, transferred * 0.10);
  near(expected.energy, before.energy);
  near(expected.cell.pigment - before.cell.pigment, transferred / 2);
  near(expected.cell.transporters - before.cell.transporters, transferred / 2);
  world.step();
  assert.equal(org.flux.uptake, 0);
  assert.deepEqual(org.cell, expected.cell);
  near(org.mass, before.mass);
  const distance = org.activeDistance - before.activeDistance;
  const basalAndMovement = 0.0058 + 0.0007 * org.mass + 1.9 * distance + molecularTraits(before).maintenance;
  near(before.energy + org.flux.light - org.energy - basalAndMovement, cost);
  near(world.getMetrics().energyError, 0);
  near(world.getMetrics().massError, 0);

  const remainingReserve = org.cell.reserve;
  world.addNutrientPulse(org.x, org.y, 0.2);
  assert.ok(world.absorbNutrient(org) > 0);
  near(org.cell.reserve - remainingReserve, 0.20 * (org.mass - before.mass));
  assert.ok(org.cell.reserve > remainingReserve);

  const limited = structuredClone(org);
  limited.energy = 0.000001;
  near(remodelFromReserve(limited), limited.energy, 1e-12);
  limited.energy = 0;
  const unchanged = { ...limited.cell };
  assert.equal(remodelFromReserve(limited), 0);
  assert.deepEqual(limited.cell, unchanged);
  limited.energy = 3;
  const floor = 0.1 * limited.mass;
  limited.cell.pigment += limited.cell.reserve - floor;
  limited.cell.reserve = floor;
  assert.equal(remodelFromReserve(limited), 0);
});

test("division partitions actual material and a mutation affects only the child's recipe", () => {
  for (const [draw, expectMutation] of [[0, true], [0.99, false]]) {
    const parent = phenotype(0.6).org;
    const originalCell = { ...parent.cell }, originalGene = parent.genome.allocation;
    const originalTape = parent.genome.sequence;
    const child = { ...parent, id: 999 };
    parent.mass /= 2;
    child.mass = parent.mass;
    divideMolecules(parent, child, () => draw);
    assert.notEqual(parent.cell, child.cell);
    assert.notEqual(parent.genome, child.genome);
    assert.equal(parent.genome.allocation, originalGene);
    assert.equal(parent.genome.sequence, originalTape);
    const edits = [...child.genome.sequence].filter((bit, index) => bit !== originalTape[index]).length;
    assert.equal(edits, expectMutation ? 1 : 0);
    assert.equal(child.genome.allocation !== originalGene, expectMutation);
    assert.ok(child.genome.allocation >= 0 && child.genome.allocation <= 1);
    near(child.mutationDelta, child.genome.allocation - originalGene);
    near(Math.abs(child.mutationDelta), expectMutation ? 1/20 : 0);
    for (const key of Object.keys(pools)) {
      near(parent.cell[key], originalCell[key] / 2);
      near(child.cell[key], originalCell[key] / 2);
    }
    child.genome.allocation = 1;
    child.cell.reserve = 0;
    assert.equal(parent.genome.allocation, originalGene);
    near(parent.cell.reserve, originalCell.reserve / 2);
  }
});

test("a real v2 checkpoint migrates without drawing RNG or changing stocks, lineage or energy", () => {
  const old = readLegacyWorld(2), current = World.restore(old), result = current.serialize();
  assert.equal(result.version, 3);
  assert.equal(result.molecularSinceTick, old.tick);
  assert.deepEqual(result.telemetry.filter(row => row.tick < old.tick), old.telemetry);
  assert.equal(result.telemetry.at(-1).tick, old.tick);
  for (const key of ["seed","tick","rng","nextId","initialMass","initialEnergy","births","deaths",
    "absorbedEnergy","dissipatedEnergy","nutrientInputTotal","light","events","grains","detritus","minerals","environment"]) {
    assert.deepEqual(result[key], old[key], key);
  }
  for (const [index, org] of current.organisms.entries()) {
    for (const [key, value] of Object.entries(old.organisms[index])) assert.deepEqual(org[key], value, key);
    assert.equal(org.genome.allocation, 0.5);
    assert.match(org.genome.sequence, /^[01]{20}$/);
    assert.equal([...org.genome.sequence].filter(bit => bit === "1").length, 10);
    near(Object.values(org.cell).reduce((a, b) => a + b), org.mass);
    near(org.flux.light, 0); near(org.flux.uptake, 0);
  }
  const replay = World.restore(JSON.parse(JSON.stringify(result)));
  for (const branch of [current, replay]) {
    for (let i = 0; i < 180; i++) {
      if (i === 27) branch.addNutrientPulse(0.6, 0.4, 1);
      if (i === 53) branch.setLight(0.35, 0.75);
      branch.step();
    }
  }
  assert.deepEqual(current.serialize(), replay.serialize());
});

test("molecular inventory reconciles with every organism and the whole pond through generations", () => {
  const w = new World(42), initialPopulation = w.organisms.length;
  for (let i = 0; i < 1200; i++) {
    if (i === 43) w.addNutrientPulse(0.55, 0.5, 1);
    const absorbedBefore = w.absorbedEnergy;
    w.step();
    const m = w.getMetrics(), totals = { membrane: 0, pigment: 0, transporters: 0, reserve: 0 };
    for (const org of w.organisms) {
      let mass = 0;
      for (const key of Object.keys(pools)) {
        assert.ok(Number.isFinite(org.cell[key]) && org.cell[key] >= 0);
        totals[key] += org.cell[key]; mass += org.cell[key];
      }
      near(mass, org.mass);
    }
    for (const [pool, metric] of Object.entries(pools)) near(m[metric], totals[pool]);
    near(m.capturedLightLastTick, w.absorbedEnergy - absorbedBefore);
    near(m.dissolvedUptakeLastTick, w.organisms.reduce((sum, org) => sum + org.flux.uptake, 0));
    if (w.organisms.length) near(m.meanAllocation, w.organisms.reduce((sum, org) => sum + org.genome.allocation, 0) / w.organisms.length);
    near(Object.values(totals).reduce((a, b) => a + b), m.bodyMass);
    near(m.totalMass, m.initialMass + m.nutrientInputTotal);
    near(m.energyError, 0);
    assert.equal(m.population, initialPopulation + m.births - m.deaths);
  }
  assert.ok(w.births > 0 && w.deaths > 0);
});

test("v3 restore rejects missing, nonphysical or inconsistent molecular state", () => {
  const saved = new World(78).serialize();
  for (const corrupt of [
    o => { delete o.cell; }, o => { o.cell.reserve = -0.2; },
    o => { o.cell.pigment += 0.5; }, o => { o.cell.transporters = null; },
    o => { o.genome.allocation = 1.2; }, o => { o.genome.allocation = NaN; },
    o => { delete o.genome.sequence; }, o => { o.genome.sequence = "01"; },
    o => { o.genome.sequence = "X".repeat(20); },
    o => { o.genome = { sequence: "1".repeat(20), allocation: 0.5 }; },
    o => { delete o.mutationDelta; }, o => { o.mutationDelta = -0.126; },
    o => { o.mutationDelta = 0.05; }, // A founder cannot have inherited a mutation.
    o => { o.flux.light = -0.1; }, o => { o.flux.uptake = Infinity; }
  ]) {
    const broken = structuredClone(saved);
    corrupt(broken.organisms[0]);
    assert.throws(() => World.restore(broken));
  }
  for (const corrupt of [
    s => { s.molecularSinceTick = s.tick + 1; },
    s => { s.telemetry.at(-1).pigmentMass += 1; },
    s => { s.telemetry.at(-1).transporterMass = -1; },
    s => { s.telemetry.at(-1).meanAllocation = 2; }
  ]) {
    const broken = structuredClone(saved);
    corrupt(broken);
    assert.throws(() => World.restore(broken));
  }
  assert.deepEqual(World.restore(saved).serialize(), saved);
});

import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../public/src/engine.js";

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

function advance(world, count) {
  for (let i = 0; i < count; i++) world.step();
}

test("erosion moves existing solid into local water; absorbing it consumes energy and excretes waste", () => {
  const world = new World(42);
  const control = new World(42);
  const initial = world.getMetrics();
  world.erodeGrains();
  const eroded = world.getMetrics();
  assert.ok(eroded.nutrientMass > 0);
  close(eroded.nutrientMass, initial.grainMass - eroded.grainMass);
  close(eroded.massError, 0);

  const original = control.organisms[0];
  assert.equal(control.absorbNutrient(original), 0);
  const x = original.x, y = original.y;
  const emptyBefore = control.getMetrics();
  const dose = 0.018;
  control.addNutrientPulse(x, y, dose);
  close(control.absorbNutrient(original), dose);
  assert.equal(control.absorbNutrient(original), 0);
  const after = control.getMetrics();
  assert.ok(after.bodyMass > emptyBefore.bodyMass && after.wasteMass > emptyBefore.wasteMass);
  close(after.nutrientMass, 0);
  close(after.bodyMass - emptyBefore.bodyMass + after.wasteMass, dose);
  assert.ok(after.totalEnergy < emptyBefore.totalEnergy);
  close(emptyBefore.totalEnergy - after.totalEnergy, after.dissipatedEnergy - emptyBefore.dissipatedEnergy);
  close(after.energyError, 0);
  close(after.massError, 0);
});

test("turbid water locally reduces capturable energy under the same light and with the same material", () => {
  const clear = new World(95);
  const turbid = World.restore(clear.serialize());
  const org = clear.organisms[0];
  for (const world of [clear, turbid]) world.addNutrientPulse(org.x, org.y, 0.8);
  const input = turbid.environment.take("nutrient", org.x, org.y, 0.8);
  turbid.environment.add("waste", org.x, org.y, input);
  close(clear.getMetrics().totalMass, turbid.getMetrics().totalMass);
  assert.ok(turbid.lightAt(org.x, org.y) < clear.lightAt(org.x, org.y));
  assert.ok(turbid.energyShares().get(org.id) < clear.energyShares().get(org.id));
  const far = clear.organisms.find(o => Math.hypot(o.x - org.x, o.y - org.y) > 0.3);
  close(turbid.energyShares().get(far.id), clear.energyShares().get(far.id));
});

test("a dead organism becomes detritus, then supplies the shared chemical cycle", () => {
  const world = new World(42);
  const dying = world.organisms[0];
  dying.age = dying.maxAge - 1;
  const body = dying.mass;
  world.step();
  assert.equal(world.organisms.some(o => o.id === dying.id), false);
  const deadMatter = world.detritus.find(d => Math.abs(d.mass - body) < 1e-9);
  assert.ok(deadMatter);
  const wasteBefore = world.environment.totals().waste;
  deadMatter.decayAt = world.tick + 1;
  world.step();
  assert.equal(world.detritus.some(d => d.id === deadMatter.id), false);
  assert.ok(world.environment.totals().waste > wasteBefore + 0.5 * body);
  assert.ok(world.environment.lastRecycled > 0);
  close(world.getMetrics().massError, 0);
  close(world.getMetrics().energyError, 0);
});

test("material pulse and branch history survive save/restore and replay", () => {
  const world = new World(314);
  advance(world, 33);
  const replay = World.restore(JSON.parse(JSON.stringify(world.serialize())));
  for (const branch of [world, replay]) {
    const before = branch.getMetrics();
    assert.equal(branch.addNutrientPulse(0.15, 0.25, 1.25), 1.25);
    close(branch.getMetrics().totalMass, before.totalMass + 1.25);
    close(branch.getMetrics().massError, 0);
    assert.equal(branch.events.at(-1).type, "nutrient");
    advance(branch, 7);
    assert.equal(branch.telemetry.at(-1).tick, 40);
    close(branch.telemetry.at(-1).nutrientInputTotal, 1.25);
    assert.equal(branch.environment.tick, 40);
  }
  assert.deepEqual(world.serialize(), replay.serialize());
  const before = world.serialize();
  assert.equal(world.addNutrientPulse(0.2, 0.2, 0), 0);
  assert.throws(() => world.addNutrientPulse(0.2, 0.2, -1));
  assert.throws(() => world.addNutrientPulse(NaN, 0.2, 1));
  assert.deepEqual(before, world.serialize());
});

test("version 1 migration keeps old stocks, starts clear water and records only known history", () => {
  // Version 1 never represented dissolved material. Its tick-zero checkpoint
  // has the same seeded entities and schema as v2 before the first erosion.
  const old = new World(111).serialize();
  delete old.environment;
  delete old.telemetry;
  delete old.nutrientInputTotal;
  old.version = 1;
  const migrated = World.restore(old);
  assert.equal(migrated.environment.totals().total, 0);
  assert.equal(migrated.getMetrics().totalMass, old.initialMass);
  assert.equal(migrated.getMetrics().totalEnergy, old.initialEnergy);
  assert.deepEqual(migrated.organisms, old.organisms);
  assert.deepEqual(migrated.grains, old.grains);
  assert.equal(migrated.telemetry.length, 1);
  assert.equal(migrated.serialize().version, 2);
  advance(migrated, 37);
  const restored = World.restore(migrated.serialize());
  advance(migrated, 27);
  advance(restored, 27);
  assert.deepEqual(restored.serialize(), migrated.serialize());
});

test("version 2 checkpoints reject damaged dissolved mass, pulse counters and history", () => {
  const world = new World(42);
  world.addNutrientPulse(0.2, 0.4, 1);
  advance(world, 12);
  for (const breakState of [
    s => { s.environment.tick++; },
    s => { s.environment.nutrient[0] += 1; },
    s => { s.environment.waste[2] = -1; },
    s => { s.nutrientInputTotal = 2; },
    s => { s.telemetry[0].tick = -1; },
    s => { s.telemetry[0].wasteMass = -2; },
    s => { s.telemetry[0].bodyMass += 5; },
    s => { s.telemetry[0].nutrientMass = null; }
  ]) {
    const broken = world.serialize();
    breakState(broken);
    assert.throws(() => World.restore(broken));
  }
});

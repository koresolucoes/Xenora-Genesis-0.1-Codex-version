import assert from "node:assert/strict";
import test from "node:test";
import { World } from "../public/src/engine.js";
import { runPairedTrial } from "../public/src/paired-trial.js";

test("paired pulse runs identical starting checkpoints without changing the active pond", () => {
  const active = new World(809);
  for (let i = 0; i < 17; i++) active.step();
  active.setLight(0.2, 0.65);
  active.addNutrientPulse(0.8, 0.25, 0.75);
  const checkpoint = active.serialize();
  const original = structuredClone(checkpoint);
  const trial = runPairedTrial(checkpoint);

  assert.deepEqual(checkpoint, original);
  assert.deepEqual(active.serialize(), original);
  assert.deepEqual(runPairedTrial(checkpoint), trial);
  assert.equal(trial.seed, 809);
  assert.equal(trial.startTick, 17);
  assert.equal(trial.endTick, 167);

  const treatment = World.restore(original);
  treatment.addNutrientPulse(0.5, 0.5, 1);
  assert.equal(treatment.rng, active.rng);
  for (let tick = trial.startTick; tick < trial.endTick; tick++) {
    treatment.step();
    active.step();
  }
  const control = active.getMetrics();
  const treated = treatment.getMetrics();
  assert.ok(Math.abs(treated.totalMass - control.totalMass - 1) < 1e-8);
  for (const key of ["nutrientMass", "bodyMass", "population"]) {
    assert.equal(trial.differences[key], treated[key] - control[key]);
  }
});

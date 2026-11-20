import assert from "node:assert/strict";
import test from "node:test";
import { World } from "../public/src/engine.js";

function advance(world, steps) {
  for (let i = 0; i < steps; i++) world.step();
}

test("same seed, light commands and saved checkpoint replay the same world", () => {
  const first = new World(42);
  const second = new World(42);
  for (const world of [first, second]) {
    advance(world, 60);
    world.setLight(0.25, 0.7);
    advance(world, 120);
  }
  assert.deepEqual(second.serialize(), first.serialize());
  const resumed = World.restore(JSON.parse(JSON.stringify(first.serialize())));
  for (const world of [first, resumed]) {
    advance(world, 50);
    world.setLight(0.71, 0.2);
    advance(world, 70);
  }
  assert.deepEqual(resumed.serialize(), first.serialize());
});

test("reactive matter is conserved through feeding, reproduction and death", () => {
  const world = new World(42);
  const initialMass = world.getMetrics().totalMass;
  for (let interval = 0; interval < 25; interval++) {
    advance(world, 50);
    const { grainMass, bodyMass, detritusMass, nutrientMass, wasteMass } = world.getMetrics();
    assert.ok(Math.abs(grainMass + bodyMass + detritusMass + nutrientMass + wasteMass - initialMass) < 1e-8);
  }
  assert.ok(world.births > 0);
  assert.ok(world.deaths > 0);
});

test("restoring rejects unsupported, corrupt or inconsistent checkpoints", () => {
  const world = new World(0);
  const changes = [
    state => { state.version += 1; },
    state => { state.rng = 0; },
    state => { state.grains[0].id = state.organisms[0].id; },
    state => { state.organisms[0].x = -1; },
    state => { state.initialMass += 1; },
    state => { state.organisms[0].mass = null; }
  ];
  for (const change of changes) {
    const snapshot = world.serialize();
    change(snapshot);
    assert.throws(() => World.restore(snapshot));
  }
});

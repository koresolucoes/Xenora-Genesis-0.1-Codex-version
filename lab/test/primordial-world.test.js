import test from "node:test";
import assert from "node:assert/strict";
import {
  PrimordialWorld,
  PRIMORDIAL_ELEMENTS,
} from "../public/src/primordial.js";

function near(actual, expected, tolerance = 1e-8) {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to equal ${expected} within ${tolerance}`,
  );
}

function until(world, check, limit = 650) {
  for (let step = 0; step <= limit; step++) {
    const metrics = world.getMetrics();
    if (check(metrics)) return metrics;
    world.step();
  }
  assert.fail("The model did not reach the expected phase");
}

test("doubling the scale halves radiation temperature and reduces matter density by eight", () => {
  const world = new PrimordialWorld({ seed: 42 });
  const start = world.getMetrics();
  const target = 2 * start.scaleFactor;
  let before = start,
    after = start;
  while (after.scaleFactor < target && after.tick < 600) {
    before = after;
    world.step();
    after = world.getMetrics();
    const a = after.scaleFactor / start.scaleFactor;
    near(after.cosmicTemperature / start.cosmicTemperature, 1 / a);
    near(after.matterDensity / start.matterDensity, 1 / a ** 3);
  }
  assert.ok(after.scaleFactor >= target && before.scaleFactor < target);
  // Reconstruct the value exactly at a=2, even if a simulation tick straddles it.
  const fraction =
    Math.log(target / before.scaleFactor) /
    Math.log(after.scaleFactor / before.scaleFactor);
  const interpolate = (key) =>
    before[key] * (after[key] / before[key]) ** fraction;
  near(interpolate("cosmicTemperature"), start.cosmicTemperature / 2);
  near(interpolate("matterDensity"), start.matterDensity / 8);
});

test("minerals conserve each element with two Mg, one Si and four O per formula unit", () => {
  const world = new PrimordialWorld({ seed: 42 });
  const phases = new Set();
  let positive = false;
  until(world, (m) => {
    phases.add(m.phase);
    assert.equal(m.lifeCount, 0);
    const recipe = { Mg: 2, Si: 1, O: 4 };
    for (const symbol of PRIMORDIAL_ELEMENTS) {
      const lot = m.elements.find((element) => element.symbol === symbol);
      near(lot.mineral, (recipe[symbol] || 0) * m.mineralUnits);
      near(m.locked[symbol], m.stellar[symbol] + lot.mineral);
      near(
        m.primordial[symbol] + m.ejecta[symbol],
        m.gas[symbol] + m.locked[symbol] + m.exported[symbol],
      );
      near(m.elementResiduals[symbol], 0);
    }
    assert.ok(m.maxElementResidual < 1e-8);
    if (m.mineralUnits > 0) positive = true;
    return m.lagoonReady;
  });
  assert.ok(positive && world.lagoon);
  assert.deepEqual(
    [...phases],
    ["plasma", "nuclei", "atoms", "stars", "disk", "minerals", "lagoon"],
  );
  assert.equal(world.lagoon.getMetrics().demonstratedLifeCount, 0);
});

test("a silicon-free origin and a silicon export from a late branch give distinct controls", () => {
  const none = new PrimordialWorld({ seed: 42, silicon: false });
  until(none, (m) => {
    near(m.mineralUnits, 0);
    return m.lagoonReady;
  });
  assert.ok(none.lagoon);
  const world = new PrimordialWorld({ seed: 42, silicon: true });
  const when = until(
    world,
    (m) => m.phase === "minerals" && m.mineralUnits > 0 && m.gas.Si > 0,
  );
  const original = world.serialize(),
    fork = world.branchWithoutSilicon();
  assert.deepEqual(world.serialize(), original);
  const branch = fork.getMetrics();
  near(branch.mineralUnits, when.mineralUnits);
  near(branch.gas.Si, 0);
  near(branch.exported.Si - when.exported.Si, when.gas.Si);
  const finish = until(world, (m) => m.lagoonReady);
  const controlFinish = until(fork, (m) => m.lagoonReady);
  near(controlFinish.mineralUnits, when.mineralUnits);
  assert.ok(finish.mineralUnits > when.mineralUnits);
});

test("the saved origin and its particle lagoon replay exactly on the normal entry point", () => {
  const world = new PrimordialWorld({ seed: 751 });
  until(world, (m) => m.lagoonReady);
  for (let i = 0; i < 37; i++) world.step();
  const previous = world.serialize(),
    restored = PrimordialWorld.restore(JSON.parse(JSON.stringify(previous)));
  assert.deepEqual(restored.serialize(), previous);
  for (let i = 0; i < 80; i++) {
    world.step();
    restored.step();
  }
  assert.deepEqual(restored.serialize(), world.serialize());
  const broken = structuredClone(previous);
  broken.lagoon.particles[0].x = 2;
  assert.throws(() => PrimordialWorld.restore(broken));
});

test("physical provenance and thermodynamic history stay attached to the saved origin", () => {
  const world = new PrimordialWorld({ seed: 42 }),
    other = new PrimordialWorld({ seed: 751 });
  until(world, (m) => m.lagoonReady);
  until(other, (m) => m.lagoonReady);
  const saved = world.serialize();
  assert.equal(other.lagoon.tick, saved.lagoon.tick);
  const edits = [
    (s) => {
      s.lagoon = other.lagoon.serialize();
    },
    (s) => {
      s.history.at(-1).cosmicTemperature *= 2;
    },
    (s) => {
      s.history.at(-1).matterDensity *= 2;
    },
    (s) => {
      s.history.at(-1).mineralUnits += 1;
    },
    (s) => {
      s.history[0].particleCount = 24;
    },
    (s) => {
      s.events.at(-1).text += "?";
    },
    (s) => {
      s.mineralLot.recipe.O = 2;
    },
    (s) => {
      s.mineralLot.source = "unknown";
    },
    (s) => {
      s.ejecta.Si += 1;
      s.gas.Si += 1;
    },
  ];
  for (const edit of edits) {
    const broken = structuredClone(saved);
    edit(broken);
    assert.throws(() => PrimordialWorld.restore(broken));
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  PrimordialParticles,
  observeAggregates,
} from "../public/src/primordial-particles.js";

test("unbonded parcels account for all matter and energy throughout assembly", () => {
  for (const seed of [42, 751]) {
    const pond = new PrimordialParticles(seed);
    const ids = pond.particles.map((p) => p.id);
    const initial = pond.getMetrics();
    assert.equal(initial.bondCount, 0);
    assert.equal(initial.componentCount, 0);
    assert.equal(initial.demonstratedLifeCount, 0);
    for (let i = 0; i < 1000; i++) {
      if (i === 207) pond.setSource(0.8, 0.33, 0.3);
      pond.step();
      const m = pond.getMetrics();
      const charge = pond.particles.reduce((sum, p) => sum + p.energy, 0);
      const committed = pond.bonds.reduce((sum, b) => sum + b.energy, 0);
      assert.equal(m.totalMass, ids.length);
      assert.equal(m.storedEnergy, charge + committed);
      assert.ok(
        Math.abs(
          charge +
            committed +
            m.dissipatedEnergy -
            m.inputEnergy -
            initial.initialEnergy,
        ) < 1e-8,
      );
      assert.deepEqual(
        pond.particles.map((p) => p.id),
        ids,
      );
      assert.equal(m.demonstratedLifeCount, 0);
      assert.ok(
        pond.particles.every((p) => Math.hypot(p.vx, p.vy) <= 0.006 + 1e-14),
      );
    }
    assert.ok(pond.observer.formations > 0);
  }
});

test("turning off the source, bonding and minerals isolates their respective mechanisms", () => {
  const dry = new PrimordialParticles(77, { sourcePower: 0 });
  const unbound = new PrimordialParticles(77, {
    bindingEnabled: false,
    mineralUnits: 0,
  });
  const baseline = new PrimordialParticles(77);
  assert.deepEqual(unbound.particles, baseline.particles);
  for (let i = 0; i < 400; i++) {
    dry.step();
    unbound.step();
    baseline.step();
    assert.equal(dry.inputEnergy, 0);
    assert.equal(unbound.bonds.length, 0);
    assert.equal(unbound.observer.clusters.length, 0);
  }
  assert.equal(unbound.sites.length, 0);
  assert.ok(
    baseline.sites.length > 0 &&
      baseline.inputEnergy > 0 &&
      baseline.observer.formations > 0,
  );
});

test("the observer recognises a persistent ring and its loss without modifying particle state", () => {
  const ps = Array.from({ length: 5 }, (_, i) => ({
    id: i + 1,
    x: i * 0.2,
    y: 0.5,
  }));
  const line = [
    { a: 1, b: 2 },
    { a: 2, b: 3 },
    { a: 3, b: 4 },
  ];
  const ring = [...line, { a: 1, b: 4 }];
  const unchanged = structuredClone({ ps, ring });
  let seen = observeAggregates(ps, line);
  const id = seen.clusters[0].id;
  assert.equal(seen.clusters[0].closed, false);
  for (let i = 1; i < 20; i++) seen = observeAggregates(ps, ring, seen);
  const cluster = seen.clusters[0];
  assert.equal(cluster.id, id);
  assert.ok(cluster.closed && cluster.stable);
  assert.equal(cluster.age, 20);
  assert.deepEqual(cluster.members, [1, 2, 3, 4]);
  const split = observeAggregates(
    ps,
    [
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ],
    seen,
  );
  assert.ok(
    split.clusters.every((c) => c.id !== id && c.age === 1 && !c.stable),
  );
  assert.equal(split.dispersals, 1);
  assert.deepEqual({ ps, ring }, unchanged);
});

test("particle checkpoint replays after loading and rejects impossible motion, links and accounts", () => {
  const pond = new PrimordialParticles(42);
  for (let i = 0; i < 100; i++) pond.step();
  assert.ok(pond.bonds.length && pond.observer.clusters.length);
  const saved = pond.serialize(),
    resumed = PrimordialParticles.restore(JSON.parse(JSON.stringify(saved)));
  for (const branch of [pond, resumed]) {
    branch.setSource(0.5, 0.2, 0.4);
    for (let i = 0; i < 100; i++) branch.step();
  }
  assert.deepEqual(pond.serialize(), resumed.serialize());
  const changes = [
    (s) => {
      s.particles[0].x = -0.001;
    },
    (s) => {
      s.particles[0].vx = 0.006;
      s.particles[0].vy = 0.006;
    },
    (s) => {
      s.bonds[0].a = s.bonds[0].b;
    },
    (s) => {
      s.bonds.push(s.bonds[0]);
    },
    (s) => {
      s.observer.clusters[0].closed = !s.observer.clusters[0].closed;
    },
    (s) => {
      s.particles[0].energy = -0.01;
    },
    (s) => {
      s.initialMass += 1;
    },
    (s) => {
      s.inputEnergy += 8 * (s.tick + 1);
      s.dissipatedEnergy += 8 * (s.tick + 1);
    },
  ];
  changes.push((s) => {
    const { a, b } = s.bonds[0];
    s.particles[a - 1].x = 0.1;
    s.particles[b - 1].x = 0.9;
    const observed = observeAggregates(s.particles, s.bonds).clusters;
    for (const [i, c] of s.observer.clusters.entries()) {
      const { x, y, radius } = observed[i];
      Object.assign(c, { x, y, radius });
    }
  });
  for (const change of changes) {
    const broken = structuredClone(saved);
    change(broken);
    assert.throws(() => PrimordialParticles.restore(broken));
  }
  assert.throws(() => new PrimordialParticles(42, { count: 385 }));
  assert.throws(() => pond.setSource(0.4, 0.4, 8.1));
  const empty = new PrimordialParticles(42, { count: 0 });
  empty.step();
  assert.deepEqual(
    PrimordialParticles.restore(empty.serialize()).serialize(),
    empty.serialize(),
  );
});

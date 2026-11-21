import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { ATOMIC_ELEMENTS } from "../public/src/atomic-elements.js";
import { AtomicWorld, createMolecularReferenceFixture } from "../public/src/atomic-world.js";

const axes = [0, 1, 2];
const magnitude = (vector) => Math.hypot(...vector);
const difference = (a, b) => a.map((x, i) => x - b[i]);
const cross = ([x, y, z], [a, b, c]) => [y * c - z * b, z * a - x * c, x * b - y * a];
const dot = (a, b) => a.reduce((v, x, i) => v + x * b[i], 0);
const close = (actual, expected, tolerance) => {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `got ${actual}, expected ${expected} ± ${tolerance}`,
  );
};

test("calibrated forces equal the negative Cartesian gradient and have zero net force and torque", () => {
  // Non-axis-aligned and asymmetric fixtures exercise every Cartesian derivative.
  const geometries = {
    H2: [
      [-0.025, 0.002, 0.012],
      [0.052, 0.016, -0.017],
    ],
    H2O: [
      [0.008, -0.011, 0.017],
      [-0.03, 0.063, 0.068],
      [0.009, -0.086, 0.077],
    ],
  };
  for (const [formula, positions] of Object.entries(geometries)) {
    const f = createMolecularReferenceFixture(formula, 16, 3);
    f.reset(positions);
    const forces = f.sample().forcesEvPerNm;
    assert.equal(forces.length, positions.length);
    const h = 0.000001;
    for (const [j, p] of positions.entries()) {
      for (const a of axes) {
        const lower = structuredClone(positions),
          upper = structuredClone(positions);
        lower[j][a] = p[a] - h;
        upper[j][a] = p[a] + h;
        const expected = (f.reset(lower) - f.reset(upper)) / (2 * h);
        close(forces[j][a], expected, 2e-6 * (1 + Math.abs(expected)));
      }
    }
    for (const a of axes) {
      close(
        forces.reduce((sum, v) => sum + v[a], 0),
        0,
        1e-10,
      );
      close(
        positions.reduce((sum, p, i) => sum + cross(p, forces[i])[a], 0),
        0,
        1e-10,
      );
    }
  }
});

const radians = (d) => (d * Math.PI) / 180;
function coordinates(formula, r, delta = 0, angleDeg = 104.48, antisymmetric = false) {
  if (formula === "H2")
    return [
      [0, 0, -(r + delta) / 2],
      [0, 0, (r + delta) / 2],
    ];
  const c = Math.cos(radians(angleDeg) / 2),
    s = Math.sin(radians(angleDeg) / 2);
  const r1 = r + delta,
    r2 = antisymmetric ? r - delta : r + delta;
  return [
    [0, 0, 0],
    [c * r1, s * r1, 0],
    [c * r2, -s * r2, 0],
  ];
}

function geometry(formula, p) {
  const d1 = difference(p[1], p[0]),
    r1 = magnitude(d1);
  if (formula === "H2") return { stretch: r1 };
  const d2 = difference(p[2], p[0]),
    r2 = magnitude(d2);
  return {
    stretch: (r1 + r2) / 2,
    asymmetry: (r1 - r2) / 2,
    angle: Math.acos(Math.max(-1, Math.min(1, dot(d1, d2) / (r1 * r2)))),
  };
}

// Blind frequency scan. Its range covers bending and stretching modes; it never
// reads a spectral target or a force constant. Windowing suppresses end effects.
function spectralPeak(signal, sampleFs) {
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  const data = signal.map((y, n) => (y - mean) * Math.sin((Math.PI * n) / (signal.length - 1)) ** 2);
  let bestFrequency = 0,
    bestPower = 0;
  for (let cm = 900; cm <= 5500; cm += 5) {
    const phasePerSample = 2 * Math.PI * cm * 2.99792458e-5 * sampleFs;
    let real = 0,
      imag = 0;
    for (let n = 0; n < data.length; n++) {
      real += data[n] * Math.cos(n * phasePerSample);
      imag += data[n] * Math.sin(n * phasePerSample);
    }
    const power = real ** 2 + imag ** 2;
    if (power > bestPower) {
      bestPower = power;
      bestFrequency = cm;
    }
  }
  assert.ok(bestPower > 0);
  return bestFrequency;
}

const settings = [
  { formula: "H2", quantity: "stretch", r: 0.074144, target: 4401.213, delta: 0.00025, angle: 104.48 },
  { formula: "H2O", quantity: "asymmetry", r: 0.095777, target: 3943, delta: 0.00025, angle: 104.48 },
  { formula: "H2O", quantity: "angle", r: 0.095777, target: 1649, delta: 0, angle: 105.23 },
  // Symmetric water stretch is reserved. Only measured relative positions enter
  // the spectrum, without a frequency-specific projection or search interval.
  {
    formula: "H2O",
    quantity: "stretch",
    r: 0.095777,
    target: 3832,
    delta: 0.00025,
    angle: 104.48,
    reserved: true,
  },
];

function trajectory(setting, substeps) {
  const { formula, quantity, r, delta, angle } = setting;
  const fixture = createMolecularReferenceFixture(formula, substeps, 3);
  const equilibriumEnergy = fixture.reset(coordinates(formula, r));
  const e0 = fixture.reset(coordinates(formula, r, delta, angle, quantity === "asymmetry"));
  const excitationEv = e0 - equilibriumEnergy;
  assert.ok(excitationEv > 0);
  const masses = (formula === "H2" ? ["H", "H"] : ["O", "H", "H"]).map((e) => ATOMIC_ELEMENTS[e].massU);
  const count = Math.round(480 / fixture.dtFs),
    stride = Math.round(1.2 / fixture.dtFs);
  close(count * fixture.dtFs, 480, 1e-10);
  close(stride * fixture.dtFs, 1.2, 1e-10);
  let previous = fixture.sample(),
    maxError = 0,
    maxImpulse = 0,
    maxAngular = 0,
    held = 0;
  const signal = [geometry(formula, previous.coordinatesNm)[quantity]];
  for (let i = 1; i <= count; i++) {
    const state = fixture.advance(),
      p = state.coordinatesNm,
      v = state.velocitiesNmFs;
    const kinetic =
      0.5 * 10364.2696563 * v.reduce((s, velocity, j) => s + masses[j] * dot(velocity, velocity), 0);
    close(state.kineticEnergyEv, kinetic, 1e-11);
    close(state.energyEv, kinetic + state.potentialEnergyEv, 1e-11);
    maxError = Math.max(maxError, Math.abs(state.energyEv - e0));
    for (const a of axes) {
      const momentum = v.reduce((sum, s, j) => sum + masses[j] * s[a], 0);
      const angular = v.reduce((sum, s, j) => sum + masses[j] * cross(p[j], s)[a], 0);
      maxImpulse = Math.max(maxImpulse, Math.abs(momentum));
      maxAngular = Math.max(maxAngular, Math.abs(angular));
    }
    if (p.every((v, j) => v.every((x, k) => x === previous.coordinatesNm[j][k]))) held++;
    assert.equal(state.correctionEv, 0);
    if (i % stride === 0) signal.push(geometry(formula, p)[quantity]);
    previous = state;
  }
  assert.equal(signal.length, 401);
  assert.equal(held, 0);
  assert.ok(maxImpulse < 4e-12 && maxAngular < 4e-12);
  return {
    dt: fixture.dtFs,
    maxError,
    relativeEnergyError: maxError / excitationEv,
    maxImpulse,
    maxAngular,
    held,
    frequency: spectralPeak(signal, 1.2),
  };
}

test("four isolated vibrations advance for 480 fs without projection, resolving a reserved water mode", (t) => {
  for (const setting of settings) {
    const coarse = trajectory(setting, 16),
      fine = trajectory(setting, 32);
    t.diagnostic(
      JSON.stringify({
        formula: setting.formula,
        mode: setting.quantity,
        role: setting.reserved ? "holdout" : "fit",
        coarse,
        fine,
      }),
    );
    assert.ok(coarse.relativeEnergyError < 0.025);
    assert.ok(coarse.maxError > 0);
    // Velocity-Verlet's bounded energy oscillation should decrease approximately
    // fourfold. This is drift of physical K+U, before any numerical adjustment.
    const ratio = coarse.maxError / fine.maxError;
    assert.ok(ratio > 2.8 && ratio < 5.2, `coarse/fine energy error ratio ${ratio}`);
    close(coarse.frequency, fine.frequency, 0.02 * setting.target);
    close(fine.frequency, setting.target, 0.1 * setting.target);
  }
});

function physicalSignature(w) {
  const state = {
    atoms: w.particles.map((p) => [
      p.id,
      p.element,
      ...["x", "y", "z", "vx", "vy", "vz"].map((k) => Number(p[k].toFixed(12))),
    ]),
    bonds: w.bonds.map((b) => [b.a, b.b, b.order, b.formedAt]),
  };
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

test("a historical atomic checkpoint follows its recorded v2 trajectory beside a fresh v3 world", () => {
  const url = new URL("./fixtures/atomic-v2-pre-bench.json.gz", import.meta.url);
  const archived = JSON.parse(gunzipSync(readFileSync(url)));
  const old = AtomicWorld.restore(archived),
    fresh = new AtomicWorld(archived.seed, { count: archived.particles.length });
  assert.equal(old.version, 2);
  assert.equal(fresh.version, 3);
  assert.deepEqual(old.serialize(), archived);
  // Golden positions, velocities and graph were produced by the pre-calibration
  // revision d80d251, using this persisted checkpoint at tick 12.
  const signatures = new Map([
    [12, "377ab7ee71ff6fe60db7728d45755ce925139ffa29aed3b32547c95504bf12b0"],
    [52, "d2f563a367167fdd136a101afea9ad8d87b949a66884cf7f99564100112314c4"],
    [92, "d4b664d95c54c5cf3258560440bee9d802f64dd14a364ebab0430a905b5c33d7"],
  ]);
  for (const [tick, expected] of signatures) {
    while (old.tick < tick) old.step();
    assert.equal(physicalSignature(old), expected);
  }
  for (let i = 0; i < 30; i++) fresh.step();
  const saved = fresh.serialize(),
    twin = AtomicWorld.restore(saved);
  assert.equal(twin.version, 3);
  assert.deepEqual(twin.serialize(), saved);
  for (let i = 0; i < 20; i++) {
    fresh.step();
    twin.step();
  }
  assert.deepEqual(twin.serialize(), fresh.serialize());
});

test("reversing all velocities retraces a free isolated water trajectory", () => {
  const f = createMolecularReferenceFixture("H2O", 16, 3);
  const positions = coordinates("H2O", 0.0959, 0.00018, 104.8, true);
  const velocities = [
    [0.00009, -0.00007, 0.00003],
    [-0.00013, 0.00005, 0.00004],
    [0.00006, 0.00011, -0.00008],
  ];
  f.reset(positions, velocities);
  const first = f.sample();
  for (let i = 0; i < 500; i++) f.advance();
  const turn = f.sample();
  f.reset(
    turn.coordinatesNm,
    turn.velocitiesNmFs.map((v) => v.map((x) => -x)),
  );
  for (let i = 0; i < 500; i++) f.advance();
  const last = f.sample();
  for (let j = 0; j < positions.length; j++)
    for (const k of axes) {
      close(last.coordinatesNm[j][k], first.coordinatesNm[j][k], 2e-10);
      close(last.velocitiesNmFs[j][k], -first.velocitiesNmFs[j][k], 2e-10);
    }
  assert.equal(last.correctionEv, 0);
});

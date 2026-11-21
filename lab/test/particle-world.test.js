import test from "node:test";
import assert from "node:assert/strict";
import { AtomicWorld } from "../public/src/atomic-world.js";
import { sampleProperties } from "../public/src/material-properties.js";
import { ATOMIC_ELEMENTS, maxBondOrder } from "../public/src/atomic-elements.js";

const nuclei = { H: [1, 0], C: [6, 6], N: [7, 7], O: [8, 8], P: [15, 16], S: [16, 16] };
const valenceLimits = { H: 1, C: 4, N: 3, O: 2, P: 3, S: 2 };

function advance(world, n) {
  for (let i = 0; i < n; i++) world.step();
}
function near(actual, expected, tolerance = 1e-8) {
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected));
  assert.ok(
    Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `${actual} vs ${expected}`,
  );
}
// Drift is reported by unprojected integration. All heat/work is external and
// must reconcile with the independent energy balance to machine precision.
function checkEnergyLedger(world) {
  const m = world.getMetrics();
  const balance = m.totalEnergyEv - world.initialEnergyEv - m.bathWorkEv - m.volumeWorkEv + m.reactionHeatEv;
  near(m.energyError, balance, 1e-7);
  near(balance, m.integrationDriftEv, 1e-7);
  assert.ok(m.integrationAbsDriftEv + 1e-8 >= Math.abs(balance));
  assert.equal(m.integrationCorrectionEv, 0);
}
function materialIdentity(world) {
  return world.particles.map((p) => [
    p.id,
    p.element,
    p.massU,
    p.protons,
    p.neutrons,
    p.electrons,
    p.charge,
  ]);
}
function connectedComponents(world) {
  const linked = new Map(world.particles.map((p) => [p.id, []]));
  for (const bond of world.bonds) {
    linked.get(bond.a).push(bond.b);
    linked.get(bond.b).push(bond.a);
  }
  const unseen = new Set(linked.keys()),
    components = [];
  while (unseen.size) {
    const id = unseen.values().next().value;
    unseen.delete(id);
    const members = [id];
    for (const member of members) {
      for (const neighbor of linked.get(member)) if (unseen.delete(neighbor)) members.push(neighbor);
    }
    components.push(members.sort((a, b) => a - b));
  }
  return components;
}
function checkBonds(world) {
  const atoms = new Map(world.particles.map((a) => [a.id, a])),
    orderByAtom = new Map(),
    seen = new Set();
  for (const bond of world.bonds) {
    const a = atoms.get(bond.a),
      b = atoms.get(bond.b);
    assert.ok(a && b && a.id < b.id);
    const edge = bond.a + "/" + bond.b;
    assert.ok(!seen.has(edge));
    seen.add(edge);
    assert.ok(
      Number.isInteger(bond.order) &&
        bond.order >= 1 &&
        bond.order <= maxBondOrder(a.element, b.element),
    );
    for (const atom of [a, b]) {
      const total = (orderByAtom.get(atom.id) || 0) + bond.order;
      assert.ok(total <= valenceLimits[atom.element]);
      orderByAtom.set(atom.id, total);
    }
  }
}
function checkMoleculeObservations(world) {
  const components = connectedComponents(world);
  const joined = components.filter((ids) => ids.length >= 2);
  const free = components.filter((ids) => ids.length === 1).flat();
  const atom = new Map(world.particles.map((a) => [a.id, a]));
  const componentKeys = (groups) =>
    groups.map((group) => [...group].sort((a, b) => a - b).join(",")).sort();
  const observer = world.observer;
  const props = sampleProperties(world);
  const pressurePa = (components.length * 1.380649e-23 * props.temperatureK) / (props.volumeNm3 * 1e-27);
  near(props.idealPressurePa, pressurePa);
  near(props.densityKgM3, (props.massU * 1.66053906892) / props.volumeNm3);
  assert.deepEqual(componentKeys(observer.molecules.map((m) => m.members)), componentKeys(joined));
  assert.deepEqual(
    [...observer.freeAtomIds].sort((a, b) => a - b),
    free.sort((a, b) => a - b),
  );
  for (const molecule of observer.molecules) {
    const counts = {},
      memberIds = new Set(molecule.members);
    let mass = 0;
    for (const id of memberIds) {
      const a = atom.get(id);
      counts[a.element] = (counts[a.element] || 0) + 1;
      mass += a.massU;
    }
    for (const symbol of Object.keys(nuclei))
      assert.equal(molecule.composition[symbol] || 0, counts[symbol] || 0);
    const order = Object.keys(counts).sort();
    if (counts.C) {
      order.splice(order.indexOf("C"), 1);
      if (counts.H) order.splice(order.indexOf("H"), 1);
      order.unshift(...(counts.H ? ["C", "H"] : ["C"]));
    }
    const formula = order.map((sym) => sym + (counts[sym] === 1 ? "" : counts[sym])).join("");
    assert.equal(molecule.formula, formula);
    near(molecule.massU, mass);
    const bonds = world.bonds.filter((b) => memberIds.has(b.a) && memberIds.has(b.b));
    assert.equal(molecule.bondCount, bonds.length);
    assert.equal(
      molecule.bondOrderSum,
      bonds.reduce((sum, b) => sum + b.order, 0),
    );
    assert.equal(molecule.cycleRank, bonds.length - memberIds.size + 1);
  }
}
function checkElementsAndCharge(world, original) {
  assert.deepEqual(materialIdentity(world), original);
  const metrics = world.getMetrics();
  const kineticEv =
    world.particles.reduce((sum, a) => sum + 0.5 * a.massU * (a.vx ** 2 + a.vy ** 2 + a.vz ** 2), 0) *
    ((1.66053906892e-27 * 1e12) / 1.602176634e-19);
  near(metrics.kineticEnergyEv, kineticEv, 1e-7);
  near(metrics.temperatureK, (2 * kineticEv) / (3 * world.particles.length * 8.617333262e-5), 1e-7);
  near(metrics.totalEnergyEv, metrics.kineticEnergyEv + metrics.potentialEnergyEv);
  near(
    metrics.totalEnergyEv + metrics.reactionHeatEv,
    metrics.initialEnergyEv + metrics.bathWorkEv + metrics.volumeWorkEv + metrics.integrationDriftEv,
  );
  near(
    metrics.totalMassU,
    original.reduce((sum, p) => sum + p[2], 0),
  );
  assert.equal(
    metrics.totalProtons,
    original.reduce((sum, p) => sum + p[3], 0),
  );
  assert.equal(
    metrics.totalNeutrons,
    original.reduce((sum, p) => sum + p[4], 0),
  );
  assert.equal(metrics.totalElectrons, metrics.totalProtons);
  assert.equal(
    world.particles.reduce((sum, a) => sum + a.charge, 0),
    0,
  );
}

test("the initial world consists only of identifiable neutral atoms of the six specified elements", () => {
  const world = new AtomicWorld(42);
  assert.equal(world.tick, 0);
  assert.equal(world.bonds.length, 0);
  assert.deepEqual(new Set(world.particles.map((p) => p.element)), new Set(Object.keys(nuclei)));
  assert.equal(new Set(world.particles.map((p) => p.id)).size, world.particles.length);
  for (const a of world.particles) {
    const el = ATOMIC_ELEMENTS[a.element],
      [z, n] = nuclei[a.element];
    assert.equal(a.protons, z);
    assert.equal(a.electrons, z);
    assert.equal(a.neutrons, n);
    assert.equal(a.charge, 0);
    assert.equal(el.massNumber, z + n);
    assert.equal(el.maxValence, valenceLimits[a.element]);
    assert.equal(el.upQuarks, 2 * z + n);
    assert.equal(el.downQuarks, z + 2 * n);
    assert.equal(a.massU, el.massU);
    assert.equal(a.radiusPm, el.covalentRadiusPm);
    assert.ok(Math.abs(a.massU - (z + n)) < 0.2);
    assert.ok(a.radiusPm > 0);
    assert.ok(!Object.hasOwn(a, "genome"));
  }
  assert.equal(connectedComponents(world).length, world.particles.length);
  checkMoleculeObservations(world);
  checkElementsAndCharge(world, materialIdentity(world));
});

test("thermal and volume interventions preserve each isotope and charge and respect covalent valence", () => {
  const world = new AtomicWorld(42),
    original = materialIdentity(world);
  let maximumEdges = 0;
  for (const temperature of [300, 650, 200]) {
    world.setTemperature(temperature);
    for (let i = 0; i < 160; i++) {
      world.step();
      maximumEdges = Math.max(maximumEdges, world.bonds.length);
      if (i % 20 === 0) {
        checkElementsAndCharge(world, original);
        checkBonds(world);
        checkMoleculeObservations(world);
        checkEnergyLedger(world);
      }
    }
  }
  assert.ok(maximumEdges > 0);
  const m = world.getMetrics();
  assert.ok(m.densityKgM3 > 0);
  near(m.densityKgM3, (m.totalMassU * 1.6605390666) / m.volumeNm3, 1e-6);
  const volume = m.volumeNm3 * 1.05;
  world.setVolume(volume);
  checkElementsAndCharge(world, original);
  near(world.getMetrics().volumeNm3, volume);
  near(world.getMetrics().densityKgM3, m.densityKgM3 / 1.05);
  advance(world, 25);
  checkBonds(world);
  checkElementsAndCharge(world, original);
  checkEnergyLedger(world);
});

test("bonding off preserves the same initial atoms and keeps every molecule a singleton", () => {
  const normal = new AtomicWorld(77);
  const isolated = new AtomicWorld(77, { bindingEnabled: false });
  assert.deepEqual(normal.particles, isolated.particles);
  const ids = materialIdentity(normal);
  let largest = 0;
  for (let i = 0; i < 350; i++) {
    isolated.step();
    normal.step();
    assert.equal(isolated.bonds.length, 0);
    largest = Math.max(largest, normal.bonds.length);
  }
  assert.ok(largest > 0);
  checkElementsAndCharge(isolated, ids);
  checkElementsAndCharge(normal, ids);
  assert.ok(connectedComponents(isolated).every((ids) => ids.length === 1));
});

test("uncoupling the thermostat leaves the kinetic bath ledger constant while reactions may exchange heat", () => {
  const coupled = new AtomicWorld(42),
    separated = AtomicWorld.restore(coupled.serialize());
  separated.setControls({ thermostatEnabled: false });
  const ledger = separated.getMetrics().bathWorkEv;
  for (const w of [coupled, separated]) w.setTemperature(650);
  advance(coupled, 200);
  advance(separated, 200);
  assert.equal(separated.getMetrics().bathWorkEv, ledger);
  assert.ok(Math.abs(coupled.getMetrics().bathWorkEv - ledger) > 1e-7);
  checkEnergyLedger(separated);
});

test("checkpoint replay reproduces the physical trajectory independently of inspecting molecules", () => {
  const source = new AtomicWorld(19);
  advance(source, 115);
  const saved = JSON.parse(JSON.stringify(source.serialize())),
    frozen = JSON.stringify(saved);
  const resumed = AtomicWorld.restore(saved);
  assert.deepEqual(resumed.serialize(), saved);
  assert.notEqual(resumed.particles[0], source.particles[0]);
  for (const w of [source, resumed]) w.setTemperature(360);
  for (let i = 0; i < 145; i++) {
    if (i % 10 === 0) {
      const before = JSON.stringify(source.serialize());
      source.molecules();
      source.getMetrics();
      assert.equal(JSON.stringify(source.serialize()), before);
    }
    source.step();
    resumed.step();
  }
  assert.deepEqual(source.serialize(), resumed.serialize());
  // Erasing past labels changes the observer's record, never the microscopic state.
  for (let i = 0; i < 75; i++) {
    resumed.observer = null;
    source.step();
    resumed.step();
  }
  assert.deepEqual(resumed.particles, source.particles);
  assert.deepEqual(resumed.bonds, source.bonds);
  assert.deepEqual(resumed.flux, source.flux);
  near(resumed.getMetrics().totalEnergyEv, source.getMetrics().totalEnergyEv);

  assert.equal(JSON.stringify(saved), frozen);
  for (const change of [
    (s) => {
      s.particles[1].id = s.particles[0].id;
    },
    (s) => {
      s.particles[0].element = "U";
    },
    (s) => {
      s.particles[0].x = 2;
    },
  ]) {
    const bad = structuredClone(saved);
    change(bad);
    assert.throws(() => AtomicWorld.restore(bad));
  }
});

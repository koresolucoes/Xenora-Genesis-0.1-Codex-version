// Run from lab: node test/experiments/particle-emergence.mjs
// Each seed is its own replicate, including runs with zero molecules or rings.
import assert from "node:assert/strict";
import { AtomicWorld } from "../../public/src/atomic-world.js";

const seeds = [7, 19, 42, 77, 115];
const steps = 600;
const controlArms = [
  "reference",
  "withoutCovalentBonding",
  "withoutThermostat",
  "warmerBath",
  "compressed",
];
function identity(world) {
  return world.particles.map((p) => [p.id, p.element, p.massU, p.charge]);
}
function snapshotMolecule(world, molecule) {
  const ids = new Set(molecule.members);
  return {
    tick: world.tick,
    id: molecule.id,
    atomIds: [...ids],
    formula: molecule.formula,
    composition: molecule.composition,
    massU: molecule.massU,
    cycleRank: molecule.cycleRank,
    covalentEdges: world.bonds
      .filter((b) => ids.has(b.a) && ids.has(b.b))
      .map(({ a, b, order }) => [a, b, order]),
  };
}
function observe(seed, arm, startingSnapshot, ids) {
  const w = AtomicWorld.restore(startingSnapshot);
  if (arm === "withoutCovalentBonding") w.setControls({ bindingEnabled: false });
  if (arm === "withoutThermostat") w.setControls({ thermostatEnabled: false });
  if (arm === "warmerBath") w.setTemperature(650);
  if (arm === "compressed") w.setVolume(5);
  assert.deepEqual(identity(w), ids);
  const initial = w.getMetrics();
  let peakBonds = 0,
    peakMolecules = 0,
    peakCycles = 0,
    largestComponent = 0,
    peakE = 0;
  let stepsWithMolecules = 0,
    stepsWithRings = 0,
    firstMolecule = null,
    firstRing = null;
  const peakByFormula = {};
  for (let i = 0; i < steps; i++) {
    w.step();
    const k = w.getMetrics(),
      o = w.observer.metrics,
      molecules = w.observer.molecules;
    if (o.moleculeCount) {
      stepsWithMolecules++;
      if (!firstMolecule) firstMolecule = snapshotMolecule(w, molecules[0]);
    }
    if (o.ringMolecules) {
      stepsWithRings++;
      if (!firstRing)
        firstRing = snapshotMolecule(
          w,
          molecules.find((c) => c.cycleRank > 0),
        );
    }
    const counts = new Map();
    for (const c of molecules) counts.set(c.formula, (counts.get(c.formula) || 0) + 1);
    for (const [formula, n] of counts) peakByFormula[formula] = Math.max(n, peakByFormula[formula] || 0);
    peakBonds = Math.max(peakBonds, w.bonds.length);
    peakMolecules = Math.max(peakMolecules, o.moleculeCount);
    peakCycles = Math.max(peakCycles, o.cycleCount);
    largestComponent = Math.max(largestComponent, o.largestMoleculeAtoms);
    peakE = Math.max(peakE, Math.abs(k.energyError));
  }
  assert.deepEqual(identity(w), ids);
  const f = w.getMetrics(),
    o = w.observer.metrics;
  return {
    seed,
    arm,
    steps,
    atoms: w.particles.length,
    initialMassU: initial.totalMassU,
    massResidualU: f.totalMassU - initial.totalMassU,
    netElementaryCharge: f.totalProtons - f.totalElectrons,
    targetTemperatureK: f.targetTemperatureK,
    finalTemperatureK: f.temperatureK,
    volumeNm3: f.volumeNm3,
    densityKgM3: f.densityKgM3,
    absoluteIntegratorCorrectionEv: f.integrationCorrectionEv,
    bathWorkEv: f.bathWorkEv,
    volumeWorkEv: f.volumeWorkEv,
    reactionHeatEv: f.reactionHeatEv,
    peakAbsoluteEnergyResidualEv: peakE,
    finalBonds: w.bonds.length,
    peakBonds,
    peakMolecules,
    finalFreeAtoms: o.freeAtomCount,
    finalMolecules: o.moleculeCount,
    largestComponent,
    peakCycles,
    stepsWithMolecules,
    stepsWithRings,
    firstMolecule,
    firstRing,
    peakByFormula,
    demonstratedMembranes: o.demonstratedMembraneCount,
    demonstratedLife: o.demonstratedLifeCount,
    lifeStatus: o.lifeStatus,
  };
}
function describe(rows, key) {
  const values = rows.map((r) => r[key]);
  assert.ok(values.every(Number.isFinite), key);
  return {
    n: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    mean: values.reduce((a, b) => a + b, 0) / values.length,
  };
}
const runs = Object.fromEntries(controlArms.map((a) => [a, []]));
for (const seed of seeds) {
  const w = new AtomicWorld(seed),
    initial = w.serialize(),
    ids = identity(w);
  assert.equal(w.bonds.length, 0);
  for (const a of controlArms) runs[a].push(observe(seed, a, initial, ids));
}
const summary = {};
for (const [arm, rows] of Object.entries(runs)) {
  summary[arm] = {
    seeds: rows.length,
    seedsWithMolecules: rows.filter((r) => r.firstMolecule).length,
    seedsWithCovalentRings: rows.filter((r) => r.firstRing).length,
    peakBonds: describe(rows, "peakBonds"),
    largestComponent: describe(rows, "largestComponent"),
    finalMolecules: describe(rows, "finalMolecules"),
    energyResidualEv: describe(rows, "peakAbsoluteEnergyResidualEv"),
    absoluteIntegratorCorrectionEv: describe(rows, "absoluteIntegratorCorrectionEv"),
    seedsWithDemonstratedMembranes: rows.filter((r) => r.demonstratedMembranes > 0).length,
    seedsWithDemonstratedLife: rows.filter((r) => r.demonstratedLife > 0).length,
  };
}
console.log(
  JSON.stringify(
    {
      seeds,
      steps,
      replicate: "one seed; zeros retained",
      summary,
      runs,
      controls: {
        reference: "initial 300 K and 12 nm³",
        withoutCovalentBonding: "only covalent bonding disabled",
        withoutThermostat:
          "temperature coupling off, including bath-activated rupture; internal chemistry and its explicit heat reservoir remain",
        warmerBath: "target set to 650 K",
        compressed: "container set to 5 nm³",
      },
      catalysis:
        "Independent catalysis kinetics is absent in this model, so there is no catalysis treatment.",
      chemicalSpecies:
        "Formula reports elemental composition. Bonds, their orders and member IDs are retained for the traced observations.",
      biologicalEvidence:
        "A covalent cycle is a property of a molecular graph. A membrane or reproduction requires separate observations at larger scales.",
    },
    null,
    2,
  ),
);

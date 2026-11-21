import test from "node:test";
import assert from "node:assert/strict";
import { AtomicWorld } from "../public/src/atomic-world.js";
import { runMolecularReference } from "../public/src/molecular-reference.js";

function zeroSafeNear(left, right, tolerance = 1e-9) {
  assert.ok(Number.isFinite(left) && Number.isFinite(right));
  assert.ok(Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(right)), `${left} vs ${right}`);
}

test("reference protocols compare two discretizations over the same physical time and report measured errors", () => {
  const focus = new AtomicWorld(42);
  for (let i = 0; i < 13; i++) focus.step();
  const resume = AtomicWorld.restore(focus.serialize());
  const checkpoint = JSON.stringify(focus.serialize());
  const report = runMolecularReference();
  assert.equal(report.physicsVersion, 3);
  assert.equal(report.protocol.durationFs, 480);
  const reserved = report.species
    .flatMap((s) => s.measurements)
    .filter((m) => m.role === "referência reservada");
  assert.deepEqual(
    reserved.map((m) => m.id),
    ["water-symmetric-trajectory"],
  );
  assert.equal(reserved[0].reference, 3832);
  assert.equal(reserved[0].status, "aceito");
  assert.equal(report.species.length, 2);
  for (const s of report.species) {
    const runs = s.integration.runs;
    assert.equal(runs.length, 2);
    const [coarse, fine] = [...runs].sort((a, b) => b.dtFs - a.dtFs);
    zeroSafeNear(coarse.dtFs, 2 * fine.dtFs);
    for (const run of runs) {
      zeroSafeNear(run.elapsedFs, report.protocol.durationFs);
      zeroSafeNear(run.dtFs * run.substepsPerTick * run.steps, run.elapsedFs);
      assert.ok(run.maxEnergyErrorEv >= 0 && run.correctionEv >= 0);
    }
    assert.equal(coarse.sampleCount, fine.sampleCount);
    assert.equal(coarse.integrationSteps * 2, fine.integrationSteps);
    assert.equal(
      coarse.sampleCount,
      1 + Math.round(report.protocol.durationFs / report.protocol.sampleEveryFs),
    );
    assert.equal(s.minimizations.length, 2);
    if (s.formula === "H2O") {
      assert.deepEqual(
        s.minimizations.map((m) => m.start.angle).sort((a, b) => a - b),
        [80, 135],
      );
      assert.ok(s.minimizations.every((m) => m.converged));
      zeroSafeNear(s.minimizations[0].angle, s.minimizations[1].angle, 1e-3);
    }
    if (s.formula === "H2" && fine.wavenumberCm1 === null) {
      const frequency = s.measurements.find((m) => m.id === "h2-we");
      assert.equal(frequency.status, "sem medida");
      assert.equal(frequency.absoluteError, null);
    }
    if (s.formula === "H2") {
      const harmonic = s.measurements.find((m) => m.id === "h2-we-curvature");
      assert.ok(harmonic.value > 0 && s.curvature.curvatureEvPerNm2 > 0);
      // Independently convert eV/nm² and u to the harmonic wavenumber in cm⁻¹.
      const newtonPerMeter = (s.curvature.curvatureEvPerNm2 * 1.602176634e-19) / 1e-18;
      const reducedMassKg =
        (focus.particles.find((p) => p.element === "H").massU / 2) * 1.6605390666e-27;
      const wavenumber = Math.sqrt(newtonPerMeter / reducedMassKg) / (2 * Math.PI * 29979245800);
      zeroSafeNear(harmonic.value, wavenumber, 2e-7);
    }
    assert.ok(coarse.sampleCount > 2);
    for (const measure of s.measurements) {
      assert.ok(measure.source && measure.unit);
      if (measure.value === null) {
        assert.equal(measure.status, "sem medida");
        continue;
      }
      assert.ok(Number.isFinite(measure.reference) && Number.isFinite(measure.value));
      zeroSafeNear(measure.absoluteError, Math.abs(measure.value - measure.reference));
      assert.equal(measure.status, measure.absoluteError <= measure.tolerance ? "aceito" : "inadequado");
    }
  }
  const legacy = runMolecularReference({ physicsVersion: 2 });
  assert.equal(legacy.physicsVersion, 2);
  assert.equal(legacy.protocol.durationFs, report.protocol.durationFs);
  const legacyMeasures = new Map(legacy.species.flatMap((s) => s.measurements).map((m) => [m.id, m]));
  zeroSafeNear(legacyMeasures.get("h2-re").value, 0.062, 0.00001);
  zeroSafeNear(legacyMeasures.get("water-angle").value, 60.4059, 0.0001);
  assert.equal(legacyMeasures.get("h2-we").status, "sem medida");
  assert.equal(
    legacy.species.every((s) => s.status === "inadequado"),
    true,
  );
  assert.deepEqual(runMolecularReference(), report);
  assert.equal(JSON.stringify(focus.serialize()), checkpoint);
  focus.step();
  resume.step();
  assert.deepEqual(focus.serialize(), resume.serialize());
});

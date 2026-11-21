import test from 'node:test';
import assert from 'node:assert/strict';
import { AtomicWorld } from '../public/src/atomic-world.js';
import { getCurrentSpecies, getReactionBenchReport, validateReactionBench } from '../public/src/reaction-bench.js';

// Observe the production topology update at fixed coordinates, before integration
// or thermostatting can obscure its energy change. Every proposal/draw stays in
// the original engine; compare the result to a world without instrumentation.
class MeasuredWorld extends AtomicWorld {
  changes = [];
  changeBonds() {
    const before = this.getMetrics();
    const result = super.changeBonds();
    const after = this.getMetrics();
    const deltaU = after.potentialEnergyEv - before.potentialEnergyEv;
    const released = after.reactionHeatEv - before.reactionHeatEv;
    close(deltaU + released, 0);
    close(released, this.flux.reactionHeatEv);
    assert.equal(after.kineticEnergyEv, before.kineticEnergyEv);
    if (this.flux.formed.length || this.flux.broken.length || this.flux.upgraded.length) {
      this.changes.push({tick:this.tick,deltaU,released});
    }
    return result;
  }
}

function close(a, b) {
  const tolerance = 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
  assert.ok(Math.abs(a-b) < tolerance, `${a} and ${b} differ by ${Math.abs(a-b)}`);
}

function verifyLedger(w) {
  const m = w.getMetrics();
  assert.equal(m.bathWorkEv,0);
  assert.equal(m.netCharge,0);
  assert.equal(m.massError,0);
  assert.ok(m.reactionHeatEv >= -1e-9, 'an isolated world borrowed energy from an empty reservoir');
  const residual = m.kineticEnergyEv + m.potentialEnergyEv + m.reactionHeatEv - m.volumeWorkEv - m.initialEnergyEv;
  close(residual, m.energyError);
  close(residual, m.integrationDriftEv);
}

// Each seed produces its target as the only bonded component. The energies of
// the topology updates can therefore be attributed to the recorded reactants.
for (const [formula,seed,count,expandedVolume] of [['H2',15,14,64],['H2O',159,12,96]]) {
  test(`${formula} association and dissociation account for the whole v3 potential and retain passive evidence`,()=>{
    const options = {count,volumeNm3:1,temperatureK:180,thermostatEnabled:false};
    const world = new MeasuredWorld(seed,options), control = new AtomicWorld(seed,options);
    assert.equal(world.version,3);
    const inventory = world.particles.map(({id,element})=>[id,element]);
    const step = () => {
      world.step();
      control.step();
      verifyLedger(world);
      const snapshot = world.serialize();
      const report = getReactionBenchReport(world);
      assert.equal(report.physicsVersion,3);
      assert.equal(report.physicsProfile,world.physicsProfile);
      assert.equal(report.integrationDtFs,world.integrationDtFs);
      assert.equal(report.tickFs,4.8);
      assert.equal(report.windowToFs,world.tick*4.8);
      getCurrentSpecies(world);
      assert.ok(validateReactionBench(world,world.reactionBench));
      assert.deepEqual(world.serialize(),snapshot);
      assert.deepEqual(control.serialize(),snapshot);
    };
    let molecule;
    for (let i=0;i<75&&!molecule;i++) {
      step();
      molecule = world.observer.molecules.find(m=>m.formula===formula);
    }
    assert.ok(molecule,'no product on this trajectory');
    const formationTick = world.tick;
    const members = new Set(molecule.members);
    const containsProduct = g => g.recentProducts.some(p=>p.formula===formula && p.members.length===members.size &&
      p.members.every(id=>members.has(id)) && p.formedTick===formationTick);
    const formed = getReactionBenchReport(world).groups.find(g=>g.type==='association' && containsProduct(g));
    assert.ok(formed);
    const internalBonds = world.bonds.filter(b=>members.has(b.a)&&members.has(b.b));
    assert.equal(internalBonds.length,formula==='H2'?1:2);
    assert.equal(world.bonds.length,internalBonds.length);
    assert.ok(world.changes.some(t=>t.tick===formationTick));
    const restored = AtomicWorld.restore(world.serialize());
    assert.deepEqual(restored.serialize(),world.serialize());

    // Dilate the vessel while the bonds still exist. Their potential change is
    // external mechanical work, separate from any subsequent reaction heat.
    const before = world.getMetrics();
    for (const w of [world,control,restored]) w.setVolume(expandedVolume);
    const expanded = world.getMetrics();
    close(expanded.potentialEnergyEv-before.potentialEnergyEv,expanded.volumeWorkEv-before.volumeWorkEv);
    assert.equal(expanded.reactionHeatEv,before.reactionHeatEv);
    assert.equal(expanded.kineticEnergyEv,before.kineticEnergyEv);
    verifyLedger(world);
    step();
    restored.step();
    assert.deepEqual(restored.serialize(),world.serialize());
    assert.ok(internalBonds.every(original=>world.flux.broken.some(b=>b.a===original.a && b.b===original.b)));
    assert.equal(world.bonds.length,0);
    assert.ok(world.flux.reactionHeatEv<0, 'endothermic separation debits accumulated reaction heat');
    const ended = getReactionBenchReport(world).groups.find(g=>g.key===formed.key);
    assert.ok(ended.recentProducts.some(p=>p.formedTick===formationTick && p.endedTick===world.tick && p.observedFs===4.8));
    assert.deepEqual(world.particles.map(({id,element})=>[id,element]),inventory);
    assert.equal(world.observer.metrics.demonstratedLifeCount,0);
  });
}

test('changing integration resolution preserves the physical sampling cadence reported by the bench',()=>{
  for(const [physicsVersion,substeps,profile] of [
    [2,4,'neutral-chonps-v2'],[2,8,'neutral-chonps-v2'],
    [3,16,'neutral-chonps-h2-h2o-v3'],[3,32,'neutral-chonps-h2-h2o-v3']
  ]) {
    const w = new AtomicWorld(11,{count:3,physicsVersion,integrationSubsteps:substeps});
    for(let i=0;i<5;i++)w.step();
    const d=w.serialize(), report=getReactionBenchReport(AtomicWorld.restore(d));
    assert.equal(d.version,physicsVersion);
    assert.equal(report.physicsVersion,physicsVersion);
    assert.equal(report.physicsProfile,profile);
    assert.equal(report.integrationDtFs,4.8/substeps);
    assert.equal(report.tickFs,4.8);
    assert.equal(report.coverageFs,24);
    assert.equal(report.comparedSteps,5);
  }
});

test('a concerted water dissociation can bypass an inaccessible stretched OH intermediate',()=>{
  const w = new MeasuredWorld(159,{count:12,volumeNm3:1,thermostatEnabled:false,temperatureK:180});
  for (let i=0;i<5;i++) w.step();
  assert.deepEqual(w.observer.molecules.map(m=>m.formula),['H2O']);
  const original = w.serialize();
  for (const volumeNm3 of [343,512]) {
    const expanded = AtomicWorld.restore(original);
    expanded.setVolume(volumeNm3);
    expanded.step();
    verifyLedger(expanded);
    assert.equal(expanded.flux.broken.length,2);
    assert.equal(expanded.bonds.length,0);
    const event = getReactionBenchReport(expanded).recentEvents.at(-1);
    assert.equal(event.type,'dissociation');
    assert.equal(event.equation,'H2O → 2 H + O');
    assert.equal(event.bondChanges.length,2);
  }
});

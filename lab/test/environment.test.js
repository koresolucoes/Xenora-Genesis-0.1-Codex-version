import test from 'node:test';
import assert from 'node:assert/strict';
import { Environment } from '../public/src/environment.js';

function close(actual, expected, tolerance = 1e-11) {
  assert.ok(Math.abs(actual - expected) < tolerance, `expected ${expected}, got ${actual}`);
}

test('Fick face flux carries the predicted mass from a pulse and closes the shores', () => {
  const e = new Environment({ size: 16, flowSpeed: 0, decayRate: 0 });
  const mass = 3;
  e.add('nutrient', 0, 0, mass);
  const perFace = e.diffusionNutrient * e.dt * mass / e.cellArea;
  e.step();
  close(e.nutrient[0], mass - 2 * perFace);
  close(e.nutrient[1], perFace);
  close(e.nutrient[e.size], perFace);
  close(e.totals().total, mass);
  assert.ok(e.nutrient.every(c => c >= 0));
});

test('closed-wall diffusion converges at second order on a cell-average cosine mode', () => {
  const errors = [];
  for (const size of [12, 24, 48]) {
    const steps = size ** 2 / 2;
    const e = new Environment({ size, diffusionNutrient: 0.05, flowSpeed: 0, decayRate: 0, dt: 1 / steps });
    const k = Math.PI;
    const half = k * e.dx / 2;
    const cellAverage = Math.sin(half) / half;
    const cos = i => cellAverage * Math.cos(k * ((i % size) + 0.5) * e.dx);
    for (let i = 0; i < e.nutrient.length; i++) e.nutrient[i] = e.cellArea * (1 + 0.5 * cos(i));
    for (let t = 0; t < steps; t++) e.step();
    const amplitude = 0.5 * Math.exp(-k*k*e.diffusionNutrient);
    let error2 = 0;
    for (let i = 0; i < e.nutrient.length; i++) {
      const error = e.nutrient[i] / e.cellArea - (1 + amplitude * cos(i));
      error2 += error * error * e.cellArea;
    }
    close(e.totals().nutrient, 1);
    errors.push(Math.sqrt(error2));
  }
  assert.ok(errors[2] < 0.00005, String(errors));
  for (let i = 1; i < errors.length; i++) {
    const order = Math.log2(errors[i-1] / errors[i]);
    assert.ok(order > 1.95 && order < 2.05, `spatial order ${order}; errors ${errors}`);
  }
});

test('circulation carries a pulse, preserves uniform density and has zero normal flow at the shore', () => {
  const e = new Environment({ size: 20, diffusionNutrient: 0, diffusionWaste: 0, flowSpeed: 0.015, decayRate: 0 });
  const mass = e.cellArea * 8;
  e.nutrient.fill(mass);
  e.add('waste', 0.525, 0.225, 1);
  for (let i = 0; i < 8; i++) e.step();
  close(e.flowAt(0, 0.3).x, 0);
  close(e.flowAt(0.3, 1).y, 0);
  close(e.totals().waste, 1);
  assert.ok(e.nutrient.every(v => Math.abs(v - mass) < 1e-14));
  assert.ok(e.waste.every(v => v >= 0));
  let meanX = 0;
  for (let i = 0; i < e.waste.length; i++) meanX += ((i % e.size) + 0.5) * e.dx * e.waste[i];
  assert.ok(meanX > 0.56, `rightward flow, mass center x=${meanX}`);
});

test('mineral recycling and Beer–Lambert attenuation close their predicted balances', () => {
  const size = 16, x = 8.5/size, y = 6.5/size;
  const parameters = {size, diffusionNutrient: 0, diffusionWaste: 0, flowSpeed: 0, decayRate: 0.01};
  const active = new Environment({...parameters, minerals: [{x,y,radius:0.01}]});
  const bare = new Environment(parameters);
  for (const e of [active, bare]) {
    e.add('waste', x, y, 1);
    close(e.transmissionAt(x, y), Math.exp(-e.opacity / e.cellArea));
    for (let t = 0; t < 12; t++) e.step();
  }
  const remaining = Math.exp(-12*active.decayRate*(1+active.mineralBoost));
  close(active.totals().waste, remaining);
  close(bare.totals().waste, Math.exp(-12*bare.decayRate));
  close(active.totals().total, 1);
  close(active.totals().meanTurbidity, active.opacity * remaining);
  close(active.sample(x,y).transmission, Math.exp(-active.opacity*remaining/active.cellArea));
  assert.ok(active.transmissionAt(x,y) > bare.transmissionAt(x,y));
  close(active.take('nutrient', x,y, 99), 1 - remaining);
  close(active.totals().total, remaining);
});

test('time subdivision preserves positivity and environmental checkpoint replay is exact', () => {
  const e = new Environment({size:18, diffusionNutrient:0.01, flowSpeed:0.01,
    minerals:[{x:0.2,y:0.3,radius:0.1}]});
  assert.ok(e.substeps > 1);
  e.add('waste', 0.2,0.12, 2);
  e.add('nutrient', 0.17,0.92, 1.3);
  for (let i = 0; i < 15; i++) e.step();
  const snapshot = JSON.parse(JSON.stringify(e.serialize()));
  const other = Environment.restore(snapshot);
  for (let i = 0; i < 5; i++) { e.step(); other.step(); }
  assert.deepEqual(e.serialize(),other.serialize());
  assert.ok(e.nutrient.every(v => v >= 0) && e.waste.every(v => v >= 0));
  close(e.totals().total,3.3);
  snapshot.waste[4] = -0.4;
  assert.throws(() => Environment.restore(snapshot));
});

test('a paused intervention invalidates the field view without advancing simulation time', () => {
  const e = new Environment();
  const baseline = e.revision;
  e.add('nutrient', 0.5, 0.5, 2);
  assert.ok(e.revision > baseline);
  const injected = e.revision;
  e.take('nutrient', 0.5, 0.5, 0.5);
  assert.ok(e.revision > injected);
  assert.equal(e.tick, 0);
});

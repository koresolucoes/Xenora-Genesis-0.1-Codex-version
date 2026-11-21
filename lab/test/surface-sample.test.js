import test from 'node:test';
import assert from 'node:assert/strict';
import { World, validEventIndividual } from '../public/src/engine.js';
import { PrimordialWorld } from '../public/src/primordial.js';

function sample(silicon = true) {
  const origin = new PrimordialWorld({ seed: 42, silicon });
  while (!origin.lagoon) origin.step();
  for (let i = 0; i < 7; i++) origin.step();
  return origin;
}

function near(a, b, margin = 1e-9) { assert.ok(Math.abs(a - b) <= margin, a + ' != ' + b); }

test('a surface aliquot uses sampled parcels, lamp and forsterite; exactly one introduced founder supplies its own mass and energy', () => {
  for (const silicon of [false, true]) {
    const origin = sample(silicon), unchanged = origin.serialize();
    const raw = origin.surfaceSample(), world = World.fromSurfaceSample(raw);
    assert.deepEqual(origin.serialize(), unchanged);
    assert.equal(origin.lagoon.getMetrics().demonstratedLifeCount, 0);
    assert.equal(world.organisms.length, 1);
    const founder = world.organisms[0], inv = world.originSample.inoculum, m = world.getMetrics();
    assert.equal(founder.parent, null);
    assert.equal(founder.genome.sequence.length, 20);
    assert.equal(founder.mass, inv.mass);
    assert.equal(founder.energy, inv.energy);
    assert.equal(world.events[0].type, 'start');
    assert.match(world.events[0].text, /externa.*inoculada/);
    assert.equal(world.light.x, raw.energySource.x);
    assert.equal(world.light.y, raw.energySource.y);
    assert.deepEqual(world.originSample.parcels, raw.parcels);
    const a = raw.parcels.filter(p => p.kind === 'a');
    assert.equal(a.length, world.grains.length);
    for (let i = 0; i < a.length; i++) {
      near(world.grains[i].x, a[i].x);
      near(world.grains[i].y, a[i].y);
    }
    near(m.grainMass + m.nutrientMass, world.originSample.substrateMass);
    near(m.initialMass, world.originSample.substrateMass + inv.mass);
    near(m.initialEnergy, inv.energy);
    near(m.massError, 0); near(m.energyError, 0);
    assert.equal(world.minerals.length, origin.lagoon.sites.length);
    assert.equal(world.minerals.length > 0, silicon);
    for (const [i, rock] of world.minerals.entries()) {
      near(rock.x, origin.lagoon.sites[i].x);
      near(rock.y, origin.lagoon.sites[i].y);
      assert.equal(rock.formula, 'Mg2SiO4');
      assert.ok(world.environment.sample(rock.x, rock.y).mineralActivity > 0);
    }
    if (!silicon) near(world.environment.sample(0.5, 0.5).mineralActivity, 0);
  }
});

test('inoculated and legacy populations restore separately, retaining origin and deterministic continuation', () => {
  const raw = sample().surfaceSample();
  raw.parentRunId = 'aaaa0000-0000-4000-a000-000000000001';
  raw.parentRevisionId = 'aaaa0000-0000-4000-a000-000000000002';
  raw.token = 'SHOULD_NOT_APPEAR_IN_SNAPSHOT';
  const world = World.fromSurfaceSample(raw);
  assert.equal(world.originSample.parentRevisionId, raw.parentRevisionId);
  assert.doesNotMatch(JSON.stringify(world.serialize()), /SHOULD_NOT/);
  for (let i=0; i<40; i++) world.step();
  const resumed = World.restore(JSON.parse(JSON.stringify(world.serialize())));
  for (let i=0; i<70; i++) { world.step(); resumed.step(); }
  assert.deepEqual(resumed.serialize(), world.serialize());
  near(world.getMetrics().massError, 0); near(world.getMetrics().energyError, 0);
  for (const mutate of [
    s => { delete s.originSample; }, s => { delete s.originSample.parcels; },
    s => { s.initialPopulation = 24; }, s => { s.originSample.inoculum.energy = 12; },
    s => { s.originSample.substrateMass += 2; }, s => { s.minerals[0].formula = 'other'; },
    s => { s.originSample.parcels[0].x = 3; }, s => { s.originSample.handoffTick = s.originSample.tick + 1; }
  ]) {
    const snapshot = world.serialize(); mutate(snapshot);
    assert.throws(() => World.restore(snapshot));
  }
  const laboratory = new World(42);
  assert.equal(laboratory.initialPopulation, 24);
  assert.equal(laboratory.originSample, undefined);
  assert.deepEqual(World.restore(laboratory.serialize()).serialize(), laboratory.serialize());
});

test('birth and death retain compact molecular identity between revisions', () => {
  const world = new World(42);
  let birth, death;
  for (let i=0; i<2000 && (!birth || !death); i++) {
    world.step();
    birth ??= world.events.find(e => e.type === 'birth');
    death ??= world.events.find(e => e.type === 'death');
  }
  assert.ok(birth && death);
  for (const event of [birth,death]) {
    assert.equal(event.individual.id, event.id);
    assert.match(event.individual.sequence, /^[01]{20}$/);
    assert.equal(validEventIndividual(event, world.nextId), true);
  }
  assert.equal(birth.individual.parentId, birth.parent);
  const snapshot = world.serialize(), withDescriptor = snapshot.events.find(e => e.individual);
  assert.ok(withDescriptor);
  withDescriptor.individual.id += 1;
  assert.throws(() => World.restore(snapshot));
  delete withDescriptor.individual;
  assert.doesNotThrow(() => World.restore(snapshot));
});

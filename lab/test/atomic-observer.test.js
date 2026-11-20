import test from 'node:test';
import assert from 'node:assert/strict';
import { observeAtomicWorld, validateAtomicObservation, molecularFormula } from '../public/src/atomic-observer.js';
import { AtomicWorld } from '../public/src/atomic-world.js';

const mass={C:12,H:1.007825032,O:15.99491462,N:14.003074};
const atom=(id,element,x,y)=>({id,element,massU:mass[element],x,y,charge:0});
const bond=(a,b,order=1)=>({a,b,order});
function state(particles,bonds,tick=0){return {particles,bonds,tick};}

test('monomers, atomic mass, Hill composition and individual atoms agree through association and dissociation',()=>{
  const atoms=[atom(31,'O',0.5,0.5),atom(11,'H',0.47,0.51),atom(24,'H',0.53,0.51),atom(70,'C',0.8,0.2)];
  const free=state(atoms,[]), start=observeAtomicWorld(free);
  assert.deepEqual(start.freeAtomIds,[11,24,31,70]);assert.equal(start.metrics.moleculeCount,0);
  assert.deepEqual(start.metrics.composition,{O:1,H:2,C:1});
  const joined=state(atoms,[bond(31,11),bond(31,24)],1), water=observeAtomicWorld(joined,start);
  assert.deepEqual(water.freeAtomIds,[70]);assert.equal(water.molecules[0].formula,'H2O');
  assert.deepEqual(water.molecules[0].members,[11,24,31]);assert.equal(water.molecules[0].massU,mass.O+2*mass.H);
  assert.equal(water.metrics.totalMassU,start.metrics.totalMassU);
  assert.equal(water.events[0].equation,'2 H + O → H2O');
  assert.deepEqual(water.events[0].bondChanges,[{a:11,b:31,before:0,after:1},{a:24,b:31,before:0,after:1}]);
  assert.ok(validateAtomicObservation(joined,water));
  const dissociated=state(atoms,[],2), split=observeAtomicWorld(dissociated,water);
  assert.equal(split.events.at(-1).type,'dissociation');assert.equal(split.metrics.associations,1);
  assert.equal(split.metrics.dissociations,1);assert.ok(validateAtomicObservation(dissociated,split));
  assert.equal(molecularFormula({N:1,H:3}),'H3N');
});

test('a ring with a substituent remains a molecular cycle; a degenerate projection is not a wall',()=>{
  const atoms=[atom(1,'C',0.2,0.2),atom(2,'C',0.55,0.2),atom(3,'C',0.55,0.55),
    atom(4,'C',0.2,0.55),atom(5,'H',0.1,0.1),atom(6,'N',0.38,0.38)];
  const graph=[bond(1,2),bond(2,3),bond(3,4),bond(4,1),bond(1,5)];
  const asDrawn=observeAtomicWorld(state(atoms,graph));
  const ring=asDrawn.molecules[0];assert.equal(ring.formula,'C4H');assert.equal(ring.cycleRank,1);
  assert.deepEqual(ring.ring.slice().sort((a,b)=>a-b),[1,2,3,4]);assert.ok(ring.projectedRingArea>0);
  assert.ok(asDrawn.freeAtomIds.includes(6));assert.equal(asDrawn.metrics.demonstratedMembraneCount,0);
  assert.equal(asDrawn.metrics.demonstratedLifeCount,0);
  const crossing=observeAtomicWorld(state(atoms,[bond(1,3),bond(3,2),bond(2,4),bond(4,1)]));
  assert.equal(crossing.molecules[0].cycleRank,1);
  assert.deepEqual(crossing.molecules[0].ring,[]);
  assert.equal(crossing.molecules[0].projectedRingArea,0);
  const chain=observeAtomicWorld(state(atoms,graph.slice(0,3)));
  assert.equal(chain.metrics.cycleCount,0);
});

test('changing bond order preserves the atom set and records the altered edge',()=>{
  const atoms=[atom(1,'O',0.4,0.4),atom(2,'O',0.44,0.4)];
  const initial=observeAtomicWorld(state(atoms,[bond(1,2)]));
  const next=state(atoms,[bond(1,2,2)],1), changed=observeAtomicWorld(next,initial);
  assert.equal(changed.molecules[0].id,initial.molecules[0].id);
  assert.equal(changed.molecules[0].age,2);assert.equal(changed.molecules[0].structureAge,1);
  assert.equal(changed.molecules[0].bondOrderSum,2);
  assert.equal(changed.events[0].type,'rearrangement');
  assert.deepEqual(changed.events[0].bondChanges,[{a:1,b:2,before:1,after:2}]);
  assert.ok(validateAtomicObservation(next,changed));
  for(const corrupt of [s=>s.molecules[0].members.push(7),s=>{s.molecules[0].formula='H2';},
    s=>{s.metrics.demonstratedLifeCount=1;},s=>{s.events[0].products[0].members=[1];},
    s=>{s.events[0].bondChanges[0].after=1;}]){
    const bad=structuredClone(changed);corrupt(bad);assert.equal(validateAtomicObservation(next,bad),false);
  }
});

test('measuring, validating and remeasuring never change the inputs or take a random draw',()=>{
  const a=state([atom(1,'H',0.2,0.2),atom(2,'H',0.3,0.2)],[]),prev=observeAtomicWorld(a);
  const b=state(a.particles,[bond(1,2)],1), before=structuredClone(b), earlier=structuredClone(prev);
  b.random=()=>assert.fail('the observer consumed a physical random draw');
  const measured=observeAtomicWorld(b,prev);
  assert.ok(validateAtomicObservation(b,measured));
  assert.deepEqual(prev,earlier);assert.deepEqual(b.particles,before.particles);assert.deepEqual(b.bonds,before.bonds);
  assert.deepEqual(observeAtomicWorld(b,prev),measured);
  assert.deepEqual(observeAtomicWorld(b,measured),measured);
});

test('discarding all observational identities every step leaves the physical trajectory unchanged',()=>{
  const tracked=new AtomicWorld(19),blind=new AtomicWorld(19);
  for(let i=0;i<90;i++) {
    blind.observer=null;
    tracked.step();blind.step();
  }
  const {observer:history,...physical}=tracked.serialize();
  const {observer:instantaneous,...other}=blind.serialize();
  assert.ok(history.events.length>0);
  assert.equal(instantaneous.events.length,0);
  assert.deepEqual(other,physical);
});

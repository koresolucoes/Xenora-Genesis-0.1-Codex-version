import test from 'node:test';
import assert from 'node:assert/strict';
import { REACTION_BENCH_LIMITS, getCurrentSpecies, getReactionBenchReport,
  updateReactionBench, validateReactionBench } from '../public/src/reaction-bench.js';

const atoms = (...symbols) => symbols.map((element,i)=>({id:i+1,element}));
const edge = (a,b,order=1) => ({a,b,order});
function fixture(particles,bonds=[],tick=0) {
  const world = {particles,bonds,tick,flux:{formed:[],broken:[],upgraded:[]}};
  world.reactionBench = updateReactionBench(world);
  return world;
}
function step(world,{formed=[],broken=[],upgraded=[]}={}) {
  const key = b => Math.min(b.a,b.b)+'/'+Math.max(b.a,b.b);
  const graph = new Map(world.bonds.map(b=>[key(b),b]));
  for (const b of broken) graph.delete(key(b));
  for (const b of [...formed,...upgraded]) graph.set(key(b),b);
  world.bonds = [...graph.values()];
  world.flux = {formed,broken,upgraded};
  world.tick++;
  world.reactionBench = updateReactionBench(world,world.reactionBench);
}
test('a simultaneous H exchange is one rearrangement and records both molecular residences',()=>{
  const world=fixture(atoms('O','H','O','H'),[edge(1,2),edge(3,4)],17);
  step(world,{broken:[edge(1,2),edge(3,4)],formed:[edge(1,4),edge(3,2)]});
  const start=getReactionBenchReport(world);
  assert.equal(start.baselineMolecules,2);
  assert.equal(start.survivingBaselineMolecules,0);
  assert.equal(start.eventCount,1);
  const [g]=start.groups;
  assert.equal(g.type,'rearrangement');
  assert.equal(g.equation,'2 HO → 2 HO');
  assert.deepEqual(g.evidence[0].atomIds,[1,2,3,4]);
  assert.equal(g.edits.length,2);
  assert.deepEqual(g.edits.map(e=>e.count),[2,2]);
  assert.equal(g.persistence[0].censoredBefore,2);
  for(let i=0;i<5;i++) step(world);
  step(world,{broken:[edge(1,4)]});
  const later=getReactionBenchReport(world);
  const exchange=later.groups.find(x=>x.key===g.key);
  assert.equal(later.silentTicks,5);
  assert.equal(exchange.residence.completedMeanFs,6*4.8);
  assert.equal(exchange.residence.ongoingMaxFs,6*4.8);
  assert.equal(exchange.persistence[0].reached,2);
  assert.equal(exchange.persistence[1].endedBefore,1);
  assert.equal(exchange.persistence[1].censoredBefore,1);
  assert.ok(validateReactionBench(world,world.reactionBench));
});
test('an increase of order closes the previous product episode and creates a new structural group',()=>{
  const w=fixture(atoms('O','O'));
  step(w,{formed:[edge(1,2)]});
  const first=getCurrentSpecies(w)[0].key;
  step(w,{upgraded:[edge(1,2,2)]});
  const next=getCurrentSpecies(w)[0].key;
  assert.notEqual(first,next);
  const report=getReactionBenchReport(w);
  const association=report.groups.find(g=>g.type==='association');
  const upgraded=report.groups.find(g=>g.type==='rearrangement');
  assert.equal(association.residence.completedMeanFs,4.8);
  assert.equal(upgraded.products[0].key,next);
  assert.equal(upgraded.reactants[0].key,first);
  assert.deepEqual(upgraded.edits,[{elements:'O–O',before:1,after:2,count:1}]);
  const saved=structuredClone(w);
  assert.ok(validateReactionBench(w,w.reactionBench));
  assert.deepEqual(getReactionBenchReport(w),report);
  assert.deepEqual(w,saved);
});
test('local edit history is bounded by time and edit count, drops whole ticks, and leaves its boundary censored',()=>{
  const particles=Array.from({length:384},(_,i)=>({id:i+1,element:'H'}));
  const pairs=Array.from({length:192},(_,i)=>edge(i*2+1,i*2+2));
  const w=fixture(particles);
  for(let i=0;i<13;i++)step(w,i%2?{broken:pairs}:{formed:pairs});
  const log=w.reactionBench;
  assert.equal(log.startTick,3);
  assert.ok(log.frames.reduce((sum,f)=>sum+f.changes.length,0)<=REACTION_BENCH_LIMITS.edits);
  assert.ok(validateReactionBench(w,log));
  const report=getReactionBenchReport(w);
  assert.equal(report.baselineMolecules,192);
  assert.equal(report.comparedSteps,10);
  assert.equal(report.groups.length,2);
  assert.equal(report.groups[0].occurrences,5*192);
  assert.equal(report.groups.find(g=>g.type==='association').residence.completedCount,4*192);
  for(let i=0;i<133;i++)step(w);
  const quiet=getReactionBenchReport(w);
  assert.equal(quiet.comparedSteps,128);
  assert.equal(quiet.eventCount,0);
  assert.equal(quiet.survivingBaselineMolecules,192);
  assert.equal(quiet.silentTicks,128);
  assert.ok(validateReactionBench(w,w.reactionBench));
});
test('rejects incompatible final flux, impossible order histories, duplicate edits, and corrupt baselines',()=>{
  const w=fixture(atoms('O','O','H'));
  step(w,{formed:[edge(1,2)]}); step(w,{upgraded:[edge(1,2,2)]});
  for(const corrupt of [
    d=>d.frames.pop(),d=>d.frames[0].changes.push([1,2,0,1]),
    d=>{d.frames[1].changes[0]=[1,2,0,2];},
    d=>{d.frames[0].changes[0]=[1,3,0,1];},d=>{d.startTick=1;},
    d=>{d.frames[0].changes[0]=[1,2,2,1];},d=>{d.frames[0].tick=2;},
    d=>{d.frames[0].changes[0]=[1,4,0,1];},
  ]){
    const bad=structuredClone(w.reactionBench);corrupt(bad);
    assert.equal(validateReactionBench(w,bad),false);
  }
  assert.ok(validateReactionBench(w,w.reactionBench));
});
test('isotopes with the same atom ID in independent worlds retain different identities',()=>{
  const a=fixture([{id:1,element:'H',isotope:1}]);
  const b=fixture([{id:1,element:'H',isotope:2}]);
  assert.notEqual(getCurrentSpecies(a)[0].key,getCurrentSpecies(b)[0].key);
});
test('validates formation dates still observable on physical bonds',()=>{
  const w=fixture(atoms('H','H'));
  step(w);step(w,{formed:[{...edge(1,2),formedAt:2}]});step(w);
  assert.ok(validateReactionBench(w,w.reactionBench));
  const shifted=structuredClone(w.reactionBench);
  shifted.frames[0].tick=1;
  assert.equal(validateReactionBench(w,shifted),false);
});

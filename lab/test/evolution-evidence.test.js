import test from 'node:test';
import assert from 'node:assert/strict';
import { EvolvingWorld } from '../public/src/evolving-world.js';
import { readEvolutionEvidence } from '../public/src/evolution-evidence.js';

test('initial and never-populated worlds distinguish distributions from unmeasured change', () => {
  const w = new EvolvingWorld(42);
  const start=readEvolutionEvidence(w);
  assert.equal(start.status,'baseline');
  assert.equal(start.baseline.tick,0);
  assert.equal(start.baseline.population,24);
  assert.equal(start.focus,null);
  assert.match(start.observation,/2, 5 e 8/);
  assert.match(start.observation,/8\/24/);
  const empty=new EvolvingWorld(42,{founderCount:0});
  empty.step();
  const noEvidence=readEvolutionEvidence(empty);
  assert.equal(noEvidence.status,'sterile');
  assert.equal(noEvidence.comparison,null);
  assert.equal(noEvidence.focus,null);
  assert.doesNotMatch(noEvidence.observation,/%/);
});

test('observed change is computed from dated carrier counts, and a neutral fork is identified', () => {
  const w=new EvolvingWorld(42);
  for(let i=0;i<145;i++) w.step();
  const before=w.serialize(), e=readEvolutionEvidence(w),m=w.getMetrics();
  assert.equal(e.status,'changed');
  assert.equal(e.comparison.tick,145);
  assert.equal(e.focus.beforeCount,e.baseline.counts[e.focus.allele]);
  assert.equal(e.focus.afterCount,m.traitCounts[e.focus.allele]);
  assert.equal(e.focus.delta,(e.focus.afterCount*e.baseline.population-e.focus.beforeCount*m.population)/(m.population*e.baseline.population));
  assert.match(e.observation,/No passo 0/);
  assert.match(e.observation,/No passo 145/);
  assert.match(e.demography,/nascimento/); assert.match(e.demography,/mutaç/); assert.match(e.demography,/geração/);
  assert.match(e.control,/deriva/);
  assert.match(readEvolutionEvidence(w.fork({selectionEnabled:false})).control,/controle neutro está ativo/);
  assert.deepEqual(w.serialize(),before);
});

test('bounded histories preserve the founding reference and an extinct population has no current allele frequencies', () => {
  const w=new EvolvingWorld(42);
  for(let i=0;i<25;i++)w.step();
  // The archive keeps the founder-family registry independently of its rolling series.
  w.history=w.history.filter(s=>s.tick>=20);
  const live=readEvolutionEvidence(w);
  assert.equal(live.baseline.population,24); assert.equal(live.oldestRetainedTick,20);
  assert.match(live.coverage,/passo 20/);
  w.setLightForcing(0);
  while(w.organisms.length && w.tick<1300)w.step();
  assert.equal(w.organisms.length,0);
  const extinct=readEvolutionEvidence(w);
  assert.equal(extinct.status,'extinct'); assert.ok(extinct.comparison.tick <= w.extinctionTick);
  assert.match(extinct.observation,/frequência relativa está indefinida/);
  w.history=w.history.filter(s=>s.population===0);
  const lost=readEvolutionEvidence(w);
  assert.equal(lost.focus,null);
  assert.equal(lost.comparison,null);
  assert.match(lost.observation,/janela guardada/);
});

test('equal endpoints do not obscure sampled variation between them', () => {
  const gen=(tick,traitCounts) => ({tick,traitCounts,population:traitCounts.reduce((s,n)=>s+n,0)});
  const a=[0,0,1,0,0,0,0,0,1,0,0],b=[0,0,2,0,0,0,0,0,1,0,0];
  const row=gen(20,a);
  const w={requestedFounders:2,lineages:[{trait:.2},{trait:.8}],history:[gen(0,a),gen(10,b),row],
    getMetrics:()=>({...row,births:2,mutations:0,maxGeneration:1,selectionEnabled:true})};
  const e=readEvolutionEvidence(w);
  assert.equal(e.status,'unchanged');
  assert.match(e.observation,/No passo 10/);
});

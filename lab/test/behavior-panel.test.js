import assert from 'node:assert/strict';
import test from 'node:test';
import {EvolvingWorld} from '../public/src/evolving-world.js';
import {exploreProbability} from '../public/src/behavior-learning.js';
import {createBehaviorTrial, BEHAVIOR_TRIAL_STEPS} from '../public/src/behavior-trial.js';
import {individualLearning, pairedRewardDifference} from '../public/src/behavior-panel.js';

test('the selected cell shows its own two context memories, observed counts and model probabilities',()=>{
  const w=new EvolvingWorld(42);
  const id=w.organisms[0].id;
  const naive=individualLearning(w,id);
  assert.equal(naive.visits,0);assert.deepEqual(naive.contexts.map(c=>c.probability),[.5,.5]);
  for(let i=0;i<45;i++)w.step();
  const cell=w.organisms.find(o=>o.memory.visits.some(v=>v>0));
  assert.ok(cell);
  const shown=individualLearning(w,cell.id);
  assert.equal(shown.allele,cell.genome.allele);
  shown.contexts.forEach((c,i)=>{
    assert.deepEqual([c.stay.score,c.explore.score], cell.memory.values.slice(i*2,i*2+2));
    assert.deepEqual([c.stay.n,c.explore.n],cell.memory.visits.slice(i*2,i*2+2));
    assert.equal(c.probability,exploreProbability(cell.memory,i,true));
  });
  const worldMetrics=w.getMetrics();
  assert.equal(worldMetrics.behaviorRewardTotal,worldMetrics.behaviorByContext[0].reward+worldMetrics.behaviorByContext[1].reward);
  w.setControls({learningEnabled:false});
  assert.deepEqual(individualLearning(w,cell.id).contexts.map(c=>c.probability),[.5,.5]);
});

test('missing selection, an absent organism, sterility and extinction have separate states',()=>{
  const w=new EvolvingWorld(9);
  assert.equal(individualLearning(w,null).state,'unselected');
  assert.equal(individualLearning(w,99999999).state,'absent');
  assert.equal(individualLearning(new EvolvingWorld(9,{founderCount:0}),null).state,'sterile');
  assert.equal(individualLearning({organisms:[],founderCount:3},2).state,'extinct');
});

test('a displayed paired difference is signed learner minus control with both decision denominators intact',()=>{
  assert.equal(pairedRewardDifference({learner:{meanReward:null},control:{meanReward:0}}),null);
  assert.equal(pairedRewardDifference({learner:{meanReward:-.25},control:{meanReward:.125}}),-.375);
  const focus=new EvolvingWorld(42);const saved=focus.serialize();
  const experiment=createBehaviorTrial(saved);
  for(let i=0;i<BEHAVIOR_TRIAL_STEPS;i++)experiment.step();
  const out=experiment.result();
  for(const arm of [out.learner,out.control]){
    assert.equal(arm.contexts.reduce((n,c)=>n+c.decisions,0),arm.decisions);
    assert.equal(arm.reward/arm.decisions,arm.meanReward);
  }
  assert.equal(pairedRewardDifference(out),out.learner.meanReward-out.control.meanReward);
  assert.deepEqual(focus.serialize(),saved);
});

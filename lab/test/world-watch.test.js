import assert from 'node:assert/strict';
import test from 'node:test';
import { EvolvingWorld } from '../public/src/evolving-world.js';
import { openEvolutionSession } from '../public/src/evolution-session.js';
import { WorldWatch, WATCH_LIMIT, openWatchStore } from '../public/src/world-watch-model.js';

test('a paired comparison branches at the same tick, advances two real simulations and leaves focus untouched', () => {
  const model = new WorldWatch(), main = new EvolvingWorld(42);
  for (let i=0; i<12; i++) main.step();
  const snapshot=main.serialize();
  const secretRef={worldId:'w',runId:'r',revision:3,tick:11,token:'not stored'};
  const [a,b]=model.pair(main,'Controle',secretRef);
  assert.equal(a.world.tick,b.world.tick);
  assert.notEqual(a.world.environment.lightForcing,b.world.environment.lightForcing);
  assert.equal(a.parent.id,b.parent.id); assert.equal(b.parent.id,model.focusId);
  assert.equal(b.parent.tick,12);assert.equal(a.parent.action,'control');
  assert.deepEqual([b.parent.action,b.parent.from,b.parent.to],['light',1,.5]);
  assert.deepEqual(main.serialize(),snapshot);
  for(let round=0;round<4;round++)model.advance([a.id,b.id],10);
  assert.equal(a.world.tick,52); assert.equal(b.world.tick,52);
  assert.notDeepEqual(a.world.environment.serialize(),b.world.environment.serialize());
  assert.deepEqual(main.serialize(),snapshot);
  assert.deepEqual(a.remote,{worldId:'w',runId:'r',revision:3,tick:11});
  assert.equal(model.checkpoint().cards.some(c=>'token' in c.remote),false);

  const opened=model.open(a.id); opened.step(); model.advance([b.id],3);
  assert.equal(a.world.tick,52); assert.equal(opened.tick,53);assert.equal(b.world.tick,55);
  const next=model.capture(opened,'Descendente');
  assert.equal(model.node(next.parent.id).parent.id,a.id);
  assert.equal(model.node(next.parent.id).parent.tick,52);
  assert.equal(next.parent.tick,53);assert.equal(next.base.tick,53);
});

test('the map restores its own trajectory and the exact divergence from a removed card', () => {
  const main=new EvolvingWorld(42), panel=new WorldWatch();
  const source=panel.create(42,'Controle');panel.advance([source.id],7);
  const independent=panel.create(42,'Outra raiz');
  const map=panel.open(source.id);map.step();
  const child=panel.capture(map,'Ramo do mapa');
  assert.equal(child.parent.id,map.watchFocus.id);
  assert.notEqual(independent.id,source.id);
  assert.equal(panel.node(independent.id).parent,null);
  panel.setLight(source.id,0.75);
  panel.remove(source.id);
  const records=new Map();
  const storage={getItem:k=>records.get(k)??null,setItem:(k,v)=>records.set(k,v)};
  const session=openEvolutionSession({tab:storage,local:null});
  assert.ok(session.save(map,false,1));
  assert.equal('watchFocus' in map.serialize(),false);
  const restored=WorldWatch.restore(JSON.parse(JSON.stringify(panel.checkpoint())));
  const resumed=session.restore().world;
  assert.equal(restored.bindFocus(resumed).id,map.watchFocus.id);
  const graph=restored.relations();
  assert.equal(graph.get(child.id).parent.tick,8);
  assert.equal(graph.get(restored.focusId).parent.id,source.id);
  assert.equal(graph.get(restored.focusId).parent.tick,7);
  assert.equal(graph.get(source.id).name,'Controle');
  assert.deepEqual(graph.get(source.id).lightChange,{tick:7,from:1,to:0.75});
  assert.equal(restored.entries.has(source.id),false);
  const replaced=restored.bindFocus(main);
  assert.notEqual(replaced.id,map.watchFocus.id);assert.equal(replaced.parent,null);
});

test('legacy cards retain recorded parents and missing references without inferring a relation by seed', () => {
  const model=new WorldWatch();
  const source=model.create(42,'Fonte'), other=model.create(42,'Independente'), branch=model.fork(source.id,'Filho');
  const cards=model.checkpoint().cards.filter(c=>c.id!==source.id).map(({kind,...c})=>{
    if(c.parent)delete c.parent.action;
    return c;
  });
  const legacy=WorldWatch.restore({version:1,cards});
  assert.equal(legacy.focusId,null);
  const graph=legacy.relations();
  assert.equal(graph.get(other.id).parent,null);
  assert.equal(graph.get(branch.id).parent.id,source.id);
  assert.equal(graph.get(branch.id).parent.action,'legacy');
  assert.equal(graph.get(source.id).kind,'reference');
  assert.deepEqual(WorldWatch.restore(legacy.checkpoint()).checkpoint(),legacy.checkpoint());
  cards[0].parent={id:cards[0].id,tick:0};assert.throws(()=>WorldWatch.restore({version:1,cards}),/Ciclo/);
});

test('local persistence reopens independent paused copies and conserves exact future progress', () => {
  const model=new WorldWatch(), a=model.create(123,'Primeiro'), b=model.fork(a.id,'Ramo');
  model.advance([a.id,b.id],3); a.playing=true;
  model.advance([b.id],5);
  const restored=WorldWatch.restore(structuredClone(model.checkpoint()));
  assert.deepEqual(restored.checkpoint(),model.checkpoint());assert.equal(restored.get(a.id).playing,false);
  for(const id of [a.id,b.id]) {
    model.advance([id],2);restored.advance([id],2);
    assert.deepEqual(restored.get(id).world.serialize(),model.get(id).world.serialize());
  }
  model.remove(a.id);assert.equal(model.get(b.id).parent.name,'Primeiro');
  assert.equal(model.undoRemove().id,a.id);assert.equal(model.get(a.id).playing,false);
});

test('capacity and invalid snapshots or seeds fail without dropping existing runs', () => {
  const model=new WorldWatch();
  assert.throws(()=>model.create(-1),/semente/);
  for(let i=0;i<WATCH_LIMIT;i++)model.create(i);
  assert.equal(model.entries.size,4);
  assert.throws(()=>model.pair(new EvolvingWorld(42)),/quatro/);
  const saved=model.checkpoint();
  saved.cards[0].base.tick=999;
  assert.throws(()=>WorldWatch.restore(saved),/inicial/);
  assert.equal(model.entries.size,4);
});

test('fallback store rejects a stale writer while retaining the newer local snapshots', async () => {
  const original=globalThis.localStorage, values=new Map();
  const store={getItem:k=>values.get(k) ?? null,setItem:(k,v)=>values.set(k,v)};
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:store});
  try {
    const a=await openWatchStore(),b=await openWatchStore();
    await a.read();await b.read();
    await a.write({version:1,cards:[]});
    await assert.rejects(b.write({version:1,cards:[]}),/Outra aba/);
    const restored=await b.read();assert.deepEqual(restored.cards,[]);
  } finally {
    if(original===undefined)delete globalThis.localStorage;
    else Object.defineProperty(globalThis,'localStorage',{configurable:true,value:original});
  }
});

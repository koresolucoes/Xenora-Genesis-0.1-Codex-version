import test from "node:test";
import assert from "node:assert/strict";
import {decodeInstrument} from "../public/src/instrument-route.js";
import {openEvolvingPlanet,getPlanetTransfer} from "../public/src/evolution-link.js";
import {PrimordialWorld} from "../public/src/primordial.js";
import {EvolvingWorld} from "../public/src/evolving-world.js";

test("document bookmarks and legacy transfers open an instrument inside the observatory",()=>{
  const base="https://observatory.test/";
  const old=decodeInstrument("/lagoa.html?amostra=a#dashboard",base);
  assert.equal(old.shell.href,base+"?instrumento=cultura&amostra=a#dashboard");
  assert.equal(decodeInstrument(old.shell,base).documentUrl.href,base+"lagoa.html?amostra=a#dashboard");
  assert.equal(decodeInstrument("/?modo=lagoa",base).name,"cultura");
  assert.equal(decodeInstrument("/primordial.html?universo=b",base).name,"origens");
  assert.equal(decodeInstrument("https://other.test/primordial.html",base),null);
  assert.equal(decodeInstrument("/?planeta=c",base),null);
});

test("two independent collections with the same seed retain their own source after save and restore",()=>{
  const priorStorage=Object.getOwnPropertyDescriptor(globalThis,"sessionStorage");
  const priorLocation=Object.getOwnPropertyDescriptor(globalThis,"location");
  const records=new Map(),visits=[];
  Object.defineProperty(globalThis,"sessionStorage",{configurable:true,value:{
    setItem:(k,v)=>records.set(k,v),getItem:k=>records.get(k)}});
  Object.defineProperty(globalThis,"location",{configurable:true,value:{assign:p=>visits.push(p)}});
  try {
    const source=new PrimordialWorld({seed:42});
    while(source.phase!=="minerals")source.step();
    openEvolvingPlanet(source,24);
    source.step();
    openEvolvingPlanet(source,0);
    const sources=visits.map(p=>getPlanetTransfer(new URL(p,"https://observatory.test/").searchParams.get("planeta")));
    assert.notEqual(sources[0].id,sources[1].id);
    for(const item of sources){
      const world=EvolvingWorld.fromSurfaceSample(item.sample,{founderCount:item.founders});
      assert.equal(EvolvingWorld.restore(world.serialize()).environment.origin.transferId,item.id);
    }
    assert.equal(sources[0].sample.tick+1,sources[1].sample.tick);
    assert.equal(sources[0].founders,24);
  } finally {
    for(const [name,descriptor] of [["sessionStorage",priorStorage],["location",priorLocation]]){
      if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];
    }
  }
});

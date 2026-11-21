import {test} from "node:test";
import assert from "node:assert/strict";
import {EvolvingWorld} from "../public/src/evolving-world.js";
import {openEvolutionSession,MAX_CATCHUP_STEPS} from "../public/src/evolution-session.js";

function storage() {
  const records = new Map();
  return {getItem:k=>records.get(k),setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k)};
}
test("local continuity uses the selected speed, saves outstanding steps and respects pause", () => {
  let time = 10000;
  const local = storage(), tab=storage();
  const session = openEvolutionSession({local,tab,now:()=>time});
  const world = new EvolvingWorld(42);
  session.save(world, true, 4, 7);
  time += 2000;
  const restored = session.restore();
  assert.equal(restored.elapsedSteps, 39);
  assert.deepEqual(restored.world.serialize(), world.serialize());
  time += 500000;
  assert.equal(session.restore().elapsedSteps, MAX_CATCHUP_STEPS);
  assert.equal(session.restore().limited, true);
  session.save(world,false,4);
  time += 500;
  assert.equal(session.restore().elapsedSteps, 0);
  session.clear();
  assert.equal(session.restore(),null);
});
test("open tabs resume independently and a fresh tab opens the last local world", () => {
  const local=storage(), tab=storage(), another=storage();
  const a=openEvolutionSession({local,tab}),b=openEvolutionSession({local,tab:another});
  a.save(new EvolvingWorld(42),false,1);
  assert.equal(b.restore().world.seed,42);
  b.save(new EvolvingWorld(43),false,1);
  assert.equal(a.restore().world.seed,42);
  assert.equal(openEvolutionSession({local,tab:storage()}).restore().world.seed,43);
});

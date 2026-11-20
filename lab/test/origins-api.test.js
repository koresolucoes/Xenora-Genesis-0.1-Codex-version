import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import app from "../worker.js";
import { World } from "../public/src/engine.js";
import { EvolvingWorld } from "../public/src/evolving-world.js";
import { evolutionarySurfaceSample } from "../public/src/evolving-environment.js";
import { PrimordialWorld } from "../public/src/primordial.js";

const env = {
  SUPABASE_URL:"https://science.invalid", SUPABASE_PUBLISHABLE_KEY:"test-publishable",
  XENORA_GATEWAY_TOKEN:"c".repeat(64)
};

function request(path, {method = "GET", token, body, operation} = {}) {
  const headers = new Headers();
  if (token) headers.set("Authorization", "Bearer " + token);
  if (operation) headers.set("Idempotency-Key", operation);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return new Request("https://laboratorio.invalid/api/worlds" + path, {
    method, headers, body:body === undefined ? undefined : JSON.stringify(body)
  });
}

test("science projects validated snapshots and authenticates write, read and fork", async t => {
  const token = randomBytes(32).toString("hex");
  const worldId = randomUUID(), runId = randomUUID(), operation = randomUUID();
  const rpcCalls = [];
  let dbResult = {worldId,runId,revision:1,tick:0,mode:"lagoon-molecular"};
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url.hostname, "science.invalid");
    assert.equal(options.redirect, "manual");
    const headers = new Headers(options.headers);
    assert.equal(headers.get("X-Xenora-Gateway"),env.XENORA_GATEWAY_TOKEN);
    assert.equal(headers.get("apikey"),env.SUPABASE_PUBLISHABLE_KEY);
    assert(!options.body.includes(token));
    const params = JSON.parse(options.body);
    assert.equal(params.p_hash,createHash("sha256").update(token).digest("hex"));
    rpcCalls.push({path:url.pathname,params});
    return Response.json(dbResult);
  });
  const create = body => app.fetch(request("",{method:"POST",token,operation,body}),env);
  const life = new World(42);
  life.step();
  const snapshot = life.serialize();
  snapshot.events[0].text = "texto livre do documento";
  const body = {worldId,runId,mode:"lagoon-molecular",checkpoint:snapshot};
  const saved = await create(body);
  assert.equal(saved.status,201);
  assert.match(saved.headers.get("Cache-Control"),/no-store/);
  assert.deepEqual(await saved.json(),dbResult);
  const creation = rpcCalls.at(-1).params;
  assert.equal(rpcCalls.at(-1).path,"/rest/v1/rpc/xenora_gateway_write_science");
  assert.equal(creation.p_request,operation);
  assert.equal(creation.p_action,"create");
  const data = creation.p_body;
  assert.equal(data.genealogy.length,life.organisms.length);
  assert.equal(data.genealogy[0].sequence,life.organisms[0].genome.sequence);
  assert(!data.events.some(event=>event.data.text === snapshot.events[0].text));
  assert.equal(data.samples.at(-1).data.membraneMass,life.getMetrics().membraneMass);
  assert.equal((await create(body)).status,201);
  assert.deepEqual(rpcCalls[0].params,rpcCalls[1].params);
  const base = "/" + worldId + "/runs/" + runId;
  assert.equal((await app.fetch(request(base+"/revisions",{method:"POST",token,operation:randomUUID(),
    body:{expectedRevision:1,mode:"lagoon-molecular",checkpoint:snapshot}}),env)).status,201);
  assert.equal(rpcCalls.at(-1).params.p_body.expectedRevision,1);
  const newRunId = randomUUID();
  assert.equal((await app.fetch(request(base+"/fork",{method:"POST",token,operation:randomUUID(),
    body:{revision:1,newRunId}}),env)).status,201);
  assert.deepEqual(rpcCalls.at(-1).params.p_body,{run:{id:newRunId},parentRunId:runId,parentRevision:1});

  for (const [suffix,view] of [["/revisions/1","checkpoint"],["/revisions?after=2","revisions"],
      ["/genealogy?history=true&revision=1","genealogy"]]) {
    assert.equal((await app.fetch(request(base+suffix,{token}),env)).status,200);
    assert.equal(rpcCalls.at(-1).path,"/rest/v1/rpc/xenora_gateway_read_science");
    assert.equal(rpcCalls.at(-1).params.p_query.view,view);
  }
  dbResult = null;
  assert.equal((await app.fetch(request("/"+worldId,{token}),env)).status,404);

  const before = rpcCalls.length;
  assert.equal((await create({...body,events:[{type:"fake"}]})).status,400);
  assert.equal((await create({...body,checkpoint:{...snapshot,initialMass:-1}})).status,422);
  assert.equal((await create({...body,mode:"primordial"})).status,422);
  assert.equal((await app.fetch(request(base+"/samples?limit=5000",{token}),env)).status,400);
  assert.equal((await app.fetch(request(base+"/revisions/1"),env)).status,404);
  assert.equal((await app.fetch(request("",{method:"POST",token,body}),env)).status,400);
  assert.equal(rpcCalls.length,before);
});

test("primordial projections are derived from the restored parcel, with a bounded causal history", async t => {
  const model = new PrimordialWorld({seed:42});
  for(let i=0; i<model.settings.epochs.minerals+8; i++) model.step();
  let sent;
  t.mock.method(globalThis,"fetch",async(_url,opts)=>{
    sent=JSON.parse(opts.body).p_body;return Response.json({revision:1});
  });
  const input = {worldId:randomUUID(),runId:randomUUID(),mode:"primordial",checkpoint:model.serialize()};
  const save = () => app.fetch(request("",{method:"POST",token:"a".repeat(64),operation:randomUUID(),body:input}),env);
  assert.equal((await save()).status,201);
  assert.equal(sent.quantities.length,7);
  assert.equal(sent.quantities.find(q=>q.symbol==="Si").mineral,model.mineralLot.units);
  assert.equal(sent.minerals[0].source,"stellar-neighborhood");
  assert.deepEqual(sent.minerals[0].recipe,{Mg:2,Si:1,O:4});
  assert.deepEqual(sent.events.map(e=>e.data.text),model.events.map(e=>e.text));
  assert.equal(sent.samples.at(-1).data.mineralUnits,model.getMetrics().mineralUnits);
  assert.deepEqual(sent.genealogy,[]);
  input.checkpoint.gas.Si += 1;
  assert.equal((await save()).status,422);
});

test("scientific routes distinguish authorization, concurrency and provider failure", async t => {
  let code, status;
  t.mock.method(globalThis,"fetch",async()=>Response.json({code},{status}));
  const target=request("/"+randomUUID(),{token:"a".repeat(64)});
  for (const row of [["PT404",404,404],["PT409",409,409],["PT422",422,422],["42501",403,503],["PGRST202",404,503]]) {
    [code,status]=row;
    assert.equal((await app.fetch(target,env)).status,row[2]);
  }
  assert.deepEqual(await (await app.fetch(request("/health"),{})).json(),{science:false});
  assert.deepEqual(await (await app.fetch(request("/health"),env)).json(),{science:true});
  assert.equal((await app.fetch(target,{})).status,503);
});

test("the archive identifies a cell born and lost between two saved revisions", async t => {
  const world = new World(42);
  const worldId = randomUUID(), runId = randomUUID(), token = randomBytes(32).toString("hex");
  const revisions = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    revisions.push(JSON.parse(options.body).p_body);
    return Response.json({worldId, runId, revision: revisions.length});
  });
  const post = (path, body) => app.fetch(request(path, {method:"POST", token, operation:randomUUID(), body}), env);
  const mode = "lagoon-molecular";
  assert.equal((await post("", {worldId, runId, mode, checkpoint:world.serialize()})).status, 201);

  let death;
  while (!death && world.tick < 5000) {
    world.step();
    death = world.events.find(event => event.type === "death" && event.tick === world.tick &&
      world.events.some(birth => birth.type === "birth" && birth.id === event.id));
  }
  assert(death, "the seeded world must retain a birth and its later death in the observation window");
  const birth = world.events.find(event => event.type === "birth" && event.id === death.id);
  assert(birth.tick > 0 && birth.tick < death.tick);
  assert(!world.organisms.some(org => org.id === death.id));
  const path = "/" + worldId + "/runs/" + runId + "/revisions";
  const checkpoint = world.serialize();
  assert.equal((await post(path, {expectedRevision:1, mode, checkpoint})).status, 201);
  assert(!revisions[0].genealogy.some(row => row.id === death.id));
  const rows = revisions[1].genealogy.filter(row => row.id === death.id);
  assert.deepEqual(rows, [{...death.individual, observedIn:"death", observedAtTick:death.tick}]);
  assert.equal(rows[0].parentId, birth.parent);
  assert.equal(rows[0].sequence, birth.individual.sequence);
  for (const org of world.organisms) {
    const living = revisions[1].genealogy.filter(row => row.id === org.id);
    assert.equal(living.length, 1);
    assert.equal(living[0].observedIn, "living");
    assert.equal(living[0].observedAtTick, world.tick);
  }

  const corrupt = structuredClone(checkpoint);
  corrupt.events.find(e => e.type === "death" && e.id === death.id).individual.sequence = "2".repeat(20);
  assert.equal((await post(path, {expectedRevision:2, mode, checkpoint:corrupt})).status, 422);
  assert.equal(revisions.length, 2);

  const legacy = structuredClone(checkpoint);
  for (const event of legacy.events) if (event.id === death.id) delete event.individual;
  assert.equal((await post(path, {expectedRevision:2, mode, checkpoint:legacy})).status, 201);
  assert(!revisions[2].genealogy.some(row => row.id === death.id));
});

test("a culture references its source silicate lot without adding the disk's stock to its own balance", async t => {
  let data;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    data = JSON.parse(options.body).p_body;
    return Response.json({revision:1});
  });
  for (const silicon of [true, false]) {
    const origin = new PrimordialWorld({seed:42, silicon});
    while (!origin.lagoon) origin.step();
    const world = World.fromSurfaceSample(origin.surfaceSample());
    const res = await app.fetch(request("", {
      method:"POST", token:"b".repeat(64), operation:randomUUID(), body:{
        worldId:randomUUID(), runId:randomUUID(), mode:"lagoon-molecular", checkpoint:world.serialize()
      }
    }), env);
    assert.equal(res.status,201);
    assert.equal(data.samples.at(-1).data.totalMass,world.getMetrics().totalMass);
    assert.equal(data.events.find(e => e.type === "start").data.introducedIndividuals, 1);
    assert.deepEqual(data.quantities,[]);
    if (silicon) {
      assert.deepEqual(data.minerals, [{
        key:"silicate-1", formula:"Mg2SiO4", source:"stellar-neighborhood", units:origin.mineralLot.units,
        firstTick:null, lastTick:null, recipe:{Mg:2,Si:1,O:4}, inventoryScope:"source-disk", scale:"representative",
        sourceSeed:42, sourceTick:origin.tick, handoffTick:origin.phaseTicks.lagoon, sampleSites:world.minerals.length
      }]);
    } else {
      assert.deepEqual(data.minerals,[]);
    }
  }
});

test("an evolving-world checkpoint archives the habitat, behavior and heritable thermal trait", async t => {
  const world = new EvolvingWorld(42);
  for (let i=0; i<12; i++) world.step();
  const snapshot = world.serialize();
  let archived;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    archived = JSON.parse(options.body).p_body;
    return Response.json({revision:1});
  });
  const body = {worldId:randomUUID(),runId:randomUUID(),mode:"evolving-world",checkpoint:snapshot};
  const save = data => app.fetch(request("", {method:"POST", token:"b".repeat(64), operation:randomUUID(), body:data}),env);
  assert.equal((await save(body)).status,201);
  assert.deepEqual(EvolvingWorld.restore(archived.checkpoint).serialize(), snapshot);
  assert.equal(archived.run.engineVersion,"evolving-world-v1");
  const last = archived.samples.at(-1).data;
  const expected = world.getMetrics();
  for (const key of ["population","meanTrait","meanTemperatureK","waterError","energyError",
      "behaviorDecisions","exploreDecisions","behaviorRewardTotal","learnedUpdates"]) {
    assert(Number.isFinite(expected[key]), key);
    assert.equal(last[key],expected[key],key);
  }
  assert.deepEqual(last.traitCounts,expected.traitCounts);
  assert.deepEqual(last.traitFrequencies,expected.traitFrequencies);
  assert.equal(last.learningEnabled,world.controls.learningEnabled);
  assert.equal(archived.genealogy.filter(row=>row.observedIn==="living").length,world.organisms.length);
  const founder = world.organisms[0];
  assert(founder);
  const gene = archived.genealogy.find(row=>row.id===founder.id);
  assert.equal(gene.allele,founder.genome.allele);
  assert.equal(gene.trait,founder.trait);
  assert.equal(gene.sequence,undefined);
  assert.deepEqual(archived.minerals,[]);
  const primordial = new PrimordialWorld({seed:42});
  while (!primordial.lagoon) primordial.step();
  const sampled = EvolvingWorld.fromSurfaceSample(evolutionarySurfaceSample(primordial));
  assert.equal((await save({...body,checkpoint:sampled.serialize()})).status,201);
  assert.equal(archived.minerals[0].units,primordial.mineralLot.units);
  assert.equal(archived.minerals[0].sampleSites,primordial.lagoon.sites.length);
  assert.equal((await save({...body, mode:"primordial"})).status,422);
  assert.equal((await save({...body, checkpoint:{...snapshot, tick:-1}})).status,422);
});

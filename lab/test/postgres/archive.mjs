import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { main } from "./local-pg.mjs";
import { World } from "../../public/src/engine.js";
import { PrimordialWorld } from "../../public/src/primordial.js";
import { projectSnapshot } from "../../origins-projection.js";

await main(async ({ admin, connect, schema }) => {
  const gateway = "a".repeat(64),
    capability = "b".repeat(64),
    wrong = "c".repeat(64);
  const owner = await connect(),
    rival = await connect(),
    guest = await connect();
  for (const c of [owner, rival, guest]) await c.query("set role anon");
  for (const c of [owner, rival])
    await c.query("select set_config('request.headers',$1,false)", [
      JSON.stringify({ "x-xenora-gateway": gateway }),
    ]);
  const legacyId = randomUUID(),
    legacyValue = { version: 3, note: "Água" };
  await owner.query(
    "select public.xenora_gateway_create_checkpoint($1,$2,$3::json)",
    [legacyId, capability, JSON.stringify(legacyValue)],
  );
  for (let i = 0; i < 2; i++) await schema("schema-origins.sql");
  const legacy = (
    await owner.query("select public.xenora_gateway_read_checkpoint($1,$2) c", [
      legacyId,
      capability,
    ])
  ).rows[0].c;
  assert.deepEqual(legacy, legacyValue);
  const world = randomUUID(),
    rootRun = randomUUID();
  const write = async (
    c,
    action,
    body,
    request = randomUUID(),
    worldId = world,
    hash = capability,
  ) => {
    return (
      await c.query(
        "select public.xenora_gateway_write_science($1,$2,$3,$4,$5::jsonb) as v",
        [worldId, hash, request, action, JSON.stringify(body)],
      )
    ).rows[0].v;
  };
  const read = async (c, query, hash = capability, worldId = world) => {
    return (
      await c.query(
        "select public.xenora_gateway_read_science($1,$2,$3::jsonb) as v",
        [worldId, hash, JSON.stringify(query)],
      )
    ).rows[0].v;
  };
  const rejected = (promise, ...states) =>
    assert.rejects(promise, (e) => states.includes(e.code));
  const createRequest = randomUUID();
  const rootBody = {
    run: {
      id: rootRun,
      mode: "primordial",
      engineVersion: "primordial-1",
      label: "qa",
    },
    checkpoint: { kind: "primordial", seed: 42, tick: 0, marker: "root" },
  };
  await rejected(write(guest, "create", rootBody, createRequest), "42501");
  const first = await write(owner, "create", rootBody, createRequest);
  assert.equal(first.revision, 1);
  assert.deepEqual(
    await write(owner, "create", rootBody, createRequest),
    first,
  );
  await rejected(
    write(
      owner,
      "create",
      { ...rootBody, checkpoint: { tick: 0, marker: "alteração" } },
      createRequest,
    ),
    "PT409",
  );
  await rejected(read(owner, { view: "world" }, wrong), "PT404");
  await rejected(read(guest, { view: "world" }), "42501");
  const rls = await admin.query(
    "select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='xenora_private' and relkind='r' order by 1",
  );
  assert.ok(rls.rows.every((r) => r.relrowsecurity));
  const viewSecurity = await admin.query(`select c.relname, c.reloptions
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='xenora_private' and c.relkind='v'`);
  assert.ok(viewSecurity.rowCount > 0);
  assert.ok(viewSecurity.rows.every(view => view.reloptions.includes("security_invoker=true")));
  const apiPermissions = await admin.query(`select p.proname,
    has_function_privilege('anon', p.oid, 'EXECUTE') as allowed,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as signed_in,
    has_function_privilege('service_role', p.oid, 'EXECUTE') as service
    from pg_proc p where p.proname in ('xenora_gateway_read_science','xenora_gateway_write_science')`);
  assert.equal(apiPermissions.rowCount, 2);
  assert.ok(apiPermissions.rows.every(row => row.allowed && !row.signed_in && !row.service));
  for (const { relname } of rls.rows)
    await rejected(
      owner.query("select 1 from xenora_private." + relname + " limit 1"),
      "42501",
    );
  await guest.query("reset role; set role authenticated");
  for (const { relname } of rls.rows)
    await rejected(
      guest.query("select 1 from xenora_private." + relname + " limit 1"),
      "42501",
    );
  await rejected(read(guest, { view: "world" }), "42501");
  const append = (checkpoint, expectedRevision) => ({
    runId: rootRun,
    expectedRevision,
    checkpoint: { kind: "primordial", seed: 42, ...checkpoint },
  });
  const secondBody = {
      ...append({ tick: 4, marker: "revisão histórica" }, 1),
      events: [
        {
          tick: 4,
          type: "mineral",
          key: "first-rock",
          data: { text: "formação" },
        },
      ],
      samples: [{ tick: 4, data: { mineralUnits: 1 } }],
      minerals: [
        {
          key: "m1",
          formula: "Mg2SiO4",
          source: "condensation",
          units: 1,
          firstTick: 4,
          lastTick: 4,
          recipe: { Mg: 2, Si: 1, O: 4 },
        },
      ],
      quantities: [
        {
          symbol: "Si",
          primordial: 0,
          ejecta: 2,
          gas: 1,
          stellar: 0,
          mineral: 1,
          exported: 0,
          residual: 0,
        },
      ],
      genealogy: [],
    },
    req = randomUUID();
  await owner.query("begin");
  const firstWriter = await write(owner, "append", secondBody, req);
  const waiter = write(rival, "append", secondBody, req).then(
    (v) => ({ value: v }),
    (e) => ({ error: e }),
  );
  const pid = rival.processID;
  let lockObserved = false;
  for (let i = 0; i < 40; i++) {
    const state = (
      await admin.query(
        "select wait_event_type from pg_stat_activity where pid=$1",
        [pid],
      )
    ).rows[0];
    if (state?.wait_event_type === "Lock") {
      lockObserved = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  await owner.query("commit");
  const repeated = await waiter;
  assert.ifError(repeated.error);
  assert.equal(lockObserved, true);
  assert.deepEqual(repeated.value, firstWriter);
  assert.equal(firstWriter.revision, 2);
  for (const view of ["events", "samples", "minerals", "quantities"]) {
    const projection = await read(owner, { view, runId: rootRun, revision: 2 });
    assert.equal(projection[view].length, 1, view);
  }
  await owner.query("begin");
  const winner = await write(
    owner,
    "append",
    append({ tick: 7, marker: "winner" }, 2),
  );
  const losing = write(
    rival,
    "append",
    append({ tick: 9, marker: "loser" }, 2),
  ).then(
    (v) => ({ value: v }),
    (e) => ({ error: e }),
  );
  await owner.query("commit");
  const loser = await losing;
  assert.equal(loser.error?.code, "PT409");
  assert.equal(winner.revision, 3);
  const query = { view: "checkpoint", runId: rootRun };
  const head = await read(owner, query);
  const next = append({ tick: 8 }, 3);
  await rejected(
    write(owner, "append", { ...next, engineVersion: "unexpected" }),
    "PT409",
  );
  await rejected(
    write(owner, "append", { ...next, mode: "lagoon-molecular" }),
    "PT409",
  );
  await rejected(
    write(owner, "append", append({ tick: 8, seed: 65 }, 3)),
    "PT409",
  );
  await rejected(
    write(owner, "append", append({ tick: 8, kind: "other" }, 3)),
    "PT400",
  );
  await owner.query("begin");
  await write(owner, "append", append({ tick: 8, marker: "rolled back" }, 3));
  await owner.query("rollback");
  assert.deepEqual(await read(owner, query), head);
  const invalidRequest = randomUUID();
  const malformed = {
    ...append({ tick: 8, marker: "bad projection" }, 3),
    events: [{ tick: 8, key: "ok", type: "sample", data: {} }],
    samples: [{ tick: 9, data: { late: true } }],
  };
  await rejected(write(owner, "append", malformed, invalidRequest), "PT400");
  assert.deepEqual(await read(owner, query), head);
  assert.equal(
    (
      await admin.query(
        "select count(*)::int as n from xenora_private.science_observations where world_id=$1 and run_id=$2 and revision=4",
        [world, rootRun],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await admin.query(
        "select count(*)::int as n from xenora_private.science_requests where world_id=$1 and request_id=$2",
        [world, invalidRequest],
      )
    ).rows[0].n,
    0,
  );
  const repaired = {
    ...append({ tick: 8, marker: "repair" }, 3),
    events: [{ tick: 8, key: "event2", type: "sample", data: {} }],
  };
  assert.equal(
    (await write(owner, "append", repaired, invalidRequest)).revision,
    4,
  );
  const page1 = await read(owner, {
    view: "events",
    runId: rootRun,
    history: true,
    limit: 1,
  });
  const page2 = await read(owner, {
    view: "events",
    runId: rootRun,
    history: true,
    limit: 1,
    after: page1.nextAfter,
  });
  assert.equal(page1.events.length, 1);
  assert.equal(page2.events.length, 1);
  assert.ok(page1.events[0].observationId < page2.events[0].observationId);
  assert.equal(
    (
      await read(owner, {
        view: "events",
        runId: rootRun,
        history: true,
        limit: 1,
        after: page2.nextAfter,
      })
    ).events.length,
    0,
  );
  const forkId = randomUUID();
  const fork = await write(owner, "fork", {
    run: { id: forkId, label: "ramo" },
    parentRunId: rootRun,
    parentRevision: 2,
  });
  assert.equal(fork.revision, 1);
  const old = await read(owner, { ...query, revision: 2 }),
    forked = await read(owner, { ...query, runId: forkId });
  assert.deepEqual(forked.checkpoint, old.checkpoint);
  assert.equal(forked.checkpoint.marker, "revisão histórica");
  const projectedFromFork = await read(owner, {
    view: "minerals",
    runId: forkId,
    revision: 1,
  });
  assert.equal(projectedFromFork.minerals[0].formula, "Mg2SiO4");
  const sharedEvent = { tick: 8, key: "event2", type: "sample", data: {} };
  await write(owner, "append", {
    ...append({ tick: 9 }, 4),
    events: [sharedEvent, { ...sharedEvent, data: { changed: true } }],
  });
  const historical = await read(owner, {
    view: "events",
    runId: rootRun,
    history: true,
  });
  assert.equal(
    historical.events.length,
    3,
    "Overlapping identical events are deduplicated and changed values persist",
  );
  for (const mode of ["primordial", "lagoon-molecular"]) {
    const model =
      mode === "primordial" ? new PrimordialWorld({ seed: 42 }) : new World(42);
    for (let i = 0; i < 360; i++) model.step();
    const snapshot = model.serialize();
    const projected = projectSnapshot(mode, snapshot),
      runId = randomUUID(),
      worldId = randomUUID();
    const { engineVersion, ...observations } = projected;
    await write(
      owner,
      "create",
      { run: { id: runId, mode, engineVersion }, ...observations },
      randomUUID(),
      worldId,
    );
    const restored = await read(
      owner,
      { view: "checkpoint", runId },
      capability,
      worldId,
    );
    assert.deepEqual(restored.checkpoint, projected.checkpoint);
    const replay = model.constructor.restore(restored.checkpoint);
    replay.step();
    model.step();
    assert.deepEqual(replay.serialize(), model.serialize());
    for (const view of ["quantities", "minerals", "genealogy", "samples"]) {
      const list = await read(
        owner,
        { view, runId, limit: 500 },
        capability,
        worldId,
      );
      assert.equal(
        list[view].length,
        observations[view].length,
        mode + " " + view,
      );
    }
  }
  console.log(
    JSON.stringify({
      legacyRead: true,
      rlsTables: rls.rows.map((x) => x.relname),
      idempotentWait: lockObserved,
      staleCas: loser.error?.code,
      rollback: true,
      failedProjection: "no partial revision, records or receipt",
      pagination: true,
      forkTick: forked.checkpoint.tick,
      historicalDeduplication: true,
      replayedModes: 2,
    }),
  );
});

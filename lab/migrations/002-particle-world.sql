-- Upgrade an existing archive with migration 001 applied. Existing checkpoints and grants are preserved.
BEGIN;

ALTER TABLE xenora_private.science_runs DROP CONSTRAINT IF EXISTS science_runs_mode_check;
ALTER TABLE xenora_private.science_runs ADD CONSTRAINT science_runs_mode_check
    CHECK (mode IN ('primordial','lagoon-molecular','evolving-world','particle-world'));

CREATE OR REPLACE FUNCTION public.xenora_gateway_write_science(
    p_world uuid,p_hash text,p_request uuid,p_action text,p_body jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    w xenora_private.science_worlds%ROWTYPE; r xenora_private.science_runs%ROWTYPE;
    src xenora_private.science_revisions%ROWTYPE; prev xenora_private.science_requests%ROWTYPE;
    added boolean:=false; sig bytea; rid uuid; pid uuid; rev integer; src_rev integer;
    checked jsonb; cov jsonb; result jsonb; t bigint; preceding_tick bigint; prior_seed jsonb;
BEGIN
    PERFORM xenora_private.require_gateway();
    IF p_world IS NULL OR p_hash IS NULL OR p_hash !~ '^[0-9A-Fa-f]{64}$' THEN
        RAISE EXCEPTION 'World unavailable' USING ERRCODE='PT404';
    END IF;
    IF p_request IS NULL OR p_action IS NULL OR p_action NOT IN ('create','append','fork')
       OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Invalid write request' USING ERRCODE='PT400';
    END IF;
    IF p_action='create' THEN
        INSERT INTO xenora_private.science_worlds(id,capability_hash,label)
            VALUES(p_world,decode(p_hash,'hex'),COALESCE(p_body->>'label',p_body#>>'{run,label}',''))
            ON CONFLICT(id) DO NOTHING RETURNING true INTO added;
    END IF;
    -- All writes for a world take this lock before looking up idempotency or
    -- run heads. A racing retry sees the first receipt, never a second commit.
    SELECT * INTO w FROM xenora_private.science_worlds
        WHERE id=p_world AND capability_hash=decode(p_hash,'hex') FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'World unavailable' USING ERRCODE='PT404'; END IF;
    sig:=sha256(convert_to(jsonb_build_array(p_action,p_body)::text,'UTF8'));
    SELECT * INTO prev FROM xenora_private.science_requests WHERE world_id=p_world AND request_id=p_request;
    IF FOUND THEN
        IF prev.body_hash<>sig THEN RAISE EXCEPTION 'Request key already used' USING ERRCODE='PT409'; END IF;
        RETURN prev.receipt;
    END IF;

    IF p_action='create' THEN
        IF NOT COALESCE(added,false) THEN RAISE EXCEPTION 'World already exists' USING ERRCODE='PT409'; END IF;
        rid:=(p_body#>>'{run,id}')::uuid;
        IF rid IS NULL OR COALESCE(p_body#>>'{run,mode}','') NOT IN ('primordial','lagoon-molecular','evolving-world','particle-world')
           OR length(COALESCE(p_body#>>'{run,engineVersion}','')) NOT BETWEEN 1 AND 160 THEN
            RAISE EXCEPTION 'Missing run identity, mode or engine version' USING ERRCODE='PT400';
        END IF;
        INSERT INTO xenora_private.science_runs(world_id,id,mode,engine_version,label)
          VALUES(p_world,rid,p_body#>>'{run,mode}',p_body#>>'{run,engineVersion}',COALESCE(p_body#>>'{run,label}',''))
          RETURNING * INTO r;
    ELSIF p_action='append' THEN
        rid:=(p_body->>'runId')::uuid;
        SELECT * INTO r FROM xenora_private.science_runs WHERE world_id=p_world AND id=rid;
        IF NOT FOUND THEN RAISE EXCEPTION 'Run unavailable' USING ERRCODE='PT404'; END IF;
        IF p_body->'expectedRevision' IS NULL THEN RAISE EXCEPTION 'Expected revision required' USING ERRCODE='PT400'; END IF;
        IF xenora_private.science_tick(p_body->'expectedRevision')<>r.head THEN
            RAISE EXCEPTION 'Head revision changed' USING ERRCODE='PT409';
        END IF;
        IF (p_body ? 'mode' AND p_body->>'mode' IS DISTINCT FROM r.mode) OR
           (p_body ? 'engineVersion' AND p_body->>'engineVersion' IS DISTINCT FROM r.engine_version) THEN
            RAISE EXCEPTION 'Run mode or engine version changed' USING ERRCODE='PT409';
        END IF;
        SELECT tick,checkpoint->'seed' INTO preceding_tick,prior_seed FROM xenora_private.science_revisions
            WHERE world_id=p_world AND run_id=rid AND revision=r.head;
    ELSE
        IF p_body ?| ARRAY['checkpoint','events','samples','quantities','minerals','genealogy'] THEN
            RAISE EXCEPTION 'Fork uses the stored parent revision' USING ERRCODE='PT400';
        END IF;
        pid:=(p_body->>'parentRunId')::uuid; rid:=(p_body#>>'{run,id}')::uuid;
        src_rev:=xenora_private.science_tick(p_body->'parentRevision')::integer;
        IF rid IS NULL THEN RAISE EXCEPTION 'Missing fork run id' USING ERRCODE='PT400'; END IF;
        SELECT * INTO src FROM xenora_private.science_revisions
            WHERE world_id=p_world AND run_id=pid AND revision=src_rev;
        IF NOT FOUND THEN RAISE EXCEPTION 'Source revision unavailable' USING ERRCODE='PT404'; END IF;
        IF EXISTS(SELECT FROM xenora_private.science_runs WHERE world_id=p_world AND id=rid) THEN
            RAISE EXCEPTION 'Run id already used' USING ERRCODE='PT409';
        END IF;
        INSERT INTO xenora_private.science_runs(world_id,id,mode,engine_version,label,parent_run_id,parent_revision)
            SELECT world_id,rid,mode,engine_version,COALESCE(p_body#>>'{run,label}',''),id,src_rev
            FROM xenora_private.science_runs WHERE world_id=p_world AND id=pid RETURNING * INTO r;
    END IF;

    rev:=r.head+1;
    checked:=CASE WHEN p_action='fork' THEN src.checkpoint ELSE p_body->'checkpoint' END;
    IF jsonb_typeof(checked) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Missing checkpoint object' USING ERRCODE='PT400';
    END IF;
    IF r.mode='particle-world' AND (
       checked->>'mode' IS DISTINCT FROM 'particle-world' OR checked->>'kind' IS DISTINCT FROM 'particle-world'
       OR checked->'version' IS DISTINCT FROM '1'::jsonb OR r.engine_version <> 'particle-world-v1'
       OR jsonb_typeof(checked->'seed') IS DISTINCT FROM 'number'
       OR jsonb_typeof(checked->'particles') IS DISTINCT FROM 'array'
       OR jsonb_typeof(checked->'bonds') IS DISTINCT FROM 'array') THEN
        RAISE EXCEPTION 'Invalid particle-world v1 checkpoint' USING ERRCODE='PT400';
    END IF;
    IF r.mode='particle-world' AND p_action<>'fork' AND (
       p_body->'genealogy' IS DISTINCT FROM '[]'::jsonb OR p_body->'minerals' IS DISTINCT FROM '[]'::jsonb
       OR p_body->'events' IS DISTINCT FROM '[]'::jsonb
       OR jsonb_typeof(p_body->'samples') IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_body->'quantities') IS DISTINCT FROM 'array') THEN
        RAISE EXCEPTION 'Missing particle-world measurements or unsupported projection' USING ERRCODE='PT400';
    END IF;
    IF r.mode='particle-world' AND p_action<>'fork' THEN
        IF jsonb_array_length(p_body->'samples')<>1 OR p_body#>'{samples,0,tick}' IS DISTINCT FROM checked->'tick'
           OR p_body#>'{samples,0,data,particleCount}' IS DISTINCT FROM to_jsonb(jsonb_array_length(checked->'particles'))
           OR p_body#>'{samples,0,data,bondCount}' IS DISTINCT FROM to_jsonb(jsonb_array_length(checked->'bonds')) THEN
            RAISE EXCEPTION 'Particle measurement does not match checkpoint' USING ERRCODE='PT400';
        END IF;
        IF p_body->'quantities' IS DISTINCT FROM (
            WITH counts AS (
                SELECT p->>'kind' AS kind,p->>'state' AS state,count(*) AS n
                FROM jsonb_array_elements(checked->'particles') AS p GROUP BY 1,2
            ), stocks AS (
                SELECT material.kind,sum(coalesce(counts.n,0)) AS n,
                       jsonb_object_agg(material.state,coalesce(counts.n,0)) AS states
                FROM (VALUES ('F','F'),('F','A'),('P','P'),('P','L'),('T','T')) AS material(kind,state)
                LEFT JOIN counts USING(kind,state) GROUP BY material.kind
            )
            SELECT jsonb_agg(jsonb_build_object('symbol',kind,'count',n,'states',states) ORDER BY kind) FROM stocks
        ) OR EXISTS (
            SELECT FROM jsonb_array_elements(checked->'particles') AS p
            WHERE (p->>'kind',p->>'state') NOT IN (('F','F'),('F','A'),('P','P'),('P','L'),('T','T'))
               OR p->>'kind' IS NULL OR p->>'state' IS NULL
        ) THEN
            RAISE EXCEPTION 'Particle inventory does not match checkpoint' USING ERRCODE='PT400';
        END IF;
    END IF;
    IF (CASE WHEN checked->>'kind'='primordial' THEN 'primordial'
             WHEN checked->>'kind'='particle-world' AND checked->>'mode'='particle-world' THEN 'particle-world'
             WHEN checked->>'mode'='evolving-world' THEN 'evolving-world'
             WHEN NOT (checked ? 'kind' OR checked ? 'mode') THEN 'lagoon-molecular'
        END) IS DISTINCT FROM r.mode THEN
        RAISE EXCEPTION 'Checkpoint mode mismatch' USING ERRCODE='PT400';
    END IF;
    IF p_action='append' AND (checked->'seed') IS DISTINCT FROM prior_seed THEN
        RAISE EXCEPTION 'Seed does not match this run' USING ERRCODE='PT409';
    END IF;
    t:=xenora_private.science_tick(checked->'tick');
    IF t<preceding_tick THEN RAISE EXCEPTION 'Fork before advancing an older tick' USING ERRCODE='PT409'; END IF;
    INSERT INTO xenora_private.science_revisions(world_id,run_id,revision,tick,checkpoint) VALUES(p_world,rid,rev,t,checked);
    IF p_action='fork' THEN
        cov:=src.coverage;
        INSERT INTO xenora_private.science_observations(world_id,run_id,revision,category,entity_key,tick,payload)
        SELECT p_world,rid,rev,category,entity_key,tick,payload FROM xenora_private.science_observations
        WHERE world_id=p_world AND run_id=pid AND revision=src_rev ORDER BY id;
    ELSE
        cov:=xenora_private.science_project(p_world,rid,rev,r.mode,t,checked,p_body);
        IF r.mode='particle-world' THEN
            cov:=cov||jsonb_build_object('genealogyBasis','not projected in particle-world-v1',
                'sampleBasis','validated checkpoint tick','eventBasis','past events not independently replayed');
        END IF;
    END IF;
    UPDATE xenora_private.science_revisions SET coverage=cov WHERE world_id=p_world AND run_id=rid AND revision=rev;
    UPDATE xenora_private.science_runs SET head=rev WHERE world_id=p_world AND id=rid;
    result:=jsonb_build_object('worldId',p_world,'runId',rid,'revision',rev,'tick',t,'mode',r.mode,
        'engineVersion',r.engine_version,'parentRunId',r.parent_run_id,'parentRevision',r.parent_revision);
    INSERT INTO xenora_private.science_requests(world_id,request_id,body_hash,receipt)
        VALUES(p_world,p_request,sig,result);
    RETURN result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Invalid identifier or numeric value' USING ERRCODE='PT400';
END;
$$;

COMMIT;

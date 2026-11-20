-- Upgrade an existing scientific archive created by schema-origins.sql.
-- Fresh installations use the cumulative schema-origins.sql instead.
-- Existing rows, world capabilities, RLS policies and function grants are preserved.
BEGIN;

-- Refresh the constraint as CREATE TABLE IF NOT EXISTS also covers older archives.
ALTER TABLE xenora_private.science_runs DROP CONSTRAINT IF EXISTS science_runs_mode_check;
ALTER TABLE xenora_private.science_runs ADD CONSTRAINT science_runs_mode_check
    CHECK (mode IN ('primordial','lagoon-molecular','evolving-world'));

CREATE OR REPLACE FUNCTION xenora_private.science_project(
    p_world uuid,p_run uuid,p_revision integer,p_mode text,p_tick bigint,c jsonb,b jsonb
) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE
    cat text; items jsonb; item jsonb; entry jsonb; k text; t bigint;
    details jsonb; q text; source_symbol text; lot jsonb;
    evidence_type text; evidence_tick bigint;
    min_event bigint; max_event bigint; min_sample bigint; max_sample bigint;
    event_count integer:=0; sample_count integer:=0;
BEGIN
    FOREACH cat IN ARRAY ARRAY['events','samples','quantities','minerals','genealogy'] LOOP
        items := b->cat;
        IF items IS NULL THEN
            CASE cat
            WHEN 'events' THEN items := c->'events';
            WHEN 'samples' THEN items := COALESCE(c->'history',c->'telemetry');
            WHEN 'minerals' THEN
                IF p_mode='primordial' AND jsonb_typeof(c->'mineralLot')='object'
                   AND COALESCE((c#>>'{mineralLot,units}')::numeric,0)>0 THEN
                    items := jsonb_build_array(c->'mineralLot');
                ELSIF p_mode='lagoon-molecular' THEN items := c->'minerals'; END IF;
            WHEN 'genealogy' THEN
                IF p_mode='lagoon-molecular' THEN items := c->'organisms'; END IF;
            WHEN 'quantities' THEN
                -- Each primordial inventory is keyed by element symbol. The
                -- mineral count is formula units times that element's coefficient.
                IF p_mode='primordial' AND jsonb_typeof(c->'primordial')='object' THEN
                    items := '[]'::jsonb; lot:=c->'mineralLot';
                    FOR source_symbol IN SELECT jsonb_object_keys(c->'primordial') LOOP
                        entry:=jsonb_build_object('symbol',source_symbol);
                        FOREACH q IN ARRAY ARRAY['primordial','ejecta','gas','stellar','exported'] LOOP
                            entry:=entry||jsonb_build_object(q,c->q->source_symbol);
                        END LOOP;
                        IF jsonb_typeof(lot->'units')='number' THEN
                            entry:=entry||jsonb_build_object('mineral',
                                (lot->>'units')::numeric * COALESCE((lot->'recipe'->>source_symbol)::numeric,0));
                        END IF;
                        items:=items||jsonb_build_array(entry);
                    END LOOP;
                END IF;
            END CASE;
        END IF;
        IF items IS NULL THEN CONTINUE; END IF;
        IF jsonb_typeof(items) <> 'array' THEN
            RAISE EXCEPTION 'Invalid projection %',cat USING ERRCODE='PT400';
        END IF;
        FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
            IF jsonb_typeof(item)<>'object' THEN
                RAISE EXCEPTION 'Projection row must be an object' USING ERRCODE='PT400';
            END IF;
            t:=p_tick;
            CASE cat
            WHEN 'events' THEN
                t:=xenora_private.science_tick(item->'tick');
                IF NULLIF(item->>'type','') IS NULL THEN
                    RAISE EXCEPTION 'Missing event type' USING ERRCODE='PT400';
                END IF;
                details:=COALESCE(item->'data',item-ARRAY['tick','key','type']);
                k:=COALESCE(NULLIF(item->>'key',''),t::text||':'||encode(sha256(convert_to(
                    jsonb_build_array(item->'type',details)::text,'UTF8')),'hex'));
                entry:=jsonb_build_object('tick',t,'type',item->'type','key',k,'data',details);
                event_count:=event_count+1; min_event:=least(min_event,t); max_event:=greatest(max_event,t);
            WHEN 'samples' THEN
                t:=xenora_private.science_tick(item->'tick'); k:=t::text;
                details:=COALESCE(item->'data',item-'tick');
                IF jsonb_typeof(details)<>'object' THEN
                    RAISE EXCEPTION 'Invalid sample metrics' USING ERRCODE='PT400';
                END IF;
                entry:=jsonb_build_object('tick',t,'data',details);
                sample_count:=sample_count+1; min_sample:=least(min_sample,t); max_sample:=greatest(max_sample,t);
            WHEN 'quantities' THEN
                k:=item->>'symbol'; entry:=item;
                FOREACH q IN ARRAY ARRAY['primordial','ejecta','gas','stellar','mineral','exported','residual'] LOOP
                    IF COALESCE(jsonb_typeof(item->q),'null') NOT IN ('number','null') THEN
                        RAISE EXCEPTION 'Invalid numeric element stock' USING ERRCODE='PT400';
                    END IF;
                END LOOP;
            WHEN 'minerals' THEN
                k:=COALESCE(item->>'key',item->>'id');
                entry:=item||jsonb_build_object('key',k,'source',item->'source');
                IF COALESCE(jsonb_typeof(item->'units'),'null') NOT IN ('null','number') THEN
                    RAISE EXCEPTION 'Invalid mineral stock' USING ERRCODE='PT400';
                END IF;
                FOREACH q IN ARRAY ARRAY['firstTick','lastTick'] LOOP
                    IF COALESCE(jsonb_typeof(item->q),'null')<>'null' AND
                       xenora_private.science_tick(item->q)>p_tick THEN
                        RAISE EXCEPTION 'Invalid mineral timestamp' USING ERRCODE='PT400';
                    END IF;
                END LOOP;
            WHEN 'genealogy' THEN
                k:=item->>'id';
                -- The unprojected snapshot's organisms list contains individuals
                -- alive at this tick. For externally supplied legacy projections,
                -- leave missing provenance unknown instead of asserting survival.
                IF NOT (b ? 'genealogy') THEN
                    evidence_type:='living'; evidence_tick:=p_tick;
                ELSE
                    evidence_type:=item->>'observedIn'; evidence_tick:=NULL;
                    IF COALESCE(jsonb_typeof(item->'observedAtTick'),'null') <> 'null' THEN
                        evidence_tick:=xenora_private.science_tick(item->'observedAtTick');
                    END IF;
                    IF (evidence_type IS NULL) <> (evidence_tick IS NULL)
                       OR evidence_type NOT IN ('living','birth','death')
                       OR evidence_tick > p_tick THEN
                        RAISE EXCEPTION 'Invalid genealogy observation origin or tick' USING ERRCODE='PT400';
                    END IF;
                END IF;
                t:=COALESCE(evidence_tick,p_tick);
                entry:=jsonb_build_object('id',item->'id','parentId',COALESCE(item->'parentId',item->'parent'),
                    'lineage',item->'lineage','generation',item->'generation',
                    'sequence',COALESCE(item->'sequence',item->'genome'->'sequence'),
                    'mutationDelta',item->'mutationDelta','observedIn',evidence_type,'observedAtTick',evidence_tick);
                IF p_mode='evolving-world' THEN
                    IF jsonb_typeof(item->'allele') IS DISTINCT FROM 'number'
                       OR xenora_private.science_tick(item->'allele') > 10
                       OR jsonb_typeof(item->'trait') IS DISTINCT FROM 'number'
                       OR (item->>'trait')::numeric <> (item->>'allele')::numeric/10 THEN
                        RAISE EXCEPTION 'Invalid thermal allele or trait' USING ERRCODE='PT400';
                    END IF;
                    entry:=entry||jsonb_build_object('allele',item->'allele','trait',item->'trait');
                END IF;
                IF COALESCE(jsonb_typeof(entry->'generation'),'null')<>'null' AND
                   xenora_private.science_tick(entry->'generation')>2147483647 THEN
                    RAISE EXCEPTION 'Invalid organism generation' USING ERRCODE='PT400';
                END IF;
                IF COALESCE(jsonb_typeof(entry->'mutationDelta'),'null') NOT IN ('null','number') THEN
                    RAISE EXCEPTION 'Invalid mutation delta' USING ERRCODE='PT400';
                END IF;
            END CASE;
            IF k IS NULL OR length(k) NOT BETWEEN 1 AND 500 OR t>p_tick THEN
                RAISE EXCEPTION 'Invalid object identity or future observation' USING ERRCODE='PT400';
            END IF;
            INSERT INTO xenora_private.science_observations(world_id,run_id,revision,category,entity_key,tick,payload)
                VALUES(p_world,p_run,p_revision,cat,k,t,entry);
        END LOOP;
    END LOOP;
    RETURN jsonb_build_object('kind','observed-windows','snapshotTick',p_tick,
        'eventCount',event_count,'eventsFromTick',min_event,'eventsThroughTick',max_event,
        'sampleCount',sample_count,'samplesFromTick',min_sample,'samplesThroughTick',max_sample,
        'genealogyBasis','living organisms and documented birth/death events where recorded; missing provenance is unknown');
END;
$$;

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
        IF rid IS NULL OR COALESCE(p_body#>>'{run,mode}','') NOT IN ('primordial','lagoon-molecular','evolving-world')
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
    IF (CASE WHEN checked->>'kind'='primordial' THEN 'primordial'
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

NOTIFY pgrst, 'reload schema';
COMMIT;

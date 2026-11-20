-- Apply after schema-supabase.sql. Legacy checkpoint tables and RPCs are independent.
BEGIN;

CREATE TABLE IF NOT EXISTS xenora_private.science_worlds (
    id uuid PRIMARY KEY,
    capability_hash bytea NOT NULL CHECK (octet_length(capability_hash) = 32),
    label text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS xenora_private.science_runs (
    world_id uuid NOT NULL REFERENCES xenora_private.science_worlds(id),
    id uuid NOT NULL,
    list_id bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    mode text NOT NULL,
    engine_version text NOT NULL CHECK (length(engine_version) BETWEEN 1 AND 160),
    label text NOT NULL DEFAULT '',
    parent_run_id uuid,
    parent_revision integer,
    head integer NOT NULL DEFAULT 0 CHECK (head >= 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (world_id,id),
    CHECK ((parent_run_id IS NULL) = (parent_revision IS NULL)),
    CHECK (parent_run_id IS NULL OR (parent_run_id <> id AND parent_revision > 0))
);

-- Refresh the constraint as CREATE TABLE IF NOT EXISTS also covers older archives.
ALTER TABLE xenora_private.science_runs DROP CONSTRAINT IF EXISTS science_runs_mode_check;
ALTER TABLE xenora_private.science_runs ADD CONSTRAINT science_runs_mode_check
    CHECK (mode IN ('primordial','lagoon-molecular','evolving-world','particle-world'));

CREATE TABLE IF NOT EXISTS xenora_private.science_revisions (
    world_id uuid NOT NULL,
    run_id uuid NOT NULL,
    revision integer NOT NULL CHECK (revision > 0),
    tick bigint NOT NULL CHECK (tick BETWEEN 0 AND 9007199254740991),
    checkpoint jsonb NOT NULL CHECK (jsonb_typeof(checkpoint) = 'object'),
    coverage jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (world_id,run_id,revision),
    FOREIGN KEY (world_id,run_id) REFERENCES xenora_private.science_runs (world_id,id)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT FROM pg_catalog.pg_constraint
        WHERE conrelid='xenora_private.science_runs'::regclass AND conname='science_fork_source'
    ) THEN
        ALTER TABLE xenora_private.science_runs ADD CONSTRAINT science_fork_source
            FOREIGN KEY (world_id,parent_run_id,parent_revision)
            REFERENCES xenora_private.science_revisions (world_id,run_id,revision);
    END IF;
END;
$$;

-- Indexed evidence at a specific revision. A sample or an event remains
-- available even when a later in-memory history window has discarded it.
CREATE TABLE IF NOT EXISTS xenora_private.science_observations (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    world_id uuid NOT NULL,
    run_id uuid NOT NULL,
    revision integer NOT NULL,
    category text NOT NULL CHECK (category IN ('events','samples','quantities','minerals','genealogy')),
    entity_key text NOT NULL,
    tick bigint NOT NULL CHECK (tick >= 0),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    FOREIGN KEY (world_id,run_id,revision)
        REFERENCES xenora_private.science_revisions (world_id,run_id,revision)
);
CREATE INDEX IF NOT EXISTS science_obs_revision_idx
    ON xenora_private.science_observations(world_id,run_id,category,revision,id);
CREATE INDEX IF NOT EXISTS science_obs_object_idx
    ON xenora_private.science_observations(world_id,run_id,category,entity_key,tick);

CREATE TABLE IF NOT EXISTS xenora_private.science_requests (
    world_id uuid NOT NULL REFERENCES xenora_private.science_worlds(id),
    request_id uuid NOT NULL,
    body_hash bytea NOT NULL CHECK (octet_length(body_hash)=32),
    receipt jsonb NOT NULL,
    PRIMARY KEY(world_id,request_id)
);

ALTER TABLE xenora_private.science_worlds ENABLE ROW LEVEL SECURITY;
ALTER TABLE xenora_private.science_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE xenora_private.science_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE xenora_private.science_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE xenora_private.science_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON xenora_private.science_worlds, xenora_private.science_runs,
    xenora_private.science_revisions, xenora_private.science_observations,
    xenora_private.science_requests FROM PUBLIC, anon, authenticated, service_role;

-- Typed projections for operators / scientific SQL. Both units and the
-- original source object are retained. A null provenance has scientific meaning.
CREATE OR REPLACE VIEW xenora_private.science_events WITH (security_invoker=true) AS
SELECT world_id,run_id,revision,tick,entity_key AS event_key,payload->>'type' AS event_type,
       payload->'data' AS details FROM xenora_private.science_observations WHERE category='events';

CREATE OR REPLACE VIEW xenora_private.science_samples WITH (security_invoker=true) AS
SELECT world_id,run_id,revision,tick,payload->'data' AS metrics
FROM xenora_private.science_observations WHERE category='samples';

CREATE OR REPLACE VIEW xenora_private.science_quantities WITH (security_invoker=true) AS
SELECT world_id,run_id,revision,tick,entity_key AS symbol,
    (payload->>'primordial')::numeric AS primordial,(payload->>'ejecta')::numeric AS ejecta,
    (payload->>'gas')::numeric AS gas,(payload->>'stellar')::numeric AS stellar,
    (payload->>'mineral')::numeric AS mineral,(payload->>'exported')::numeric AS exported,
    (payload->>'residual')::numeric AS residual,payload AS evidence
FROM xenora_private.science_observations WHERE category='quantities';

CREATE OR REPLACE VIEW xenora_private.science_mineral_origins WITH (security_invoker=true) AS
SELECT world_id,run_id,revision,tick,entity_key AS mineral_key,payload->>'formula' AS formula,
    payload->>'source' AS origin,(payload->>'units')::numeric AS units,
    (payload->>'firstTick')::bigint AS first_tick,(payload->>'lastTick')::bigint AS last_tick,
    payload->'recipe' AS recipe,payload AS evidence
FROM xenora_private.science_observations WHERE category='minerals';

CREATE OR REPLACE VIEW xenora_private.science_genealogy WITH (security_invoker=true) AS
SELECT world_id,run_id,revision,tick,entity_key AS organism_id,payload->>'parentId' AS parent_id,
    payload->>'lineage' AS lineage,(payload->>'generation')::integer AS generation,
    payload->>'sequence' AS sequence,(payload->>'mutationDelta')::numeric AS mutation_delta,
    payload->>'observedIn' AS observed_in,(payload->>'observedAtTick')::bigint AS observed_at_tick
FROM xenora_private.science_observations WHERE category='genealogy';

REVOKE ALL ON xenora_private.science_events, xenora_private.science_samples,
    xenora_private.science_quantities, xenora_private.science_mineral_origins,
    xenora_private.science_genealogy FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION xenora_private.science_tick(v jsonb)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE t numeric;
BEGIN
    IF jsonb_typeof(v) IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Expected a nonnegative integer tick' USING ERRCODE='PT400';
    END IF;
    t := (v #>> '{}')::numeric;
    IF trunc(t)<>t OR t<0 OR t>9007199254740991 THEN
        RAISE EXCEPTION 'Invalid simulation tick' USING ERRCODE='PT400';
    END IF;
    RETURN t::bigint;
END;
$$;

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

-- Validate aggregates against the persisted atoms and graph. Atomic masses are
-- floating-point model values; sub-micro-unit rounding is permitted.
CREATE OR REPLACE FUNCTION xenora_private.validate_atomic_projection(c jsonb,b jsonb)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE atom_total integer; edge_count integer; sample jsonb; bad boolean;
BEGIN
    IF jsonb_typeof(c->'particles') IS DISTINCT FROM 'array' OR jsonb_typeof(c->'bonds') IS DISTINCT FROM 'array'
       OR b->'genealogy' IS DISTINCT FROM '[]'::jsonb OR b->'minerals' IS DISTINCT FROM '[]'::jsonb
       OR jsonb_typeof(b->'samples') IS DISTINCT FROM 'array' OR jsonb_typeof(b->'quantities') IS DISTINCT FROM 'array'
       OR jsonb_typeof(b->'events') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Missing atomic state or unsupported observations' USING ERRCODE='PT400';
    END IF;
    atom_total:=jsonb_array_length(c->'particles'); edge_count:=jsonb_array_length(c->'bonds');
    sample:=b#>'{samples,0,data}';
    IF jsonb_array_length(b->'samples')<>1 OR b#>'{samples,0,tick}' IS DISTINCT FROM c->'tick'
       OR sample->'atomCount' IS DISTINCT FROM to_jsonb(atom_total) OR sample->'bondCount' IS DISTINCT FROM to_jsonb(edge_count)
       OR sample->'bondedComponents' IS DISTINCT FROM to_jsonb(jsonb_array_length(b->'events'))
       OR jsonb_array_length(b->'quantities')<>6 OR jsonb_array_length(b->'events')>atom_total/2 THEN
        RAISE EXCEPTION 'Atomic observation counts do not match checkpoint' USING ERRCODE='PT400';
    END IF;
    IF EXISTS (SELECT FROM jsonb_array_elements(c->'particles') a
        WHERE coalesce(a->>'element','') NOT IN ('H','C','N','O','P','S')
           OR jsonb_typeof(a->'massU') IS DISTINCT FROM 'number' OR (a->>'massU')::numeric<=0)
    THEN RAISE EXCEPTION 'Invalid atomic material' USING ERRCODE='PT400'; END IF;

    WITH expected AS (
        SELECT e.symbol,count(a) AS n,coalesce(sum((a->>'massU')::numeric),0) AS mass
        FROM (VALUES ('H'),('C'),('N'),('O'),('P'),('S')) e(symbol)
        LEFT JOIN jsonb_array_elements(c->'particles') a ON a->>'element'=e.symbol GROUP BY e.symbol
    ), reported AS (SELECT q->>'symbol' symbol,q FROM jsonb_array_elements(b->'quantities') q)
    SELECT EXISTS(SELECT FROM expected e FULL JOIN reported r USING(symbol)
        WHERE e.symbol IS NULL OR r.q IS NULL OR r.q->'count' IS DISTINCT FROM to_jsonb(e.n)
           OR jsonb_typeof(r.q->'massU') IS DISTINCT FROM 'number'
           OR abs((r.q->>'massU')::numeric-e.mass)>0.000000001*greatest(1,e.mass)) INTO bad;
    IF bad THEN RAISE EXCEPTION 'Atomic inventory does not match checkpoint' USING ERRCODE='PT400'; END IF;

    -- Start from each reported molecule and traverse the actual bonds. The
    -- member ids must match that entire connected component; every bonded
    -- atom must be covered exactly once. Unbonded atoms belong to the stock.
    WITH RECURSIVE atoms AS (
        SELECT (a->>'id')::integer id,a->>'element' symbol,(a->>'massU')::numeric mass FROM jsonb_array_elements(c->'particles') a
    ), edges AS (
        SELECT (v->>'a')::integer a,(v->>'b')::integer b FROM jsonb_array_elements(c->'bonds') v
    ), connected AS (SELECT e.a,e.b FROM edges e UNION ALL SELECT e.b,e.a FROM edges e),
    reported AS (
        SELECT (r#>>'{data,members,0}')::integer root,r FROM jsonb_array_elements(b->'events') r
    ), reach(root,id) AS (
        SELECT root,root FROM reported UNION SELECT w.root,e.b FROM reach w JOIN connected e ON e.a=w.id
    ), groups AS (
        SELECT w.root,array_agg(a.id ORDER BY a.id) members,sum(a.mass) mass
        FROM reach w JOIN atoms a ON a.id=w.id GROUP BY w.root
    ), element_counts AS (
        SELECT w.root,a.symbol,count(*) n FROM reach w JOIN atoms a ON a.id=w.id GROUP BY w.root,a.symbol
    ), labeled AS (
        SELECT *,bool_or(symbol='C') OVER(PARTITION BY root) has_carbon FROM element_counts
    ), formulae AS (
        SELECT root,string_agg(symbol||CASE WHEN n=1 THEN '' ELSE n::text END,''
            ORDER BY CASE WHEN has_carbon AND symbol='C' THEN 0 WHEN has_carbon AND symbol='H' THEN 1 ELSE 2 END,symbol COLLATE "C") formula
        FROM labeled GROUP BY root
    ), totals AS (
        SELECT w.root,count(*) n FROM reach w JOIN edges e ON e.a=w.id GROUP BY w.root
    )
    SELECT EXISTS(SELECT FROM reported p LEFT JOIN groups g USING(root) LEFT JOIN formulae f USING(root) LEFT JOIN totals t USING(root)
        WHERE g.root IS NULL OR t.n IS NULL OR cardinality(g.members)<2 OR g.members[1]<>p.root
           OR p.r->>'type' IS DISTINCT FROM 'component-observed' OR p.r->>'key' IS DISTINCT FROM 'component-'||p.root::text
           OR p.r->'tick' IS DISTINCT FROM c->'tick' OR p.r#>'{data,members}' IS DISTINCT FROM to_jsonb(g.members)
           OR p.r#>>'{data,formula}' IS DISTINCT FROM f.formula OR p.r#>'{data,bondCount}' IS DISTINCT FROM to_jsonb(t.n)
           OR jsonb_typeof(p.r#>'{data,massU}') IS DISTINCT FROM 'number'
           OR abs((p.r#>>'{data,massU}')::numeric-g.mass)>0.000000001*greatest(1,g.mass))
        OR (SELECT count(*) FROM reach)<>(SELECT count(DISTINCT a) FROM connected)
        OR (SELECT count(*) FROM reported)<>(SELECT count(DISTINCT root) FROM reported)
        INTO bad;
    IF bad THEN RAISE EXCEPTION 'Observed molecule does not match atomic bonds' USING ERRCODE='PT400'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION xenora_private.validate_atomic_projection(jsonb,jsonb) FROM PUBLIC;

-- A chemistry window is a bounded, checkpoint-reported journal. Structural
-- identities describe only the saved graph; they are not an independent replay.
CREATE OR REPLACE FUNCTION xenora_private.atomic_bench_coverage(c jsonb,b jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE journal jsonb:=c->'reactionBench'; sample jsonb:=b#>'{samples,0,data}';
    win jsonb:=sample->'reactionWindow'; census jsonb:=sample->'speciesCensus';
    first_tick bigint; last_tick bigint; retained integer; edits bigint; exact_count integer;
BEGIN
    IF journal IS NULL THEN
        IF win IS NOT NULL OR census IS NOT NULL THEN
            RAISE EXCEPTION 'Unsupported historical bench claim' USING ERRCODE='PT400';
        END IF;
        RETURN '{}'::jsonb;
    END IF;
    IF jsonb_typeof(journal) IS DISTINCT FROM 'object' OR journal->'version' IS DISTINCT FROM '1'::jsonb
       OR jsonb_typeof(journal->'frames') IS DISTINCT FROM 'array'
       OR jsonb_typeof(win) IS DISTINCT FROM 'object' OR jsonb_typeof(census->'identified') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Invalid reaction bench projection' USING ERRCODE='PT400';
    END IF;
    first_tick:=xenora_private.science_tick(journal->'startTick');
    last_tick:=xenora_private.science_tick(journal->'tick');
    retained:=jsonb_array_length(journal->'frames');
    SELECT coalesce(sum(jsonb_array_length(f->'changes')),0) INTO edits FROM jsonb_array_elements(journal->'frames') f;
    IF last_tick<first_tick OR last_tick-first_tick>128 OR retained>last_tick-first_tick OR edits>2048
       OR journal->'tick' IS DISTINCT FROM c->'tick'
       OR win->'startTick' IS DISTINCT FROM journal->'startTick' OR win->'endTick' IS DISTINCT FROM journal->'tick'
       OR win->'comparedSteps' IS DISTINCT FROM to_jsonb(last_tick-first_tick)
       OR win->'changedSteps' IS DISTINCT FROM to_jsonb(retained) OR win->'bondEdits' IS DISTINCT FROM to_jsonb(edits)
       OR win->>'basis' IS DISTINCT FROM 'checkpoint-bond-edits'
       OR census->>'scope' IS DISTINCT FROM 'current-graph-including-free-atoms'
       OR sample->'integrationSubsteps' IS DISTINCT FROM coalesce(c->'integrationSubsteps','4'::jsonb) THEN
        RAISE EXCEPTION 'Reaction coverage differs from saved window' USING ERRCODE='PT400';
    END IF;
    exact_count:=jsonb_array_length(census->'identified');
    IF jsonb_typeof(win->'fromFs') IS DISTINCT FROM 'number' OR jsonb_typeof(win->'toFs') IS DISTINCT FROM 'number'
       OR abs((win->>'fromFs')::numeric - first_tick*4.8)>1e-12*greatest(1,first_tick)
       OR abs((win->>'toFs')::numeric - last_tick*4.8)>1e-12*greatest(1,last_tick)
       OR EXISTS(SELECT FROM jsonb_array_elements(census->'identified') s
              WHERE jsonb_typeof(s->'key') IS DISTINCT FROM 'string' OR length(s->>'key')=0
                OR jsonb_typeof(s->'formula') IS DISTINCT FROM 'string' OR length(s->>'formula')=0
                OR xenora_private.science_tick(s->'count')<1)
       OR exact_count<>(SELECT count(DISTINCT s->>'key') FROM jsonb_array_elements(census->'identified') s)
       OR xenora_private.science_tick(census->'unresolvedComponents')+
          (SELECT coalesce(sum((s->>'count')::bigint),0) FROM jsonb_array_elements(census->'identified') s)
          <>jsonb_array_length(c->'particles')+jsonb_array_length(b->'events')-
          (SELECT coalesce(sum(jsonb_array_length(e#>'{data,members}')),0) FROM jsonb_array_elements(b->'events') e)
       OR EXISTS(SELECT FROM jsonb_array_elements(b->'events') e
              WHERE NOT (e->'data' ? 'speciesIndex') OR (e#>'{data,speciesIndex}'<>'null'::jsonb AND
                   (xenora_private.science_tick(e#>'{data,speciesIndex}')>=exact_count
                    OR (census->'identified'->(e#>>'{data,speciesIndex}')::integer->'formula') IS DISTINCT FROM e#>'{data,formula}'))) THEN
        RAISE EXCEPTION 'Invalid current species census' USING ERRCODE='PT400';
    END IF;
    RETURN jsonb_build_object('reactionWindow',win,'speciesBasis','current graph including free atoms');
END;
$$;
REVOKE ALL ON FUNCTION xenora_private.atomic_bench_coverage(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.xenora_gateway_write_science(
    p_world uuid,p_hash text,p_request uuid,p_action text,p_body jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
    w xenora_private.science_worlds%ROWTYPE; r xenora_private.science_runs%ROWTYPE;
    src xenora_private.science_revisions%ROWTYPE; prev xenora_private.science_requests%ROWTYPE;
    added boolean:=false; sig bytea; rid uuid; pid uuid; rev integer; src_rev integer;
    checked jsonb; cov jsonb; result jsonb; t bigint; preceding_tick bigint; prior_seed jsonb; prior_substeps jsonb;
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
        SELECT tick,checkpoint->'seed',coalesce(checkpoint->'integrationSubsteps','4'::jsonb)
            INTO preceding_tick,prior_seed,prior_substeps FROM xenora_private.science_revisions
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
       OR NOT ((checked->'version' IS NOT DISTINCT FROM '1'::jsonb AND r.engine_version='particle-world-v1')
               OR (checked->'version' IS NOT DISTINCT FROM '2'::jsonb AND r.engine_version='particle-world-v2'))
       OR jsonb_typeof(checked->'seed') IS DISTINCT FROM 'number'
       OR jsonb_typeof(checked->'particles') IS DISTINCT FROM 'array'
       OR jsonb_typeof(checked->'bonds') IS DISTINCT FROM 'array') THEN
        RAISE EXCEPTION 'Invalid particle-world v1 checkpoint' USING ERRCODE='PT400';
    END IF;
    IF r.engine_version='particle-world-v1' AND r.mode='particle-world' AND p_action<>'fork' AND (
       p_body->'genealogy' IS DISTINCT FROM '[]'::jsonb OR p_body->'minerals' IS DISTINCT FROM '[]'::jsonb
       OR p_body->'events' IS DISTINCT FROM '[]'::jsonb
       OR jsonb_typeof(p_body->'samples') IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_body->'quantities') IS DISTINCT FROM 'array') THEN
        RAISE EXCEPTION 'Missing particle-world measurements or unsupported projection' USING ERRCODE='PT400';
    END IF;
    IF r.engine_version='particle-world-v1' AND r.mode='particle-world' AND p_action<>'fork' THEN
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
    IF r.mode='particle-world' AND r.engine_version='particle-world-v2' AND p_action<>'fork' THEN
        IF coalesce(checked->'integrationSubsteps','4'::jsonb) NOT IN ('4'::jsonb,'8'::jsonb) THEN
            RAISE EXCEPTION 'Invalid atomic integration step' USING ERRCODE='PT400';
        END IF;
        IF p_action='append' AND coalesce(checked->'integrationSubsteps','4'::jsonb) IS DISTINCT FROM prior_substeps THEN
            RAISE EXCEPTION 'Integration step changed within run' USING ERRCODE='PT409';
        END IF;
        PERFORM xenora_private.validate_atomic_projection(checked,p_body);
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
        IF r.mode='particle-world' AND r.engine_version='particle-world-v2' THEN
            cov:=cov||jsonb_build_object('genealogyBasis','not projected in atomic version 2',
                'sampleBasis','validated checkpoint tick','eventBasis','connected molecules observed at checkpoint tick');
            cov:=cov||xenora_private.atomic_bench_coverage(checked,p_body);
        ELSIF r.mode='particle-world' THEN
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

CREATE OR REPLACE FUNCTION public.xenora_gateway_read_science(p_world uuid,p_hash text,p_query jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
    w xenora_private.science_worlds%ROWTYPE; r xenora_private.science_runs%ROWTYPE;
    revrow xenora_private.science_revisions%ROWTYPE; res jsonb; items jsonb; curs bigint;
    kind text; lim integer; prior bigint; with_history boolean;
BEGIN
    PERFORM xenora_private.require_gateway();
    IF p_world IS NULL OR p_hash IS NULL OR p_hash !~ '^[0-9A-Fa-f]{64}$' THEN
        RAISE EXCEPTION 'World unavailable' USING ERRCODE='PT404';
    END IF;
    SELECT * INTO w FROM xenora_private.science_worlds WHERE id=p_world AND capability_hash=decode(p_hash,'hex');
    IF NOT FOUND THEN RAISE EXCEPTION 'World unavailable' USING ERRCODE='PT404'; END IF;
    IF jsonb_typeof(p_query) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid query' USING ERRCODE='PT400'; END IF;
    kind:=COALESCE(p_query->>'view','world'); prior:=COALESCE((p_query->>'after')::bigint,0);
    lim:=COALESCE((p_query->>'limit')::integer,100); with_history:=COALESCE((p_query->>'history')::boolean,false);
    IF lim NOT BETWEEN 1 AND 500 OR prior<0 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='PT400'; END IF;
    IF kind='world' THEN
        SELECT COALESCE(jsonb_agg(page.data ORDER BY page.cursor),'[]'),max(page.cursor) INTO items,curs FROM (
            SELECT u.list_id AS cursor,jsonb_build_object('worldId',p_world,'runId',u.id,'mode',u.mode,
                'engineVersion',u.engine_version,'label',u.label,'revision',u.head,'tick',v.tick,
                'parentRunId',u.parent_run_id,'parentRevision',u.parent_revision,'createdAt',u.created_at) AS data
            FROM xenora_private.science_runs u JOIN xenora_private.science_revisions v
              ON (v.world_id,v.run_id,v.revision)=(u.world_id,u.id,u.head)
            WHERE u.world_id=p_world AND u.list_id>prior ORDER BY u.list_id LIMIT lim
        ) page;
        RETURN jsonb_build_object('worldId',p_world,'label',w.label,'createdAt',w.created_at,'runs',items,
            'nextAfter',CASE WHEN jsonb_array_length(items)=lim THEN curs END);
    END IF;
    IF kind NOT IN ('revisions','checkpoint','events','samples','minerals','quantities','genealogy') THEN
        RAISE EXCEPTION 'Unknown view' USING ERRCODE='PT400';
    END IF;
    SELECT * INTO r FROM xenora_private.science_runs WHERE world_id=p_world AND id=(p_query->>'runId')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Run unavailable' USING ERRCODE='PT404'; END IF;
    SELECT * INTO revrow FROM xenora_private.science_revisions WHERE world_id=p_world AND run_id=r.id
        AND revision=COALESCE((p_query->>'revision')::integer,r.head);
    IF NOT FOUND THEN RAISE EXCEPTION 'Revision unavailable' USING ERRCODE='PT404'; END IF;
    res:=jsonb_build_object('worldId',p_world,'runId',r.id,'mode',r.mode,'engineVersion',r.engine_version,
        'label',r.label,'parentRunId',r.parent_run_id,'parentRevision',r.parent_revision,
        'revision',revrow.revision,'tick',revrow.tick,'coverage',revrow.coverage);
    IF kind='checkpoint' THEN RETURN res||jsonb_build_object('checkpoint',revrow.checkpoint); END IF;
    IF kind='revisions' THEN
        SELECT COALESCE(jsonb_agg(p.data ORDER BY p.cursor),'[]'),max(p.cursor) INTO items,curs FROM (
            SELECT v.revision AS cursor,jsonb_build_object('worldId',p_world,'runId',r.id,'mode',r.mode,
                'engineVersion',r.engine_version,'revision',v.revision,'tick',v.tick,'createdAt',v.created_at,
                'coverage',v.coverage) AS data
            FROM xenora_private.science_revisions v WHERE v.world_id=p_world AND v.run_id=r.id
              AND v.revision>prior AND v.revision<=revrow.revision ORDER BY v.revision LIMIT lim
        ) p;
    ELSE
        SELECT COALESCE(jsonb_agg(p.data ORDER BY p.cursor),'[]'),max(p.cursor) INTO items,curs FROM (
            SELECT o.id AS cursor,o.payload||jsonb_build_object('observedRevision',o.revision,'observationId',o.id) AS data
            FROM xenora_private.science_observations o WHERE o.world_id=p_world AND o.run_id=r.id
              AND o.category=kind AND o.id>prior AND (o.revision=revrow.revision OR (with_history AND o.revision<revrow.revision))
              -- Rolling in-memory windows overlap. Report the first saved copy
              -- of identical evidence, retaining changed samples at the same tick.
              AND (NOT with_history OR kind NOT IN ('events','samples') OR NOT EXISTS (
                  SELECT FROM xenora_private.science_observations older
                  WHERE (older.world_id,older.run_id,older.category,older.entity_key)=
                        (o.world_id,o.run_id,o.category,o.entity_key)
                    AND older.revision<o.revision AND older.payload=o.payload
              ))
            ORDER BY o.id LIMIT lim
        ) p;
    END IF;
    RETURN res||jsonb_build_object(kind,items,'nextAfter',CASE WHEN jsonb_array_length(items)=lim THEN curs END);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Invalid identifier or numeric value' USING ERRCODE='PT400';
END;
$$;

REVOKE ALL ON FUNCTION xenora_private.science_tick(jsonb),
    xenora_private.science_project(uuid,uuid,integer,text,bigint,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.xenora_gateway_write_science(uuid,text,uuid,text,jsonb),
    public.xenora_gateway_read_science(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.xenora_gateway_write_science(uuid,text,uuid,text,jsonb),
    public.xenora_gateway_read_science(uuid,text,jsonb) TO anon;
NOTIFY pgrst,'reload schema';
COMMIT;

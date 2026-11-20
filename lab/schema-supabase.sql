BEGIN;

CREATE SCHEMA IF NOT EXISTS xenora_private;
REVOKE ALL ON SCHEMA xenora_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS xenora_private.checkpoints (
    id uuid PRIMARY KEY,
    token_hash bytea NOT NULL CHECK (octet_length(token_hash) = 32),
    checkpoint json NOT NULL CHECK (json_typeof(checkpoint) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE xenora_private.checkpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE xenora_private.checkpoints FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.xenora_create_checkpoint(
    p_id uuid, p_hash text, p_checkpoint json
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
    INSERT INTO xenora_private.checkpoints (id, token_hash, checkpoint)
    VALUES (p_id, pg_catalog.decode(p_hash, 'hex'), p_checkpoint);
$$;

CREATE OR REPLACE FUNCTION public.xenora_read_checkpoint(
    p_id uuid, p_hash text
) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
    SELECT checkpoint FROM xenora_private.checkpoints
    WHERE id = p_id AND token_hash = pg_catalog.decode(p_hash, 'hex');
$$;

REVOKE ALL ON FUNCTION public.xenora_create_checkpoint(uuid, text, json)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.xenora_read_checkpoint(uuid, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xenora_create_checkpoint(uuid, text, json) TO service_role;
GRANT EXECUTE ON FUNCTION public.xenora_read_checkpoint(uuid, text) TO service_role;

-- The operator installs only the SHA-256 digest of the server's gateway credential.
CREATE TABLE IF NOT EXISTS xenora_private.gateway_secret (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    token_hash bytea NOT NULL CHECK (octet_length(token_hash) = 32)
);
ALTER TABLE xenora_private.gateway_secret ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE xenora_private.gateway_secret FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION xenora_private.require_gateway()
RETURNS void
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
    token text := NULLIF(pg_catalog.current_setting('request.headers', true), '')::json ->> 'x-xenora-gateway';
BEGIN
    IF token IS NULL OR token !~ '^[0-9a-f]{64}$' OR NOT EXISTS (
        SELECT 1 FROM xenora_private.gateway_secret
        WHERE singleton AND token_hash = pg_catalog.sha256(pg_catalog.convert_to(token, 'UTF8'))
    ) THEN
        RAISE EXCEPTION 'Gateway credential required' USING ERRCODE = '42501';
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION xenora_private.require_gateway() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.xenora_gateway_create_checkpoint(
    p_id uuid, p_hash text, p_checkpoint json
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    PERFORM xenora_private.require_gateway();
    PERFORM public.xenora_create_checkpoint(p_id, p_hash, p_checkpoint);
END;
$$;

CREATE OR REPLACE FUNCTION public.xenora_gateway_read_checkpoint(
    p_id uuid, p_hash text
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    PERFORM xenora_private.require_gateway();
    RETURN public.xenora_read_checkpoint(p_id, p_hash);
END;
$$;

REVOKE ALL ON FUNCTION public.xenora_gateway_create_checkpoint(uuid, text, json)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.xenora_gateway_read_checkpoint(uuid, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xenora_gateway_create_checkpoint(uuid, text, json) TO anon;
GRANT EXECUTE ON FUNCTION public.xenora_gateway_read_checkpoint(uuid, text) TO anon;

NOTIFY pgrst, 'reload schema';
COMMIT;

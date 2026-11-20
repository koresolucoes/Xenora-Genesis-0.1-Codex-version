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

NOTIFY pgrst, 'reload schema';
COMMIT;

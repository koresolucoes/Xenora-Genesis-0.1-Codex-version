CREATE TABLE IF NOT EXISTS xenora_checkpoints (
    id uuid PRIMARY KEY,
    token_hash bytea NOT NULL CHECK (octet_length(token_hash) = 32),
    checkpoint json NOT NULL CHECK (json_typeof(checkpoint) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now()
);

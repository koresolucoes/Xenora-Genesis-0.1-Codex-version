import { neon } from "@neondatabase/serverless";

const MAX_BYTES = 4 * 1024 * 1024;
const checkpointRoute = /^\/api\/checkpoints\/([\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12})$/i;
const encoder = new TextEncoder();

function json(value, status = 200, headers = {}) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", ...headers }
  });
}

function methodNotAllowed(method) {
  return json({ error: "Método indisponível." }, 405, { Allow: method });
}

function hex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return hex(new Uint8Array(digest));
}

async function readCheckpoint(request) {
  const contentType = request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw json({ error: "Envie o checkpoint como application/json." }, 415);
  }

  const tooLarge = () => json({ error: "O checkpoint excede 4 MiB." }, 413);
  if (Number(request.headers.get("Content-Length")) > MAX_BYTES) throw tooLarge();
  if (!request.body) throw json({ error: "Checkpoint ausente." }, 400);

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let body = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        throw tooLarge();
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    const checkpoint = JSON.parse(body)?.checkpoint;
    if (checkpoint === null || typeof checkpoint !== "object" || Array.isArray(checkpoint)) {
      throw json({ error: "Esperado um objeto no campo checkpoint." }, 400);
    }
    return JSON.stringify(checkpoint);
  } catch (error) {
    if (error instanceof Response) throw error;
    throw json({ error: "JSON inválido." }, 400);
  } finally {
    reader.releaseLock();
  }
}

function storageProvider(env) {
  if (env.SUPABASE_URL || env.SUPABASE_SERVICE_ROLE_KEY) {
    return env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : null;
  }
  return env.DATABASE_URL ? "neon" : null;
}

async function supabaseRpc(env, name, params) {
  const url = new URL("/rest/v1/rpc/" + name, env.SUPABASE_URL);
  if (url.protocol !== "https:") throw new Error("Supabase requer HTTPS");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = "Bearer " + key;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
    redirect: "error"
  });
  if (!response.ok) throw new Error("Supabase indisponível");
  return response;
}

async function saveCheckpoint(env, provider, id, digest, checkpoint) {
  if (provider === "supabase") {
    await supabaseRpc(env, "xenora_create_checkpoint", {
      p_id: id, p_hash: digest, p_checkpoint: JSON.parse(checkpoint)
    });
    return;
  }
  const sql = neon(env.DATABASE_URL);
  await sql`
    INSERT INTO xenora_checkpoints (id, token_hash, checkpoint)
    VALUES (${id}::uuid, decode(${digest}, 'hex'), ${checkpoint}::json)
  `;
}

async function loadCheckpoint(env, provider, id, digest) {
  if (provider === "supabase") {
    const response = await supabaseRpc(env, "xenora_read_checkpoint", { p_id: id, p_hash: digest });
    return response.status === 204 ? null : response.json();
  }
  const sql = neon(env.DATABASE_URL);
  const rows = await sql`
    SELECT checkpoint FROM xenora_checkpoints
    WHERE id = ${id}::uuid AND token_hash = decode(${digest}, 'hex')
  `;
  return rows[0]?.checkpoint;
}

async function serveApi(request, env, path) {
  const provider = storageProvider(env);
  if (path === "/api/health") {
    return request.method === "GET"
      ? json({ storage: Boolean(provider) })
      : methodNotAllowed("GET");
  }

  const isCollection = path === "/api/checkpoints";
  const item = checkpointRoute.exec(path);
  const missing = () => json({ error: "Checkpoint ou rota indisponível." }, 404);
  if (!isCollection && !item) return missing();

  const method = isCollection ? "POST" : "GET";
  if (request.method !== method) return methodNotAllowed(method);
  if (!provider) return json({ error: "Armazenamento remoto indisponível." }, 503);

  if (isCollection) {
    const checkpoint = await readCheckpoint(request);
    const id = crypto.randomUUID();
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    const digest = await hashToken(token);
    await saveCheckpoint(env, provider, id, digest, checkpoint);
    return json({ id, token }, 201);
  }

  const authorization = /^Bearer ([\da-f]{64})$/i.exec(request.headers.get("Authorization") || "");
  if (!authorization) return missing();
  const digest = await hashToken(authorization[1]);
  const checkpoint = await loadCheckpoint(env, provider, item[1], digest);
  return checkpoint ? json({ checkpoint }) : missing();
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path !== "/api" && !path.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await serveApi(request, env, path);
    } catch (error) {
      if (error instanceof Response) return error;
      console.error(JSON.stringify({ event: "checkpoint_storage_unavailable" }));
      return json({ error: "Armazenamento remoto indisponível." }, 503);
    }
  }
};

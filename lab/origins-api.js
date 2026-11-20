import { projectSnapshot } from "./origins-projection.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = value => typeof value === "string" && uuidPattern.test(value);
const pages = new Set(["revisions", "events", "samples", "minerals", "quantities", "genealogy"]);
const modes = new Set(["primordial", "lagoon-molecular", "evolving-world", "particle-world"]);

function matchesShape(object, allowed) {
  return object && typeof object === "object" && !Array.isArray(object)
    && Object.keys(object).every(field => allowed.includes(field));
}

function validRevision(n) {
  return Number.isSafeInteger(n) && n > 0 && n < 2147483647;
}

function validLabel(value) {
  return value === undefined || (typeof value === "string" && value.length <= 100 && !/[\u0000-\u001f\u007f]/.test(value));
}

function routeParts(path) {
  if (path === "/api/worlds") return { action: "create", method: "POST" };
  const [worldId, runs, runId, segment, rev, ...rest] = path.slice("/api/worlds/".length).split("/");
  if (!isId(worldId) || rest.length) return null;
  if (runs === undefined) return {action: "world", worldId, method: "GET"};
  if (runs !== "runs" || !isId(runId)) return null;
  if (segment === "revisions" && rev !== undefined && /^[1-9]\d*$/.test(rev) && validRevision(Number(rev))) {
    return {action:"checkpoint", worldId, runId, revision:Number(rev), method:"GET"};
  }
  if (rev !== undefined) return null;
  if (segment === "fork") return {action:"fork", worldId, runId, method:"POST"};
  if (pages.has(segment)) return {action:segment, worldId, runId, method:segment === "revisions" ? "GET, POST" : "GET"};
  return null;
}

function indexValue(query, key, defaultValue, min, max) {
  if (!query.has(key)) return defaultValue;
  const raw = query.get(key);
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

export async function serveScience(request, path, api) {
  const {json, configured, readJson, hashToken, rpc} = api;
  const notFound = () => json({error:"Mundo, execução ou revisão indisponível."}, 404);
  const invalid = () => json({error:"Parâmetros de mundo inválidos."}, 400);
  const wrongMethod = allowed => json({error:"Método indisponível."}, 405, { Allow: allowed });
  if (path === "/api/worlds/health") {
    return request.method === "GET" ? json({science: configured}) : wrongMethod("GET");
  }
  const route = routeParts(path);
  if (!route) return notFound();
  if (!route.method.split(", ").includes(request.method)) return wrongMethod(route.method);
  if (!configured) return json({error:"Arquivo de mundos indisponível."}, 503);
  const auth = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("Authorization") || "");
  if (!auth) return notFound();
  const p_hash = await hashToken(auth[1]);
  if (request.method === "GET") {
    const query = new URL(request.url).searchParams;
    const p_query = {view:route.action};
    if (route.runId) p_query.runId = route.runId;
    if (route.revision) p_query.revision = route.revision;
    if (route.action === "world" || pages.has(route.action)) {
      const after = indexValue(query, "after", 0, 0, Number.MAX_SAFE_INTEGER);
      const limit = indexValue(query, "limit", 50, 1, 100);
      if (after === null || limit === null) return invalid();
      Object.assign(p_query, {after, limit});
    }
    if (pages.has(route.action) && route.action !== "revisions") {
      if (query.has("revision")) {
        p_query.revision = indexValue(query, "revision", null, 1, 2147483646);
        if (p_query.revision === null) return invalid();
      }
      if (query.has("history")) {
        if (!["true", "false"].includes(query.get("history"))) return invalid();
        p_query.history = query.get("history") === "true";
      }
    }
    const result = await rpc("read_science", {p_world:route.worldId, p_hash, p_query});
    return result === null ? notFound() : json(result);
  }

  const p_request = request.headers.get("Idempotency-Key");
  if (!isId(p_request || "")) return json({error:"A gravação requer Idempotency-Key no formato UUID v4."}, 400);
  const body = await readJson(request);
  const action = route.action === "revisions" ? "append" : route.action;
  let worldId = route.worldId;
  let p_body;
  if (action === "fork") {
    if (!matchesShape(body, ["newRunId", "revision", "label"]) || !isId(body.newRunId)
        || body.newRunId.toLowerCase() === route.runId.toLowerCase() || !validRevision(body.revision)
        || !validLabel(body.label)) return invalid();
    p_body = {run:{id:body.newRunId,label:body.label}, parentRunId:route.runId, parentRevision:body.revision};
  } else {
    const fields = action === "create" ? ["mode","checkpoint","worldId","runId","label"]
      : ["mode","checkpoint","expectedRevision"];
    if (!matchesShape(body, fields) || !modes.has(body.mode) || !validLabel(body.label)) return invalid();
    if (action === "create") {
      if (!isId(body.worldId) || !isId(body.runId)) return invalid();
      worldId = body.worldId;
    } else if (!validRevision(body.expectedRevision)) return invalid();
    let data;
    try {
      data = projectSnapshot(body.mode, body.checkpoint);
    } catch {
      return json({error:"O checkpoint é inválido ou incompatível com o modo escolhido."}, 422);
    }
    const {engineVersion, ...projected} = data;
    p_body = action === "create"
      ? {label:body.label, run:{id:body.runId,mode:body.mode,engineVersion,label:body.label}, ...projected}
      : {runId:route.runId, expectedRevision:body.expectedRevision, mode:body.mode, engineVersion, ...projected};
  }
  const result = await rpc("write_science", {p_world:worldId, p_hash, p_request, p_action:action, p_body});
  return result === null ? notFound() : json(result, 201);
}

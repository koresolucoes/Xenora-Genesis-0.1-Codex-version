const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function recoveryKey(worldId, token) {
  return worldId + '.' + token;
}

export function readKey(value) {
  const parts = value.trim().split('.');
  if (parts.length !== 2 || !UUID.test(parts[0]) || !/^[0-9a-f]{64}$/.test(parts[1])) {
    throw new Error('Use a chave do mundo, com identificador e código de recuperação.');
  }
  return {worldId: parts[0], token: parts[1]};
}

function uuid(value) {
  if (!UUID.test(value)) throw new Error('Identificador de mundo ou ramo inválido.');
  return value;
}

function revisionNumber(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Revisão inválida.');
  return value;
}

function runPath(worldId, runId) {
  return '/api/worlds/' + uuid(worldId) + '/runs/' + uuid(runId);
}

async function api(path, token, method = 'GET', body, requestId) {
  const headers = {Accept: 'application/json', Authorization: 'Bearer ' + token};
  if (body) headers['Content-Type'] = 'application/json';
  if (requestId) headers['Idempotency-Key'] = uuid(requestId);
  const options = {method, headers, cache: 'no-store', redirect: 'error'};
  if (body) options.body = JSON.stringify(body);
  const response = await fetch(path, options);
  let data;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok || !data || typeof data !== 'object') {
    const fallback = {404:'Mundo ou revisão indisponível. Confira a chave.',409:'Este ramo já avançou. Abra a revisão mais recente ou bifurque a revisão que você tem.',422:'Estado do mundo incompatível.',503:'O arquivo científico está temporariamente indisponível.'};
    const error = new Error(fallback[response.status] || 'O servidor não confirmou a operação.');
    error.status = response.status;
    throw error;
  }
  return data;
}

export function listRuns({worldId,token},after=0) {
  if (!Number.isSafeInteger(after) || after<0) throw new Error('Cursor inválido.');
  return api('/api/worlds/' + uuid(worldId) + '?after=' + after + '&limit=50', token);
}
export function listRevisions({worldId,token},runId,after=0) {
  if (!Number.isSafeInteger(after) || after < 0) throw new Error('Cursor inválido.');
  return api(runPath(worldId,runId) + '/revisions?after=' + after + '&limit=50',token);
}
export function openRevision({worldId,token},runId,revision) {
  return api(runPath(worldId,runId) + '/revisions/' + revisionNumber(revision),token);
}

export function newCapability() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes, byte => byte.toString(16).padStart(2,'0')).join('');
  return {worldId: crypto.randomUUID(), token};
}

export function makeOperation(action, key, body, runId) {
  return {action, key, body, runId, requestId:crypto.randomUUID()};
}

export async function writeOperation(op) {
  const key = readKey(recoveryKey(op.key.worldId,op.key.token));
  let path;
  if (op.action === 'create') path = '/api/worlds';
  else if (op.action === 'append') path = runPath(key.worldId,op.runId) + '/revisions';
  else if (op.action === 'fork') path = runPath(key.worldId,op.runId) + '/fork';
  else throw new Error('Operação de arquivo desconhecida.');
  const data = await api(path,key.token,'POST',op.body,op.requestId);
  if (data.worldId !== key.worldId || !UUID.test(data.runId)) throw new Error('Confirmação do arquivo incompatível.');
  revisionNumber(data.revision);
  return data;
}

export function readObservations(key,runId,revision,view,after=0) {
  if (!['events','samples','minerals','quantities','genealogy'].includes(view) ||
      !Number.isSafeInteger(after) || after<0) throw new Error('Consulta inválida.');
  const url=runPath(key.worldId,runId)+'/'+view+'?revision='+revisionNumber(revision)+'&after='+after+'&limit=20';
  return api(url,key.token);
}

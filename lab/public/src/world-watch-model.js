import { EvolvingWorld } from './evolving-world.js';

export const WATCH_LIMIT = 4;
const VERSION = 2;

function nameOf(name, fallback) {
  return String(name || '').trim().slice(0, 56) || fallback;
}

function remoteReference(ref) {
  if (!ref || typeof ref.worldId !== 'string' || typeof ref.runId !== 'string' ||
      !Number.isSafeInteger(ref.revision) || ref.revision < 1) return null;
  // Keep citation information only. Archive bearer credentials stay in the archive.
  return {worldId: ref.worldId, runId: ref.runId, revision: ref.revision,
    tick: Number.isSafeInteger(ref.tick) ? ref.tick : null};
}

function baseline(world) {
  const m = world.getMetrics();
  return {tick: world.tick, population: m.population, livingLineages: m.livingLineages};
}


const kinds = new Set(['map','seed','card','legacy','reference']);
const interventions = new Set(['open','capture','fork','control','light','legacy']);
const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 128;

function relation(source,tick,action,from,to) {
  return {id:source.id,name:source.name,tick,action,...(action==='light' || action==='control' ? {from,to} : {})};
}

function readParent(raw) {
  if (raw == null) return null;
  const action=raw.action ?? 'legacy';
  if (!validId(raw.id) || !Number.isSafeInteger(raw.tick) || raw.tick<0 || !interventions.has(action))
    throw new Error('Origem do ramo local inválida.');
  if (['control','light'].includes(action) && ![raw.from,raw.to].every(n=>Number.isFinite(n)&&n>=0&&n<=2))
    throw new Error('Intervenção de luz inválida.');
  return relation({id:raw.id,name:nameOf(raw.name,'Origem registrada')},raw.tick,action,raw.from,raw.to);
}

function readNode(raw) {
  if (!raw || !validId(raw.id) || !kinds.has(raw.kind)) throw new Error('Identidade de mundo inválida.');
  const node={id:raw.id,name:nameOf(raw.name,'Mundo local'),kind:raw.kind,parent:readParent(raw.parent)};
  if(Number.isInteger(raw.seed) && raw.seed>=0 && raw.seed<=0xffffffff)node.seed=raw.seed;
  if(raw.lightChange)node.lightChange=readLight(raw.lightChange);
  return node;
}

function readLight(change) {
  if(!Number.isSafeInteger(change.tick) || change.tick<0 || ![change.from,change.to].every(n=>Number.isFinite(n)&&n>=0&&n<=2))
    throw new Error('Alteração de luz inválida.');
  return {tick:change.tick,from:change.from,to:change.to};
}

function metadata(entry) {
  const node={id:entry.id,name:entry.name,kind:entry.kind,parent:entry.parent && {...entry.parent}};
  const seed=entry.world?.seed ?? entry.seed;
  if(seed!==undefined)node.seed=seed;
  if(entry.lightChange)node.lightChange={...entry.lightChange};
  return node;
}

export class WorldWatch {
  constructor() {
    this.entries = new Map();
    this.focusId = null;
    this.nodes = new Map();
    this.removed = null;
  }

  ensureRoom(count = 1) {
    if (this.entries.size + count > WATCH_LIMIT) throw new Error('O painel comporta quatro execuções locais. Retire uma para liberar espaço.');
  }

  get(id) {
    const item = this.entries.get(id);
    if (!item) throw new Error('Execução fora do painel.');
    return item;
  }

  node(id) {
    return this.entries.get(id) || this.nodes.get(id);
  }

  // The map and each card evolve independently. Opening a card starts a new
  // map trajectory, even when they still share the same seed and tick.
  bindFocus(world) {
    let node;
    if (world.watchFocus) {
      try { node=readNode(world.watchFocus); } catch { /* Legacy sessions have no provenance. */ }
    }
    if (!node || node.kind!=='map' || node.parent?.tick>world.tick || (node.seed!==undefined && node.seed!==world.seed))
      node={id:crypto.randomUUID(),kind:'map',name:'Mundo do mapa',parent:null};
    node.seed=world.seed;
    world.watchFocus=metadata(node);
    this.nodes.set(node.id,node);
    this.focusId=node.id;
    return node;
  }

  relations() {
    const result=new Map();
    const active=[...this.entries.keys(),this.focusId].filter(Boolean);
    for (const id of active) {
      let node=this.node(id);
      while (node && !result.has(node.id)) {
        result.set(node.id,metadata(node));
        const parent=node.parent;
        node=parent && (this.node(parent.id) || {id:parent.id,name:parent.name,kind:'reference',parent:null});
      }
    }
    return result;
  }

  insert(world, name, parent = null, ref = null, kind='card') {
    this.ensureRoom();
    const id = crypto.randomUUID();
    const entry = {id, name: nameOf(name, 'Mundo ' + world.seed), world,
      base: baseline(world), parent, kind, remote: remoteReference(ref), playing: false};
    this.entries.set(id, entry);
    return entry;
  }

  capture(world, name, ref = null) {
    this.ensureRoom();
    const source=this.bindFocus(world);
    return this.insert(EvolvingWorld.restore(world.serialize()), nameOf(name,'Cópia do mapa'),
      relation(source,world.tick,'capture'),ref);
  }

  create(seed, name) {
    this.ensureRoom();
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('Use uma semente inteira entre 0 e 4294967295.');
    return this.insert(new EvolvingWorld(seed), name,null,null,'seed');
  }

  fork(id, name) {
    this.ensureRoom();
    const source = this.get(id);
    return this.insert(EvolvingWorld.restore(source.world.serialize()), nameOf(name, 'Ramo de ' + source.name),
      relation(source,source.world.tick,'fork'), source.remote);
  }

  pair(world, name, reference = null) {
    this.ensureRoom(2);
    const source=this.bindFocus(world);
    const forcing=world.environment.lightForcing, changed=forcing>=0.4 ? forcing/2 : 1;
    const snapshot=world.serialize();
    const original=this.insert(EvolvingWorld.restore(snapshot),nameOf(name,'Luz de referência'),
      relation(source,world.tick,'control',forcing,forcing),reference);
    const child=this.insert(EvolvingWorld.restore(snapshot),'Luz alterada',
      relation(source,world.tick,'light',forcing,changed),reference);
    child.world.setLightForcing(changed);
    original.playing = true;
    child.playing = true;
    return [original, child];
  }

  open(id) {
    const entry = this.get(id);
    const copy = EvolvingWorld.restore(entry.world.serialize());
    copy.watchFocus={id:crypto.randomUUID(),kind:'map',name:'Mapa de '+entry.name,
      parent:relation(entry,copy.tick,'open')};
    this.bindFocus(copy);
    return copy;
  }

  advance(ids, steps = 1) {
    if (!Number.isSafeInteger(steps) || steps < 0 || steps > 10) throw new Error('Lote de passos inválido.');
    const cards = [...new Set(ids)].map(id => this.get(id));
    for (let i = 0; i < steps; i++) for (const card of cards) card.world.step();
  }

  setLight(id,to) {
    const item=this.get(id),from=item.world.environment.lightForcing;
    item.world.setLightForcing(to);
    if(from!==to)item.lightChange={tick:item.world.tick,from,to};
  }

  remove(id) {
    this.removed = this.get(id);
    this.removed.playing = false;
    this.nodes.set(id,metadata(this.removed));
    this.entries.delete(id);
  }

  undoRemove() {
    if (!this.removed) return null;
    this.ensureRoom();
    const card = this.removed;
    this.entries.set(card.id, card);
    this.removed = null;
    return card;
  }

  checkpoint() {
    const relations=this.relations();
    const origins=[...relations.values()].filter(node=>!this.entries.has(node.id));
    return {version: VERSION, focusId:this.focusId, origins, cards: [...this.entries.values()].map(card => ({
      id: card.id, name: card.name, kind:card.kind, base: {...card.base}, parent: card.parent && {...card.parent},
      ...(card.lightChange ? {lightChange:{...card.lightChange}} : {}),
      remote: remoteReference(card.remote), checkpoint: card.world.serialize()
    }))};
  }

  static restore(saved) {
    const panel = new WorldWatch();
    if (saved == null) return panel;
    if (![1,VERSION].includes(saved.version) || !Array.isArray(saved.cards) || saved.cards.length > WATCH_LIMIT) {
      throw new Error('Formato do painel salvo incompatível.');
    }
    for (const raw of saved.cards) {
      if (!raw || !validId(raw.id) || panel.entries.has(raw.id)) throw new Error('Identidade de execução inválida.');
      const world = EvolvingWorld.restore(raw.checkpoint);
      const base = raw.base;
      if (!base || ![base.tick, base.population, base.livingLineages].every(n => Number.isSafeInteger(n) && n >= 0) || base.tick > world.tick) {
        throw new Error('Ponto inicial do cartão inválido.');
      }
      const parent=readParent(raw.parent);
      if(parent && parent.tick>base.tick)throw new Error('Origem do ramo local inválida.');
      const kind=saved.version===1 ? 'legacy' : raw.kind;
      if(!['legacy','seed','card'].includes(kind))throw new Error('Origem do cartão inválida.');
      const lightChange=raw.lightChange ? readLight(raw.lightChange) : null;
      if(lightChange && (lightChange.tick<base.tick || lightChange.tick>world.tick || lightChange.to!==world.environment.lightForcing))
        throw new Error('Passo ou intensidade da intervenção inválidos.');
      panel.entries.set(raw.id, {id: raw.id, name: nameOf(raw.name, 'Mundo ' + world.seed), world,kind,
        ...(lightChange ? {lightChange} : {}),
        base: {...base}, parent, remote: remoteReference(raw.remote), playing: false});
    }
    if (saved.version===VERSION) {
      if(!Array.isArray(saved.origins))throw new Error('Histórico de origens inválido.');
      for(const row of saved.origins) {
        const node=readNode(row);
        if(panel.node(node.id))throw new Error('Identidade de mundo duplicada.');
        panel.nodes.set(node.id,node);
      }
      if(saved.focusId!=null && panel.node(saved.focusId)?.kind!=='map')throw new Error('Foco do mapa inválido.');
      panel.focusId=saved.focusId ?? null;
    }
    const checked=new Set();
    for (const id of [...panel.entries.keys(),...panel.nodes.keys()]) {
      const path=new Set(); let node=panel.node(id);
      while(node && !checked.has(node.id)) {
        if(path.has(node.id))throw new Error('Ciclo nas relações entre mundos.');
        path.add(node.id); node=node.parent && panel.node(node.parent.id);
      }
      for(const key of path)checked.add(key);
    }
    return panel;
  }
}

const STORAGE_KEY = 'xenora.world-watch.v1';
const TABLE = 'painel';

function indexedDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { resolve(null); return; }
    const req = indexedDB.open(STORAGE_KEY, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(TABLE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Outra aba está atualizando o armazenamento.'));
  });
}

// One atomic record protects parent references, names and all snapshots together.
export async function openWatchStore() {
  let db;
  try { db = await indexedDatabase(); } catch { db = null; }
  let knownWrite = null;
  const conflict = () => new Error('Outra aba salvou este painel. Reabra a página para ver a versão salva.');
  const accept = data => { knownWrite = data?.writeId ?? null; return data; };
  if (!db) {
    const storage = globalThis.localStorage;
    if (!storage) throw new Error('Histórico local indisponível.');
    const read = () => JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
    return {
      async read() { return accept(read()); },
      async write(record) {
        if ((read()?.writeId ?? null) !== knownWrite) throw conflict();
        const envelope = {...record, writeId:crypto.randomUUID()};
        storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
        knownWrite = envelope.writeId;
      },
      close() {}
    };
  }
  return {
    read: () => new Promise((resolve,reject) => {
      const tx = db.transaction(TABLE,'readonly');
      const req = tx.objectStore(TABLE).get('v1');
      tx.oncomplete = () => resolve(accept(req.result ?? null));
      tx.onabort = () => reject(tx.error || new Error('Leitura do painel interrompida.'));
    }),
    write: record => new Promise((resolve,reject) => {
      const tx = db.transaction(TABLE,'readwrite');
      const table = tx.objectStore(TABLE);
      const req = table.get('v1'), writeId = crypto.randomUUID();
      let stale = false;
      req.onsuccess = () => {
        if ((req.result?.writeId ?? null) !== knownWrite) { stale = true; tx.abort(); return; }
        table.put({...record, writeId},'v1');
      };
      tx.oncomplete = () => { knownWrite=writeId; resolve(); };
      tx.onabort = () => reject(stale ? conflict() : tx.error || new Error('A gravação foi interrompida.'));
    }),
    close: () => db.close()
  };
}

import { EvolvingWorld } from './evolving-world.js';

export const WATCH_LIMIT = 4;
const VERSION = 1;

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

export class WorldWatch {
  constructor() {
    this.entries = new Map();
    this.focusId = null;
    this.focusTick = null;
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

  insert(world, name, parent = null, ref = null) {
    this.ensureRoom();
    const id = crypto.randomUUID();
    const entry = {id, name: nameOf(name, 'Mundo ' + world.seed), world,
      base: baseline(world), parent, remote: remoteReference(ref), playing: false};
    this.entries.set(id, entry);
    return entry;
  }

  capture(world, name, ref = null) {
    this.ensureRoom();
    if (this.focusId && this.entries.has(this.focusId)) {
      const source = this.get(this.focusId);
      const parent = {id: source.id, name: source.name, tick: this.focusTick ?? world.tick};
      return this.insert(EvolvingWorld.restore(world.serialize()), nameOf(name, 'Cópia do foco'), parent, ref);
    }
    return this.insert(EvolvingWorld.restore(world.serialize()), nameOf(name, 'Referência do foco'), null, ref);
  }

  create(seed, name) {
    this.ensureRoom();
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('Use uma semente inteira entre 0 e 4294967295.');
    return this.insert(new EvolvingWorld(seed), name);
  }

  fork(id, name) {
    this.ensureRoom();
    const source = this.get(id);
    return this.insert(EvolvingWorld.restore(source.world.serialize()), nameOf(name, 'Ramo de ' + source.name),
      {id, name: source.name, tick: source.world.tick}, source.remote);
  }

  pair(world, name, reference = null) {
    this.ensureRoom(2);
    const original = this.capture(world, nameOf(name, 'Controle'), reference);
    const child = this.fork(original.id, 'Luz alterada');
    const forcing = child.world.environment.lightForcing;
    // Either reduce light or restore it if the focus was already dark.
    const normal = Number.isFinite(forcing) ? forcing : 1;
    child.world.setLightForcing(normal >= 0.4 ? normal / 2 : 1);
    original.playing = true;
    child.playing = true;
    return [original, child];
  }

  open(id) {
    const entry = this.get(id);
    const copy = EvolvingWorld.restore(entry.world.serialize());
    this.focusId = id;
    this.focusTick = copy.tick;
    return copy;
  }

  advance(ids, steps = 1) {
    if (!Number.isSafeInteger(steps) || steps < 0 || steps > 10) throw new Error('Lote de passos inválido.');
    const cards = [...new Set(ids)].map(id => this.get(id));
    for (let i = 0; i < steps; i++) for (const card of cards) card.world.step();
  }

  remove(id) {
    this.removed = this.get(id);
    this.removed.playing = false;
    this.entries.delete(id);
    if (this.focusId === id) { this.focusId = null; this.focusTick = null; }
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
    return {version: VERSION, cards: [...this.entries.values()].map(card => ({
      id: card.id, name: card.name, base: {...card.base}, parent: card.parent && {...card.parent},
      remote: remoteReference(card.remote), checkpoint: card.world.serialize()
    }))};
  }

  static restore(saved) {
    const panel = new WorldWatch();
    if (saved == null) return panel;
    if (saved.version !== VERSION || !Array.isArray(saved.cards) || saved.cards.length > WATCH_LIMIT) {
      throw new Error('Formato do painel salvo incompatível.');
    }
    for (const raw of saved.cards) {
      if (!raw || typeof raw.id !== 'string' || !raw.id || panel.entries.has(raw.id)) throw new Error('Identidade de execução inválida.');
      const world = EvolvingWorld.restore(raw.checkpoint);
      const base = raw.base;
      if (!base || ![base.tick, base.population, base.livingLineages].every(n => Number.isSafeInteger(n) && n >= 0) || base.tick > world.tick) {
        throw new Error('Ponto inicial do cartão inválido.');
      }
      let parent = null;
      if (raw.parent) {
        if (typeof raw.parent.id !== 'string' || !Number.isSafeInteger(raw.parent.tick) || raw.parent.tick < 0 || raw.parent.tick > base.tick) {
          throw new Error('Origem do ramo local inválida.');
        }
        parent = {id: raw.parent.id, name: nameOf(raw.parent.name, 'Ramo'), tick: raw.parent.tick};
      }
      panel.entries.set(raw.id, {id: raw.id, name: nameOf(raw.name, 'Mundo ' + world.seed), world,
        base: {...base}, parent, remote: remoteReference(raw.remote), playing: false});
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

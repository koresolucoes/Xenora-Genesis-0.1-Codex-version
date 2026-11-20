// A tab resumes its own experiment. A new tab can resume the last local experiment.
import { EvolvingWorld } from "./evolving-world.js";

export const EVOLUTION_STEPS_PER_SECOND = 4;
export const MAX_CATCHUP_STEPS = 2400;
const sessionKey = "xenora.evolution.session.v1";
const speeds = new Set([1, 4, 16]);

function browserStorage(name) {
  try { return globalThis[name]; } catch { return null; }
}

function readRecord(storage) {
  try {
    const record = JSON.parse(storage?.getItem(sessionKey) || "null");
    if (record?.version !== 1 || typeof record.running !== "boolean" ||
        !speeds.has(record.speed) || !Number.isSafeInteger(record.savedAt) ||
        record.savedAt < 0 || !Number.isSafeInteger(record.remainingSteps) ||
        record.remainingSteps < 0 || record.remainingSteps > MAX_CATCHUP_STEPS) return null;
    const world=EvolvingWorld.restore(record.world);
    if(record.watchFocus)world.watchFocus=record.watchFocus;
    return {...record, world};
  } catch { return null; }
}

function writeRecord(storage, value) {
  if (!storage) return false;
  try {
    storage.setItem(sessionKey, value);
    return true;
  } catch { return false; }
}

function removeRecord(storage) {
  try { storage?.removeItem(sessionKey); } catch { /* Storage can be disabled. */ }
}

export function openEvolutionSession({
  tab = browserStorage("sessionStorage"),
  local = browserStorage("localStorage"),
  now = Date.now
} = {}) {
  return {
    restore() {
      const record = readRecord(tab) ?? readRecord(local);
      if (!record) return null;
      const elapsedMs = Math.max(0, now() - record.savedAt);
      const due = record.running ? record.remainingSteps +
        Math.floor(elapsedMs * EVOLUTION_STEPS_PER_SECOND * record.speed / 1000) : 0;
      return {
        world: record.world, speed: record.speed, running: record.running,
        elapsedSteps: Math.min(MAX_CATCHUP_STEPS, due), limited: due > MAX_CATCHUP_STEPS
      };
    },
    save(world, running, speed, remainingSteps = 0) {
      if (!speeds.has(speed) || !Number.isSafeInteger(remainingSteps) || remainingSteps < 0) return false;
      const value = JSON.stringify({
        version: 1, savedAt: now(), world: world.serialize(), running: Boolean(running), speed,
        remainingSteps: running ? Math.min(remainingSteps, MAX_CATCHUP_STEPS) : 0,
        watchFocus: world.watchFocus ?? null
      });
      const savedInTab = writeRecord(tab, value);
      const savedLocally = writeRecord(local, value);
      if (savedLocally && !savedInTab) removeRecord(tab);
      return savedInTab || savedLocally;
    },
    clear() {
      removeRecord(tab);
      removeRecord(local);
    }
  };
}

import { World } from "./engine.js";

const STEPS = 150;

export function runPairedTrial(snapshot) {
  const control = World.restore(snapshot);
  const pulse = World.restore(snapshot);
  pulse.addNutrientPulse(0.5, 0.5, 1);
  for (let i = 0; i < STEPS; i++) {
    control.step();
    pulse.step();
  }
  const controlMetrics = control.getMetrics();
  const pulseMetrics = pulse.getMetrics();
  const differences = {};
  for (const key of ["nutrientMass", "bodyMass", "population"]) {
    differences[key] = pulseMetrics[key] - controlMetrics[key];
  }
  return { seed: snapshot.seed, startTick: snapshot.tick, endTick: control.tick, differences };
}

if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  globalThis.addEventListener("message", ({ data }) => {
    try {
      globalThis.postMessage({ result: runPairedTrial(data) });
    } catch {
      globalThis.postMessage({ error: "Não foi possível simular este checkpoint." });
    }
  });
}

import { World } from "./engine.js";
import { createCell, makeGenome } from "./molecular.js";

export const DESIGN = Object.freeze({
  seeds: [42, 127, 719, 2027],
  steps: 600,
  transporterAllocation: 0.15,
  pigmentAllocation: 0.85
});

export const CONDITIONS = Object.freeze([
  { id: "base", light: 1, nutrient: 0 },
  { id: "light", light: 0.5, nutrient: 0 },
  { id: "nutrient", light: 1, nutrient: 12 },
  { id: "both", light: 0.5, nutrient: 12 }
]);

class TrialWorld extends World {
  incidentLightAt(x, y) {
    return (this.lightScale ?? 1) * super.incidentLightAt(x, y);
  }
}

export function prepareReplicate(seed, condition, swap) {
  const world = new TrialWorld(seed);
  world.lightScale = condition.light;
  const founders = { transport: new Set(), pigment: new Set() };
  for (const [i, org] of world.organisms.entries()) {
    if (!org.cell || !org.genome) throw new Error("Motor molecular indisponível.");
    const transport = i % 2 === Number(swap);
    const group = transport ? "transport" : "pigment";
    org.genome = makeGenome(transport ? DESIGN.transporterAllocation : DESIGN.pigmentAllocation);
    org.mutationDelta = 0;
    org.flux = { light: 0, uptake: 0 };
    org.cell = createCell(org.mass, org.genome);
    founders[group].add(org.id);
  }
  // Four equal inputs avoid assigning the treatment to one founding position.
  if (condition.nutrient) {
    for (const x of [0.25, 0.75]) {
      for (const y of [0.25, 0.75]) world.addNutrientPulse(x, y, condition.nutrient / 4);
    }
  }
  world.recordTelemetry();
  return { world, founders };
}

function descendantsPerFounder(world, founders) {
  let surviving = 0;
  for (const org of world.organisms) {
    if (org.generation > 0 && founders.has(org.lineage)) surviving++;
  }
  return surviving / founders.size;
}

function summary(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const squares = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return { mean, sd: Math.sqrt(squares / (values.length - 1)) };
}

export function runMolecularTrial(onProgress = () => {}) {
  const count = DESIGN.seeds.length * CONDITIONS.length * 2;
  let completed = 0;
  const conditions = CONDITIONS.map(condition => {
    const replicates = DESIGN.seeds.map(seed => {
      let transport = 0, pigment = 0;
      // Averaging reciprocal assignments within the seed matches every founding
      // position, energy reserve and initial mass to both types exactly once.
      for (const swap of [false, true]) {
        const { world, founders } = prepareReplicate(seed, condition, swap);
        for (let step = 0; step < DESIGN.steps; step++) world.step();
        transport += descendantsPerFounder(world, founders.transport) / 2;
        pigment += descendantsPerFounder(world, founders.pigment) / 2;
        onProgress({ completed: ++completed, total: count });
      }
      return { seed, transport, pigment, difference: pigment - transport };
    });
    return {
      ...condition, replicates,
      transport: summary(replicates.map(row => row.transport)),
      pigment: summary(replicates.map(row => row.pigment)),
      difference: summary(replicates.map(row => row.difference))
    };
  });
  const [base, light, nutrient, both] = conditions;
  const contrasts = DESIGN.seeds.map((_, i) => {
    const b = base.replicates[i].difference, l = light.replicates[i].difference;
    const n = nutrient.replicates[i].difference, bothFactors = both.replicates[i].difference;
    return { light: l - b, nutrient: n - b, interaction: (bothFactors - l) - (n - b) };
  });
  const effects = Object.fromEntries(["light", "nutrient", "interaction"].map(key =>
    [key, summary(contrasts.map(row => row[key]))]));
  return { conditions, effects, steps: DESIGN.steps, seeds: DESIGN.seeds, worlds: count };
}

if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  globalThis.addEventListener("message", () => {
    try {
      const result = runMolecularTrial(progress => globalThis.postMessage({ progress }));
      globalThis.postMessage({ result });
    } catch {
      globalThis.postMessage({ error: "Não foi possível concluir o ensaio molecular." });
    }
  });
}

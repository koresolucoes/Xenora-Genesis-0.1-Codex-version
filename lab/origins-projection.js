import { World, validEventIndividual } from "./public/src/engine.js";
import { PRIMORDIAL_MODEL, PrimordialWorld } from "./public/src/primordial.js";

// Archive model identities are independent of the saved JSON format.
// Advance the appropriate identifier when evolution or numerical rules change.
const MODEL_VERSIONS = Object.freeze({
  "lagoon-molecular": "lagoon-molecular-v3",
  primordial: "primordial-v1"
});

const molecularMeasurements = [
  "population","initialPopulation","generation","births","deaths","totalMass","initialMass",
  "grainMass","bodyMass","detritusMass","nutrientMass","wasteMass","massError","nutrientInputTotal",
  "initialEnergy","totalEnergy","absorbedEnergy","dissipatedEnergy","energyError","meanTurbidity",
  "membraneMass","pigmentMass","transporterMass","reserveMass","meanAllocation",
  "capturedLightLastTick","dissolvedUptakeLastTick"
];
const primordialMeasurements = [
  "scaleFactor","cosmicTemperature","matterDensity","overdensity","mineralUnits","particleCount","stableCount",
  "diskTemperature","diskPressureBar","maxElementResidual","lifeCount","cosmologicalTick","unresolvedBaryons"
];

function numbers(source, keys) {
  const result = {};
  for (const key of keys) {
    if (Number.isFinite(source[key]) || source[key] === null) result[key] = source[key];
  }
  return result;
}

function samplesFrom(world, recorded, keys) {
  const sample = (tick, reading) => {
    const data = numbers(reading, keys);
    if (typeof reading.phase === "string" && reading.phase.length <= 40) data.phase = reading.phase;
    return {tick, data};
  };
  const result = [];
  for (const observation of recorded) {
    if (Number.isSafeInteger(observation.tick) && observation.tick >= 0 && observation.tick < world.tick) {
      result.push(sample(observation.tick, observation));
    }
  }
  const current = world.getMetrics();
  result.push(sample(world.tick, current));
  return result;
}

const lifeEvents = {
  start:"Povoamento inicial.", light:"A fonte de luz mudou de posição.",
  nutrient:"Entrada externa de nutriente.", birth:"Nascimento observado.", death:"Morte observada."
};

function observedEvents(world, labels, replayedText = false) {
  const occurrences = new Map();
  const projected = [];
  for (const event of world.events) {
    if (!Object.hasOwn(labels, event.type) || !Number.isSafeInteger(event.tick) || event.tick < 0 || event.tick > world.tick) continue;
    const prefix = event.tick + ":" + event.type;
    const occurrence = (occurrences.get(prefix) || 0) + 1;
    occurrences.set(prefix, occurrence);
    const key = prefix + ":" + (Number.isSafeInteger(event.id) ? "id-" + event.id : "n-" + occurrence);
    const data = numbers(event, ["id","parent","allocation","mutationDelta","x","y","amount","units"]);
    data.text = replayedText ? event.text : labels[event.type];
    if (event.type === "start" && world.originSample) {
      const inoculum = world.originSample.inoculum;
      data.text = "Inoculação externa de uma célula virtual na amostra de superfície.";
      data.introducedIndividuals = inoculum.count;
      data.introducedMass = inoculum.mass;
      data.introducedEnergy = inoculum.energy;
    }
    projected.push({tick:event.tick, type:event.type, key, data});
  }
  return projected;
}

function observedGenealogy(world) {
  const individuals = new Map();
  for (const org of world.organisms) {
    individuals.set(org.id, {
      id: org.id, parentId: org.parent, lineage: org.lineage, generation: org.generation,
      sequence: org.genome.sequence, mutationDelta: org.mutationDelta,
      observedIn: "living", observedAtTick: world.tick
    });
  }
  // A single projection row represents each individual per revision. The most
  // recent witnessed event supplies evidence when the cell is no longer here.
  for (let index = world.events.length - 1; index >= 0; index--) {
    const event = world.events[index];
    if (individuals.has(event.id) || !validEventIndividual(event, world.nextId)) continue;
    const {id, parentId, lineage, generation, sequence, mutationDelta} = event.individual;
    individuals.set(id, {
      id, parentId, lineage, generation, sequence, mutationDelta,
      observedIn: event.type, observedAtTick: event.tick
    });
  }
  return Array.from(individuals.values());
}

function projectMolecular(checkpoint) {
  const world = World.restore(checkpoint);
  const canonical = world.serialize();
  const genealogy = observedGenealogy(world);
  const origin = world.originSample;
  const minerals = origin?.mineralUnits > 0 ? [{
    key: "silicate-1", formula: origin.formula, source: origin.source, units: origin.mineralUnits,
    recipe: {...PRIMORDIAL_MODEL.recipe}, firstTick: null, lastTick: null,
    inventoryScope: "source-disk", scale: "representative", sourceSeed: origin.seed,
    sourceTick: origin.tick, handoffTick: origin.handoffTick, sampleSites: world.minerals.length
  }] : [];
  return {
    checkpoint: canonical, engineVersion: MODEL_VERSIONS["lagoon-molecular"],
    events: observedEvents(world, lifeEvents), samples: samplesFrom(world, world.telemetry, molecularMeasurements),
    minerals, quantities: [], genealogy
  };
}

function projectPrimordial(checkpoint) {
  const world = PrimordialWorld.restore(checkpoint);
  const canonical = world.serialize();
  const metrics = world.getMetrics();
  const quantities = metrics.elements.map(row => ({
    symbol: row.symbol, ...numbers(row, ["primordial","ejecta","gas","stellar","mineral","exported","residual"])
  }));
  const lot = world.mineralLot;
  const minerals = lot && lot.units > 0 ? [{
    key: lot.id, formula: lot.formula, source: lot.source, units: lot.units,
    firstTick: lot.firstTick, lastTick: lot.lastTick, recipe: numbers(lot.recipe, ["Mg","Si","O"])
  }] : [];
  return {
    checkpoint: canonical, engineVersion: MODEL_VERSIONS.primordial,
    events: observedEvents(world, primordialEvents, true),
    samples: samplesFrom(world, world.history, primordialMeasurements),
    minerals, quantities, genealogy: []
  };
}

// PrimordialWorld.restore recomputes these events from the seed and silicon intervention.
const primordialEvents = { epoch:true, yield:true, control:true };

export function projectSnapshot(mode, checkpoint) {
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) throw new TypeError("Checkpoint inválido");
  if (mode === "lagoon-molecular") return projectMolecular(checkpoint);
  if (mode === "primordial") return projectPrimordial(checkpoint);
  throw new TypeError("Modo desconhecido");
}

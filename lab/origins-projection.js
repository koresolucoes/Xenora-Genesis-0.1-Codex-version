import { World, validEventIndividual } from "./public/src/engine.js";
import { EvolvingWorld } from "./public/src/evolving-world.js";
import { PRIMORDIAL_MODEL, PrimordialWorld } from "./public/src/primordial.js";

// Archive model identities are independent of the saved JSON format.
// Advance the appropriate identifier when evolution or numerical rules change.
const MODEL_VERSIONS = Object.freeze({
  "lagoon-molecular": "lagoon-molecular-v3",
  primordial: "primordial-v1",
  "evolving-world": "evolving-world-v1"
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

function samplesFrom(world, recorded, keys, extendSample) {
  const sample = (tick, reading) => {
    const data = numbers(reading, keys);
    if (typeof reading.phase === "string" && reading.phase.length <= 40) data.phase = reading.phase;
    if (extendSample) extendSample(data, reading);
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
    const data = numbers(event, ["id","parent","parentId","lineage","allele","generation","allocation","mutationDelta","x","y","amount","units","count","forcing"]);
    data.text = replayedText ? event.text : labels[event.type];
    if (labels === evolvingEvents) {
      if (event.type === "start" && event.count === 0) data.text = "Mundo iniciado sem fundadores.";
      if (event.type === "control") { data.control = event.control; data.enabled = event.enabled; }
      if (event.type === "habitat") { data.habitat = event.habitat; data.previous = event.previous; }
    }
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

const evolvingMeasurements = [
  "population", "births", "deaths", "founderCount", "maxGeneration", "mutations", "meanTrait",
  "maxLivingGeneration", "extinctionTick", "livingLineages", "bodyMass", "nutrientMass", "totalMass",
  "initialMass", "nutrientInputTotal", "massError", "totalEnergy", "initialEnergy", "absorbedEnergy",
  "dissipatedEnergy", "energyError", "meanTemperatureK", "meanHumidity",
  "meanEnergy", "meanHabitability", "lagoonFraction", "waterInventory", "liquidWater", "iceWater",
  "vaporWater", "waterError", "availableNutrient", "boundNutrient", "totalNutrient", "nutrientError",
  "lightForcing", "meanBiota", "behaviorDecisions", "exploreDecisions", "behaviorRewardTotal", "learnedUpdates"
];

const evolvingEvents = {
  start:"Fundadores introduzidos no mundo.", birth:"Nascimento observado.", death:"Morte observada.",
  mutation:"Mutação observada.", extinction:"Extinção observada.", light:"A iluminação foi alterada.",
  nutrient:"Entrada externa de nutriente.", control:"Um controle experimental mudou.", habitat:"Mudança de habitat."
};

function evolutionarySample(data, reading) {
  for (const key of ["traitCounts", "traitFrequencies"]) {
    const bins = reading[key];
    if (Array.isArray(bins) && bins.length === 11 && bins.every(value => Number.isFinite(value) && value >= 0)) {
      data[key] = bins.slice();
    }
  }
  for (const key of ["extinct", "selectionEnabled", "mutationEnabled", "learningEnabled"]) {
    if (typeof reading[key] === "boolean") data[key] = reading[key];
  }
  if (["ice", "lagoon", "wetland", "temperate", "dry"].includes(reading.dominantHabitat)) data.dominantHabitat = reading.dominantHabitat;
  const counts = reading.habitatCounts;
  if (counts && typeof counts === "object" && !Array.isArray(counts)) {
    const pairs = Object.entries(counts).filter(([type,value]) =>
      /^[a-z][a-z-]{0,32}$/.test(type) && Number.isSafeInteger(value) && value >= 0);
    data.habitatCounts = Object.fromEntries(pairs);
  }
}

function evolvingGenealogy(world) {
  const seen = new Map();
  function observe(identity, origin, tick) {
    if (!identity || seen.has(identity.id)) return;
    const {id, parentId, lineage, generation} = identity;
    const allele = identity.genome?.allele ?? identity.allele;
    const hasParent = Number.isSafeInteger(parentId) && parentId >= lineage && parentId < id;
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(lineage) || lineage < 1 || lineage > id
        || !Number.isSafeInteger(generation) || generation < 0 || (generation ? !hasParent : parentId !== null || id !== lineage)
        || !Number.isInteger(allele) || allele < 0 || allele > 10 || !Number.isSafeInteger(tick) || tick < 0 || tick > world.tick) return;
    const record = {id,parentId,lineage,generation,allele,trait:allele/10,observedIn:origin,observedAtTick:tick};
    if ([-1, 0, 1].includes(identity.mutationDelta)) record.mutationDelta = identity.mutationDelta;
    seen.set(id, record);
  }
  for (const org of world.organisms) observe(org, "living", world.tick);
  for (let i = world.events.length - 1; i >= 0; i--) {
    const event = world.events[i];
    if (event.type === "birth" || event.type === "death") observe(event, event.type, event.tick);
  }
  return Array.from(seen.values());
}

function projectEvolving(checkpoint) {
  const world = EvolvingWorld.restore(checkpoint);
  const origin = world.environment.origin;
  const minerals = origin?.kind === "primordial" && origin.formula === "Mg2SiO4" && origin.mineralUnits > 0 ? [{
    key:"silicate-1", formula:origin.formula, source:origin.source, units:origin.mineralUnits,
    recipe:{...PRIMORDIAL_MODEL.recipe}, firstTick:null, lastTick:null, inventoryScope:"source-disk",
    scale:"representative", sourceSeed:origin.seed, sourceTick:origin.tick, sampleSites:origin.sites.length
  }] : [];
  const samples = samplesFrom(world, world.history, evolvingMeasurements, evolutionarySample);
  const current = samples.at(-1).data;
  current.mutationEnabled = world.controls.mutationEnabled;
  current.selectionEnabled = world.controls.selectionEnabled;
  current.learningEnabled = world.controls.learningEnabled;
  return {
    checkpoint:world.serialize(), engineVersion:MODEL_VERSIONS["evolving-world"], samples, minerals,
    events:observedEvents(world, evolvingEvents), quantities:[], genealogy:evolvingGenealogy(world)
  };
}

export function projectSnapshot(mode, checkpoint) {
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) throw new TypeError("Checkpoint inválido");
  if (mode === "lagoon-molecular") return projectMolecular(checkpoint);
  if (mode === "primordial") return projectPrimordial(checkpoint);
  if (mode === "evolving-world") return projectEvolving(checkpoint);
  throw new TypeError("Modo desconhecido");
}

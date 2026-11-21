import { World, validEventIndividual } from "./public/src/engine.js";
import { EvolvingWorld } from "./public/src/evolving-world.js";
import { PRIMORDIAL_MODEL, PrimordialWorld } from "./public/src/primordial.js";
import { AtomicWorld, ATOMIC_PHYSICS } from "./public/src/atomic-world.js";
import { getCurrentSpecies } from "./public/src/reaction-bench.js";

// Archive model identities are independent of the saved JSON format.
// Advance the appropriate identifier when evolution or numerical rules change.
const MODEL_VERSIONS = Object.freeze({
  "lagoon-molecular": "lagoon-molecular-v3",
  primordial: "primordial-v1",
  "evolving-world": "evolving-world-v1"
});
const atomicEngineVersions = new Map([[2,"particle-world-v2"],[3,"particle-world-v3"]]);

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

function appendBenchObservation(world, bench, events, data) {
  const groups=getCurrentSpecies(world);
  const exact=groups.filter(group=>group.status==="exact")
    .sort((a,b)=>a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const speciesByAtom=new Map();
  data.speciesCensus={
    scope:"current-graph-including-free-atoms",
    identified:exact.map((group,index)=>{
      for (const instance of group.instances) for(const id of instance.members) speciesByAtom.set(id,index);
      return {key:group.key,formula:group.formula,count:group.count};
    }),
    unresolvedComponents:groups.reduce((n,group)=>n+(group.status==="unresolved" ? group.count : 0),0)
  };
  for (const entry of events) {
    entry.data.speciesIndex=speciesByAtom.get(entry.data.members[0]) ?? null;
  }
  const ticks=bench.tick-bench.startTick, tickFs=ATOMIC_PHYSICS.tickFs;
  data.reactionWindow={
    basis:"checkpoint-bond-edits", startTick:bench.startTick, endTick:bench.tick,
    fromFs:bench.startTick*tickFs, toFs:bench.tick*tickFs, comparedSteps:ticks,
    changedSteps:bench.frames.length, bondEdits:bench.frames.reduce((n,frame)=>n+frame.changes.length,0)
  };
  data.integrationSubsteps=world.integrationSubsteps ?? 4;
}

function projectAtomic(checkpoint) {
  const world=AtomicWorld.restore(checkpoint);
  const stocks=new Map(["C","H","N","O","P","S"].map(symbol=>[symbol,{symbol,count:0,massU:0}]));
  let protons=0, neutrons=0, electrons=0;
  for(const atom of world.particles) {
    const stock=stocks.get(atom.element);
    if(!stock || !Number.isFinite(atom.massU) || atom.massU<=0) throw new Error("Elemento atômico inválido.");
    stock.count++; stock.massU+=atom.massU;
    protons+=atom.protons; neutrons+=atom.neutrons; electrons+=atom.electrons;
  }
  const events=world.molecules().filter(component=>component.members.length>1).map(component=>{
    const members=[...component.members].sort((a,b)=>a-b);
    return {tick:world.tick,type:"component-observed",key:"component-"+members[0],
      data:{formula:component.formula,members,massU:component.massU,bondCount:component.bondCount}};
  });
  const data={atomCount:world.particles.length,bondCount:world.bonds.length,bondedComponents:events.length,
    massU:[...stocks.values()].reduce((sum,stock)=>sum+stock.massU,0),protons,neutrons,electrons,
    ...numbers(world.getMetrics(),["timeFs","temperatureK","targetTemperatureK","volumeNm3","densityKgM3","pressurePa",
      "idealPressurePa","kineticEnergyEv","potentialEnergyEv","totalEnergyEv","initialEnergyEv","bathWorkEv",
      "volumeWorkEv","reactionHeatEv","initialMassU","massError","energyError",
      "netCharge","distinctFormulas","ringMolecules","largestMoleculeAtoms"])};
  const canonical=world.serialize();
  if(canonical.version!==checkpoint.version || world.version!==checkpoint.version)
    throw new TypeError("O checkpoint mudou de versão durante a restauração.");
  // The SQL idempotency receipt hashes the full write. An unadvanced file from
  // before the bench must still generate exactly its original RPC projection.
  if (checkpoint.reactionBench) appendBenchObservation(world,canonical.reactionBench,events,data);
  if (canonical.version===3) {
    if (canonical.physicsProfile!==checkpoint.physicsProfile || canonical.physicsProfile!==world.physicsProfile)
      throw new TypeError("Perfil de física atômica incompatível.");
    if (!Number.isFinite(world.integrationDriftEv) || !Number.isFinite(world.integrationAbsDriftEv) || world.integrationAbsDriftEv<0)
      throw new TypeError("Registro de deriva da integração inválido.");
    data.physicsProfile=world.physicsProfile;
    data.integrationSubsteps=world.integrationSubsteps;
    Object.assign(data,numbers(world,["integrationDriftEv","integrationAbsDriftEv"]));
  }
  return {checkpoint:canonical,engineVersion:atomicEngineVersions.get(canonical.version),
    samples:[{tick:world.tick,data}],quantities:[...stocks.values()],events,minerals:[],genealogy:[]};
}

export function projectSnapshot(mode, checkpoint) {
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) throw new TypeError("Checkpoint inválido");
  if (mode === "lagoon-molecular") return projectMolecular(checkpoint);
  if (mode === "primordial") return projectPrimordial(checkpoint);
  if (mode === "evolving-world") return projectEvolving(checkpoint);
  if (mode === "particle-world") {
    if (!atomicEngineVersions.has(checkpoint.version) || checkpoint.mode !== mode || checkpoint.kind !== mode) throw new TypeError("Versão atômica incompatível");
    if (checkpoint.version===2 && Object.hasOwn(checkpoint,"physicsProfile")) throw new TypeError("Perfil incompatível com o motor anterior.");
    if (checkpoint.version===3 && checkpoint.physicsProfile!=="neutral-chonps-h2-h2o-v3") throw new TypeError("Perfil de calibração inválido.");
    return projectAtomic(checkpoint);
  }
  throw new TypeError("Modo desconhecido");
}

import { Environment } from "./environment.js";
import {
  assimilateMolecules, createCell, createGenome, divideMolecules, makeGenome, molecularTraits,
  remodelFromReserve, validMolecules
} from "./molecular.js";

// Reactive matter occupies five compartments. A nutrient pulse is the only
// external material input; absorbed light contributes to the separate energy budget.
const TAU = 2 * Math.PI;
const SNAPSHOT_VERSION = 3;
const EVENT_LIMIT = 100;
const LIGHT_CELLS = 16;
const TELEMETRY_INTERVAL = 10;
const TELEMETRY_LIMIT = 512;

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function seedValue(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) return seed >>> 0;
  let hash = 2166136261;
  for (const char of String(seed)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function bodyRadius(mass) {
  return 0.0065 + 0.003 * Math.sqrt(mass);
}

function grainRadius(mass) {
  return 0.0028 + 0.0025 * Math.sqrt(mass);
}

function total(items, key) {
  return items.reduce((sum, item) => sum + item[key], 0);
}

function inRange(value, lo, hi) {
  return Number.isFinite(value) && value >= lo && value <= hi;
}

function integer(value, lo = 0, hi = Number.MAX_SAFE_INTEGER - 1) {
  return Number.isSafeInteger(value) && value >= lo && value <= hi;
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validPosition(obj) {
  return record(obj) && inRange(obj.x, 0, 1) && inRange(obj.y, 0, 1);
}

function validOrganism(org, nextId) {
  return integer(org.lineage, 1, org.id) && integer(org.generation) &&
    (org.generation === 0 ? org.parent === null && org.lineage === org.id :
      integer(org.parent, org.lineage, org.id - 1)) && org.id < nextId &&
    Number.isFinite(org.angle) && inRange(org.energy, 0, 9) && inRange(org.sensitivity, 0, 1) &&
    integer(org.maxAge, 1) && integer(org.age, 0, org.maxAge - 1) &&
    Number.isSafeInteger(org.cooldown) && Number.isFinite(org.activeDistance) && org.activeDistance >= 0 &&
    Number.isFinite(org.passiveDistance) && org.passiveDistance >= 0;
}

function initializeMolecules(org, genome) {
  org.genome = genome;
  org.cell = createCell(org.mass, genome);
  org.mutationDelta = 0;
  org.flux = { light: 0, uptake: 0 };
}

function validCheckpoint(state, dissolvedMass) {
  if (!record(state) || ![1, 2, SNAPSHOT_VERSION].includes(state.version) || !validPosition(state.light) ||
    !integer(state.seed, 0, 0xffffffff) || !integer(state.rng, 1, 0xffffffff) ||
    !integer(state.tick) || !integer(state.nextId, 1) ||
    !["initialPopulation", "births", "deaths"].every(key => integer(state[key])) ||
    !["activeDistance", "passiveDistance", "absorbedEnergy", "dissipatedEnergy",
      "initialMass", "initialEnergy"].every(key => inRange(state[key], 0, Number.MAX_SAFE_INTEGER)) ||
    !["organisms", "grains", "minerals", "detritus", "events"].every(key => Array.isArray(state[key]))) return false;

  // Version 1 starts with 130 grains (at most 1 each) and 24 bodies (at most 3.6 each).
  if (state.initialMass <= 0 || state.initialMass > 217 || state.initialPopulation !== 24 ||
    state.organisms.length !== state.initialPopulation + state.births - state.deaths ||
    state.events.length > EVENT_LIMIT) return false;
  const input = state.version === 1 ? 0 : state.nutrientInputTotal;
  if (!inRange(input, 0, Number.MAX_SAFE_INTEGER)) return false;
  if (state.version === SNAPSHOT_VERSION && (!integer(state.molecularSinceTick, 0, state.tick) ||
      !inRange(state.capturedLightLastTick, 0, state.absorbedEnergy + 1e-8) ||
      !inRange(state.dissolvedUptakeLastTick, 0, Number.MAX_SAFE_INTEGER))) return false;
  const ids = new Set();
  for (const group of ["organisms", "grains", "minerals", "detritus"]) {
    for (const obj of state[group]) {
      if (!validPosition(obj) || !integer(obj.id, 1, state.nextId - 1) || ids.has(obj.id) ||
        !inRange(obj.phase, 0, TAU) || !inRange(obj.radius, Number.EPSILON, 0.5) ||
        !inRange(obj.x, obj.radius, 1 - obj.radius) || !inRange(obj.y, obj.radius, 1 - obj.radius)) return false;
      ids.add(obj.id);
      if (group === "minerals") continue;
      if (!inRange(obj.mass, Number.EPSILON, state.initialMass + input) ||
        Math.abs(obj.radius - (group === "organisms" ? bodyRadius(obj.mass) : grainRadius(obj.mass))) > 1e-10) return false;
      if (group === "organisms" && !validOrganism(obj, state.nextId)) return false;
      if (group === "organisms" && state.version === SNAPSHOT_VERSION && (!validMolecules(obj) ||
          ![-0.05, 0, 0.05].includes(obj.mutationDelta) ||
          (obj.generation === 0 && obj.mutationDelta !== 0) ||
          !inRange(obj.genome.allocation - obj.mutationDelta, -1e-12, 1 + 1e-12) ||
          !record(obj.flux) || !inRange(obj.flux.light, 0, 9) ||
          !inRange(obj.flux.uptake, 0, Number.MAX_SAFE_INTEGER))) return false;
      if (group === "detritus" && !integer(obj.decayAt, state.tick + 1)) return false;
    }
  }
  if (state.version === SNAPSHOT_VERSION) {
    const living = new Map(state.organisms.map(org => [org.id, org]));
    for (const child of state.organisms) {
      const parent = living.get(child.parent);
      if (!parent) continue;
      const delta = child.genome.allocation - parent.genome.allocation;
      if (Math.abs(delta - child.mutationDelta) > 1e-12) return false;
      let changed = 0;
      for (let i = 0; i < child.genome.sequence.length; i++) {
        if (child.genome.sequence[i] !== parent.genome.sequence[i]) changed++;
      }
      if (changed !== (child.mutationDelta === 0 ? 0 : 1)) return false;
    }
  }
  let prevTick = 0;
  for (const event of state.events) {
    if (!record(event) || !integer(event.tick, prevTick, state.tick) || typeof event.text !== "string" ||
      !["start", "birth", "death", "light", "nutrient"].includes(event.type)) return false;
    prevTick = event.tick;
    if (event.type === "light" && !validPosition(event)) return false;
    if (event.type === "nutrient" && (state.version === 1 || !validPosition(event) ||
        !Number.isFinite(event.amount) || !(event.amount > 0 && event.amount <= input))) return false;
    if ((event.type === "birth" || event.type === "death") && !integer(event.id, 1, state.nextId - 1)) return false;
    if (event.type === "birth" && !integer(event.parent, 1, event.id - 1)) return false;
  }
  const mass = total(state.organisms, "mass") + total(state.grains, "mass") + total(state.detritus, "mass") + dissolvedMass;
  const stored = total(state.organisms, "energy");
  const expected = state.initialEnergy + state.absorbedEnergy - state.dissipatedEnergy;
  return Math.abs(mass - state.initialMass - input) <= 1e-8 * Math.max(1, state.initialMass + input) &&
    Math.abs(stored - expected) <= 1e-8 * Math.max(1, state.absorbedEnergy, state.initialEnergy);
}

export class World {
  constructor(seed = 42) {
    this.seed = seedValue(seed);
    this.rng = this.seed || 0x9e3779b9;
    this.tick = 0;
    this.nextId = 1;
    this.light = { x: 0.34, y: 0.39 };
    this.organisms = [];
    this.grains = [];
    this.detritus = [];
    this.minerals = [];
    this.events = [];
    this.births = 0;
    this.deaths = 0;
    this.activeDistance = 0;
    this.passiveDistance = 0;
    this.absorbedEnergy = 0;
    this.dissipatedEnergy = 0;
    this.nutrientInputTotal = 0;
    this.molecularSinceTick = 0;
    this.capturedLightLastTick = 0;
    this.dissolvedUptakeLastTick = 0;
    this.telemetry = [];

    const rocks = [[0.15, 0.23, 0.026], [0.22, 0.76, 0.037], [0.52, 0.28, 0.032],
      [0.52, 0.71, 0.037], [0.84, 0.25, 0.024], [0.84, 0.71, 0.031], [0.68, 0.48, 0.018]];
    for (const [x, y, radius] of rocks) {
      this.minerals.push({ id: this.nextId++, x: x + this.noise(0.025),
        y: y + this.noise(0.025), radius, phase: this.random() * TAU });
    }
    this.environment = new Environment({ size: 24, minerals: this.minerals });

    for (let i = 0; i < 130; i++) {
      const [x, y] = this.findStart(0.007);
      this.addGrain(x, y, 0.40 + this.random() * 0.60);
    }
    for (let i = 0; i < 24; i++) {
      const mass = 2.0 + this.random() * 1.6;
      const radius = bodyRadius(mass);
      const [x, y] = this.findStart(radius, true);
      const id = this.nextId++;
      this.organisms.push({ id, x, y, mass, radius, parent: null, lineage: id,
        angle: this.random() * TAU, energy: 2.0 + this.random() * 3.5,
        sensitivity: 0.25 + 0.65 * this.random(), generation: 0, age: Math.floor(this.random() * 380),
        maxAge: 1050 + Math.floor(this.random() * 850), cooldown: Math.floor(this.random() * 30),
        phase: this.random() * TAU, activeDistance: 0, passiveDistance: 0 });
    }
    // Assign founder genotypes after placing all initial entities so their
    // starting locations and material inventories stay paired across model versions.
    for (const org of this.organisms) initializeMolecules(org, createGenome(() => this.random()));
    this.initialPopulation = this.organisms.length;
    this.initialMass = total(this.grains, "mass") + total(this.organisms, "mass");
    this.initialEnergy = total(this.organisms, "energy");
    this.log("start", "A lagoa foi povoada com " + this.initialPopulation + " organismos.");
    this.recordTelemetry();
  }

  random() {
    let x = this.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rng = x >>> 0;
    return this.rng / 4294967296;
  }

  noise(amplitude) {
    return (2 * this.random() - 1) * amplitude;
  }

  free(x, y, radius, bodies = null, ignore = null) {
    if (x < radius || y < radius || x > 1 - radius || y > 1 - radius) return false;
    const overlaps = (o) => {
      const r = radius + o.radius;
      return (o.x - x) ** 2 + (o.y - y) ** 2 < r * r;
    };
    if (this.minerals.some(overlaps)) return false;
    return !bodies || !bodies.some(o => o !== ignore && overlaps(o));
  }

  findStart(radius, withBodies = false) {
    for (let i = 0; i < 500; i++) {
      const x = 0.035 + this.random() * 0.93;
      const y = 0.035 + this.random() * 0.93;
      if (this.free(x, y, radius, withBodies ? this.organisms : null)) return [x, y];
    }
    throw new Error("Sem espaço livre para gerar a lagoa.");
  }

  log(type, text, details = {}) {
    this.events.push({ tick: this.tick, type, text, ...details });
    if (this.events.length > EVENT_LIMIT) this.events.shift();
  }

  setLight(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Posição da luz inválida.");
    const next = { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
    if (next.x === this.light.x && next.y === this.light.y) return;
    this.light = next;
    this.log("light", "O foco de luz foi reposicionado.", next);
    if (this.telemetry.at(-1)?.tick === this.tick) this.recordTelemetry();
  }

  addNutrientPulse(x, y, amount = 1) {
    const next = this.nutrientInputTotal + amount;
    if (!inRange(x, 0, 1) || !inRange(y, 0, 1) || !inRange(amount, 0, Number.MAX_SAFE_INTEGER) ||
        next > Number.MAX_SAFE_INTEGER) throw new Error("Pulso de nutriente inválido.");
    if (!amount || next === this.nutrientInputTotal) return 0;
    this.environment.add("nutrient", x, y, amount);
    this.nutrientInputTotal = next;
    this.log("nutrient", "Pulso externo de " + amount + " unidade(s) de nutriente.", { x, y, amount });
    if (this.telemetry.at(-1)?.tick === this.tick) this.recordTelemetry();
    return amount;
  }

  incidentLightAt(x, y) {
    const dx = x - this.light.x;
    const dy = y - this.light.y;
    return Math.exp(-(dx * dx + dy * dy) / 0.055);
  }

  lightAt(x, y) {
    return this.incidentLightAt(x, y) * this.environment.transmissionAt(x, y);
  }

  addGrain(x, y, mass) {
    this.grains.push({ id: this.nextId++, x, y, mass, radius: grainRadius(mass), phase: this.random() * TAU });
  }

  addDetritus(x, y, mass) {
    if (mass <= 0) return;
    this.detritus.push({ id: this.nextId++, x, y, mass, radius: grainRadius(mass),
      phase: this.random() * TAU, decayAt: this.tick + 80 + Math.floor(this.random() * 150) });
  }

  drift(entity, mobility, bodies = null) {
    // The Eulerian solutes and Lagrangian particles use the same prescribed flow.
    const flow = this.environment.flowAt(entity.x, entity.y);
    const dx = mobility * (flow.x + this.noise(0.00035));
    const dy = mobility * (flow.y + this.noise(0.00035));
    if (!this.free(entity.x + dx, entity.y + dy, entity.radius, bodies, entity)) return 0;
    entity.x += dx;
    entity.y += dy;
    return Math.hypot(dx, dy);
  }

  energyShares() {
    // Neighbors in the same patch share its incident light budget.
    const patches = new Map();
    const incoming = new Map();
    for (const org of this.organisms) {
      const ix = Math.min(LIGHT_CELLS - 1, Math.floor(org.x * LIGHT_CELLS));
      const iy = Math.min(LIGHT_CELLS - 1, Math.floor(org.y * LIGHT_CELLS));
      const patch = iy * LIGHT_CELLS + ix;
      if (!patches.has(patch)) patches.set(patch, []);
      patches.get(patch).push(org);
    }
    for (const [patch, occupants] of patches) {
      const x = (patch % LIGHT_CELLS + 0.5) / LIGHT_CELLS;
      const y = (Math.floor(patch / LIGHT_CELLS) + 0.5) / LIGHT_CELLS;
      const intensity = this.incidentLightAt(x, y);
      let requested = 0;
      for (const org of occupants) {
        const capture = 0.053 * intensity * molecularTraits(org).lightFactor *
          this.environment.transmissionAt(org.x, org.y);
        const demand = Math.min(capture, 9 - org.energy);
        incoming.set(org.id, demand);
        requested += demand;
      }
      const available = 0.11 * intensity;
      if (requested > available) {
        for (const org of occupants) incoming.set(org.id, incoming.get(org.id) * available / requested);
      }
    }
    return incoming;
  }

  tryFeed(org) {
    if (org.cooldown > 0 || org.mass >= 6.4) return false;
    let best = -1;
    let closest = Infinity;
    for (let i = 0; i < this.grains.length; i++) {
      const g = this.grains[i];
      const d = (org.x - g.x) ** 2 + (org.y - g.y) ** 2;
      if (d <= (org.radius + g.radius + 0.004) ** 2 && d < closest) {
        best = i;
        closest = d;
      }
    }
    if (best < 0) return false;
    const g = this.grains[best];
    // Fully assimilate very small grains instead of creating ever finer debris.
    const waste = g.mass > 0.20 ? 0.19 * g.mass : 0;
    const biomass = g.mass - waste;
    const cost = biomass * molecularTraits(org).synthesisCost;
    if (org.energy < cost) return false;
    const nextMass = org.mass + biomass;
    const nextRadius = bodyRadius(nextMass);
    if (!this.free(org.x, org.y, nextRadius, this.organisms, org)) return false;
    this.grains.splice(best, 1);
    assimilateMolecules(org, biomass);
    org.mass = nextMass;
    org.radius = nextRadius;
    org.energy -= cost;
    this.dissipatedEnergy += cost;
    this.addDetritus(g.x, g.y, waste);
    org.cooldown = 28;
    return true;
  }

  absorbNutrient(org) {
    // The finite volume, not its interpolated display concentration, pays
    // the entire uptake. The non-assimilated fraction returns as dissolved waste.
    const { uptakeFactor, assimilationYield: yieldFraction, synthesisCost } = molecularTraits(org);
    const energyPerMass = yieldFraction * synthesisCost;
    const capacity = Math.max(0, (6.4 - org.mass) / yieldFraction);
    const demand = Math.min(0.026 * uptakeFactor, capacity, org.energy / energyPerMass);
    const uptake = this.environment.take("nutrient", org.x, org.y, demand);
    if (uptake === 0) return 0;
    const biomass = yieldFraction * uptake;
    const radius = bodyRadius(org.mass + biomass);
    if (!this.free(org.x, org.y, radius, this.organisms, org)) {
      this.environment.add("nutrient", org.x, org.y, uptake);
      return 0;
    }
    const cost = Math.min(org.energy, biomass * synthesisCost);
    org.energy -= cost;
    this.dissipatedEnergy += cost;
    assimilateMolecules(org, biomass);
    org.mass += biomass;
    org.radius = radius;
    this.environment.add("waste", org.x, org.y, uptake - biomass);
    return uptake;
  }

  erodeGrains() {
    const remaining = [];
    for (const g of this.grains) {
      this.drift(g, 1);
      const eroded = Math.min(g.mass, 0.0005 + 0.0025 * g.mass);
      this.environment.add("nutrient", g.x, g.y, eroded);
      g.mass -= eroded;
      if (g.mass > 0) {
        g.radius = grainRadius(g.mass);
        remaining.push(g);
      }
    }
    this.grains = remaining;
  }

  moveOrganism(org) {
    const lightBefore = this.lightAt(org.x, org.y);
    const passive = this.drift(org, 0.72, this.organisms);
    org.passiveDistance += passive;
    this.passiveDistance += passive;
    const speed = 0.0012 * clamp(org.energy / 1.8, 0, 1) / Math.sqrt(org.mass / 3);
    const x = org.x + speed * Math.cos(org.angle);
    const y = org.y + speed * Math.sin(org.angle);
    if (this.free(x, y, org.radius, this.organisms, org)) {
      org.x = x;
      org.y = y;
      org.activeDistance += speed;
      this.activeDistance += speed;
      // Sense only the change along this step. Keep a favorable heading for longer;
      // a falling signal makes an unoriented tumble more likely next step.
      const lightAfter = this.lightAt(x, y);
      const change = (lightAfter - lightBefore) / (0.045 + lightBefore);
      const tumble = clamp(0.012 - 18 * org.sensitivity * change, 0.001, 0.22);
      org.angle += this.random() < tumble ? this.noise(Math.PI) : this.noise(0.065);
      return speed;
    }
    org.angle += 0.58 + this.noise(0.2);
    return 0;
  }

  tryDivide(org, newborns) {
    if (org.mass < 4.05 || org.energy < 5.0 || org.age < 65) return;
    const nextMass = org.mass / 2;
    const radius = bodyRadius(nextMass);
    const start = this.random() * TAU;
    for (let i = 0; i < 8; i++) {
      const angle = start + i * TAU / 8;
      const x = org.x + 2.1 * radius * Math.cos(angle);
      const y = org.y + 2.1 * radius * Math.sin(angle);
      if (!this.free(x, y, radius, this.organisms, org) || !this.free(x, y, radius, newborns)) continue;
      org.mass = nextMass;
      org.radius = radius;
      org.energy = (org.energy - 0.48) / 2;
      this.dissipatedEnergy += 0.48;
      const child = { ...org, id: this.nextId++, parent: org.id, x, y, angle, age: 0,
        generation: org.generation + 1, phase: this.random() * TAU, cooldown: 26,
        activeDistance: 0, passiveDistance: 0, flux: { light: 0, uptake: 0 },
        maxAge: 1050 + Math.floor(this.random() * 850),
        sensitivity: clamp(org.sensitivity + this.noise(0.07), 0.05, 1) };
      divideMolecules(org, child, () => this.random());
      newborns.push(child);
      this.births++;
      let birthText = "Organismo #" + org.id + " originou #" + child.id + ".";
      if (child.mutationDelta !== 0) {
        const change = child.mutationDelta > 0 ? "ganhou" : "perdeu";
        const points = (child.mutationDelta > 0 ? "+" : "−") + Math.round(Math.abs(child.mutationDelta) * 100);
        birthText += " Por mutação, a filha " + change + " uma posição para pigmento (" + points + " pontos percentuais).";
      }
      this.log("birth", birthText,
        { id: child.id, parent: org.id, allocation: child.genome.allocation, mutationDelta: child.mutationDelta });
      return;
    }
  }

  step() {
    this.tick++;
    this.capturedLightLastTick = 0;
    this.dissolvedUptakeLastTick = 0;
    this.erodeGrains();
    const remains = [];
    for (const d of this.detritus) {
      this.drift(d, 0.42);
      if (this.tick < d.decayAt) {
        remains.push(d);
        continue;
      }
      // Breaking a detrital particle exposes soluble waste to mineral recycling;
      // its remaining insoluble material returns as edible and erodible grains.
      const residue = d.mass * 0.60;
      this.environment.add("waste", d.x, d.y, residue);
      const solid = d.mass - residue;
      const parts = Math.max(1, Math.ceil(solid / 0.95));
      for (let p = 0; p < parts; p++) {
        const x = d.x + this.noise(0.018);
        const y = d.y + this.noise(0.018);
        const ok = this.free(x, y, grainRadius(solid / parts));
        this.addGrain(ok ? x : d.x, ok ? y : d.y, solid / parts);
      }
    }
    this.detritus = remains;
    this.environment.step();

    const alive = [];
    const newborns = [];
    const energy = this.energyShares();
    // Rotate priority by a seeded offset so food contested in one tick is counted only once.
    const start = this.organisms.length ? Math.floor(this.random() * this.organisms.length) : 0;
    for (let n = 0; n < this.organisms.length; n++) {
      const org = this.organisms[(start + n) % this.organisms.length];
      const incoming = energy.get(org.id);
      org.flux.light = incoming;
      org.flux.uptake = 0;
      this.capturedLightLastTick += incoming;
      this.absorbedEnergy += incoming;
      org.energy += incoming;
      org.age++;
      org.cooldown--;
      const distance = this.moveOrganism(org);
      const maintenance = molecularTraits(org).maintenance;
      const cost = Math.min(org.energy, 0.0058 + 0.0007 * org.mass + distance * 1.9 + maintenance);
      org.energy -= cost;
      this.dissipatedEnergy += cost;
      if (org.energy <= 0.000001 || org.age >= org.maxAge) {
        const cause = org.age >= org.maxAge ? "fim do ciclo" : "reserva esgotada";
        this.deaths++;
        this.dissipatedEnergy += org.energy;
        this.addDetritus(org.x, org.y, org.mass);
        this.log("death", "Organismo #" + org.id + " retornou ao detrito (" + cause + ").", { id: org.id });
        continue;
      }
      org.flux.uptake = this.absorbNutrient(org);
      this.dissolvedUptakeLastTick += org.flux.uptake;
      const ateGrain = this.tryFeed(org);
      if (!ateGrain && org.flux.uptake < 0.003 && org.energy >= 0.3) {
        const remodelingCost = remodelFromReserve(org);
        org.energy -= remodelingCost;
        this.dissipatedEnergy += remodelingCost;
      }
      alive.push(org);
    }
    this.organisms = alive;
    for (const org of alive) this.tryDivide(org, newborns);
    this.organisms = alive.concat(newborns);
    if (this.tick % TELEMETRY_INTERVAL === 0) this.recordTelemetry();
    return this.tick;
  }

  getMetrics() {
    const population = this.organisms.length;
    const grainMass = total(this.grains, "mass");
    const bodyMass = total(this.organisms, "mass");
    const detritusMass = total(this.detritus, "mass");
    const water = this.environment.totals();
    const totalMass = grainMass + bodyMass + detritusMass + water.total;
    const totalEnergy = total(this.organisms, "energy");
    let generation = 0;
    let membraneMass = 0, pigmentMass = 0, transporterMass = 0, reserveMass = 0, allocation = 0;
    for (const org of this.organisms) {
      generation = Math.max(generation, org.generation);
      membraneMass += org.cell.membrane;
      pigmentMass += org.cell.pigment;
      transporterMass += org.cell.transporters;
      reserveMass += org.cell.reserve;
      allocation += org.genome.allocation;
    }
    return { tick: this.tick, population, generation, births: this.births, deaths: this.deaths,
      initialPopulation: this.initialPopulation, grainMass, bodyMass, detritusMass, totalMass,
      membraneMass, pigmentMass, transporterMass, reserveMass,
      meanAllocation: population ? allocation / population : null,
      capturedLightLastTick: this.capturedLightLastTick, dissolvedUptakeLastTick: this.dissolvedUptakeLastTick,
      nutrientMass: water.nutrient, wasteMass: water.waste, meanTurbidity: water.meanTurbidity,
      recycledLastTick: this.environment.lastRecycled, nutrientInputTotal: this.nutrientInputTotal,
      maxGeneration: generation, initialEnergy: this.initialEnergy, initialMass: this.initialMass,
      massError: totalMass - this.initialMass - this.nutrientInputTotal, totalEnergy,
      meanEnergy: population ? totalEnergy / population : 0,
      meanSensitivity: population ? total(this.organisms, "sensitivity") / population : 0,
      activeDistance: this.activeDistance, passiveDistance: this.passiveDistance,
      lightX: this.light.x, lightY: this.light.y, absorbedEnergy: this.absorbedEnergy,
      dissipatedEnergy: this.dissipatedEnergy,
      energyError: totalEnergy + this.dissipatedEnergy - this.absorbedEnergy - this.initialEnergy };
  }

  recordTelemetry() {
    const sample = this.getMetrics();
    if (this.telemetry.at(-1)?.tick === this.tick) this.telemetry[this.telemetry.length - 1] = sample;
    else this.telemetry.push(sample);
    if (this.telemetry.length > TELEMETRY_LIMIT) this.telemetry.shift();
  }

  serialize() {
    return copy({ version: SNAPSHOT_VERSION, ...this, environment: this.environment.serialize() });
  }

  static restore(snapshot) {
    if (!record(snapshot) || ![1, 2, SNAPSHOT_VERSION].includes(snapshot.version) ||
        !Array.isArray(snapshot.minerals)) throw new Error("Snapshot de lagoa incompatível.");
    // A v1 world already accounts for every unit in bodies, grains and detritus.
    // Starting its water at zero preserves the material and energy at migration.
    const missingWater = snapshot.version === 1;
    const missingMolecules = snapshot.version < SNAPSHOT_VERSION;
    const environment = missingWater ? new Environment({ minerals: snapshot.minerals }) :
      Environment.restore(snapshot.environment, snapshot.minerals);
    if (!validCheckpoint(snapshot, environment.totals().total) ||
        (!missingWater && (environment.tick !== snapshot.tick || !validTelemetry(snapshot))))
      throw new Error("Snapshot de lagoa incompatível.");
    const state = copy(snapshot);
    const world = Object.create(this.prototype);
    for (const key of ["seed", "rng", "tick", "nextId", "light", "organisms", "grains", "minerals",
      "detritus", "events", "births", "deaths", "activeDistance", "passiveDistance", "absorbedEnergy",
      "dissipatedEnergy", "initialPopulation", "initialMass", "initialEnergy"]) world[key] = state[key];
    world.environment = environment;
    world.environment.tick = world.tick;
    world.nutrientInputTotal = missingWater ? 0 : state.nutrientInputTotal;
    world.telemetry = missingWater ? [] : state.telemetry;
    world.molecularSinceTick = missingMolecules ? world.tick : state.molecularSinceTick;
    world.capturedLightLastTick = missingMolecules ? 0 : state.capturedLightLastTick;
    world.dissolvedUptakeLastTick = missingMolecules ? 0 : state.dissolvedUptakeLastTick;
    if (missingMolecules) {
      // Divide the already measured biomass into neutral stocks without RNG
      // draws, external input, or retroactive molecular measurements.
      for (const org of world.organisms) initializeMolecules(org, makeGenome(0.5));
      world.recordTelemetry();
    }
    return world;
  }
}

function validTelemetry(state) {
  if (!Array.isArray(state.telemetry) || !state.telemetry.length || state.telemetry.length > TELEMETRY_LIMIT)
    return false;
  let prev = -1;
  for (const sample of state.telemetry) {
    if (!record(sample) || !integer(sample.tick, prev + 1, state.tick) ||
        !["population", "births", "deaths"].every(key => integer(sample[key])) ||
        !["grainMass", "bodyMass", "detritusMass", "nutrientMass", "wasteMass", "absorbedEnergy",
          "dissipatedEnergy", "totalEnergy", "totalMass", "meanTurbidity", "nutrientInputTotal"]
          .every(key => Number.isFinite(sample[key]) && sample[key] >= 0) ||
        !Number.isFinite(sample.massError) || sample.initialMass !== state.initialMass ||
        sample.nutrientInputTotal > state.nutrientInputTotal ||
        sample.population !== state.initialPopulation + sample.births - sample.deaths)
      return false;
    const stocks = sample.grainMass + sample.bodyMass + sample.detritusMass + sample.nutrientMass + sample.wasteMass;
    const expected = state.initialMass + sample.nutrientInputTotal;
    const tolerance = 1e-8 * Math.max(1, expected);
    if (Math.abs(stocks - sample.totalMass) > tolerance ||
        Math.abs(sample.totalMass - expected - sample.massError) > tolerance) return false;
    if (state.version === SNAPSHOT_VERSION && sample.tick >= state.molecularSinceTick) {
      const compartments = [sample.membraneMass, sample.pigmentMass, sample.transporterMass, sample.reserveMass];
      if (!compartments.every(value => inRange(value, 0, sample.bodyMass + tolerance)) ||
          Math.abs(compartments.reduce((sum, value) => sum + value, 0) - sample.bodyMass) > tolerance ||
          (sample.population ? !inRange(sample.meanAllocation, 0, 1) : sample.meanAllocation !== null) ||
          !inRange(sample.capturedLightLastTick, 0, sample.absorbedEnergy + tolerance) ||
          !inRange(sample.dissolvedUptakeLastTick, 0, Number.MAX_SAFE_INTEGER)) return false;
    }
    prev = sample.tick;
  }
  return state.tick - prev < TELEMETRY_INTERVAL;
}

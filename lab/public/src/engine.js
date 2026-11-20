// Xenora's closed material cycle uses arbitrary units of matter and energy.
// Visible grains, organism biomass and detritus account for all reactive matter.
const TAU = 2 * Math.PI;
const SNAPSHOT_VERSION = 1;
const EVENT_LIMIT = 100;
const LIGHT_CELLS = 16;

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

function validCheckpoint(state) {
  if (!record(state) || state.version !== SNAPSHOT_VERSION || !validPosition(state.light) ||
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
  const ids = new Set();
  for (const group of ["organisms", "grains", "minerals", "detritus"]) {
    for (const obj of state[group]) {
      if (!validPosition(obj) || !integer(obj.id, 1, state.nextId - 1) || ids.has(obj.id) ||
        !inRange(obj.phase, 0, TAU) || !inRange(obj.radius, Number.EPSILON, 0.5) ||
        !inRange(obj.x, obj.radius, 1 - obj.radius) || !inRange(obj.y, obj.radius, 1 - obj.radius)) return false;
      ids.add(obj.id);
      if (group === "minerals") continue;
      if (!inRange(obj.mass, Number.EPSILON, state.initialMass) ||
        Math.abs(obj.radius - (group === "organisms" ? bodyRadius(obj.mass) : grainRadius(obj.mass))) > 1e-10) return false;
      if (group === "organisms" && !validOrganism(obj, state.nextId)) return false;
      if (group === "detritus" && !integer(obj.decayAt, state.tick + 1)) return false;
    }
  }
  let prevTick = 0;
  for (const event of state.events) {
    if (!record(event) || !integer(event.tick, prevTick, state.tick) || typeof event.text !== "string" ||
      !["start", "birth", "death", "light"].includes(event.type)) return false;
    prevTick = event.tick;
    if (event.type === "light" && !validPosition(event)) return false;
    if ((event.type === "birth" || event.type === "death") && !integer(event.id, 1, state.nextId - 1)) return false;
    if (event.type === "birth" && !integer(event.parent, 1, event.id - 1)) return false;
  }
  const mass = total(state.organisms, "mass") + total(state.grains, "mass") + total(state.detritus, "mass");
  const stored = total(state.organisms, "energy");
  const expected = state.initialEnergy + state.absorbedEnergy - state.dissipatedEnergy;
  return Math.abs(mass - state.initialMass) <= 1e-8 * Math.max(1, state.initialMass) &&
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

    const rocks = [[0.15, 0.23, 0.026], [0.22, 0.76, 0.037], [0.52, 0.28, 0.032],
      [0.52, 0.71, 0.037], [0.84, 0.25, 0.024], [0.84, 0.71, 0.031], [0.68, 0.48, 0.018]];
    for (const [x, y, radius] of rocks) {
      this.minerals.push({ id: this.nextId++, x: x + this.noise(0.025),
        y: y + this.noise(0.025), radius, phase: this.random() * TAU });
    }

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
    this.initialPopulation = this.organisms.length;
    this.initialMass = total(this.grains, "mass") + total(this.organisms, "mass");
    this.initialEnergy = total(this.organisms, "energy");
    this.log("start", "A lagoa foi povoada com " + this.initialPopulation + " organismos.");
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
  }

  lightAt(x, y) {
    const dx = x - this.light.x;
    const dy = y - this.light.y;
    return Math.exp(-(dx * dx + dy * dy) / 0.055);
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
    // A bounded, slow circulation field drives passive motion; organisms also propel themselves.
    const t = this.tick * 0.003;
    const dx = mobility * (0.00052 * Math.sin(7 * entity.y + t) + this.noise(0.00035));
    const dy = mobility * (0.00048 * Math.cos(7 * entity.x - t) + this.noise(0.00035));
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
      const intensity = this.lightAt(x, y);
      const share = Math.min(0.053 * intensity, 0.11 * intensity / occupants.length);
      for (const org of occupants) incoming.set(org.id, Math.min(share, 9 - org.energy));
    }
    return incoming;
  }

  tryFeed(org) {
    if (org.cooldown > 0 || org.mass >= 6.4) return;
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
    if (best < 0) return;
    const g = this.grains[best];
    // Fully assimilate very small grains instead of creating ever finer debris.
    const waste = g.mass > 0.20 ? 0.19 * g.mass : 0;
    const nextMass = org.mass + g.mass - waste;
    const nextRadius = bodyRadius(nextMass);
    if (!this.free(org.x, org.y, nextRadius, this.organisms, org)) return;
    this.grains.splice(best, 1);
    org.mass = nextMass;
    org.radius = nextRadius;
    this.addDetritus(g.x, g.y, waste);
    org.cooldown = 28;
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
        activeDistance: 0, passiveDistance: 0, maxAge: 1050 + Math.floor(this.random() * 850),
        sensitivity: clamp(org.sensitivity + this.noise(0.07), 0.05, 1) };
      newborns.push(child);
      this.births++;
      this.log("birth", "Organismo #" + org.id + " originou #" + child.id + ".", { id: child.id, parent: org.id });
      return;
    }
  }

  step() {
    this.tick++;
    for (const g of this.grains) this.drift(g, 1);
    const remains = [];
    for (const d of this.detritus) {
      this.drift(d, 0.42);
      if (this.tick < d.decayAt) {
        remains.push(d);
        continue;
      }
      const parts = Math.max(1, Math.ceil(d.mass / 0.95));
      for (let p = 0; p < parts; p++) {
        const x = d.x + this.noise(0.018);
        const y = d.y + this.noise(0.018);
        const ok = this.free(x, y, grainRadius(d.mass / parts));
        this.addGrain(ok ? x : d.x, ok ? y : d.y, d.mass / parts);
      }
    }
    this.detritus = remains;

    const alive = [];
    const newborns = [];
    const energy = this.energyShares();
    // Rotate priority by a seeded offset so food contested in one tick is counted only once.
    const start = this.organisms.length ? Math.floor(this.random() * this.organisms.length) : 0;
    for (let n = 0; n < this.organisms.length; n++) {
      const org = this.organisms[(start + n) % this.organisms.length];
      const incoming = energy.get(org.id);
      this.absorbedEnergy += incoming;
      org.energy += incoming;
      org.age++;
      org.cooldown--;
      const distance = this.moveOrganism(org);
      const cost = Math.min(org.energy, 0.0058 + 0.0007 * org.mass + distance * 1.9);
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
      this.tryFeed(org);
      alive.push(org);
    }
    this.organisms = alive;
    for (const org of alive) this.tryDivide(org, newborns);
    this.organisms = alive.concat(newborns);
    return this.tick;
  }

  getMetrics() {
    const population = this.organisms.length;
    const grainMass = total(this.grains, "mass");
    const bodyMass = total(this.organisms, "mass");
    const detritusMass = total(this.detritus, "mass");
    const totalMass = grainMass + bodyMass + detritusMass;
    const totalEnergy = total(this.organisms, "energy");
    let generation = 0;
    for (const org of this.organisms) generation = Math.max(generation, org.generation);
    return { tick: this.tick, population, generation, births: this.births, deaths: this.deaths,
      initialPopulation: this.initialPopulation, grainMass, bodyMass, detritusMass, totalMass,
      initialMass: this.initialMass, massError: totalMass - this.initialMass, totalEnergy,
      meanEnergy: population ? totalEnergy / population : 0,
      meanSensitivity: population ? total(this.organisms, "sensitivity") / population : 0,
      activeDistance: this.activeDistance, passiveDistance: this.passiveDistance,
      lightX: this.light.x, lightY: this.light.y, absorbedEnergy: this.absorbedEnergy,
      dissipatedEnergy: this.dissipatedEnergy,
      energyError: totalEnergy + this.dissipatedEnergy - this.absorbedEnergy - this.initialEnergy };
  }

  serialize() {
    return copy({ version: SNAPSHOT_VERSION, ...this });
  }

  static restore(snapshot) {
    if (!validCheckpoint(snapshot)) throw new Error("Snapshot de lagoa incompatível.");
    const state = copy(snapshot);
    const world = Object.create(World.prototype);
    for (const key of ["seed", "rng", "tick", "nextId", "light", "organisms", "grains", "minerals",
      "detritus", "events", "births", "deaths", "activeDistance", "passiveDistance", "absorbedEnergy",
      "dissipatedEnergy", "initialPopulation", "initialMass", "initialEnergy"]) world[key] = state[key];
    return world;
  }
}

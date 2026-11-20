// Local, overdamped particles in a representative sample of the planetary pond.
// An abstract material parcel has mass 1. These parcels are not additional atoms
// in the cosmic ledger. Stored energy consists of available particle charge
// and charge committed to links. Motion is dissipative, with no inertial state.
const CAPACITY = 1.5;
const BOND_ENERGY = 0.036;
const LINK_HEAT = 0.002;
const REACH = 0.083;
const EDGE = 0.009;
const STABLE_AGE = 20;
const MAX_COUNT = 384;
const VALENCE = { a: 3, b: 3, c: 0 };
const SUM = (items, key) => items.reduce((s, item) => s + item[key], 0);

function finite(x, min, max = Number.MAX_SAFE_INTEGER) {
  return Number.isFinite(x) && x >= min && x <= max;
}

function integer(x, min, max = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(x) && x >= min && x <= max;
}

function checked(ok, message = 'Estado de partículas primordiais inválido.') {
  if (!ok) throw new Error(message);
}

function copy(data) {
  return JSON.parse(JSON.stringify(data));
}

function nextRandom(state) {
  let x = state >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

// Pair decisions do not consume the motion RNG. A control that disables bonds
// still receives the same thermal draws for each labelled particle on each tick.
function pairDraw(seed, tick, a, b, salt) {
  let x = (seed ^ Math.imul(tick, 0x9e3779b1) ^ Math.imul(a + salt, 0x85ebca6b) ^
    Math.imul(b, 0xc2b2ae35)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

function originOf(options) {
  const mineralUnits = options.mineralUnits ?? 1.15;
  const carbon = options.carbon ?? 1;
  const oxygen = options.oxygen ?? 1;
  const density = options.mineralDensity ?? Math.min(1, mineralUnits / 2.3);
  checked([mineralUnits, carbon, oxygen].every(n => finite(n, 0)) && finite(density, 0, 1),
    'Reservatórios de origem inválidos.');
  return { scale: 'representative', mineralUnits, carbon, oxygen, mineralDensity: mineralUnits > 0 ? density : 0 };
}

export function surfaceMineralSites(seed, density) {
  const count = density > 0 ? Math.ceil(5 * density) : 0;
  const sites = [];
  for (let i = 0; i < count; i++) {
    sites.push({ id: i + 1, x: 0.12 + 0.76 * pairDraw(seed, 0, i, 5, 17),
      y: 0.12 + 0.76 * pairDraw(seed, 0, i, 6, 17), radius: 0.075 + 0.055 * density,
      strength: 0.0007 * density });
  }
  return sites;
}

function initialKinds(count, origin, random) {
  const supplied = origin.carbon + origin.oxygen;
  const reactive = supplied ? Math.round(0.80 * count) : 0;
  const a = supplied ? Math.round(reactive * origin.carbon / supplied) : 0;
  const kinds = Array.from({ length: count }, (_, i) => i < a ? 'a' : i < reactive ? 'b' : 'c');
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  return kinds;
}

function emptyObserver() {
  return { nextId: 1, formations: 0, dispersals: 0, clusters: [] };
}

// A convex envelope only describes the observed geometry. A polygon may enclose
// empty water even when the bond graph itself is open.
function contourOf(members, byId) {
  const points = members.map(id => byId.get(id)).sort((a, b) => a.x - b.x || a.y - b.y || a.id - b.id);
  function half(ordered) {
    const hull = [];
    for (const p of ordered) {
      while (hull.length >= 2) {
        const a = hull[hull.length - 2], b = hull[hull.length - 1];
        if ((b.x-a.x)*(p.y-a.y) - (b.y-a.y)*(p.x-a.x) > 0) break;
        hull.pop();
      }
      hull.push(p);
    }
    hull.pop();
    return hull;
  }
  const hull = half(points).concat(half(points.reverse()));
  let twiceArea = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i+1) % hull.length];
    twiceArea += a.x * b.y - a.y * b.x;
  }
  return { contour: hull.map(p => p.id), area: Math.abs(twiceArea) / 2 };
}

// Read-only observer. An observed aggregate persists across a step if it keeps
// a strict majority of both its old and new membership. Ties start a new ID.
// A cycle is a graph property, not a membrane or a reproduction event.
export function observeAggregates(particles, bonds, previous = emptyObserver()) {
  const adj = new Map();
  for (const { a, b } of bonds) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  }
  const oldByMember = new Map();
  for (const cluster of previous.clusters) {
    for (const member of cluster.members) oldByMember.set(member, cluster);
  }
  const byId = new Map(particles.map(p => [p.id, p]));
  const seen = new Set(), retained = new Set(), clusters = [];
  let nextId = previous.nextId;
  for (const p of particles) {
    if (!adj.has(p.id) || seen.has(p.id)) continue;
    const members = [p.id], overlaps = new Map();
    let edges = 0, x = 0, y = 0;
    seen.add(p.id);
    for (let i = 0; i < members.length; i++) {
      const id = members[i], at = byId.get(id);
      x += at.x; y += at.y;
      const old = oldByMember.get(id);
      if (old) overlaps.set(old, (overlaps.get(old) || 0) + 1);
      const neighbors = adj.get(id);
      edges += neighbors.length;
      for (const neighbor of neighbors) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        members.push(neighbor);
      }
    }
    x /= members.length; y /= members.length;
    let radius = 0;
    for (const id of members) {
      const at = byId.get(id);
      radius = Math.max(radius, Math.hypot(at.x - x, at.y - y));
    }
    let match = null;
    for (const [old, overlap] of overlaps) {
      if (2 * overlap > old.members.length && 2 * overlap > members.length) { match = old; break; }
    }
    if (match) retained.add(match.id);
    const age = match ? match.age + 1 : 1;
    const envelope = contourOf(members, byId);
    clusters.push({ id: match ? match.id : nextId++, members: members.sort((a, b) => a - b),
      x, y, radius, age, ...envelope, closed: edges / 2 >= members.length,
      stable: age >= STABLE_AGE && members.length >= 3 });
  }
  return { clusters, nextId, formations: previous.formations + clusters.length - retained.size,
    dispersals: previous.dispersals + previous.clusters.length - retained.size };
}

export class PrimordialParticles {
  constructor(seed = 42, options = {}) {
    checked(integer(seed, 0, 0xffffffff), 'Semente primordial inválida.');
    const count = options.count ?? 120, bindingEnabled = options.bindingEnabled ?? true;
    const sourcePower = options.sourcePower ?? 1;
    checked(integer(count, 0, MAX_COUNT) && typeof bindingEnabled === 'boolean' && finite(sourcePower, 0, 8),
      'Parâmetros primordiais inválidos.');
    this.seed = seed;
    this.rng = seed || 0x6d2b79f5;
    this.options = { count, bindingEnabled };
    this.origin = originOf(options);
    this.tick = 0;
    this.source = { x: 0.32, y: 0.38, power: sourcePower };
    this.sites = surfaceMineralSites(seed, this.origin.mineralDensity);
    const kinds = initialKinds(count, this.origin, () => this.random());
    this.particles = kinds.map((kind, i) => ({ id: i + 1, kind, mass: 1,
      x: 0.015 + 0.97 * this.random(), y: 0.015 + 0.97 * this.random(),
      vx: 0.002 * (this.random() - 0.5), vy: 0.002 * (this.random() - 0.5),
      energy: 0.12 + 0.12 * this.random() }));
    this.initialMass = SUM(this.particles, 'mass');
    this.initialEnergy = SUM(this.particles, 'energy');
    this.inputEnergy = 0;
    this.dissipatedEnergy = 0;
    this.bonds = [];
    this.observer = emptyObserver();
  }

  random() {
    this.rng = nextRandom(this.rng);
    return this.rng / 4294967296;
  }

  setSource(x, y, power = this.source.power) {
    checked(finite(x, 0, 1) && finite(y, 0, 1) && finite(power, 0, 8), 'Fonte de energia inválida.');
    this.source = { x, y, power };
  }

  step() {
    this.tick++;
    const ps = this.particles, n = ps.length;
    const fx = new Float64Array(n), fy = new Float64Array(n), degree = new Uint8Array(n);
    const linked = new Set(), intact = [];
    const binCount = Math.ceil(1 / REACH), bins = new Map();
    const key = (i, j) => i * MAX_COUNT + j;
    for (let i = 0; i < n; i++) {
      const p = ps[i], sx = this.source.x - p.x, sy = this.source.y - p.y;
      const received = Math.min(CAPACITY - p.energy, this.source.power / n * Math.exp(-(sx*sx + sy*sy) / 0.11));
      p.energy += received;
      this.inputEnergy += received;
      for (const site of this.sites) {
        if (p.kind === 'c') continue;
        const dx = site.x - p.x, dy = site.y - p.y, distance = Math.hypot(dx, dy);
        if (distance >= site.radius) continue;
        // A finite surface locally draws reactive units into the same neighborhood.
        const pull = site.strength * (1 - distance / site.radius) / site.radius;
        fx[i] += dx * pull; fy[i] += dy * pull;
      }
      const cell = Math.floor(p.x / REACH) + binCount * Math.floor(p.y / REACH);
      if (!bins.has(cell)) bins.set(cell, []);
      bins.get(cell).push(i);
    }
    for (const bond of this.bonds) {
      const i = bond.a - 1, j = bond.b - 1, p = ps[i], q = ps[j];
      const dx = q.x - p.x, dy = q.y - p.y, d = Math.max(1e-8, Math.hypot(dx, dy));
      if (d > 0.092 || pairDraw(this.seed, this.tick, i, j, 21) < 0.003) {
        this.dissipatedEnergy += bond.energy;
        continue;
      }
      const spring = 0.085 * (d - bond.rest) / d;
      fx[i] += dx * spring; fy[i] += dy * spring;
      fx[j] -= dx * spring; fy[j] -= dy * spring;
      degree[i]++; degree[j]++; linked.add(key(i, j)); intact.push(bond);
    }
    for (let i = 0; i < n; i++) {
      const p = ps[i], bx = Math.floor(p.x / REACH), by = Math.floor(p.y / REACH);
      for (let cy = Math.max(0, by - 1); cy <= Math.min(binCount - 1, by + 1); cy++) {
        for (let cx = Math.max(0, bx - 1); cx <= Math.min(binCount - 1, bx + 1); cx++) {
          for (const j of bins.get(cx + binCount * cy) || []) {
            if (j <= i) continue;
            const q = ps[j], dx = q.x - p.x, dy = q.y - p.y;
            const d = Math.max(1e-8, Math.hypot(dx, dy));
            if (d >= REACH) continue;
            const compatible = p.kind !== q.kind && p.kind !== 'c' && q.kind !== 'c';
            const force = d < 0.021 ? -0.0023 * (1 - d / 0.021) :
              compatible ? 0.00055 * (1 - d / REACH) : 0;
            fx[i] += dx / d * force; fy[i] += dy / d * force;
            fx[j] -= dx / d * force; fy[j] -= dy / d * force;
            if (!this.options.bindingEnabled || !compatible || d >= 0.048 || linked.has(key(i,j)) ||
                degree[i] >= VALENCE[p.kind] || degree[j] >= VALENCE[q.kind]) continue;
            const share = (BOND_ENERGY + LINK_HEAT) / 2;
            if (p.energy < share || q.energy < share || pairDraw(this.seed, this.tick, i, j, 52) >= 0.22) continue;
            p.energy -= share; q.energy -= share;
            this.dissipatedEnergy += LINK_HEAT;
            intact.push({ a: p.id, b: q.id, formedAt: this.tick, rest: 0.030, energy: BOND_ENERGY });
            degree[i]++; degree[j]++;
          }
        }
      }
    }
    this.bonds = intact;
    for (let i = 0; i < n; i++) {
      const p = ps[i], mobility = Math.min(1, p.energy / 0.06);
      const ux = (0.76 * p.vx + 0.0014 * (2*this.random()-1) + fx[i]) * mobility;
      const uy = (0.76 * p.vy + 0.0014 * (2*this.random()-1) + fy[i]) * mobility;
      const scale = Math.min(1, 0.006 / Math.max(1e-8, Math.hypot(ux, uy)));
      p.vx = ux * scale; p.vy = uy * scale;
      const nx = p.x + p.vx, ny = p.y + p.vy;
      p.x = Math.min(1 - EDGE, Math.max(EDGE, nx));
      p.y = Math.min(1 - EDGE, Math.max(EDGE, ny));
      if (p.x !== nx) p.vx *= -0.6;
      if (p.y !== ny) p.vy *= -0.6;
      const spent = Math.min(p.energy, 0.00022 + 0.085 * Math.hypot(p.vx, p.vy));
      p.energy -= spent; this.dissipatedEnergy += spent;
    }
    this.observer = observeAggregates(ps, this.bonds, this.observer);
    return this.tick;
  }

  getMetrics() {
    const totalMass = SUM(this.particles, 'mass');
    const internalEnergy = SUM(this.particles, 'energy'), bondEnergy = SUM(this.bonds, 'energy');
    const storedEnergy = internalEnergy + bondEnergy;
    const clusters = this.observer.clusters;
    return { tick: this.tick, particleCount: this.particles.length, bondCount: this.bonds.length,
      componentCount: clusters.length, stableCount: clusters.filter(c => c.stable).length,
      cycleCount: clusters.filter(c => c.closed).length, largestSize: clusters.reduce((n,c) => Math.max(n,c.members.length), 0),
      formations: this.observer.formations, dispersals: this.observer.dispersals, mineralSiteCount: this.sites.length,
      initialMass: this.initialMass, totalMass, massError: totalMass - this.initialMass,
      initialEnergy: this.initialEnergy, internalEnergy, bondEnergy, storedEnergy, inputEnergy: this.inputEnergy,
      dissipatedEnergy: this.dissipatedEnergy, energyError: storedEnergy + this.dissipatedEnergy - this.initialEnergy - this.inputEnergy,
      lifeStatus: 'não demonstrada', demonstratedLifeCount: 0 };
  }

  serialize() {
    return copy({ version: 1, mode: 'primordial-particles', seed: this.seed, rng: this.rng, tick: this.tick,
      options: this.options, origin: this.origin, source: this.source, sites: this.sites, particles: this.particles,
      bonds: this.bonds, observer: this.observer, initialMass: this.initialMass, initialEnergy: this.initialEnergy,
      inputEnergy: this.inputEnergy, dissipatedEnergy: this.dissipatedEnergy });
  }

  static restore(data) {
    checked(data?.mode === 'primordial-particles' && data.version === 1 && integer(data.seed, 0, 0xffffffff) &&
      integer(data.rng, 1, 0xffffffff) && integer(data.tick, 0) && data.origin?.scale === 'representative' &&
      Array.isArray(data.particles) && integer(data.options?.count, 0, MAX_COUNT) &&
      data.particles.length === data.options.count && typeof data.options.bindingEnabled === 'boolean' &&
      Array.isArray(data.bonds) && Array.isArray(data.sites) && data.observer && Array.isArray(data.observer.clusters));
    const world = new PrimordialParticles(data.seed, { ...data.origin, ...data.options });
    checked(data.initialMass === world.initialMass && data.initialEnergy === world.initialEnergy &&
      data.origin.mineralDensity === world.origin.mineralDensity &&
      ['carbon','oxygen','mineralUnits'].every(k => data.origin[k] === world.origin[k]));
    checked(data.sites.length === world.sites.length && data.sites.every((site,i) =>
      ['id','x','y','radius','strength'].every(k => site[k] === world.sites[i][k])));
    world.setSource(data.source?.x, data.source?.y, data.source?.power);
    checked(finite(data.source.power, 0, 8) && finite(data.inputEnergy, 0, 8 * data.tick + 1e-9) &&
      finite(data.dissipatedEnergy, 0));
    for (let i = 0; i < data.particles.length; i++) {
      const p = data.particles[i];
      checked(p?.id === i + 1 && p.mass === 1 && p.kind === world.particles[i].kind &&
        finite(p.x, EDGE, 1 - EDGE) && finite(p.y, EDGE, 1 - EDGE) &&
        finite(p.energy, 0, CAPACITY) && Number.isFinite(p.vx) && Number.isFinite(p.vy) &&
        Math.hypot(p.vx, p.vy) <= 0.006 + 1e-12);
    }
    const seen = new Set(), degrees = new Uint8Array(data.particles.length);
    for (const b of data.bonds) {
      checked(data.options.bindingEnabled && integer(b?.a, 1, data.particles.length) &&
        integer(b.b, b.a + 1, data.particles.length) && integer(b.formedAt, 1, data.tick) &&
        b.energy === BOND_ENERGY && b.rest === 0.030);
      const k = b.a * (MAX_COUNT+1) + b.b;
      checked(!seen.has(k));
      seen.add(k);
      const a = data.particles[b.a - 1], other = data.particles[b.b - 1];
      checked(a.kind !== other.kind && ++degrees[b.a-1] <= VALENCE[a.kind] && ++degrees[b.b-1] <= VALENCE[other.kind]);
      const reach = b.formedAt === data.tick ? 0.048 : 0.092;
      checked(Math.hypot(a.x-other.x, a.y-other.y) <= reach + 2 * 0.006 + 1e-12);
    }
    world.tick = data.tick; world.rng = data.rng;
    world.particles = copy(data.particles); world.bonds = copy(data.bonds);
    world.inputEnergy = data.inputEnergy; world.dissipatedEnergy = data.dissipatedEnergy;
    const ob = data.observer;
    checked(integer(ob.formations, 0) && integer(ob.dispersals, 0, ob.formations) &&
      ob.nextId === ob.formations + 1 && ob.formations - ob.dispersals === ob.clusters.length);
    const graph = observeAggregates(world.particles, world.bonds).clusters;
    checked(graph.length === ob.clusters.length);
    const ids = new Set();
    for (let i = 0; i < graph.length; i++) {
      const c = ob.clusters[i], g = graph[i];
      checked(integer(c.id, 1, ob.formations) && !ids.has(c.id) && integer(c.age, 1, data.tick) &&
        Array.isArray(c.members) && c.members.length === g.members.length && g.members.every((id,k) => id === c.members[k]) &&
        c.closed === g.closed && c.stable === (c.age >= STABLE_AGE && g.members.length >= 3) &&
        Array.isArray(c.contour) && c.contour.length === g.contour.length && g.contour.every((id,k) => id === c.contour[k]) &&
        ['x','y','radius','area'].every(key => Math.abs(c[key] - g[key]) <= 1e-12 && Number.isFinite(c[key])));
      ids.add(c.id);
    }
    world.observer = copy(ob);
    const m = world.getMetrics();
    checked(Math.abs(m.energyError) <= 1e-8 * Math.max(1, m.initialEnergy + m.inputEnergy));
    return world;
  }
}

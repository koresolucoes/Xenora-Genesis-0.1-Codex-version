// Dimensionless pond: unit square L×L, uniform depth, one tick T by default.
// Each finite volume stores MASS (M), not concentration. The concentration
// displayed or sampled is areal mass density M/L². No flux crosses the shores.
// Bottom minerals catalyze recycling in the water column above their surfaces.
export const ENVIRONMENT_DEFAULTS = Object.freeze({
  size: 24, dt: 1, diffusionNutrient: 0.000028, diffusionWaste: 0.000014,
  flowSpeed: 0.00052, decayRate: 0.0022, mineralBoost: 5,
  mineralReach: 0.055, opacity: 0.020
});

function finite(value, min, max = Infinity) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function unit(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function lerp(a, b, weight) {
  return a + weight * (b - a);
}

// gx and gy are matrix coordinates, including the half-cell offset for
// cell centers or staggered face centers. Constant extension at the boundary.
function bilinear(values, width, height, gx, gy) {
  gx = Math.max(0, Math.min(width - 1, gx));
  gy = Math.max(0, Math.min(height - 1, gy));
  const x = Math.floor(gx), y = Math.floor(gy);
  const i = y * width + x, j = x + 1 < width ? i + 1 : i;
  const row = y + 1 < height ? width : 0;
  return lerp(lerp(values[i], values[j], gx - x),
    lerp(values[i + row], values[j + row], gx - x), gy - y);
}

function sum(values) {
  let result = 0;
  for (let i = 0; i < values.length; i++) result += values[i];
  return result;
}

export class Environment {
  constructor(options = {}) {
    const p = { ...ENVIRONMENT_DEFAULTS, ...options };
    if (!Number.isInteger(p.size) || !finite(p.size, 2, 256) ||
      !finite(p.dt, Number.EPSILON) || !finite(p.mineralReach, Number.EPSILON) ||
      !["diffusionNutrient", "diffusionWaste", "flowSpeed", "decayRate", "mineralBoost", "opacity"]
        .every(k => finite(p[k], 0))) throw new Error("Parâmetros ambientais inválidos.");
    for (const k of Object.keys(ENVIRONMENT_DEFAULTS)) this[k] = p[k];
    this.minerals = (p.minerals ?? []).map(({x, y, radius}) => {
      if (!finite(x, 0, 1) || !finite(y, 0, 1) || !finite(radius, 0, 1))
        throw new Error("Posição mineral inválida.");
      return {x, y, radius};
    });

    const n = this.size;
    this.dx = 1 / n;
    this.cellArea = this.dx * this.dx;
    this.nutrient = new Float64Array(n * n);
    this.waste = new Float64Array(n * n);
    this.activity = new Float64Array(n * n);
    this.recycleFraction = new Float64Array(n * n);
    this.workN = new Float64Array(n * n);
    this.workW = new Float64Array(n * n);
    this.u = new Float64Array((n + 1) * n);
    this.v = new Float64Array(n * (n + 1));
    this.tick = 0;
    this.revision = 0;
    this.lastRecycled = 0;

    // This bounds outgoing upwind advection and diffusion simultaneously,
    // retaining a positive diagonal coefficient in every explicit substep.
    const limit = this.dt * (4 * Math.max(this.diffusionNutrient, this.diffusionWaste) / this.cellArea +
      4 * this.flowSpeed / this.dx);
    this.substeps = Math.max(1, Math.ceil(limit / 0.85));
    if (this.substeps > 2048) throw new Error("Passo ambiental excede a resolução temporal suportada.");

    this.buildFields();
  }

  buildFields() {
    const n = this.size;
    const s = new Float64Array(n + 1);
    for (let i = 1; i < n; i++) s[i] = Math.sin(Math.PI * i / n);
    // Streamfunction ψ=U·L/π sin(πx/L)sin(πy/L). Discrete face velocities
    // are corner differences of ψ: divergence cancels exactly by construction,
    // and normal velocity at each outer face is identically zero.
    const a = this.flowSpeed / (Math.PI * this.dx);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x <= n; x++) this.u[y*(n+1)+x] = a * s[x] * (s[y+1] - s[y]);
    }
    for (let y = 0; y <= n; y++) {
      for (let x = 0; x < n; x++) this.v[y*n+x] = -a * s[y] * (s[x+1] - s[x]);
    }
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y*n+x;
        let activity = 0;
        for (const m of this.minerals) {
          const gap = Math.max(0, Math.hypot((x+0.5)/n-m.x, (y+0.5)/n-m.y) - m.radius);
          activity = Math.max(activity, Math.exp(-0.5 * (gap / this.mineralReach) ** 2));
        }
        this.activity[i] = activity;
        this.recycleFraction[i] = -Math.expm1(-this.dt * this.decayRate * (1 + this.mineralBoost * activity));
      }
    }
  }

  field(kind) {
    if (kind === "nutrient") return this.nutrient;
    if (kind === "waste") return this.waste;
    throw new Error("Campo ambiental desconhecido.");
  }

  index(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Posição ambiental inválida.");
    const n = this.size;
    return Math.min(n-1, Math.floor(unit(y)*n))*n + Math.min(n-1, Math.floor(unit(x)*n));
  }

  add(kind, x, y, mass) {
    if (!finite(mass, 0)) throw new Error("Massa ambiental inválida.");
    this.field(kind)[this.index(x, y)] += mass;
    if (mass > 0) this.revision++;
    return mass;
  }

  take(kind, x, y, maxMass) {
    if (!finite(maxMass, 0)) throw new Error("Massa ambiental inválida.");
    const field = this.field(kind), i = this.index(x, y);
    const amount = Math.min(maxMass, field[i]);
    field[i] -= amount;
    if (amount > 0) this.revision++;
    return amount;
  }

  centered(values, x, y) {
    return bilinear(values, this.size, this.size, x*this.size-0.5, y*this.size-0.5);
  }

  gradient(kind, x, y) {
    const values = this.field(kind);
    const h = this.dx / 2;
    const scale = 1 / (this.dx * this.cellArea);
    return { x: (this.centered(values, x+h, y)-this.centered(values, x-h, y))*scale,
      y: (this.centered(values, x, y+h)-this.centered(values, x, y-h))*scale };
  }

  flowAt(x, y) {
    const n = this.size;
    return { x: bilinear(this.u, n+1, n, x*n, y*n-0.5),
      y: bilinear(this.v, n, n+1, x*n-0.5, y*n) };
  }

  turbidityAt(x, y) {
    // Optical depth τ = κ·(M/L²), with κ in L²/M. Vertical path through
    // the modeled water column is absorbed into κ.
    return this.opacity * this.centered(this.waste, x, y) / this.cellArea;
  }

  transmissionAt(x, y) {
    return Math.exp(-this.turbidityAt(x, y));
  }

  sample(x, y) {
    const nutrient = this.centered(this.nutrient, x, y) / this.cellArea;
    const waste = this.centered(this.waste, x, y) / this.cellArea;
    const turbidity = this.opacity * waste;
    return { nutrient, waste, turbidity, transmission: Math.exp(-turbidity),
      mineralActivity: this.centered(this.activity, x, y) };
  }

  transport() {
    const n = this.size;
    const time = this.dt / this.substeps;
    const nd = this.diffusionNutrient * time / this.cellArea;
    const wd = this.diffusionWaste * time / this.cellArea;
    const adv = time / this.dx;
    const nutrient = this.nutrient, waste = this.waste, nn = this.workN, ww = this.workW;
    nn.set(nutrient);
    ww.set(waste);
    // Internal face transfer only: positive flux leaves left/top cell i and
    // enters neighbor j. Fick uses cell differences; advection uses upwinding.
    // Reading only the old arrays keeps the result independent of sweep order.
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        if (x + 1 < n) {
          const j = i + 1, a = this.u[y*(n+1)+x+1]*adv;
          const donor = a >= 0 ? i : j;
          const fn = nd*(nutrient[i]-nutrient[j]) + a*nutrient[donor];
          const fw = wd*(waste[i]-waste[j]) + a*waste[donor];
          nn[i] -= fn; nn[j] += fn;
          ww[i] -= fw; ww[j] += fw;
        }
        if (y + 1 < n) {
          const j = i+n, a = this.v[j]*adv;
          const donor = a >= 0 ? i : j;
          const fn = nd*(nutrient[i]-nutrient[j]) + a*nutrient[donor];
          const fw = wd*(waste[i]-waste[j]) + a*waste[donor];
          nn[i] -= fn; nn[j] += fn;
          ww[i] -= fw; ww[j] += fw;
        }
      }
    }
    nutrient.set(nn);
    waste.set(ww);
  }

  step() {
    for (let k = 0; k < this.substeps; k++) this.transport();
    let recycled = 0;
    for (let i = 0; i < this.waste.length; i++) {
      // Exact first-order reaction in each local parcel, split after transport.
      const amount = this.waste[i] * this.recycleFraction[i];
      this.waste[i] -= amount;
      this.nutrient[i] += amount;
      recycled += amount;
    }
    this.tick++;
    this.revision++;
    this.lastRecycled = recycled;
    return recycled;
  }

  totals() {
    const nutrient = sum(this.nutrient), waste = sum(this.waste);
    return { nutrient, waste, total: nutrient+waste, meanTurbidity: this.opacity*waste };
  }

  serialize() {
    const parameters = Object.fromEntries(Object.keys(ENVIRONMENT_DEFAULTS).map(k => [k, this[k]]));
    return { version: 1, parameters, minerals: this.minerals.map(m => ({...m})),
      tick: this.tick, lastRecycled: this.lastRecycled, nutrient: Array.from(this.nutrient), waste: Array.from(this.waste) };
  }

  static restore(data, minerals) {
    if (!data || data.version !== 1 || !data.parameters ||
      !Object.keys(ENVIRONMENT_DEFAULTS).every(k => Number.isFinite(data.parameters[k])) ||
      !Number.isSafeInteger(data.tick) || data.tick < 0 || !finite(data.lastRecycled, 0) ||
      !Array.isArray(data.minerals)) throw new Error("Checkpoint ambiental inválido.");
    const env = new Environment({...data.parameters, minerals: minerals ?? data.minerals});
    for (const kind of ["nutrient", "waste"]) {
      const values = data[kind];
      if (!Array.isArray(values) || values.length !== env.size ** 2 || !values.every(v => finite(v, 0)))
        throw new Error("Campo do checkpoint ambiental inválido.");
      env[kind].set(values);
    }
    env.tick = data.tick;
    env.lastRecycled = data.lastRecycled;
    return env;
  }
}

// This is a digital allocation model. A bit selects investment in one of two
// kinds of machinery; it does not encode a biological sequence or molecule.
const TAPE_LENGTH = 20;
const MUTATION_CHANCE = 1 / 6;
const MEMBRANE_FRACTION = 0.36;
const MACHINERY_FRACTION = 0.44;
const MIN_SITE_SHARE = 0.10;
const POOLS = ["membrane", "pigment", "transporters", "reserve"];

function genomeFromSequence(sequence) {
  let ones = 0;
  for (const bit of sequence) if (bit === "1") ones++;
  return { sequence, allocation: ones / TAPE_LENGTH };
}

function validGenome(genome) {
  return typeof genome?.sequence === "string" && /^[01]{20}$/.test(genome.sequence) &&
    genome.sequence.length === TAPE_LENGTH &&
    genome.allocation === genomeFromSequence(genome.sequence).allocation;
}

function unitDraw(random) {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("O gerador do genoma deve produzir valores em [0,1).");
  }
  return value;
}

// Used by matched trials and by migrations, without advancing the world clock
// or RNG. A requested share is rounded to the nearest representable 1/20.
export function makeGenome(allocation) {
  if (!Number.isFinite(allocation) || allocation < 0 || allocation > 1) {
    throw new RangeError("Alocação molecular fora do intervalo [0,1].");
  }
  const ones = Math.round(allocation * TAPE_LENGTH);
  let sequence = "";
  for (let i = 1; i <= TAPE_LENGTH; i++) {
    const next = Math.floor(i * ones / TAPE_LENGTH);
    const previous = Math.floor((i - 1) * ones / TAPE_LENGTH);
    sequence += next > previous ? "1" : "0";
  }
  return genomeFromSequence(sequence);
}

export function createGenome(random) {
  // Founders span 2–18 pigment symbols. Shuffling distinguishes copies with the
  // same initial phenotype. Extreme allocations can arise after division.
  const ones = 2 + Math.floor(unitDraw(random) * 17);
  const bits = makeGenome(ones / TAPE_LENGTH).sequence.split("");
  for (let i = bits.length - 1; i > 0; i--) {
    const j = Math.floor(unitDraw(random) * (i + 1));
    [bits[i], bits[j]] = [bits[j], bits[i]];
  }
  return genomeFromSequence(bits.join(""));
}

function pigmentShare(genome) {
  return MIN_SITE_SHARE + (1 - 2 * MIN_SITE_SHARE) * genome.allocation;
}

export function createCell(mass, genome) {
  if (!Number.isFinite(mass) || mass < 0 || !validGenome(genome)) {
    throw new RangeError("Massa ou fita molecular inválida.");
  }
  const membrane = mass * MEMBRANE_FRACTION;
  const machines = mass * MACHINERY_FRACTION;
  const pigment = machines * pigmentShare(genome);
  const transporters = machines - pigment;
  // All four pools are matter, including reserve; usable energy is org.energy.
  return { membrane, pigment, transporters, reserve: mass - membrane - machines };
}

function capacityFraction(density) {
  // The first 4.4% of body mass as sites establishes basal capacity. Further
  // sites add throughput. A cell completely lacking those sites has zero flux.
  const minimum = MACHINERY_FRACTION * MIN_SITE_SHARE;
  return 0.5 * Math.min(1, density / minimum) + density / MACHINERY_FRACTION;
}

export function molecularTraits(org) {
  const { membrane, pigment, transporters } = org.cell;
  const pigmentDensity = org.mass > 0 ? pigment / org.mass : 0;
  const transporterDensity = org.mass > 0 ? transporters / org.mass : 0;
  // The inherited material, rather than its future synthesis instructions,
  // determines what the cell can capture or retain at this instant.
  const advantage = Math.max(-1, Math.min(1,
    (transporterDensity - pigmentDensity) / (MACHINERY_FRACTION * (1 - 2 * MIN_SITE_SHARE))));
  return {
    lightFactor: capacityFraction(pigmentDensity),
    uptakeFactor: capacityFraction(transporterDensity),
    assimilationYield: 0.82 + 0.05 * advantage,
    // Energy units paid per unit of NEW biomass. Pigment-rich synthesis costs
    // more; the engine charges this once and transfers the expense to heat.
    synthesisCost: 0.13 + 0.04 * org.genome.allocation,
    // Extra energy units per tick. Rates multiply existing units of each pool.
    maintenance: 0.00012 * membrane + 0.00024 * pigment + 0.00040 * transporters
  };
}

export function assimilateMolecules(org, capturedMass) {
  // The caller accounts for the same net addition in total body mass.
  if (capturedMass === 0) return;
  const addition = createCell(capturedMass, org.genome);
  for (const pool of POOLS) org.cell[pool] += addition[pool];
}

// When external capture is low, the engine can commission machinery from the
// stored precursor. The basal tenth of body mass is retained. The conversion
// limit is 0.0006 units per unit of body mass per tick. Energy is paid by the
// caller exactly once; this function returns the cost of the mass actually used.
export function remodelFromReserve(org) {
  const available = org.cell.reserve - 0.10 * org.mass;
  if (available <= 0 || org.energy <= 0 || org.mass <= 0) return 0;
  const energyPerMass = 0.08 + 0.04 * org.genome.allocation;
  const converted = Math.min(available, 0.0006 * org.mass, org.energy / energyPerMass);
  const pigment = converted * pigmentShare(org.genome);
  org.cell.reserve -= converted;
  org.cell.pigment += pigment;
  org.cell.transporters += converted - pigment;
  return Math.min(org.energy, converted * energyPerMass);
}

export function divideMolecules(org, child, random) {
  // The engine has assigned both final masses but the parent's old cell still
  // holds all the material. Never recreate a mutated child's existing machinery.
  const totalMass = org.mass + child.mass;
  if (!Number.isFinite(totalMass) || org.mass <= 0 || child.mass <= 0 || !validGenome(org.genome)) {
    throw new RangeError("Divisão molecular inválida.");
  }
  const ratio = child.mass / totalMass;
  const inherited = {}, retained = {};
  for (const pool of POOLS) {
    inherited[pool] = org.cell[pool] * ratio;
    retained[pool] = org.cell[pool] - inherited[pool];
  }
  let sequence = org.genome.sequence;
  let mutationDelta = 0;
  if (unitDraw(random) < MUTATION_CHANCE) {
    const i = Math.floor(unitDraw(random) * TAPE_LENGTH);
    const symbol = sequence[i] === "1" ? "0" : "1";
    mutationDelta = (symbol === "1" ? 1 : -1) / TAPE_LENGTH;
    sequence = sequence.slice(0, i) + symbol + sequence.slice(i + 1);
  }
  org.cell = retained;
  child.cell = inherited;
  child.genome = genomeFromSequence(sequence);
  child.mutationDelta = mutationDelta;
}

export function validMolecules(org) {
  if (!Number.isFinite(org?.mass) || org.mass < 0 || !validGenome(org.genome) || !org.cell) return false;
  let sum = 0;
  for (const pool of POOLS) {
    const mass = org.cell[pool];
    if (!Number.isFinite(mass) || mass < 0) return false;
    sum += mass;
  }
  return Math.abs(sum - org.mass) <= 1e-9 * Math.max(1, org.mass);
}

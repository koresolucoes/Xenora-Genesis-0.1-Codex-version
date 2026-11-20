// Run from lab: node test/experiments/evolving-selection.mjs
// One seed is one replicate. Individual organisms share a pond and ancestry.
import { EvolvingWorld } from "../../public/src/evolving-world.js";

const seeds = Array.from({ length: 12 }, (_, index) => index + 1);
const steps = 400;

function observe(world) {
  const metrics = world.getMetrics();
  const counts = Array(11).fill(0);
  for (const org of world.organisms) counts[org.genome.allele]++;
  const frequencies = counts.map((n) => (metrics.population ? n / metrics.population : null));
  const highFraction = metrics.population
    ? counts.slice(6).reduce((a, b) => a + b, 0) / metrics.population
    : null;
  const mismatch = world.organisms.reduce((sum, organism) => {
    const optimum = 266 + 4.8 * organism.genome.allele;
    return sum + Math.abs(optimum - world.environment.sample(organism.x, organism.y).temperatureK);
  }, 0);
  return {
    population: metrics.population,
    births: metrics.births,
    deaths: metrics.deaths,
    generation: metrics.maxGeneration,
    survivingFounders: new Set(world.organisms.map((o) => o.lineage)).size,
    highFraction,
    localMismatchK: metrics.population ? mismatch / metrics.population : null,
    frequencies,
  };
}

function totalVariation(p, q) {
  return 0.5 * p.reduce((sum, value, index) => sum + Math.abs(value - q[index]), 0);
}

function describe(numbers) {
  if (!numbers.length) return { n: 0, mean: null, sd: null, range: null };
  const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
  const sd =
    numbers.length > 1
      ? Math.sqrt(numbers.reduce((s, val) => s + (val - mean) ** 2, 0) / (numbers.length - 1))
      : null;
  return { n: numbers.length, mean, sd, range: [Math.min(...numbers), Math.max(...numbers)] };
}

function regime(forcing) {
  const replicates = seeds.map((seed) => {
    const initial = new EvolvingWorld(seed, {
      founderCount: 24,
      selectionEnabled: true,
      mutationEnabled: false,
      learningEnabled: false,
      lightForcing: 1,
    });
    const selected = initial.fork({ selectionEnabled: true, lightForcing: forcing });
    const neutral = initial.fork({ selectionEnabled: false, lightForcing: forcing });
    const start = observe(initial);
    for (let i = 0; i < steps; i++) {
      selected.step();
      neutral.step();
    }
    const A = observe(selected),
      B = observe(neutral);
    return {
      seed,
      start,
      selected: A,
      neutral: B,
      // A frequency has no denominator in an extinct pond.
      neutralDrift: B.population ? totalVariation(B.frequencies, start.frequencies) : null,
      selectedVsNeutral: A.population && B.population ? totalVariation(A.frequencies, B.frequencies) : null,
      highAlleleContrast: A.population && B.population ? A.highFraction - B.highFraction : null,
      localMismatchContrastK: A.population && B.population ? A.localMismatchK - B.localMismatchK : null,
    };
  });
  const distribution = (key) => describe(replicates.map((row) => row[key]).filter((value) => value !== null));
  return {
    lightForcing: forcing,
    replicates,
    initiallySterile: replicates.filter((r) => !r.start.population).length,
    extinctions: {
      selected: replicates.filter((r) => r.start.population && !r.selected.population).length,
      neutral: replicates.filter((r) => r.start.population && !r.neutral.population).length,
    },
    neutralDrift: distribution("neutralDrift"),
    selectedVsNeutral: distribution("selectedVsNeutral"),
    highAlleleContrast: distribution("highAlleleContrast"),
    localMismatchContrastK: distribution("localMismatchContrastK"),
  };
}

const normal = regime(1),
  bright = regime(1.3);
const matchedContrasts = normal.replicates.flatMap((row, i) => {
  const contrast = bright.replicates[i].highAlleleContrast;
  return row.highAlleleContrast === null || contrast === null ? [] : [contrast - row.highAlleleContrast];
});
console.log(
  JSON.stringify(
    {
      conditions: {
        seeds,
        steps,
        founderCount: 24,
        mutationEnabled: false,
        learningEnabled: false,
        highAlleles: "6–10",
        frequencyDistance: "half of the sum of absolute allele-frequency differences",
        replicate: "one initial seed",
      },
      regimes: [normal, bright],
      changeInHighAlleleContrastWithLight: describe(matchedContrasts),
    },
    null,
    2,
  ),
);

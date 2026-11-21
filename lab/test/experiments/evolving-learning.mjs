// Run from lab: node test/experiments/evolving-learning.mjs
import { EvolvingWorld } from "../../public/src/evolving-world.js";
import { createBehaviorTrial } from "../../public/src/behavior-trial.js";

const steps = 400;
const runs = [];
for (let seed = 1; seed <= 12; seed++) {
  const world = new EvolvingWorld(seed, {
    founderCount: 24,
    lightForcing: 1,
    selectionEnabled: false,
    mutationEnabled: false,
  });
  const trial = createBehaviorTrial(world.serialize());
  for (let i = 0; i < steps; i++) trial.step();
  runs.push(trial.result());
}

function pairedContrast(pairs) {
  // A replicate with zero choices has no reward per choice or exploration rate.
  const differences = pairs.flatMap(([a, b]) => (a === null || b === null ? [] : [a - b]));
  if (!differences.length) return { n: 0, mean: null, sd: null, range: null };
  const mean = differences.reduce((a, b) => a + b, 0) / differences.length;
  const sd =
    differences.length > 1
      ? Math.sqrt(differences.reduce((sum, diff) => sum + (diff - mean) ** 2, 0) / (differences.length - 1))
      : null;
  return { n: differences.length, mean, sd, range: [Math.min(...differences), Math.max(...differences)] };
}

console.log(
  JSON.stringify(
    {
      conditions: {
        seeds: runs.map((r) => r.seed),
        steps,
        founderCount: 24,
        lightForcing: 1,
        selectionEnabled: false,
        mutationEnabled: false,
        contrast: "learner minus fixed policy; one initial seed per pair",
      },
      runs,
      rewardPerDecision: pairedContrast(runs.map((r) => [r.learner.meanReward, r.control.meanReward])),
      explorationByContext: ["poor", "rich"].map((context, i) => ({
        context,
        ...pairedContrast(
          runs.map((r) => [r.learner.contexts[i].exploreRate, r.control.contexts[i].exploreRate]),
        ),
      })),
      updates: {
        learner: runs.reduce((sum, r) => sum + r.learner.updates, 0),
        control: runs.reduce((sum, r) => sum + r.control.updates, 0),
      },
    },
    null,
    2,
  ),
);

import { EvolvingWorld } from "./evolving-world.js";
import { createBehaviorMemory } from "./behavior-learning.js";

export const BEHAVIOR_TRIAL_STEPS = 240;

function naiveBranch(source, enabled) {
  const branch = source.fork({learningEnabled: enabled});
  for (const cell of branch.organisms) cell.memory = createBehaviorMemory();
  return branch;
}

function rate(num, den) { return den ? num / den : null; }

export function measureBehavior(start, end) {
  const decisions = end.behaviorDecisions - start.behaviorDecisions;
  const explores = end.exploreDecisions - start.exploreDecisions;
  const reward = end.behaviorRewardTotal - start.behaviorRewardTotal;
  const contexts = end.behaviorByContext.map((group, i) => {
    const previous = start.behaviorByContext[i];
    const decisions = group.decisions - previous.decisions;
    const explores = group.explores - previous.explores;
    return {decisions, explores, exploreRate: rate(explores, decisions)};
  });
  return {
    decisions, explores, exploreRate: rate(explores, decisions), reward, meanReward: rate(reward, decisions),
    updates: end.learnedUpdates - start.learnedUpdates, population: end.population, contexts
  };
}

export function createBehaviorTrial(snapshot) {
  const source = EvolvingWorld.restore(snapshot);
  const learner = naiveBranch(source, true);
  const control = naiveBranch(source, false);
  const baseline = source.getMetrics();
  let steps = 0;
  return {
    step() {
      learner.step();
      control.step();
      steps++;
    },
    result() {
      return {seed: source.seed, start: source.tick, steps,
        learner: measureBehavior(baseline, learner.getMetrics()),
        control: measureBehavior(baseline, control.getMetrics())};
    }
  };
}

if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  globalThis.onmessage = ({data}) => {
    try {
      const trial = createBehaviorTrial(data);
      for (let i = 1; i <= BEHAVIOR_TRIAL_STEPS; i++) {
        trial.step();
        if (i % 48 === 0) globalThis.postMessage({steps:i});
      }
      globalThis.postMessage({result:trial.result()});
    } catch {
      globalThis.postMessage({error:"A comparação não pôde continuar a partir desta amostra."});
    }
  };
}

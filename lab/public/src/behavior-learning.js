// Two local resource contexts and two actions. Values are estimates for one cell's lifetime.
const learningRate = 0.22;
const response = 5;
const explorationFloor = 0.05;

export function createBehaviorMemory() {
  return {values: [0, 0, 0, 0], visits: [0, 0, 0, 0]};
}

export function validBehaviorMemory(memory) {
  return Array.isArray(memory?.values) && memory.values.length === 4 &&
    memory.values.every(v => Number.isFinite(v) && Math.abs(v) <= 1) &&
    Array.isArray(memory.visits) && memory.visits.length === 4 &&
    memory.visits.every(n => Number.isSafeInteger(n) && n >= 0) &&
    memory.values.every((v, i) => memory.visits[i] > 0 || v === 0);
}

export function exploreProbability(memory, context, enabled) {
  if (!enabled) return 0.5;
  const advantage = memory.values[context * 2 + 1] - memory.values[context * 2];
  return explorationFloor + (1 - 2 * explorationFloor) / (1 + Math.exp(-response * advantage));
}

export function chooseBehavior(memory, context, enabled, draw) {
  return draw < exploreProbability(memory, context, enabled) ? 1 : 0;
}

export function learnBehavior(memory, context, action, reward, enabled) {
  const outcome = Math.max(-1, Math.min(1, reward));
  if (enabled) {
    const i = context * 2 + action;
    memory.values[i] += learningRate * (outcome - memory.values[i]);
    memory.visits[i]++;
  }
  return outcome;
}

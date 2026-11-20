import test from "node:test";
import assert from "node:assert/strict";
import {createBehaviorMemory, validBehaviorMemory, exploreProbability, chooseBehavior, learnBehavior} from "../public/src/behavior-learning.js";

test("reinforcement changes only the observed action in its resource context and can reverse", () => {
  const memory = createBehaviorMemory();
  assert.equal(exploreProbability(memory, 0, true), 0.5);
  for (let i = 0; i < 50; i++) {
    learnBehavior(memory, 0, 1, 2, true);
    learnBehavior(memory, 0, 0, -1, true);
  }
  assert.ok(exploreProbability(memory, 0, true) > 0.9);
  assert.equal(exploreProbability(memory, 1, true), 0.5);
  assert.equal(chooseBehavior(memory, 0, true, 0.7), 1);
  for (let i = 0; i < 50; i++) {
    learnBehavior(memory, 0, 0, 1, true);
    learnBehavior(memory, 0, 1, -1, true);
  }
  assert.equal(chooseBehavior(memory, 0, true, 0.7), 0);
  assert.ok(validBehaviorMemory(memory));
  assert.ok(!validBehaviorMemory({values:[1,0,0,0],visits:[0,0,0,0]}));
  const child = createBehaviorMemory();
  assert.equal(exploreProbability(child, 0, true), 0.5);
});

test("the control senses and receives the same reward while its policy stays unbiased", () => {
  const memory = createBehaviorMemory();
  assert.equal(learnBehavior(memory, 1, 1, 3, false), 1);
  assert.deepEqual(memory, createBehaviorMemory());
  assert.equal(exploreProbability(memory, 1, false), 0.5);
  assert.equal(chooseBehavior(memory, 1, false, 0.51), 0);
});

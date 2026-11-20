import test from 'node:test'
import assert from 'node:assert/strict'
import { EvolvingWorld } from '../public/src/evolving-world.js'
import { readWorldVariables } from '../public/src/world-variables.js'

test('planetary variables identify the probe cell and use the same scale for local and mean measurements',()=>{
  const world=new EvolvingWorld(42)
  world.step()
  const reading=readWorldVariables(world,{x:1,y:-0.3})
  const env=world.environment,control=env.sample(1,0),metrics=world.getMetrics()
  assert.equal(reading.tick,world.tick)
  assert.equal(reading.column,env.size)
  assert.equal(reading.row,1)
  assert.equal(reading.values.temperature[0],control.temperatureK)
  assert.equal(reading.values.humidity[0],control.humidity)
  assert.equal(reading.values.energy[0],control.energy)
  assert.equal(reading.values.nutrient[1],metrics.availableNutrient/env.size**2)
  assert.equal(reading.values.temperature[1],metrics.meanTemperatureK)
  assert.equal(readWorldVariables(world,null).x,0.5)
})

test('intervening during pause updates the actual current reading without advancing the world',()=>{
  const world=new EvolvingWorld(42)
  const target={x:0.28,y:0.62}, away={x:0.81,y:0.22}
  const initial=readWorldVariables(world,target), other=readWorldVariables(world,away)
  world.setLightForcing(0)
  const dark=readWorldVariables(world,target)
  assert.equal(dark.lightForcing,0)
  assert.deepEqual(dark.values.energy,[0,0])
  assert.deepEqual(dark.values.temperature,initial.values.temperature)
  world.addNutrientPulse(target.x,target.y,2.75)
  const pulse=readWorldVariables(world,target)
  assert.equal(pulse.tick,initial.tick)
  assert.equal(pulse.nutrientInputTotal-initial.nutrientInputTotal,2.75)
  assert.ok(Math.abs(pulse.values.nutrient[0]-initial.values.nutrient[0]-2.75)<1e-12)
  assert.ok(Math.abs(pulse.values.nutrient[1]-initial.values.nutrient[1]-2.75/pulse.cells)<1e-12)
  assert.equal(readWorldVariables(world,away).values.nutrient[0],other.values.nutrient[0])
  const saved=EvolvingWorld.restore(world.serialize())
  assert.deepEqual(readWorldVariables(saved,target),pulse)
})

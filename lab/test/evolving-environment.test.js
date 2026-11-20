import assert from 'node:assert/strict'
import test from 'node:test'
import { EvolvingEnvironment as Environment, evolutionarySurfaceSample } from '../public/src/evolving-environment.js'
import { PrimordialWorld } from '../public/src/primordial.js'

function advance(planet, ticks) {
  for(let i=0;i<ticks;i++) planet.step()
  return planet.getMetrics()
}

test('moist planet freezes and thaws under reversible light forcing without creating water', () => {
  const e = new Environment({seed:42,waterInventory:0.75,meanInsolation:1})
  const warm = advance(e,320)
  assert.ok(warm.lagoonFraction>0.4)
  e.setLightForcing(0)
  assert.equal(e.getMetrics().meanEnergy,0)
  assert.equal(e.getMetrics().meanTemperatureK,warm.meanTemperatureK)
  const frozen = advance(e,320)
  assert.equal(frozen.habitatCounts.ice,e.size**2)
  assert.equal(frozen.habitatCounts.lagoon,0)
  assert.ok(frozen.iceWater > 0.70 && frozen.meanTemperatureK < 205)
  e.setLightForcing(1.3)
  const thawed = advance(e,320)
  assert.ok(thawed.lagoonFraction>0.4 && thawed.liquidWater>0.5)
  assert.ok([warm,frozen,thawed].every(m=>Math.abs(m.waterError)<1e-11 && Math.abs(m.nutrientError)<1e-9))
})

test('habitat mosaic is local and a naturally dry seed never spontaneously gains a lagoon', () => {
  const dry = new Environment({seed:5})
  const wet = new Environment({seed:42})
  assert.equal(dry.initialWaterInventory,0)
  const m=advance(dry,350)
  assert.equal(m.waterInventory,0)
  assert.equal(m.habitatCounts.dry,dry.size**2)
  const mosaic=wet.getMetrics()
  assert.ok(Object.values(mosaic.habitatCounts).filter(x=>x>0).length>=3)
  const cell=wet.sample(0.55,0.25)
  assert.ok(cell.humidity>=0 && cell.humidity<=1 && cell.temperatureK>100 && cell.habitability<=1)
})

test('finite weathering and biomass feedback change climate and the nutrient balance closes', () => {
  const empty = new Environment({seed:42,waterInventory:0.42,meanInsolation:1})
  const colonized = Environment.restore(empty.serialize())
  colonized.setBiotaField(new Float64Array(colonized.size**2).fill(3))
  advance(empty,140);advance(colonized,140)
  const a=empty.getMetrics(), b=colonized.getMetrics()
  assert.ok(b.meanTemperatureK>a.meanTemperatureK+0.3)
  assert.ok(b.boundNutrient<a.boundNutrient)
  const initial=b.totalNutrient
  const available=colonized.sample(.34,.52).nutrient
  const removed=colonized.takeNutrient(.34,.52,1e8)
  assert.equal(removed,available)
  colonized.depositNutrient(.52,.34,removed/3)
  const changed=colonized.getMetrics()
  assert.ok(Math.abs(changed.totalNutrient-(initial-removed*2/3))<1e-9)
  assert.ok(Math.abs(changed.nutrientError)<1e-9)
})

test('condensation can feed a planet before any pond, preserving quantities of the source lot', () => {
  const normal=new PrimordialWorld({seed:42}), noSi=new PrimordialWorld({seed:42,silicon:false})
  assert.throws(()=>evolutionarySurfaceSample(normal))
  while(normal.getMetrics().mineralUnits<0.3){normal.step();noSi.step()}
  assert.equal(normal.phase,'minerals')
  assert.equal(normal.lagoon,null)
  const sample=evolutionarySurfaceSample(normal), blank=evolutionarySurfaceSample(noSi)
  const deposit=new Environment({surfaceSample:sample}),control=new Environment({surfaceSample:blank})
  assert.equal(deposit.seed,42)
  assert.equal(deposit.origin.mineralUnits,normal.mineralLot.units)
  assert.ok(deposit.sample(.5,.5).mineral>0)
  assert.equal(control.sample(.5,.5).mineral,0)
  assert.ok(deposit.initialWaterInventory<control.initialWaterInventory)
  assert.deepEqual(deposit.origin.elementLedger.map(row=>row.symbol),['H','He','C','O','Mg','Si','Fe'])
  assert.equal(deposit.origin.elementLedger.find(row=>row.symbol==='Si').mineral,sample.mineralUnits)
  const controlSi=control.origin.elementLedger.find(row=>row.symbol==='Si')
  assert.equal(controlSi.mineral,0)
  assert.equal(controlSi.exported,controlSi.ejecta)
  assert.deepEqual(Environment.restore(deposit.serialize()).origin,deposit.origin)
  const broken=deposit.serialize()
  broken.origin.elementLedger.find(row=>row.symbol==='Mg').mineral+=1
  assert.throws(()=>Environment.restore(broken))
})

test('restore reproduces climate exactly and rejects corrupted water, nutrient and substrate', () => {
  const e=new Environment({seed:42,size:12,waterInventory:0.73})
  advance(e,73);e.setLightForcing(.82)
  const snapshot=e.serialize(),restored=Environment.restore(snapshot)
  advance(e,88);advance(restored,88)
  assert.deepEqual(e.serialize(),restored.serialize())
  for(const corrupt of [s=>s.water[0]+=0.1,s=>s.nutrient[0]=-0.01,s=>s.origin.mineralDensity=20,
    s=>s.temperature[10]='299',s=>s.ice.pop()]) {
    const bad=structuredClone(snapshot);corrupt(bad);assert.throws(()=>Environment.restore(bad))
  }
})

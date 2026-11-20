// Independent, reduced-order planet surface, not a forecast. Columns of water
// use model units W, matter uses M, and temperature is in illustrative kelvin.
// Each step is one model time unit. A unit-area square has closed material
// boundaries and exchanges radiation with its star and space.
export const EVOLVING_HABITATS = Object.freeze(['dry','ice','wetland','lagoon','temperate'])
export const EVOLVING_CLIMATE = Object.freeze({
  version:1, surface:'unit-area square, closed lateral boundaries', internalK:178,
  radiation:'T*⁴ = 178⁴ + 324⁴ · incident flux · atmospheric transmission · (1 − albedo)',
  hydrology:'finite liquid, ice and vapor columns; local freezing/melting, evaporation, rain, and downhill runoff',
  biota:'local living matter darkens the surface, slows runoff and accelerates mineral weathering',
  light:'incident flux is prescribed; local warm/cold reservoirs and finite relaxation approximate thermal inertia'
})

const unit = x => Math.max(0,Math.min(1,x))
const finite = (x,min=0,max=Infinity) => Number.isFinite(x) && x>=min && x<=max
const integer = x => Number.isSafeInteger(x) && x>=0
const TAU = 2*Math.PI
const elements = ['H','He','C','O','Mg','Si','Fe']
const mineralRecipe = {Mg:2, Si:1, O:4}
const ledgerKeys = ['primordial','ejecta','gas','stellar','mineral','exported']

function check(condition) {
  if (!condition) throw new Error('Campo planetário ou amostra de superfície inválida.')
}

function noise(seed, stream) {
  let h = (seed ^ Math.imul(stream+1,0x9e3779b9)) >>> 0
  h = Math.imul(h ^ (h>>>16),0x85ebca6b)
  h = Math.imul(h ^ (h>>>13),0xc2b2ae35)
  return ((h ^ (h>>>16)) >>> 0)/4294967296
}

function amount(field) {
  let sum=0
  for (const value of field) sum+=value
  return sum
}

function cellsAt(seed, origin) {
  if (origin.kind === 'generated') return [[0.25+0.45*noise(seed,24),0.22+0.60*noise(seed,25)]]
  // Match the parent particle microsample when its actual catalytic sites were captured.
  return origin.sites.map(s=>[s.x,s.y])
}

// A specimen can be taken once the disk is cool enough for condensation,
// even from a silicon-free region with zero solid units. Sampling never advances time.
export function evolutionarySurfaceSample(world) {
  check(world && ['minerals','lagoon'].includes(world.phase) && world.mineralLot?.formula==='Mg2SiO4')
  const inherited = world.lagoon ? world.surfaceSample() : {}
  return {...inherited,kind:'evolving-surface-sample',version:1,seed:world.seed,tick:world.tick,
    phase:world.phase,branchTick:world.branchTick,silicon:world.silicon,source:world.mineralLot.source,
    formula:world.mineralLot.formula,mineralUnits:world.mineralLot.units,
    elementLedger:world.getMetrics().elements.map(({symbol,primordial,ejecta,gas,stellar,mineral,exported}) =>
      ({symbol,primordial,ejecta,gas,stellar,mineral,exported})),
    mineralDensity:Math.min(1,world.mineralLot.units/2.3),carbon:world.gas.C,oxygen:world.gas.O,
    sites:(world.lagoon?.sites ?? []).map(({x,y})=>({x,y}))}
}

function checkedLedger(sample) {
  if (sample.elementLedger == null) return null
  check(Array.isArray(sample.elementLedger) && sample.elementLedger.length===elements.length)
  return elements.map(symbol=>{
    const r=sample.elementLedger.find(row=>row?.symbol===symbol)
    check(r && ledgerKeys.every(k=>finite(r[k])) &&
      Math.abs(r.primordial+r.ejecta-r.gas-r.stellar-r.mineral-r.exported)<=1e-8*(1+r.primordial+r.ejecta) &&
      Math.abs(r.mineral-(mineralRecipe[symbol]??0)*sample.mineralUnits)<=1e-9 &&
      (symbol!=='C'||r.gas===sample.carbon) && (symbol!=='O'||r.gas===sample.oxygen))
    return {symbol,...Object.fromEntries(ledgerKeys.map(k=>[k,r[k]]))}
  })
}

function planetOrigin(seed,sample) {
  if (!sample) return {kind:'generated',seed,tick:0,phase:null,silicon:null,branchTick:null,
    source:'seeded-surface',formula:null,mineralUnits:null,mineralDensity:0.20+0.72*noise(seed,2),
    carbon:null,oxygen:null,sites:[],elementLedger:null}
  const inherited = sample.kind==='primordial-surface' || sample.kind==='evolving-surface-sample'
  check(inherited && sample.version===1 && integer(sample.seed) && sample.seed<=0xffffffff &&
    integer(sample.tick) && typeof sample.silicon==='boolean' && (sample.silicon ? sample.branchTick===null :
      integer(sample.branchTick) && sample.branchTick<=sample.tick) &&
    sample.source==='stellar-neighborhood' && sample.formula==='Mg2SiO4' &&
    finite(sample.mineralUnits) && finite(sample.carbon) && finite(sample.oxygen) &&
    finite(sample.mineralDensity,0,1) &&
    Math.abs(sample.mineralDensity-Math.min(1,sample.mineralUnits/2.3))<1e-10)
  const sites = sample.sites ?? []
  check(Array.isArray(sites) && sites.length<=64 && sites.every(s=>s && finite(s.x,0,1) && finite(s.y,0,1)))
  const phase = sample.phase ?? 'lagoon'
  check(phase==='lagoon' || phase==='minerals')
  const transferId=sample.transferId
  if (transferId!==undefined) check(typeof transferId==='string' && /^[a-zA-Z0-9-]{1,80}$/.test(transferId))
  return {kind:'primordial',seed:sample.seed,tick:sample.tick,phase,silicon:sample.silicon,branchTick:sample.branchTick,
    ...(transferId===undefined ? {} : {transferId}),
    source:sample.source,formula:sample.formula,mineralUnits:sample.mineralUnits,mineralDensity:sample.mineralDensity,
    carbon:sample.carbon,oxygen:sample.oxygen,sites:sites.map(({x,y})=>({x,y})),elementLedger:checkedLedger(sample)}
}

function terrain(x,y,angles) {
  const [a,b,c,d]=angles
  return unit(0.49+0.20*Math.sin(TAU*x+a)*Math.cos(TAU*y+b)+0.20*Math.sin(TAU*(1.7*x+0.7*y)+c)
    +0.08*Math.cos(TAU*(2*x-2.1*y)+d)+0.03*Math.sin(TAU*(4*x+3*y)+b))
}

function saturation(temperature) {
  return Math.min(1.9,0.035*Math.exp((temperature-273.15)/27))
}

function habitat(temp, liquid, ice, humidity) {
  if (ice>0.018 && ice>liquid) return 'ice'
  if (liquid>=0.33) return 'lagoon'
  if (liquid>=0.10) return 'wetland'
  if (humidity>=0.29 && temp>=259 && temp<=325) return 'temperate'
  return 'dry'
}

export class EvolvingEnvironment {
  constructor(options={}) {
    const sample = options.surfaceSample ?? null
    const seed = options.seed ?? sample?.seed ?? 42
    const size = options.size ?? 16
    check(integer(seed) && seed<=0xffffffff && integer(size) && size>=4 && size<=48)
    this.seed=seed
    this.size=size
    this.tick=0
    this.origin=planetOrigin(seed,sample)
    this.lightForcing=options.lightForcing ?? 1
    this.meanInsolation=options.meanInsolation ?? 0.82+0.39*noise(seed,4)
    const retention = noise(seed,31)
    const oxygenFactor = this.origin.kind==='generated' ? 1 : this.origin.oxygen/(this.origin.oxygen+1.5)
    // Some seeds retain no surface volatiles despite having oxygen-bearing solids.
    this.initialWaterInventory=options.waterInventory ?? (retention<0.14 ? 0 : 0.09+0.89*retention**1.7)*oxygenFactor
    check(finite(this.lightForcing,0,2) && finite(this.meanInsolation,0.2,1.8) &&
      finite(this.initialWaterInventory,0,4))
    const n=size*size
    this.cellArea=1/n
    this.initialNutrient=(185+115*noise(seed,6))*(this.origin.kind==='generated' ?
      1 : 0.22+0.78*this.origin.carbon/(this.origin.carbon+1))
    this.nutrientWithdrawn=0
    this.nutrientReturned=0
    this.season=TAU*noise(seed,7)
    this.elevation=new Float64Array(n)
    this.mineral=new Float64Array(n)
    this.temperature=new Float64Array(n)
    this.water=new Float64Array(n)
    this.ice=new Float64Array(n)
    this.vapor=new Float64Array(n)
    this.nutrient=new Float64Array(n)
    this.boundNutrient=new Float64Array(n)
    this.biota=new Float64Array(n)
    this.light=new Float64Array(n)
    this.energy=new Float64Array(n)
    this.cover=new Float64Array(n)
    this.humidity=new Float64Array(n)
    this.habitability=new Float64Array(n)
    this.tempDelta=new Float64Array(n)
    this.vaporDelta=new Float64Array(n)
    this.runoffDelta=new Float64Array(n)
    this.nutrientDelta=new Float64Array(n)
    this.rowSolar=new Float64Array(size)
    this.seedSurface()
  }

  seedSurface() {
    const angles=[0,1,2,3].map(i=>TAU*noise(this.seed,12+i))
    const sites=cellsAt(this.seed,this.origin)
    const n=this.size*this.size
    let sumWater=0, sumNutrient=0
    for (let i=0;i<n;i++) {
      const x=((i%this.size)+0.5)/this.size, y=(Math.floor(i/this.size)+0.5)/this.size
      this.elevation[i]=terrain(x,y,angles)
      let proximity=0
      for(const [sx,sy] of sites) proximity=Math.max(proximity,Math.exp(-((x-sx)**2+(y-sy)**2)/0.016))
      this.mineral[i]=this.origin.mineralDensity*unit(0.16+0.58*this.elevation[i]+0.26*proximity)
      this.water[i]=0.04+(1-this.elevation[i])**2
      this.nutrient[i]=0.43+this.mineral[i]+0.46*(1-this.elevation[i])
      sumWater+=this.water[i]; sumNutrient+=this.nutrient[i]
    }
    this.refreshSun()
    for(let i=0;i<n;i++) {
      const water=this.water[i]*this.initialWaterInventory*n/sumWater
      const t=this.radiativeTarget(i,0.22)
      this.temperature[i]=t
      this.vapor[i]=Math.min(water*0.10,saturation(t)*0.75)
      const initialIce=unit((277-t)/9)
      this.ice[i]=(water-this.vapor[i])*initialIce
      this.water[i]=water-this.vapor[i]-this.ice[i]
      const nutrient=this.nutrient[i]*this.initialNutrient/sumNutrient
      this.boundNutrient[i]=nutrient*(0.24+0.37*this.mineral[i])
      this.nutrient[i]=nutrient-this.boundNutrient[i]
    }
    this.refreshObservables()
  }

  index(x,y) {
    check(Number.isFinite(x) && Number.isFinite(y))
    return Math.min(this.size-1,Math.floor(unit(y)*this.size))*this.size+Math.min(this.size-1,Math.floor(unit(x)*this.size))
  }

  refreshSun() {
    const season=Math.sin(this.season+TAU*(this.tick%480)/480)
    for(let y=0;y<this.size;y++) {
      const latitude=2*(y+0.5)/this.size-1
      this.rowSolar[y]=this.meanInsolation*this.lightForcing*
        (1.04-0.38*latitude**2+0.13*latitude*season)
    }
  }

  radiativeTarget(i,albedo) {
    const sun=this.rowSolar[Math.floor(i/this.size)]*(1-0.48*(1-Math.exp(-this.vapor[i]*3)))
    return (178**4+324**4*sun*(1-albedo))**0.25-8.5*this.elevation[i]
  }

  refreshObservables() {
    for(let i=0;i<this.water.length;i++) {
      const liquid=this.water[i],ice=this.ice[i],temp=this.temperature[i]
      const cover=1-Math.exp(-this.biota[i]/(2.0*this.cellArea*256))
      this.cover[i]=cover
      const clouds=1-Math.exp(-3*this.vapor[i])
      this.light[i]=this.rowSolar[Math.floor(i/this.size)]*(1-0.48*clouds)
      this.energy[i]=this.light[i]*0.78*(1-0.6*unit(ice/0.35))*this.cellArea*256
      const soilMoisture=1-Math.exp(-liquid/0.07)
      this.humidity[i]=unit(0.45*unit(this.vapor[i]/saturation(temp))+0.55*soilMoisture)
      const thermal=Math.exp(-0.5*((temp-292)/29)**2)
      this.habitability[i]=thermal*(0.13+0.87*this.humidity[i])*(1-0.6*unit(ice/0.35))
    }
  }

  setLightForcing(value) {
    check(finite(value,0,2))
    this.lightForcing=value
    this.refreshSun()
    this.refreshObservables()
  }

  setBiota(x,y,mass) {
    check(finite(mass))
    this.biota[this.index(x,y)]=mass
    // No energy cost or matter is implied by this observational coupling.
  }

  setBiotaField(masses) {
    check(masses?.length===this.biota.length)
    for (let i=0;i<masses.length;i++) check(finite(masses[i]))
    this.biota.set(masses)
  }

  takeNutrient(x,y,requested) {
    check(finite(requested))
    const i=this.index(x,y), consumed=Math.min(requested,this.nutrient[i])
    this.nutrient[i]-=consumed; this.nutrientWithdrawn+=consumed
    return consumed
  }

  depositNutrient(x,y,mass) {
    check(finite(mass))
    this.nutrient[this.index(x,y)]+=mass; this.nutrientReturned+=mass
  }

  face(i,j) {
    // Paired conservative transfers. The donor loses at most one quarter
    // of its water or dissolved nutrient across any one of its four faces.
    const heat=0.045*(this.temperature[i]-this.temperature[j])
    const air=0.095*(this.vapor[i]-this.vapor[j])
    this.tempDelta[i]-=heat; this.tempDelta[j]+=heat
    this.vaporDelta[i]-=air; this.vaporDelta[j]+=air
    const head=0.72*(this.elevation[i]-this.elevation[j])+this.water[i]-this.water[j]
    const from=head>=0?i:j, to=head>=0?j:i
    const liquid=this.water[from]
    if(liquid<=0) return
    const out=Math.min(0.17*liquid,0.055*Math.abs(head))*(1-0.62*this.cover[from])
    const solute=this.nutrient[from]*0.33*out/liquid
    this.runoffDelta[from]-=out; this.runoffDelta[to]+=out
    this.nutrientDelta[from]-=solute; this.nutrientDelta[to]+=solute
  }

  step() {
    this.tick++
    this.refreshSun()
    // Ground cover is supplied by the organisms of the previous ecological step.
    this.refreshObservables()
    this.tempDelta.fill(0); this.vaporDelta.fill(0); this.runoffDelta.fill(0); this.nutrientDelta.fill(0)
    const n=this.size
    for(let y=0;y<n;y++) for(let x=0;x<n;x++) {
      const i=y*n+x
      if(x+1<n)this.face(i,i+1)
      if(y+1<n)this.face(i,i+n)
    }
    for(let i=0;i<n*n;i++) {
      this.water[i]+=this.runoffDelta[i]; this.vapor[i]+=this.vaporDelta[i]
      this.nutrient[i]+=this.nutrientDelta[i]
      const albedo=0.22+0.32*unit(this.ice[i]/0.32)-0.045*unit(this.water[i]/0.24)-0.077*this.cover[i]
      const target=this.radiativeTarget(i,albedo)
      const inertia=0.043/(1+0.7*this.water[i]+0.4*this.ice[i])
      this.temperature[i]+=this.tempDelta[i]+inertia*(target-this.temperature[i])
      const t=this.temperature[i], capacity=saturation(t)
      const fraction=1-Math.exp(-0.010*Math.abs(t-273.15))
      if(t<273.15) {
        const freeze=this.water[i]*fraction
        this.water[i]-=freeze; this.ice[i]+=freeze
      } else {
        const melt=this.ice[i]*fraction
        this.ice[i]-=melt; this.water[i]+=melt
      }
      const excess=this.vapor[i]-0.80*capacity
      if(excess>0) {
        const rain=0.18*excess
        this.vapor[i]-=rain
        if(t<273.15)this.ice[i]+=rain
        else this.water[i]+=rain
      } else {
        const evaporation=Math.min(this.water[i],-excess*(0.025+0.045*this.light[i])*(1-0.3*this.cover[i]))
        this.water[i]-=evaporation; this.vapor[i]+=evaporation
      }
      // Bound mineral exposes nutrient at a moisture- and cover-dependent rate.
      const release=this.boundNutrient[i]*0.00055*unit(this.water[i]/0.14)*(1+1.6*this.cover[i])
      this.boundNutrient[i]-=release; this.nutrient[i]+=release
    }
    this.refreshObservables()
    return this.tick
  }

  sample(x,y) {
    const i=this.index(x,y), t=this.temperature[i],water=this.water[i],ice=this.ice[i],h=this.humidity[i]
    return {temperatureK:t,humidity:h,water,ice,vapor:this.vapor[i],light:this.light[i],energy:this.energy[i],
      nutrient:this.nutrient[i],mineral:this.mineral[i],elevation:this.elevation[i],
      habitability:this.habitability[i],habitat:habitat(t,water,ice,h)}
  }

  getMetrics() {
    const n=this.water.length, area=this.cellArea
    const liquidWater=amount(this.water)*area, iceWater=amount(this.ice)*area, vaporWater=amount(this.vapor)*area
    const availableNutrient=amount(this.nutrient), boundNutrient=amount(this.boundNutrient)
    const habitatCounts=Object.fromEntries(EVOLVING_HABITATS.map(h=>[h,0]))
    for(let i=0;i<n;i++) habitatCounts[habitat(this.temperature[i],this.water[i],this.ice[i],this.humidity[i])]++
    return {tick:this.tick,meanTemperatureK:amount(this.temperature)*area,meanHumidity:amount(this.humidity)*area,
      meanEnergy:amount(this.energy)*area,meanHabitability:amount(this.habitability)*area,habitatCounts,
      lagoonFraction:habitatCounts.lagoon*area,waterInventory:liquidWater+iceWater+vaporWater,liquidWater,
      iceWater,vaporWater,waterError:liquidWater+iceWater+vaporWater-this.initialWaterInventory,
      availableNutrient,boundNutrient,totalNutrient:availableNutrient+boundNutrient,
      nutrientError:availableNutrient+boundNutrient+this.nutrientWithdrawn-this.nutrientReturned-this.initialNutrient,
      lightForcing:this.lightForcing,meanBiota:amount(this.biota)*area}
  }

  serialize() {
    const state={kind:'evolving-environment',version:1,seed:this.seed,size:this.size,tick:this.tick,
      origin:structuredClone(this.origin),lightForcing:this.lightForcing,meanInsolation:this.meanInsolation,
      initialWaterInventory:this.initialWaterInventory,initialNutrient:this.initialNutrient,
      nutrientWithdrawn:this.nutrientWithdrawn,nutrientReturned:this.nutrientReturned}
    for(const k of ['temperature','water','ice','vapor','nutrient','boundNutrient','biota'])state[k]=Array.from(this[k])
    return state
  }

  static restore(data) {
    check(data?.kind==='evolving-environment' && data.version===1 && integer(data.tick) && integer(data.seed) &&
      integer(data.size) && finite(data.lightForcing,0,2) && finite(data.meanInsolation,0.2,1.8) &&
      finite(data.initialWaterInventory,0,4) &&
      ['generated','primordial'].includes(data.origin?.kind) &&
      finite(data.nutrientWithdrawn) && finite(data.nutrientReturned) && finite(data.initialNutrient))
    const origin=data.origin
    const inherited=origin.kind==='primordial' ? {...origin,kind:'evolving-surface-sample',version:1} : null
    const env=new EvolvingEnvironment({seed:data.seed,size:data.size,meanInsolation:data.meanInsolation,
      waterInventory:data.initialWaterInventory,lightForcing:data.lightForcing,surfaceSample:inherited})
    check(Object.keys(env.origin).every(k=>k==='sites' || k==='elementLedger' || env.origin[k]===origin[k]) &&
      (origin.kind==='primordial' || origin.elementLedger==null) &&
      Array.isArray(origin.sites) && origin.sites.length===env.origin.sites.length &&
      env.initialNutrient===data.initialNutrient)
    const n=env.size**2
    for(const k of ['temperature','water','ice','vapor','nutrient','boundNutrient','biota']) {
      const field=data[k]
      check(Array.isArray(field) && field.length===n &&
        field.every(v=>k==='temperature'?finite(v,80,500):finite(v,0,Number.MAX_SAFE_INTEGER)))
      env[k].set(field)
    }
    env.tick=data.tick
    env.nutrientWithdrawn=data.nutrientWithdrawn;env.nutrientReturned=data.nutrientReturned
    env.refreshSun();env.refreshObservables()
    const m=env.getMetrics()
    check(Math.abs(m.waterError)<1e-8*(1+env.initialWaterInventory) &&
      Math.abs(m.nutrientError)<1e-8*(1+env.initialNutrient+env.nutrientReturned))
    return env
  }
}

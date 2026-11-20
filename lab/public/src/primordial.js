import { PrimordialParticles } from './primordial-particles.js'

// Each cosmological step is a compressed epoch. The local particle clock starts
// at the handoff; it never changes the parent region's scale factor or chemistry.
export const PRIMORDIAL_ELEMENTS = Object.freeze(['H', 'He', 'C', 'O', 'Mg', 'Si', 'Fe'])
export const PRIMORDIAL_PHASES = Object.freeze([
  ['plasma','Plasma em expansão'], ['nuclei','Núcleos leves'], ['atoms','Átomos neutros'],
  ['stars','Região estelar'], ['disk','Disco enriquecido'], ['minerals','Condensação mineral'],
  ['lagoon','Lagoa primordial']
].map(([id,label]) => Object.freeze({id,label})))

const recipe = Object.freeze({Mg: 2, Si: 1, O: 4})
const atomicWeights = {H:1, He:4, C:12, O:16, Mg:24, Si:28, Fe:56}
const stellarYield = Object.freeze({H:4, He:1, C:3, O:12, Mg:5.6, Si:2.3, Fe:1.2})
const phaseIds = PRIMORDIAL_PHASES.map(p => p.id)
const recombination = 48
const aAtRecombination = 3.3e6
const collapseThreshold = 1.686
const baryons = 1000
const historyLimit = 256
const eventLimit = 80

export const PRIMORDIAL_MODEL = Object.freeze({
  version: 1, elementUnits: 'lotes de núcleos', formulaUnits: 'lotes de fórmulas',
  expansion: 'T/T₀=1/a; ρmat/ρ₀=a⁻³. Escala de tempo comprimida por época.',
  initialBaryons: baryons, collapseThreshold,
  enrichment: 'Amostra aberta a um lote tabelado de ejeção da vizinhança estelar.',
  stellarYield, recipe, condensationK: 1350, diskPressureBar: 0.0001,
  diskModel: 'Resfriamento prescrito a pressão fixa. A única fase sólida resolvida é Mg₂SiO₄.',
  surfaceBoundary: Object.freeze({temperatureK:300, pressureBar:1,
    source:'Superfície planetária prescrita. A montagem do planeta e a formação da água não são integradas.'}),
  transfer: 'A lagoa é uma amostra representativa do inventário do disco. Seus grânulos virtuais têm unidades próprias.'
})

const blank = () => Object.fromEntries(PRIMORDIAL_ELEMENTS.map(e => [e,0]))
const clone = obj => JSON.parse(JSON.stringify(obj))
const integer = value => Number.isSafeInteger(value) && value >= 0
const number = value => Number.isFinite(value) && value >= 0
const close = (a,b) => number(a) && Math.abs(a-b) <= 1e-10 * Math.max(1,Math.abs(b))
const weighted = pool => PRIMORDIAL_ELEMENTS.reduce((n,e) => n + pool[e]*atomicWeights[e], 0)

function vary(seed, stream) {
  let h = (seed ^ Math.imul(stream, 0x9e3779b9)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function background(t) {
  if (t <= recombination) return aAtRecombination ** (t / recombination)
  return aAtRecombination * (1 + (t - recombination) / 8) ** (2/3)
}

function diskKelvin(age) {
  return 295 + 1430 * Math.exp(-age / 38)
}

function scales(seed) {
  const amplitude = 0.23 + 0.08 * vary(seed,1)
  const stars = Math.ceil(recombination + 8*((collapseThreshold/amplitude)**1.5 - 1))
  const disk = stars + 52
  const thermalTick = k => disk + Math.ceil(-38*Math.log((k-295)/1430))
  return {amplitude, yieldScale:0.85+0.3*vary(seed,2), starFraction:0.055+0.035*vary(seed,3),
    epochs: {plasma:0, nuclei:8, atoms:recombination, stars, disk, minerals:thermalTick(1350), lagoon:thermalTick(365)}}
}

function phaseAt(epochs,t) {
  for (let i = phaseIds.length-1; i >= 0; i--) if (t >= epochs[phaseIds[i]]) return phaseIds[i]
  return 'plasma'
}

function check(condition) {
  if (!condition) throw new Error('Checkpoint primordial incompatível ou inconsistente.')
}

function validateTimeline(data, expected, solidsAtTick) {
  check(Array.isArray(data.events) && data.events.length > 0 && data.events.length <= eventLimit &&
    Array.isArray(data.history) && data.history.length > 0 && data.history.length <= historyLimit)
  let previous = -1
  for (const e of data.events) {
    check(e && integer(e.tick) && e.tick >= previous && e.tick <= data.tick &&
      typeof e.text === 'string' && e.text.length > 0 && e.text.length <= 512 &&
      ['epoch','yield','control'].includes(e.type))
    previous = e.tick
  }
  const {epochs, amplitude} = expected.settings
  const crossings = new Set(Object.values(epochs))
  const due = []
  for (let t = data.tick; t >= 0 && due.length < historyLimit; t--) {
    if (t%8 === 0 || crossings.has(t)) due.push(t)
  }
  due.reverse()
  check(due.length === data.history.length)
  for (let i = 0; i < due.length; i++) {
    const h = data.history[i], t = due[i], macroTick = Math.min(t,epochs.lagoon)
    const a = background(macroTick)
    check(h && h.tick === t && h.phase === phaseAt(epochs,t) && close(h.scaleFactor,a) &&
      number(h.cosmicTemperature) && Math.abs(h.cosmicTemperature*a-1) < 1e-11 &&
      number(h.matterDensity) && Math.abs(h.matterDensity*a**3-1) < 1e-11 &&
      close(h.overdensity,Math.min(collapseThreshold,amplitude*a/aAtRecombination)) &&
      close(h.mineralUnits,solidsAtTick[macroTick]) && h.particleCount === (t < epochs.lagoon ? 0 : 120) &&
      integer(h.stableCount) && h.stableCount <= h.particleCount &&
      (t > epochs.lagoon || h.stableCount === 0))
  }
}

export class PrimordialWorld {
  constructor({seed=42,silicon=true}={}) {
    if (!integer(seed) || seed > 0xffffffff || typeof silicon !== 'boolean') throw new Error('Configuração primordial inválida.')
    this.seed = seed
    this.settings = scales(seed)
    this.tick = 0
    this.silicon = true
    this.branchTick = null
    this.phase = 'plasma'
    this.phaseTicks = Object.fromEntries(phaseIds.map(p => [p,p === 'plasma' ? 0 : null]))
    this.gas = blank()
    this.primordial = blank()
    this.stellar = blank()
    this.ejecta = blank()
    this.exported = blank()
    this.mineralLot = {id:'silicate-1', formula:'Mg2SiO4', units:0, firstTick:null, lastTick:null,
      source:'stellar-neighborhood',recipe:{...recipe}}
    this.events = []
    this.history = []
    this.lagoon = null
    this.log('epoch','Região quente e densa em expansão. O inventário nuclear ainda está por resolver.')
    if (!silicon) this.excludeSilicon()
    this.observe()
  }

  log(type,text) {
    this.events.push({tick:this.tick,type,text})
    if (this.events.length > eventLimit) this.events.shift()
  }

  excludeSilicon() {
    if (!this.silicon) return
    this.silicon = false
    this.branchTick = this.tick
    this.exported.Si += this.gas.Si
    this.gas.Si = 0
    this.log('control','Silício livre desviado na fronteira. O material já condensado permanece no lote mineral.')
  }

  branchWithoutSilicon() {
    const other = PrimordialWorld.restore(this.serialize())
    other.excludeSilicon()
    return other
  }

  surfaceSample() {
    if (this.phase !== 'lagoon') throw new Error('A superfície ainda não esfriou até a fase de lagoa.')
    const sample = {kind:'primordial-surface', version:1, seed:this.seed, tick:this.tick,
      handoffTick:this.phaseTicks.lagoon, mineralUnits:this.mineralLot.units,
      mineralDensity:Math.min(1,this.mineralLot.units/2.3), carbon:this.gas.C, oxygen:this.gas.O,
      formula:this.mineralLot.formula, source:this.mineralLot.source, silicon:this.silicon,
      branchTick:this.branchTick}
    if (this.lagoon) {
      sample.parcels = this.lagoon.particles.map(({id,x,y,kind}) => ({id,x,y,kind}))
      sample.energySource = {...this.lagoon.source}
    }
    return sample
  }

  // Evolution of the representative parcel, not a stellar interior solver.
  advanceMacro(enterParticles = true) {
    const t = this.tick
    const { epochs, starFraction, yieldScale } = this.settings
    const next = phaseAt(epochs,t)
    if (next !== this.phase) {
      this.phase = next
      this.phaseTicks[next] = t
      this.log('epoch',PRIMORDIAL_PHASES.find(p => p.id === next).label + '.')
    }
    if (t >= epochs.nuclei && t < epochs.nuclei+12) {
      // 75%/25% by baryon count, converted into coarse H and He nuclei.
      const h = baryons*0.75/12, he = baryons*0.25/(4*12)
      this.primordial.H += h; this.gas.H += h
      this.primordial.He += he; this.gas.He += he
    }
    const age = t-epochs.stars
    if (age >= 0 && age < 16) {
      for (const e of ['H','He']) {
        const moved = this.primordial[e] * starFraction / 16
        this.gas[e] -= moved
        this.stellar[e] += moved
      }
    }
    // Neighboring stars supply a tracked external boundary flux. This parcel's
    // sequestered H/He are not consumed a second time to produce that ejecta.
    if (age >= 26 && age < 38) {
      if (age === 26) this.log('yield','Chegada de ejeção da vizinhança estelar. Rendimentos tabelados por elemento.')
      for (const e of PRIMORDIAL_ELEMENTS) {
        const added = stellarYield[e]*yieldScale/12
        this.ejecta[e] += added
        if (!this.silicon && e === 'Si') this.exported.Si += added
        else this.gas[e] += added
      }
    }
    if (t >= epochs.minerals && t <= epochs.lagoon) {
      const kelvin = diskKelvin(t-epochs.disk)
      const available = Math.min(this.gas.Mg/2, this.gas.Si, this.gas.O/4)
      const fraction = 1 - Math.exp(-0.085*Math.max(0,(1350-kelvin)/1000))
      const formed = available*fraction
      if (formed > 0) {
        for (const [e,coefficient] of Object.entries(recipe)) this.gas[e] -= coefficient*formed
        this.mineralLot.units += formed
        this.mineralLot.firstTick ??= t
        this.mineralLot.lastTick = t
      }
    }
    if (enterParticles && t === epochs.lagoon) {
      // Representative microdomain; avoid counting its virtual units again in
      // the cosmic ledger. Silicate-free controls enter at the same temperature.
      this.lagoon = new PrimordialParticles(this.seed,this.surfaceSample())
    }
  }

  step() {
    if (this.tick >= Number.MAX_SAFE_INTEGER-1) throw new Error('Relógio primordial esgotado.')
    this.tick++
    if (this.lagoon) this.lagoon.step()
    else this.advanceMacro()
    if (this.tick % 8 === 0 || this.phaseTicks[this.phase] === this.tick) this.observe()
    return this.tick
  }

  getMetrics() {
    const t = Math.min(this.tick,this.settings.epochs.lagoon)
    const a = background(t)
    const delta = Math.min(collapseThreshold,this.settings.amplitude*a/aAtRecombination)
    const elements = PRIMORDIAL_ELEMENTS.map(symbol => {
      const mineral = (recipe[symbol] || 0)*this.mineralLot.units
      const residual = this.primordial[symbol]+this.ejecta[symbol]-this.gas[symbol]-
        this.stellar[symbol]-mineral-this.exported[symbol]
      return {symbol,primordial:this.primordial[symbol],ejecta:this.ejecta[symbol],gas:this.gas[symbol],
        stellar:this.stellar[symbol],mineral,exported:this.exported[symbol],residual}
    })
    const unresolvedBaryons = Math.max(0,baryons-weighted(this.primordial))
    const particles = this.lagoon?.getMetrics() ?? {}
    return {...particles,tick:this.tick,phase:this.phase,phaseLabel:PRIMORDIAL_PHASES.find(p => p.id===this.phase).label,
      scaleFactor:a,cosmicTemperature:1/a,matterDensity:a**(-3),cosmologicalTick:t,overdensity:delta,
      diskTemperature:t < this.settings.epochs.disk ? null : diskKelvin(t-this.settings.epochs.disk),
      diskPressureBar:t < this.settings.epochs.disk ? null : PRIMORDIAL_MODEL.diskPressureBar,
      surfaceTemperatureK:this.lagoon ? PRIMORDIAL_MODEL.surfaceBoundary.temperatureK : null,
      surfacePressureBar:this.lagoon ? PRIMORDIAL_MODEL.surfaceBoundary.pressureBar : null,
      stellarProcessed:weighted(this.stellar),unresolvedBaryons,mineralUnits:this.mineralLot.units,
      consumedSilicon:this.mineralLot.units,gas:{...this.gas},ejecta:{...this.ejecta},exported:{...this.exported},
      primordial:{...this.primordial},stellar:{...this.stellar},
      locked:Object.fromEntries(elements.map(e=>[e.symbol,e.stellar+e.mineral])),elements,
      elementResiduals:Object.fromEntries(elements.map(e=>[e.symbol,e.residual])),
      maxElementResidual:Math.max(...elements.map(e=>Math.abs(e.residual))),
      silicon:this.silicon,branchTick:this.branchTick,lagoonReady:!!this.lagoon,lifeCount:0,
      particleCount:particles.particleCount ?? 0,stableCount:particles.stableCount ?? 0,
      lifeStatus:particles.lifeStatus ?? 'Sem organismos inoculados.'}
  }

  observe() {
    const m = this.getMetrics()
    const sample = Object.fromEntries(['tick','phase','scaleFactor','cosmicTemperature','matterDensity','overdensity',
      'mineralUnits','particleCount','stableCount'].map(k=>[k,m[k]]))
    this.history.push(sample)
    if (this.history.length > historyLimit) this.history.shift()
  }

  serialize() {
    return clone({kind:'primordial', version:1, seed:this.seed,tick:this.tick,phase:this.phase,phaseTicks:this.phaseTicks,
      silicon:this.silicon,branchTick:this.branchTick,primordial:this.primordial,stellar:this.stellar,
      ejecta:this.ejecta,gas:this.gas,exported:this.exported,mineralLot:this.mineralLot,events:this.events,
      history:this.history,lagoon:this.lagoon?.serialize() ?? null})
  }

  static restore(data) {
    check(data?.kind === 'primordial' && data.version === 1 && integer(data.seed) && data.seed <= 0xffffffff &&
      integer(data.tick) && data.tick < Number.MAX_SAFE_INTEGER && typeof data.silicon === 'boolean' &&
      (data.silicon ? data.branchTick === null : integer(data.branchTick) && data.branchTick <= data.tick))
    // Replay only the short macro chronology, regardless of how many local
    // particle steps elapsed. This also checks the causal provenance of solids.
    const w = new PrimordialWorld({seed:data.seed, silicon:data.branchTick !== 0})
    const end = Math.min(data.tick,w.settings.epochs.lagoon)
    const solidsAtTick = [0]
    for (let t = 1; t <= end; t++) {
      w.tick = t
      w.advanceMacro(false)
      if (t === data.branchTick) w.excludeSilicon()
      solidsAtTick.push(w.mineralLot.units)
    }
    w.tick = data.tick
    if (!data.silicon && data.branchTick > end) { w.tick=data.branchTick; w.excludeSilicon(); w.tick=data.tick }
    check(data.phase === w.phase && data.phaseTicks && phaseIds.every(p=>data.phaseTicks[p]===w.phaseTicks[p]))
    for (const name of ['gas','stellar','primordial','exported','ejecta']) {
      check(data[name] && PRIMORDIAL_ELEMENTS.every(e=>close(data[name][e],w[name][e])))
    }
    const l = data.mineralLot, expected = w.mineralLot
    check(l && l.id===expected.id && l.formula===expected.formula && l.source===expected.source &&
      l.firstTick===expected.firstTick && l.lastTick===expected.lastTick && close(l.units,expected.units) &&
      l.recipe && Object.keys(l.recipe).length === 3 && Object.keys(recipe).every(e=>l.recipe[e]===recipe[e]))
    validateTimeline(data,w,solidsAtTick)
    check(w.events.length===data.events.length && w.events.every((e,i)=>
      e.tick===data.events[i].tick && e.type===data.events[i].type && e.text===data.events[i].text))
    if (data.tick >= w.settings.epochs.lagoon) {
      const lake = data.lagoon
      check(lake && lake.seed === w.seed && lake.tick === data.tick - w.settings.epochs.lagoon &&
        lake.options?.count === 120 && lake.options.bindingEnabled === true &&
        lake.origin?.scale === 'representative' && close(lake.origin.mineralUnits,expected.units) &&
        close(lake.origin.carbon,w.gas.C) && close(lake.origin.oxygen,w.gas.O) &&
        close(lake.origin.mineralDensity,Math.min(1,expected.units/2.3)))
      w.lagoon = PrimordialParticles.restore(lake)
      const tail = data.history.at(-1)
      if (tail.tick === data.tick) check(tail.stableCount === w.lagoon.getMetrics().stableCount)
    } else check(data.lagoon === null)
    w.history = clone(data.history)
    return w
  }
}

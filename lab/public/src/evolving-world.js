// A synthetic population coupled to a finite two-dimensional planetary surface.
// A founder inoculum is an explicit initial condition. No occupancy or climate
// threshold ever creates individuals after that initial step.
import { EvolvingEnvironment, EVOLVING_HABITATS } from './evolving-environment.js';
import { createBehaviorMemory, chooseBehavior, learnBehavior, validBehaviorMemory } from './behavior-learning.js';

const MAX_FOUNDERS = 72, MAX_LIVING = 384, SITE_CAPACITY = 4;
const HISTORY_LIMIT = 256, JOURNAL_LIMIT = 256, HISTORY_INTERVAL = 10;
const FOUNDER_MASS = 0.55, FOUNDER_ENERGY = 1.12, ENERGY_CAPACITY = 2.4;
const CONTROLS = ['mutationEnabled','selectionEnabled','learningEnabled'];
const neighbors = [[-1,0],[1,0],[0,-1],[0,1]];
const clip = (v, min, max) => Math.max(min, Math.min(max, v));
const finite = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isFinite(v) && v >= min && v <= max;
const integer = (v, min=0, max=Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= min && v <= max;
const same = (a,b,tolerance=1e-8) => Number.isFinite(a) && Number.isFinite(b) &&
  Math.abs(a-b) <= tolerance * Math.max(1,Math.abs(a),Math.abs(b));
const copy = object => structuredClone(object);
function requireValue(value, msg = 'Estado evolutivo inválido.') { if (!value) throw new Error(msg); }
const emptyBehavior = () => ({ decisions:0, explores:0, reward:0, learnedUpdates:0 });
const countAlleles = () => Array(11).fill(0);
const thermalOptimum = allele => 266 + 4.8 * allele;
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const dominant = counts => EVOLVING_HABITATS.reduce((best,h) => counts[h] > counts[best] ? h : best, EVOLVING_HABITATS[0]);

function mapCell(p,size) {
  return Math.min(size - 1, Math.floor(p.y * size)) * size + Math.min(size - 1, Math.floor(p.x * size));
}
function habitatAtIndex(env,i) {
  return env.sample((i % env.size + 0.5)/env.size, (Math.floor(i/env.size)+0.5)/env.size);
}
function eventIdentity(org) {
  return {id:org.id, parentId:org.parentId, lineage:org.lineage, generation:org.generation,
    allele:org.genome.allele, mutationDelta:org.mutationDelta};
}
function validIdentity(i, next, founders) {
  return record(i) && integer(i.id,1,next-1) && integer(i.allele,0,10) && integer(i.lineage,1,founders) &&
    integer(i.generation) && [-1,0,1].includes(i.mutationDelta) && integer(i.allele-i.mutationDelta,0,10) &&
    (i.generation === 0 ? i.id===i.lineage && i.parentId===null && i.mutationDelta===0 && i.id<=founders :
      i.id>founders && integer(i.parentId,i.lineage,i.id-1));
}
function validBehaviorTally(b) {
  return record(b) && integer(b.decisions) && integer(b.explores,0,b.decisions) &&
    integer(b.learnedUpdates,0,b.decisions) && finite(b.reward,-b.decisions,b.decisions);
}
function matchingMeasures(row, expected) {
  if(typeof expected==='number') return same(row,expected,1e-11);
  if(expected===null || typeof expected!=='object') return row===expected;
  if(!row || typeof row!=='object' || Array.isArray(row)!==Array.isArray(expected)) return false;
  const keys=Object.keys(expected);
  return keys.length===Object.keys(row).length && keys.every(k=>matchingMeasures(row[k],expected[k]));
}

export class EvolvingWorld {
  constructor(seed=42, options={}) {
    if (record(seed)) { options = seed; seed = options.seed ?? options.surfaceSample?.seed ?? 42; }
    requireValue(integer(seed,0,0xffffffff) && record(options));
    this.seed = seed;
    this.rng = seed || 0x9e3779b9;
    this.tick = 0;
    this.environment = new EvolvingEnvironment({...options,seed});
    this.controls = Object.fromEntries(CONTROLS.map(k => [k,options[k] ?? true]));
    requireValue(CONTROLS.every(k=>typeof this.controls[k]==='boolean'));
    this.requestedFounders = options.founderCount ?? 24;
    requireValue(integer(this.requestedFounders,0,MAX_FOUNDERS));
    this.organisms = [];
    this.lineages = [];
    this.events = [];
    this.history = [];
    this.branch = null;
    this.nextId = 1;
    this.births = 0; this.deaths = 0; this.mutations = 0; this.maxGeneration = 0;
    this.nutrientInputTotal = 0; this.absorbedEnergy = 0; this.dissipatedEnergy = 0;
    this.behaviorByContext = [emptyBehavior(),emptyBehavior()];
    this.extinctionTick = null;
    this.placeFounders();
    this.founderCount = this.organisms.length;
    this.initialEnergy = this.founderCount * FOUNDER_ENERGY;
    const climate = this.environment.getMetrics();
    this.initialMass = this.environment.initialNutrient + this.founderCount * FOUNDER_MASS;
    this.dominantHabitat = dominant(climate.habitatCounts);
    this.log('start', this.founderCount ?
      this.founderCount+' fundadores digitais introduzidos em regiões habitáveis.' :
      'Mundo iniciado sem fundadores digitais.', {count:this.founderCount});
    this.syncBiota();
    this.recordHistory();
  }

  static fromSurfaceSample(sample,options={}) {
    requireValue(record(sample) && integer(sample.seed,0,0xffffffff));
    return new this(sample.seed,{...options,surfaceSample:sample});
  }

  random() {
    let x=this.rng; x^=x<<13; x^=x>>>17; x^=x<<5;
    this.rng=x>>>0; return this.rng/4294967296;
  }

  placeFounders() {
    const env = this.environment, sites=[];
    for (let i=0; i<env.size*env.size; i++) {
      const p = habitatAtIndex(env,i);
      if (p.habitability >= 0.22 && p.energy > 0.02 && (p.water+p.ice)>0.001 && p.nutrient>0.001) sites.push(i);
    }
    for(let i=sites.length-1;i>0;i--) {
      const j=Math.floor(this.random()*(i+1)); [sites[i],sites[j]]=[sites[j],sites[i]];
    }
    const found=Math.min(this.requestedFounders, sites.length*3);
    for(let i=0; i<found; i++) {
      // A matched triplet of thermal variants occupies each founding patch.
      const site=sites[Math.floor(i/3)], allele=[2,5,8][i%3], id=this.nextId++;
      const x=(site%env.size+0.3+0.4*this.random())/env.size;
      const y=(Math.floor(site/env.size)+0.3+0.4*this.random())/env.size;
      const org={id,parentId:null,lineage:id,generation:0,genome:{allele},trait:allele/10,mutationDelta:0,
        x,y,mass:FOUNDER_MASS,energy:FOUNDER_ENERGY,age:0,lifespan:180+Math.floor(80*this.random()),
        memory:createBehaviorMemory()};
      this.organisms.push(org);
      this.lineages.push({id,trait:org.trait,births:0,deaths:0,mutations:0,maxGeneration:0});
    }
  }

  syncBiota() {
    const env=this.environment;
    const field=new Float64Array(env.size**2);
    for(const o of this.organisms) field[mapCell(o,env.size)]+=o.mass;
    env.setBiotaField(field);
  }

  log(type,text,details={}) {
    this.events.push({tick:this.tick,type,text,...details});
    if(this.events.length>JOURNAL_LIMIT) this.events.shift();
  }

  setLightForcing(forcing) {
    requireValue(finite(forcing,0,2),'Intensidade de luz fora do intervalo.');
    if(this.environment.lightForcing===forcing) return;
    this.environment.setLightForcing(forcing);
    this.log('light','A intensidade da luz foi alterada.',{forcing});
    this.refreshCurrentSample();
  }

  addNutrientPulse(x,y,amount=1) {
    requireValue(finite(x,0,1)&&finite(y,0,1)&&finite(amount,0,1e6) &&
      this.nutrientInputTotal+amount <= 1e9, 'Pulso de nutriente inválido.');
    if(amount===0) return 0;
    this.environment.depositNutrient(x,y,amount);
    this.nutrientInputTotal+=amount;
    this.log('nutrient','Nutriente externo adicionado.',{x,y,amount});
    this.refreshCurrentSample();
    return amount;
  }

  setControls(options={}) {
    requireValue(record(options)&&Object.keys(options).every(k=>CONTROLS.includes(k)&&typeof options[k]==='boolean'));
    for(const k of CONTROLS) {
      if(options[k]!==undefined && options[k]!==this.controls[k]) {
        this.controls[k]=options[k]; this.log('control','Controle experimental alterado.',{control:k,enabled:options[k]});
      }
    }
    this.refreshCurrentSample();
  }

  fork(options={}) {
    requireValue(record(options)&&Object.keys(options).every(k=>CONTROLS.includes(k)||k==='lightForcing'));
    const fork=EvolvingWorld.restore(this.serialize());
    fork.branch={seed:this.seed,tick:this.tick};
    const {lightForcing,...controls}=options;
    fork.setControls(controls);
    if(lightForcing!==undefined) fork.setLightForcing(lightForcing);
    return fork;
  }

  refreshCurrentSample() {
    if(this.history.at(-1)?.tick===this.tick) this.recordHistory();
  }

  thermalMatch(org, temperature) {
    const optimum=thermalOptimum(this.controls.selectionEnabled ? org.genome.allele : 5);
    const delta=(temperature-optimum)/16;
    return Math.exp(-0.5*delta*delta);
  }

  charge(org, amount) {
    const cost=Math.min(org.energy,amount);
    org.energy-=cost; this.dissipatedEnergy+=cost;
  }

  recordDecision(org, decision, gainedMass) {
    // Reward belongs to this individual's chosen stay/explore action. Its
    // energetic outcome includes movement, maintenance and synthesis. No
    // reward uses genotype, reproduction, future conditions or global scores.
    const value=(org.energy-decision.energyBefore+0.6*gainedMass)/0.055;
    const reward=learnBehavior(org.memory,decision.context,decision.action,clip(value,-1,1),this.controls.learningEnabled);
    const tally=this.behaviorByContext[decision.context];
    tally.decisions++; tally.explores+=decision.action; tally.reward+=reward;
    if(this.controls.learningEnabled) tally.learnedUpdates++;
  }

  step() {
    this.tick++;
    const env=this.environment, size=env.size;
    env.step(); // Uses the living surface cover saved at the end of the previous step.
    const samples=new Map(), occupancy=new Uint16Array(size*size), groups=new Map(), decisions=new Map();
    const at=site=>{
      if(!samples.has(site)) samples.set(site,habitatAtIndex(env,site));
      return samples.get(site);
    };
    for(const org of this.organisms) occupancy[mapCell(org,size)]++;
    for(const org of this.organisms) {
      let site=mapCell(org,size);
      if(this.tick%6===org.id%6) {
        const context=at(site).nutrient<0.6 ? 0 : 1;
        const action=chooseBehavior(org.memory,context,this.controls.learningEnabled,this.random());
        const [dx,dy]=neighbors[Math.floor(4*this.random())];
        decisions.set(org.id,{context,action,energyBefore:org.energy});
        if(action===1) {
          this.charge(org,0.006);
          const cx=site%size,cy=Math.floor(site/size),tx=cx+dx,ty=cy+dy;
          const target=ty*size+tx;
          if(tx>=0 && tx<size && ty>=0 && ty<size && occupancy[target]<SITE_CAPACITY) {
            org.x+=dx/size; org.y+=dy/size;
            occupancy[site]--; occupancy[target]++; site=target;
          }
        }
      }
      if(!groups.has(site)) groups.set(site,[]);
      groups.get(site).push(org);
    }

    const alive=[], newborns=[];
    for(const [site,occupants] of groups) {
      const cell=at(site), budgets=[];
      let lightDemand=0, nutrientDemand=0;
      for(const org of occupants) {
        const match=this.thermalMatch(org,cell.temperatureK);
        const capture=Math.min(ENERGY_CAPACITY-org.energy,
          0.090*Math.min(1.5,cell.light)*(0.14+0.86*match)*(0.25+0.75*cell.habitability));
        budgets.push({org,match,capture,uptake:0,survived:false});
        lightDemand+=capture;
      }
      const share=lightDemand>0?Math.min(1,cell.energy/lightDemand):0;
      for(const budget of budgets) {
        const {org,match,capture}=budget;
        const photons=capture*share;
        org.energy+=photons; this.absorbedEnergy+=photons;
        this.charge(org,0.005+0.003*org.mass+0.006*(1-cell.habitability)+0.004*(1-match));
        org.age++;
        if(org.age>=org.lifespan || org.energy<1e-9 || cell.water+cell.ice<0.0001) {
          if(decisions.has(org.id)) this.recordDecision(org,decisions.get(org.id),0);
          this.deaths++; this.lineages[org.lineage-1].deaths++;
          env.depositNutrient(org.x,org.y,org.mass);
          this.charge(org,org.energy); occupancy[site]--;
          this.log('death','Organismo '+org.id+' morreu.',eventIdentity(org));
          continue;
        }
        budget.uptake=Math.min(0.035*(0.15+0.85*match)*(0.22+0.78*cell.habitability),
          Math.max(0,1.35-org.mass),org.energy/0.21);
        budget.survived=true;
        nutrientDemand+=budget.uptake;
        alive.push(org);
      }
      const fraction=nutrientDemand>0 ?
        env.takeNutrient(occupants[0].x,occupants[0].y,nutrientDemand)/nutrientDemand : 0;
      for(const budget of budgets) {
        if(!budget.survived) continue;
        const gained=budget.uptake*fraction;
        budget.org.mass+=gained;
        this.charge(budget.org,gained*0.21);
        if(decisions.has(budget.org.id)) this.recordDecision(budget.org,decisions.get(budget.org.id),gained);
      }
    }
    for(const org of alive) {
      if(org.mass<0.91 || org.energy<0.66 || org.age<16 || alive.length+newborns.length>=MAX_LIVING) continue;
      const site=mapCell(org,size),cx=site%size,cy=Math.floor(site/size);
      const rotation=Math.floor(4*this.random());
      for(let j=0;j<5;j++) {
        const [dx,dy]=j===0 ? [0,0] : neighbors[(j-1+rotation)%4];
        const tx=cx+dx,ty=cy+dy, target=ty*size+tx;
        if(tx<0||tx>=size||ty<0||ty>=size||occupancy[target]>=SITE_CAPACITY||at(target).habitability<0.08) continue;
        const mutateDraw=this.random(), direction=this.random()<0.5?-1:1;
        const old=org.genome.allele;
        const allele=this.controls.mutationEnabled && mutateDraw<0.12 ? (old===0?1:old===10?9:old+direction) : old;
        this.charge(org,0.11);
        org.mass/=2; org.energy/=2;
        const child={id:this.nextId++,parentId:org.id,lineage:org.lineage,generation:org.generation+1,
          genome:{allele},trait:allele/10,mutationDelta:allele-old,
          x:(tx+0.25+0.5*this.random())/size,y:(ty+0.25+0.5*this.random())/size,
          age:0,lifespan:180+Math.floor(80*this.random()),mass:org.mass,energy:org.energy,memory:createBehaviorMemory()};
        occupancy[target]++; newborns.push(child);
        this.births++; this.maxGeneration=Math.max(this.maxGeneration,child.generation);
        const family=this.lineages[child.lineage-1];family.births++;
        family.maxGeneration=Math.max(family.maxGeneration,child.generation);
        if(child.mutationDelta) {this.mutations++;family.mutations++;}
        this.log('birth','Descendente '+child.id+(child.mutationDelta?' nasceu com variação herdável.':' nasceu.'),eventIdentity(child));
        break;
      }
    }
    this.organisms=alive.concat(newborns).sort((a,b)=>a.id-b.id);
    if(!this.organisms.length && this.founderCount>0 && this.extinctionTick===null) {
      this.extinctionTick=this.tick; this.log('extinction','A última linhagem se extinguiu.');
    }
    this.syncBiota();
    if(this.tick%HISTORY_INTERVAL===0) {
      const habitat=dominant(env.getMetrics().habitatCounts);
      if(habitat!==this.dominantHabitat) {
        this.log('habitat','Mudança do habitat predominante.',{previous:this.dominantHabitat,habitat});
        this.dominantHabitat=habitat;
      }
      this.recordHistory();
    }
    return this.tick;
  }

  getMetrics() {
    const climate=this.environment.getMetrics(), population=this.organisms.length,traitCounts=countAlleles();
    let bodyMass=0,totalEnergy=0,totalTrait=0,maxLivingGeneration=0;
    for(const o of this.organisms) {
      traitCounts[o.genome.allele]++; bodyMass+=o.mass; totalEnergy+=o.energy; totalTrait+=o.genome.allele;
      maxLivingGeneration=Math.max(maxLivingGeneration,o.generation);
    }
    const totalMass=bodyMass+climate.totalNutrient;
    const bc=this.behaviorByContext;
    return {...climate, tick:this.tick,population,founderCount:this.founderCount,births:this.births,deaths:this.deaths,
      maxGeneration:this.maxGeneration,maxLivingGeneration,mutations:this.mutations,extinct:this.extinctionTick!==null,
      extinctionTick:this.extinctionTick, livingLineages:this.lineages.filter(l=>1+l.births-l.deaths>0).length,
      traitCounts,traitFrequencies:traitCounts.map(n=>population?n/population:0),meanTrait:population?totalTrait/(10*population):null,
      dominantHabitat:dominant(climate.habitatCounts),bodyMass,nutrientMass:climate.totalNutrient,totalMass,
      initialMass:this.initialMass,nutrientInputTotal:this.nutrientInputTotal,massError:totalMass-this.initialMass-this.nutrientInputTotal,
      totalEnergy,initialEnergy:this.initialEnergy,absorbedEnergy:this.absorbedEnergy,dissipatedEnergy:this.dissipatedEnergy,
      energyError:totalEnergy+this.dissipatedEnergy-this.absorbedEnergy-this.initialEnergy,
      selectionEnabled:this.controls.selectionEnabled,mutationEnabled:this.controls.mutationEnabled,
      learningEnabled:this.controls.learningEnabled,behaviorDecisions:bc[0].decisions+bc[1].decisions,
      exploreDecisions:bc[0].explores+bc[1].explores,behaviorRewardTotal:bc[0].reward+bc[1].reward,
      learnedUpdates:bc[0].learnedUpdates+bc[1].learnedUpdates,
      behaviorByContext:bc.map(b=>({...b,rewardTotal:b.reward}))};
  }

  recordHistory() {
    const m=this.getMetrics();
    if(this.history.at(-1)?.tick===this.tick) this.history[this.history.length-1]=m;
    else this.history.push(m);
    if(this.history.length>HISTORY_LIMIT) this.history.shift();
  }

  serialize() {
    return copy({mode:'evolving-world',version:1,seed:this.seed,rng:this.rng,tick:this.tick,
      environment:this.environment.serialize(),controls:this.controls,requestedFounders:this.requestedFounders,
      founderCount:this.founderCount,nextId:this.nextId,organisms:this.organisms,lineages:this.lineages,
      births:this.births,deaths:this.deaths,mutations:this.mutations,maxGeneration:this.maxGeneration,
      extinctionTick:this.extinctionTick,initialMass:this.initialMass,initialEnergy:this.initialEnergy,
      nutrientInputTotal:this.nutrientInputTotal,absorbedEnergy:this.absorbedEnergy,dissipatedEnergy:this.dissipatedEnergy,
      behaviorByContext:this.behaviorByContext,dominantHabitat:this.dominantHabitat,branch:this.branch,
      history:this.history,events:this.events});
  }

  static restore(data) {
    requireValue(data?.mode==='evolving-world' && data.version===1 && integer(data.seed,0,0xffffffff) &&
      integer(data.rng,1,0xffffffff) && integer(data.tick) && record(data.controls) &&
      CONTROLS.every(k=>typeof data.controls[k]==='boolean') && Object.keys(data.controls).length===CONTROLS.length &&
      integer(data.requestedFounders,0,MAX_FOUNDERS) && integer(data.founderCount,0,data.requestedFounders) &&
      integer(data.births) && integer(data.deaths,0,data.founderCount+data.births) && integer(data.mutations,0,data.births) &&
      integer(data.maxGeneration,0,data.births) && data.nextId===1+data.founderCount+data.births &&
      integer(data.nextId,1) && Array.isArray(data.organisms) && data.organisms.length<=MAX_LIVING &&
      data.organisms.length===data.founderCount+data.births-data.deaths &&
      Array.isArray(data.lineages) && data.lineages.length===data.founderCount &&
      Array.isArray(data.events) && data.events.length<=JOURNAL_LIMIT && data.events.length>0 &&
      Array.isArray(data.history) && data.history.length>0 && data.history.length<=HISTORY_LIMIT &&
      Array.isArray(data.behaviorByContext) && data.behaviorByContext.length===2 &&
      data.behaviorByContext.every(validBehaviorTally) && EVOLVING_HABITATS.includes(data.dominantHabitat));
    requireValue((data.branch===null || (data.branch?.seed===data.seed && integer(data.branch?.tick,0,data.tick))) &&
      [data.initialMass,data.initialEnergy,data.nutrientInputTotal,data.absorbedEnergy,data.dissipatedEnergy].every(n=>finite(n)) &&
      data.initialEnergy===data.founderCount*FOUNDER_ENERGY &&
      (data.founderCount>0 && data.organisms.length===0 ? integer(data.extinctionTick,1,data.tick) : data.extinctionTick===null));
    const env=EvolvingEnvironment.restore(data.environment);
    requireValue(env.tick===data.tick && env.seed===data.seed && same(data.initialMass,env.initialNutrient+data.founderCount*FOUNDER_MASS));
    const world=Object.create(this.prototype);
    for(const key of ['seed','rng','tick','controls','requestedFounders','founderCount','nextId','organisms','lineages',
      'births','deaths','mutations','maxGeneration','extinctionTick','initialMass','initialEnergy','nutrientInputTotal',
      'absorbedEnergy','dissipatedEnergy','behaviorByContext','dominantHabitat','branch','history','events']) world[key]=copy(data[key]);
    world.environment=env;
    world.validateObservations();
    return world;
  }

  validateObservations() {
    let births=0,deaths=0,mutations=0,maxGen=0;
    const families=new Array(this.founderCount).fill(0), ids=new Set(), known=new Map();
    const occupancy=new Uint16Array(this.environment.size**2), biota=new Float64Array(occupancy.length);
    const addObservation=o=>{
      requireValue(validIdentity(o,this.nextId,this.founderCount));
      const prior=known.get(o.id);
      if(prior) requireValue(['lineage','parentId','generation','allele','mutationDelta'].every(k=>prior[k]===o[k]));
      else known.set(o.id,o);
    };
    for(const o of this.organisms) {
      requireValue(record(o)&&record(o.genome)&&!ids.has(o.id)&&o.trait===o.genome.allele/10&&
        finite(o.x,0,1)&&finite(o.y,0,1)&&finite(o.mass,1e-12,1.3500000001)&&finite(o.energy,0,ENERGY_CAPACITY+1e-12)&&
        integer(o.lifespan,180,259)&&integer(o.age,0,Math.min(this.tick,o.lifespan-1))&&validBehaviorMemory(o.memory)&&
        o.memory.visits.reduce((s,n)=>s+n,0)<=Math.ceil(o.age/6));
      addObservation(eventIdentity(o)); ids.add(o.id);
      const i=mapCell(o,this.environment.size);occupancy[i]++;biota[i]+=o.mass; families[o.lineage-1]++;
    }
    requireValue(occupancy.every(n=>n<=SITE_CAPACITY)&&biota.every((n,i)=>same(n,this.environment.biota[i])));
    for(const [i,f] of this.lineages.entries()) {
      requireValue(f.id===i+1 && finite(f.trait,0,1)&&same(f.trait,Math.round(10*f.trait)/10)&&
        integer(f.births)&&integer(f.deaths,0,1+f.births)&&integer(f.mutations,0,f.births)&&integer(f.maxGeneration,0,f.births)&&
        families[i]===1+f.births-f.deaths);
      births+=f.births;deaths+=f.deaths;mutations+=f.mutations;maxGen=Math.max(maxGen,f.maxGeneration);
    }
    requireValue(births===this.births&&deaths===this.deaths&&mutations===this.mutations&&maxGen===this.maxGeneration);
    let last=-1;
    for(const e of this.events) {
      requireValue(record(e)&&integer(e.tick,Math.max(0,last),this.tick)&&typeof e.text==='string'&&e.text.length<=300);
      switch(e.type) {
        case 'start':requireValue(e.tick===0&&e.count===this.founderCount);break;
        case 'birth':case 'death':addObservation(e);if(e.type==='birth')requireValue(e.generation>0);break;
        case 'extinction':requireValue(e.tick===this.extinctionTick);break;
        case 'light':requireValue(finite(e.forcing,0,2));break;
        case 'control':requireValue(CONTROLS.includes(e.control)&&typeof e.enabled==='boolean');break;
        case 'nutrient':requireValue(finite(e.x,0,1)&&finite(e.y,0,1)&&finite(e.amount,0,1e6));break;
        case 'habitat':requireValue(EVOLVING_HABITATS.includes(e.habitat)&&EVOLVING_HABITATS.includes(e.previous));break;
        default:requireValue(false);
      }
      last=e.tick;
    }
    for(const o of known.values()) {
      const parent=known.get(o.parentId);
      if(parent) requireValue(o.lineage===parent.lineage && o.generation===parent.generation+1 && o.allele-parent.allele===o.mutationDelta);
      if(o.generation===0)requireValue(o.allele===Math.round(this.lineages[o.lineage-1].trait*10));
    }
    const current=this.getMetrics();
    const expectedLength=Math.min(HISTORY_LIMIT,Math.floor(this.tick/HISTORY_INTERVAL)+1);
    requireValue(this.history.length===expectedLength);
    const cells=this.environment.size**2;
    let previous=null;
    for(const [index,h] of this.history.entries()) {
      const expectedTick=(Math.floor(this.tick/HISTORY_INTERVAL)-expectedLength+index+1)*HISTORY_INTERVAL;
      requireValue(record(h)&&h.tick===expectedTick&&integer(h.births,0,this.births)&&integer(h.deaths,0,this.deaths)&&
        h.founderCount===this.founderCount&&integer(h.mutations,0,Math.min(h.births,this.mutations))&&
        integer(h.maxGeneration,0,Math.min(h.births,this.maxGeneration))&&integer(h.maxLivingGeneration,0,h.maxGeneration)&&
        integer(h.livingLineages,0,Math.min(h.population,this.founderCount))&&
        h.extinct===(this.extinctionTick!==null&&h.tick>=this.extinctionTick)&&
        h.extinctionTick===(h.extinct?this.extinctionTick:null)&&
        integer(h.population,0,MAX_LIVING)&&h.population===this.founderCount+h.births-h.deaths&&
        Array.isArray(h.traitCounts)&&h.traitCounts.length===11&&h.traitCounts.every(n=>integer(n,0,h.population))&&
        h.traitCounts.reduce((s,n)=>s+n,0)===h.population&&Array.isArray(h.traitFrequencies)&&h.traitFrequencies.length===11&&
        h.traitFrequencies.every((n,i)=>n===(h.population?h.traitCounts[i]/h.population:0))&&
        (h.population?same(h.meanTrait,h.traitCounts.reduce((s,n,a)=>s+n*a,0)/(10*h.population)):h.meanTrait===null)&&
        finite(h.bodyMass)&&finite(h.nutrientMass)&&finite(h.totalMass)&&same(h.totalMass,h.bodyMass+h.nutrientMass)&&
        h.initialMass===this.initialMass&&finite(h.nutrientInputTotal,0,this.nutrientInputTotal)&&
        same(h.massError,h.totalMass-h.initialMass-h.nutrientInputTotal)&&
        same(h.totalMass,this.initialMass+h.nutrientInputTotal)&&
        finite(h.totalEnergy)&&h.initialEnergy===this.initialEnergy&&finite(h.absorbedEnergy,0,this.absorbedEnergy)&&
        finite(h.dissipatedEnergy,0,this.dissipatedEnergy)&&
        same(h.totalEnergy+h.dissipatedEnergy,h.initialEnergy+h.absorbedEnergy)&&
        same(h.energyError,h.totalEnergy+h.dissipatedEnergy-h.absorbedEnergy-h.initialEnergy)&&
        record(h.habitatCounts)&&EVOLVING_HABITATS.every(k=>integer(h.habitatCounts[k],0,cells))&&
        EVOLVING_HABITATS.reduce((n,k)=>n+h.habitatCounts[k],0)===cells&&
        h.dominantHabitat===dominant(h.habitatCounts)&&same(h.lagoonFraction,h.habitatCounts.lagoon/cells)&&
        finite(h.meanTemperatureK,80,500)&&finite(h.meanEnergy)&&finite(h.meanHumidity,0,1.00000001)&&
        finite(h.meanHabitability,0,1.00000001)&&finite(h.lightForcing,0,2)&&
        [h.liquidWater,h.iceWater,h.vaporWater,h.boundNutrient,h.availableNutrient].every(n=>finite(n))&&
        same(h.waterInventory,h.liquidWater+h.iceWater+h.vaporWater)&&same(h.waterInventory,this.environment.initialWaterInventory)&&
        same(h.waterError,h.waterInventory-this.environment.initialWaterInventory)&&Number.isFinite(h.nutrientError)&&
        Math.abs(h.nutrientError)<1e-8*(1+this.environment.initialNutrient+this.environment.nutrientReturned)&&
        same(h.totalNutrient,h.boundNutrient+h.availableNutrient)&&same(h.nutrientMass,h.totalNutrient)&&
        same(h.meanBiota,h.bodyMass/cells)&&CONTROLS.every(k=>typeof h[k]==='boolean')&&
        Array.isArray(h.behaviorByContext)&&h.behaviorByContext.length===2&&h.behaviorByContext.every(validBehaviorTally));
      const [low,high]=h.behaviorByContext;
      requireValue(low.rewardTotal===low.reward&&high.rewardTotal===high.reward&&
        h.behaviorDecisions===low.decisions+high.decisions&&h.exploreDecisions===low.explores+high.explores&&
        h.learnedUpdates===low.learnedUpdates+high.learnedUpdates&&same(h.behaviorRewardTotal,low.reward+high.reward));
      const cumulative=['births','deaths','mutations','maxGeneration','behaviorDecisions','exploreDecisions','learnedUpdates',
        'nutrientInputTotal','absorbedEnergy','dissipatedEnergy'];
      requireValue(cumulative.every(k=>h[k]<=current[k]&&(!previous||previous[k]<=h[k])));
      previous=h;
    }
    if(previous.tick===this.tick)requireValue(matchingMeasures(previous,current));
    requireValue(same(current.totalMass,this.initialMass+this.nutrientInputTotal)&&
      same(current.totalEnergy+this.dissipatedEnergy,this.initialEnergy+this.absorbedEnergy));
  }
}

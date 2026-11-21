// 3D classical, reactive teaching model for neutral atomic parcels. Positions
// are fractions of a cubic vessel. Velocities are nm/fs, mass u, energies eV.
// Coordinates, interactions and topology are resolved; orbitals are not.
import {ATOMIC_ELEMENTS,ATOMIC_SYMBOLS,maxBondOrder,bondEnergyEv} from './atomic-elements.js'
import {observeAtomicWorld,validateAtomicObservation} from './atomic-observer.js'
import {updateReactionBench,validateReactionBench} from './reaction-bench.js'
import {CALIBRATED_MOLECULES,calibratedBondLaw,waterBend} from './calibrated-force-field.js'

const KB=8.617333262e-5, UVEL=10364.2696563, U_KG=1.66053906660e-27, EV_J=1.602176634e-19
const DT=1.2, SUBS=4, RC=.40, DEPTH=.013, STEEP=13, SPRING=165, MAX=384
const TICK_FS=DT*SUBS, V3_SUBSTEPS=16
const PROFILES={2:'neutral-chonps-v2',3:'neutral-chonps-h2-h2o-v3'}
const integer=(x,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(x)&&x>=min&&x<=max
const finite=(x,min=-Infinity,max=Infinity)=>Number.isFinite(x)&&x>=min&&x<=max
const check=v=>{if(!v)throw new Error('Estado da simulação atômica inválido.')}
const clone=o=>JSON.parse(JSON.stringify(o))
const keys=['x','y','z'],vk=['vx','vy','vz']
const controls=['bindingEnabled','thermostatEnabled']
const energyK=(ps)=>ps.reduce((s,p)=>s+0.5*UVEL*p.massU*(p.vx*p.vx+p.vy*p.vy+p.vz*p.vz),0)
const pairKey=(i,j)=>i*MAX+j
export const ATOMIC_PHYSICS=Object.freeze({tickFs:TICK_FS,dtFs:TICK_FS/V3_SUBSTEPS,integrationSubsteps:V3_SUBSTEPS,
  legacyDtFs:DT,legacySubsteps:SUBS,version:3,physicsProfile:PROFILES[3],maxCount:MAX,minTemperatureK:1,
  maxTemperatureK:3000,minVolumeNm3:1,maxVolumeNm3:512,boltzmannEvK:KB,atomicMassKg:U_KG,
  weakAttractionEv:DEPTH,phase:'indeterminada',model:'3D molecular dynamics; calibrated intramolecular H2/H2O, effective bonds for other graphs, explicit reaction reservoir, optional thermal bath'})

function random(seed,t,a,b=0,s=0){
  let x=(seed^Math.imul(t,0x9e3779b1)^Math.imul(a+s,0x85ebca6b)^Math.imul(b,0xc2b2ae35))>>>0
  x=Math.imul(x^(x>>>16),0x21f0aaad);x=Math.imul(x^(x>>>15),0x735a2d97)
  return ((x^(x>>>15))>>>0)/4294967296
}
function gaussian(seed,i,k){
  return Math.sqrt(-2*Math.log(Math.max(1e-12,random(seed,0,i,k,11))))*Math.cos(2*Math.PI*random(seed,0,i,k,17))
}
function symbolsFor(seed,count){
  const ratios={H:.43,C:.20,N:.12,O:.19,P:.03,S:.03}
  const symbols=ATOMIC_SYMBOLS.filter(s=>count>=6||['H','C','N','O','P','S'].indexOf(s)<count)
  const items=symbols.map(s=>[s,1])
  while(items.reduce((s,p)=>s+p[1],0)<count){
    let best=0
    for(let j=1;j<items.length;j++)if(ratios[items[j][0]]*count-items[j][1]>ratios[items[best][0]]*count-items[best][1])best=j
    items[best][1]++
  }
  const out=items.flatMap(([s,n])=>Array(n).fill(s))
  for(let i=out.length-1;i>0;i--){const j=Math.floor(random(seed,0,i,8)*(i+1));[out[i],out[j]]=[out[j],out[i]]}
  return out
}

// Shift potential AND derivative at the cutoff for continuous forces.
const parameters=new Map()
function pairParameters(a,b){
  const key=a.element+b.element
  let v=parameters.get(key)
  if(!v){
    const nominal=(a.radiusPm+b.radiusPm)/1000,minimum=1.55*nominal
    const e=Math.exp(-STEEP*(RC-minimum))
    v={nominal,minimum,uc:DEPTH*(e*e-2*e),dc:2*DEPTH*STEEP*(e-e*e)}
    parameters.set(key,v);parameters.set(b.element+a.element,v)
  }
  return v
}
function pairLaw(d,params,order,energy){
  if(order){
    const rest=params.nominal*(1-.064*(order-1)),k=SPRING*order,stretch=d-rest
    return [0.5*k*stretch*stretch-energy,k*stretch]
  }
  if(d>=RC)return [0,0]
  const e=Math.exp(-STEEP*(d-params.minimum))
  return [DEPTH*(e*e-2*e)-params.uc-(d-RC)*params.dc,2*DEPTH*STEEP*(e-e*e)-params.dc]
}

function nearby(ps,side,visit){
  const n=Math.max(1,Math.floor(side/RC)),bins=new Map()
  const cell=v=>Math.min(n-1,Math.floor(v*n)), flat=(a,b,c)=>a+n*(b+n*c)
  for(let i=0;i<ps.length;i++){
    const p=ps[i],key=flat(cell(p.x),cell(p.y),cell(p.z))
    if(!bins.has(key))bins.set(key,[])
    bins.get(key).push(i)
  }
  for(let i=0;i<ps.length;i++){
    const p=ps[i],cx=cell(p.x),cy=cell(p.y),cz=cell(p.z)
    for(let z=Math.max(0,cz-1);z<=Math.min(n-1,cz+1);z++)
      for(let y=Math.max(0,cy-1);y<=Math.min(n-1,cy+1);y++)
        for(let x=Math.max(0,cx-1);x<=Math.min(n-1,cx+1);x++)
          for(const j of bins.get(flat(x,y,z))||[]){
            if(j<=i)continue
            const q=ps[j],dx=(q.x-p.x)*side,dy=(q.y-p.y)*side,dz=(q.z-p.z)*side,d2=dx*dx+dy*dy+dz*dz
            if(d2<RC*RC)visit(i,j,dx,dy,dz,Math.max(1e-9,Math.sqrt(d2)))
          }
  }
}

// Rebuild only after a graph edit. Neighboring but unbonded species do not
// change whether a component has the H2 or H2O intramolecular force field.
const topologyCache=new WeakMap()
function moleculeTerms(world){
  if(world.version!==3)return null
  let topology=topologyCache.get(world.bonds)
  if(topology)return topology
  const ps=world.particles, neighbors=Array.from(ps,()=>[])
  const bonds=new Map(),excluded=new Set(),waters=[]
  for(const b of world.bonds){
    const i=b.a-1,j=b.b-1
    neighbors[i].push([j,b.order]);neighbors[j].push([i,b.order])
  }
  for(const b of world.bonds){
    const i=b.a-1,j=b.b-1
    if(b.order===1&&ps[i].element==='H'&&ps[j].element==='H'&&neighbors[i].length===1&&neighbors[j].length===1)
      bonds.set(pairKey(i,j),'H2')
  }
  for(let o=0;o<ps.length;o++){
    if(ps[o].element!=='O'||neighbors[o].length!==2)continue
    if(!neighbors[o].every(([h,order])=>ps[h].element==='H'&&order===1&&neighbors[h].length===1))continue
    const [[a],[b]]=neighbors[o]
    for(const h of [a,b])bonds.set(pairKey(Math.min(o,h),Math.max(o,h)),'H2O')
    excluded.add(pairKey(Math.min(a,b),Math.max(a,b)))
    waters.push([o,a,b])
  }
  topology={bonds,excluded,waters}
  topologyCache.set(world.bonds,topology)
  return topology
}

function forces(world){
  const ps=world.particles,side=world.sideNm,f=new Float64Array(ps.length*3)
  let potential=0,virial=0,weak=0,covalent=0,angle=0
  const topology=moleculeTerms(world)
  const bonded=new Set()
  function add(i,j,dx,dy,dz,d,order,energy){
    const formula=order&&topology?.bonds.get(pairKey(i,j))
    const [u,g]=formula?calibratedBondLaw(formula,d,energy):pairLaw(d,pairParameters(ps[i],ps[j]),order,energy)
    potential+=u;virial-=d*g
    if(order)covalent+=u;else weak+=u
    const scale=g/d,ix=i*3,jx=j*3
    f[ix]+=dx*scale;f[ix+1]+=dy*scale;f[ix+2]+=dz*scale
    f[jx]-=dx*scale;f[jx+1]-=dy*scale;f[jx+2]-=dz*scale
  }
  for(const b of world.bonds){
    const i=b.a-1,j=b.b-1,p=ps[i],q=ps[j]
    const dx=(q.x-p.x)*side,dy=(q.y-p.y)*side,dz=(q.z-p.z)*side
    add(i,j,dx,dy,dz,Math.max(1e-9,Math.hypot(dx,dy,dz)),b.order,b.energyEv);bonded.add(pairKey(i,j))
  }
  nearby(ps,side,(i,j,dx,dy,dz,d)=>{
    const key=pairKey(i,j)
    if(!bonded.has(key)&&!topology?.excluded.has(key))add(i,j,dx,dy,dz,d,0,0)
  })
  for(const [o,a,b] of topology?.waters??[]){
    const u=keys.map(k=>(ps[a][k]-ps[o][k])*side)
    const v=keys.map(k=>(ps[b][k]-ps[o][k])*side)
    const bend=waterBend(u,v)
    for(let k=0;k<3;k++){
      f[3*a+k]+=bend.forceH1[k];f[3*b+k]+=bend.forceH2[k]
      f[3*o+k]-=bend.forceH1[k]+bend.forceH2[k]
    }
    angle+=bend.energyEv
  }
  // The angular potential is invariant under uniform scaling; its scalar virial is zero.
  return {f,potential:potential+angle,virial,weak,covalent:covalent+angle,angle}
}

function scaleVelocity(ps,factor){
  for(const p of ps){p.vx*=factor;p.vy*=factor;p.vz*=factor}
}

export class AtomicWorld {
  #substeps
  #physicsVersion
  get kind(){return 'particle-world'}
  get mode(){return 'particle-world'}
  get version(){return this.#physicsVersion}
  get physicsVersion(){return this.#physicsVersion}
  get physicsProfile(){return PROFILES[this.version]}
  get integrationSubsteps(){return this.#substeps}
  get integrationDtFs(){return DT*SUBS/this.#substeps}
  constructor(seed=42,options={}){
    const count=options.count??144
    this.#physicsVersion=options.physicsVersion===undefined?3:options.physicsVersion
    check(this.version===2||this.version===3)
    const defaultSteps=this.version===3?V3_SUBSTEPS:SUBS
    this.#substeps=options.integrationSubsteps===undefined?defaultSteps:options.integrationSubsteps
    check(this.#substeps===defaultSteps || this.#substeps===2*defaultSteps)
    this.targetTemperatureK=options.temperatureK??300;this.volumeNm3=options.volumeNm3??12
    check(integer(seed,0,0xffffffff)&&integer(count,0,MAX)&&finite(this.targetTemperatureK,1,3000)&&finite(this.volumeNm3,1,512))
    this.initialTemperatureK=this.targetTemperatureK;this.initialVolumeNm3=this.volumeNm3
    this.seed=seed;this.tick=0;this.sideNm=Math.cbrt(this.volumeNm3)
    this.controls=Object.fromEntries(controls.map(k=>[k,options[k]??true]))
    check(controls.every(k=>typeof this.controls[k]==='boolean'))
    this.particles=[]
    for(const [i,s] of symbolsFor(seed,count).entries()){
      const e=ATOMIC_ELEMENTS[s],scale=Math.sqrt(KB*this.targetTemperatureK/(UVEL*e.massU))
      const p={id:i+1,element:s,mass:e.massU,massU:e.massU,radiusPm:e.covalentRadiusPm,protons:e.protons,
        neutrons:e.neutrons,electrons:e.electrons,charge:0,vx:gaussian(seed,i,1)*scale,
        vy:gaussian(seed,i,2)*scale,vz:gaussian(seed,i,3)*scale}
      for(let attempt=0;attempt<100;attempt++){
        for(let k=0;k<3;k++)p[keys[k]]=0.005+0.99*random(seed,attempt,i,k+22)
        if(this.particles.every(q=>Math.hypot(q.x-p.x,q.y-p.y,q.z-p.z)*this.sideNm>
          0.88*(q.radiusPm+p.radiusPm)/1000))break
      }
      this.particles.push(p)
    }
    if(count)scaleVelocity(this.particles,Math.sqrt(1.5*count*KB*this.targetTemperatureK/energyK(this.particles)))
    this.bonds=[];this.events=[];this.history=[];this.flux={formed:[],broken:[],upgraded:[]}
    this.bathWorkEv=0;this.volumeWorkEv=0;this.reactionHeatEv=0;this.integrationCorrectionEv=0
    this.integrationDriftEv=0;this.integrationAbsDriftEv=0
    this.cumulativeFormed=0;this.cumulativeBroken=0;this.cumulativeUpgraded=0
    this.field=forces(this)
    this.initialEnergyEv=energyK(this.particles)+this.field.potential
    this.initialMassU=this.particles.reduce((s,p)=>s+p.massU,0)
    this.observer=observeAtomicWorld(this,null)
    this.reactionBench=updateReactionBench(this)
    this.benchLegacyOmitted=false
    this.log('start','Átomos neutros livres introduzidos no recipiente.');this.record()
  }
  log(type,text,details={}){
    this.events.push({tick:this.tick,type,text,...details})
    if(this.events.length>128)this.events.shift()
  }
  setTemperature(value){
    check(finite(value,1,3000));if(value===this.targetTemperatureK)return
    this.targetTemperatureK=value;this.log('temperature','Temperatura-alvo do banho alterada.',{temperatureK:value});this.record()
  }
  setVolume(value){
    check(finite(value,1,512));if(value===this.volumeNm3)return
    const old=this.field.potential
    this.volumeNm3=value;this.sideNm=Math.cbrt(value)
    for(const b of this.bonds)b.rest=this.bondRest(b)
    this.field=forces(this);this.volumeWorkEv+=this.field.potential-old
    this.log('volume','Paredes deslocadas. As posições relativas foram preservadas.',{volumeNm3:value});this.record()
  }
  setControls(changes){
    check(changes&&Object.keys(changes).every(k=>controls.includes(k)&&typeof changes[k]==='boolean'))
    for(const [k,v] of Object.entries(changes))if(this.controls[k]!==v){
      this.controls[k]=v;this.log('control','Controle experimental alterado.',{control:k,enabled:v})
    }
    this.record()
  }
  bondRest(b){
    const formula=moleculeTerms(this)?.bonds.get(pairKey(b.a-1,b.b-1))
    if(formula)return CALIBRATED_MOLECULES[formula].rEqNm/this.sideNm
    return pairParameters(this.particles[b.a-1],this.particles[b.b-1]).nominal*(1-.064*(b.order-1))/this.sideNm
  }
  changeBonds(){
    if(this.version===3)return this.changeBondsV3()
    const ps=this.particles,side=this.sideNm,used=new Uint8Array(ps.length)
    const active=new Map(),survivors=[],blocked=new Set()
    let heat=0
    for(const b of this.bonds){
      const i=b.a-1,j=b.b-1,p=ps[i],q=ps[j],d=Math.hypot(q.x-p.x,q.y-p.y,q.z-p.z)*side
      const params=pairParameters(p,q),u=pairLaw(d,params,b.order,b.energyEv)[0]
      const strain=Math.max(0,d-b.rest*side),elastic=.5*SPRING*b.order*strain**2
      // Stretch-induced dissociation, plus activated rupture when the heat bath
      // is coupled. Thermal breakup is extremely rare at room temperature.
      const thermal=this.controls.thermostatEnabled ? .004*Math.exp(-Math.max(0,b.energyEv-elastic)/(KB*this.targetTemperatureK)) : 0
      if(elastic>b.energyEv||random(this.seed,this.tick,b.a,b.b,33)<thermal){
        heat+=u-pairLaw(d,params,0,0)[0];this.flux.broken.push({...b});blocked.add(pairKey(i,j));continue
      }
      used[i]+=b.order;used[j]+=b.order;active.set(pairKey(i,j),b);survivors.push(b)
    }
    if(this.controls.bindingEnabled)nearby(ps,side,(i,j,dx,dy,dz,d)=>{
      const p=ps[i],q=ps[j],k=pairKey(i,j),old=active.get(k),ord=(old?.order??0)+1
      if(blocked.has(k)||used[i]>=ATOMIC_ELEMENTS[p.element].maxValence||used[j]>=ATOMIC_ELEMENTS[q.element].maxValence||
        ord>maxBondOrder(p.element,q.element))return
      const params=pairParameters(p,q)
      if(d>params.nominal*(old?1.07:1.34)||d<.50*params.nominal||
        random(this.seed,this.tick,p.id,q.id,47)>(old ? .045 : .48))return
      const energy=bondEnergyEv(p.element,q.element,ord)
      const before=pairLaw(d,params,old?.order??0,old?.energyEv??0)[0]
      const after=pairLaw(d,params,ord,energy)[0]
      if(after>=before)return
      const b=old??{a:i+1,b:j+1,formedAt:this.tick}
      b.order=ord;b.energyEv=energy;b.rest=this.bondRest(b)
      used[i]++;used[j]++;heat+=before-after
      if(!old){active.set(k,b);survivors.push(b);this.flux.formed.push({...b})}
      else this.flux.upgraded.push({...b})
    })
    this.bonds=survivors;this.reactionHeatEv+=heat;this.flux.reactionHeatEv=heat
    this.cumulativeFormed+=this.flux.formed.length
    this.cumulativeBroken+=this.flux.broken.length;this.cumulativeUpgraded+=this.flux.upgraded.length
    if(this.flux.formed.length||this.flux.broken.length||this.flux.upgraded.length)this.field=forces(this)
  }
  changeBondsV3(){
    const ps=this.particles,side=this.sideNm,startPotential=this.field.potential
    const occupied=new Uint8Array(ps.length),active=new Map(),broken=new Set()
    for(const b of this.bonds){
      occupied[b.a-1]+=b.order;occupied[b.b-1]+=b.order
      active.set(pairKey(b.a-1,b.b-1),b)
    }
    // Switching topology may activate the water angle, both stretch terms and
    // the 1–3 exclusion. Evaluate the entire potential at identical positions.
    const tryGraph=(candidate,association)=>{
      const old=this.bonds
      this.bonds=candidate
      const field=forces(this),release=this.field.potential-field.potential
      const available=this.reactionHeatEv+startPotential-this.field.potential
      if(association?release<=0:available+release<0){
        this.bonds=old
        return false
      }
      this.field=field
      for(const b of this.bonds)b.rest=this.bondRest(b)
      return true
    }
    for(const b of this.bonds){
      const i=b.a-1,j=b.b-1,p=ps[i],q=ps[j],r=Math.hypot(q.x-p.x,q.y-p.y,q.z-p.z)*side
      if(!active.has(pairKey(i,j)))continue
      const formula=moleculeTerms(this).bonds.get(pairKey(i,j))
      const r0=b.rest*side,stretch=Math.max(0,r-r0)
      // The Morse well tends continuously to zero. At three equilibrium
      // lengths its remaining attraction can be paid by the reaction reservoir.
      const radialU=formula?calibratedBondLaw(formula,r,b.energyEv)[0]:0
      const strain=.5*SPRING*b.order*stretch**2
      const separation=formula?r>3*r0:strain>b.energyEv
      const barrier=formula?(r>r0?Math.max(0,-radialU):b.energyEv):Math.max(0,b.energyEv-strain)
      const thermal=this.controls.thermostatEnabled ? .004*Math.exp(-barrier/(KB*this.targetTemperatureK)) : 0
      if(!separation&&random(this.seed,this.tick,b.a,b.b,33)>=thermal)continue
      let removed=[b]
      // When both O–H bonds are pulled apart, a direct three-fragment
      // channel avoids evaluating a highly stretched generic OH intermediate.
      if(formula==='H2O'&&separation){
        const oxygen=p.element==='O'?b.a:b.b
        const other=this.bonds.find(edge=>edge!==b&&(edge.a===oxygen||edge.b===oxygen))
        if(other){
          const a=ps[other.a-1],c=ps[other.b-1]
          if(Math.hypot(c.x-a.x,c.y-a.y,c.z-a.z)>3*other.rest)removed.push(other)
        }
      }
      if(!tryGraph(this.bonds.filter(edge=>!removed.includes(edge)),false)){
        if(removed.length===1||!tryGraph(this.bonds.filter(edge=>edge!==b),false))continue
        removed=[b]
      }
      for(const edge of removed){
        const k=pairKey(edge.a-1,edge.b-1)
        this.flux.broken.push({...edge});broken.add(k);active.delete(k)
        occupied[edge.a-1]-=edge.order;occupied[edge.b-1]-=edge.order
      }
    }
    if(this.controls.bindingEnabled)nearby(ps,side,(i,j,dx,dy,dz,d)=>{
      const p=ps[i],q=ps[j],key=pairKey(i,j),old=active.get(key),order=(old?.order??0)+1
      if(broken.has(key)||occupied[i]>=ATOMIC_ELEMENTS[p.element].maxValence||
        occupied[j]>=ATOMIC_ELEMENTS[q.element].maxValence||order>maxBondOrder(p.element,q.element))return
      const contact=pairParameters(p,q).nominal
      if(d>contact*(old?1.07:1.34)||d<.50*contact||
        random(this.seed,this.tick,p.id,q.id,47)>(old ? .045 : .48))return
      const b={a:i+1,b:j+1,order,formedAt:old?.formedAt??this.tick,energyEv:bondEnergyEv(p.element,q.element,order)}
      const candidate=old?this.bonds.map(edge=>edge===old?b:edge):[...this.bonds,b]
      if(!tryGraph(candidate,true))return
      active.set(key,b);occupied[i]++;occupied[j]++
      this.flux[old?'upgraded':'formed'].push({...b})
    })
    // A second edit in the same tick may have completed the molecule and
    // changed the equilibrium length of an earlier surviving bond.
    for(const b of [...this.flux.formed,...this.flux.upgraded])b.rest=this.bondRest(b)
    this.flux.reactionHeatEv=startPotential-this.field.potential
    this.reactionHeatEv+=this.flux.reactionHeatEv
    this.cumulativeFormed+=this.flux.formed.length;this.cumulativeBroken+=this.flux.broken.length
    this.cumulativeUpgraded+=this.flux.upgraded.length
  }
  integrate(){
    const dt=this.integrationDtFs
    const ps=this.particles,project=this.version===2,k0=project?energyK(ps):0,u0=this.field.potential
    const before=project?new Float64Array(ps.length*6):null
    for(let i=0;i<ps.length;i++){
      const p=ps[i],factor=.5*dt/(UVEL*p.massU)
      for(let k=0;k<3;k++){
        if(before){before[6*i+k]=p[keys[k]];before[6*i+3+k]=p[vk[k]]}
        p[vk[k]]+=factor*this.field.f[3*i+k]
        let pos=p[keys[k]]+dt*p[vk[k]]/this.sideNm
        if(pos<0||pos>1){const folded=((pos%2)+2)%2;pos=folded>1?2-folded:folded;if(folded>1)p[vk[k]]*=-1}
        p[keys[k]]=pos
      }
    }
    const f=forces(this)
    for(let i=0;i<ps.length;i++)for(let k=0;k<3;k++)ps[i][vk[k]]+=.5*dt*f.f[i*3+k]/(UVEL*ps[i].massU)
    if(!project){this.field=f;return}
    const target=k0+u0-f.potential, k1=energyK(ps)
    // Velocity-Verlet with a microcanonical energy projection: correct its
    // small truncation error and report the cumulative absolute correction.
    if(target>=0&&k1>0){
      this.integrationCorrectionEv+=Math.abs(k1-target)
      scaleVelocity(ps,Math.sqrt(target/k1));this.field=f
    }else{
      for(let i=0;i<ps.length;i++)for(let k=0;k<3;k++){
        ps[i][keys[k]]=before[i*6+k];ps[i][vk[k]]=before[i*6+3+k]
      }
    }
  }
  step(){
    this.tick++;this.flux={formed:[],broken:[],upgraded:[],reactionHeatEv:0,bathWorkEv:0}
    this.changeBonds()
    const before=this.version===3?energyK(this.particles)+this.field.potential:0
    for(let sub=0;sub<this.integrationSubsteps;sub++)this.integrate()
    if(this.version===3){
      const drift=energyK(this.particles)+this.field.potential-before
      this.integrationDriftEv+=drift;this.integrationAbsDriftEv+=Math.abs(drift)
    }
    if(this.controls.thermostatEnabled&&this.particles.length){
      const k=energyK(this.particles),want=1.5*this.particles.length*KB*this.targetTemperatureK
      const next=k+(want-k)*(-Math.expm1(-SUBS*DT/85))
      if(k>0){scaleVelocity(this.particles,Math.sqrt(next/k));this.flux.bathWorkEv=next-k;this.bathWorkEv+=next-k}
    }
    this.observer=observeAtomicWorld(this,this.observer)
    this.reactionBench=updateReactionBench(this,this.reactionBench)
    this.benchLegacyOmitted=false
    if(this.tick%10===0)this.record()
    return this.tick
  }
  molecules(){return this.observer.molecules}
  getMetrics(){
    const ps=this.particles,kinetic=energyK(ps),energy=kinetic+this.field.potential
    const energyError=energy+this.reactionHeatEv-this.initialEnergyEv-this.bathWorkEv-this.volumeWorkEv
    const elementCounts=Object.fromEntries(ATOMIC_SYMBOLS.map(s=>[s,0]))
    let totalMassU=0,totalProtons=0,totalNeutrons=0,totalElectrons=0
    for(const p of ps){elementCounts[p.element]++;totalMassU+=p.massU;totalProtons+=p.protons;totalNeutrons+=p.neutrons;totalElectrons+=p.electrons}
    const temperatureK=ps.length?2*kinetic/(3*ps.length*KB):0
    return {...this.observer?.metrics,tick:this.tick,timeFs:this.tick*DT*SUBS,atomCount:ps.length,particleCount:ps.length,
      bondCount:this.bonds.length,moleculeCount:this.observer?.molecules?.length??0,elementCounts,totalMassU,totalMass:totalMassU,
      initialMassU:this.initialMassU,massError:totalMassU-this.initialMassU,totalProtons,totalNeutrons,totalElectrons,netCharge:totalProtons-totalElectrons,
      volumeNm3:this.volumeNm3,sideNm:this.sideNm,densityKgM3:totalMassU*U_KG/(this.volumeNm3*1e-27),temperatureK,
      integrationSubsteps:this.integrationSubsteps,integrationDtFs:this.integrationDtFs,targetTemperatureK:this.targetTemperatureK,idealPressurePa:2*kinetic*EV_J/(3*this.volumeNm3*1e-27),
      pressurePa:(2*kinetic+this.field.virial)*EV_J/(3*this.volumeNm3*1e-27),
      kineticEnergyEv:kinetic,potentialEnergyEv:this.field.potential,weakPotentialEv:this.field.weak,covalentPotentialEv:this.field.covalent,
      totalEnergyEv:energy,initialEnergyEv:this.initialEnergyEv,bathWorkEv:this.bathWorkEv,volumeWorkEv:this.volumeWorkEv,
      reactionHeatEv:this.reactionHeatEv,integrationCorrectionEv:this.integrationCorrectionEv,
      energyError,physicsVersion:this.version,physicsProfile:this.physicsProfile,anglePotentialEv:this.field.angle,
      integrationDriftEv:this.integrationDriftEv,integrationAbsDriftEv:this.integrationAbsDriftEv,
      ledgerResidualEv:energyError-this.integrationDriftEv,
      cumulativeFormed:this.cumulativeFormed,cumulativeBroken:this.cumulativeBroken,cumulativeUpgraded:this.cumulativeUpgraded,
      phase:'indeterminada'}
  }
  record(){
    const m=this.getMetrics(),row=Object.fromEntries(['tick','atomCount','bondCount','moleculeCount','temperatureK','targetTemperatureK',
      'volumeNm3','densityKgM3','totalMassU','netCharge','kineticEnergyEv','totalEnergyEv','energyError'].map(k=>[k,m[k]]))
    if(this.history.at(-1)?.tick===this.tick)this.history[this.history.length-1]=row
    else this.history.push(row)
    if(this.history.length>256)this.history.shift()
  }
  serialize(){
    return clone({kind:'particle-world',mode:'particle-world',version:this.version,seed:this.seed,tick:this.tick,
      ...(this.version===2&&this.integrationSubsteps===SUBS?{}:{integrationSubsteps:this.integrationSubsteps}),
      ...(this.version===3?{physicsProfile:this.physicsProfile,integrationDriftEv:this.integrationDriftEv,
        integrationAbsDriftEv:this.integrationAbsDriftEv}:{}),
      ...(this.benchLegacyOmitted?{}:{reactionBench:this.reactionBench}),
      targetTemperatureK:this.targetTemperatureK,volumeNm3:this.volumeNm3,controls:this.controls,particles:this.particles,
      bonds:this.bonds,observer:this.observer,initialMassU:this.initialMassU,initialEnergyEv:this.initialEnergyEv,
      initialTemperatureK:this.initialTemperatureK,initialVolumeNm3:this.initialVolumeNm3,
      bathWorkEv:this.bathWorkEv,volumeWorkEv:this.volumeWorkEv,reactionHeatEv:this.reactionHeatEv,
      integrationCorrectionEv:this.integrationCorrectionEv,cumulativeFormed:this.cumulativeFormed,
      cumulativeBroken:this.cumulativeBroken,cumulativeUpgraded:this.cumulativeUpgraded,events:this.events,history:this.history,flux:this.flux})
  }
  static restore(d){
    check(d?.mode==='particle-world'&&d.kind===d.mode&&(d.version===2||d.version===3)&&integer(d.seed,0,0xffffffff)&&integer(d.tick)&&
      Array.isArray(d.particles)&&d.particles.length<=MAX&&Array.isArray(d.bonds)&&d.controls&&controls.every(k=>typeof d.controls[k]==='boolean')&&
      finite(d.targetTemperatureK,1,3000)&&finite(d.volumeNm3,1,512)&&finite(d.initialTemperatureK,1,3000)&&finite(d.initialVolumeNm3,1,512))
    if(d.version===3)check(d.physicsProfile===PROFILES[3]&&[V3_SUBSTEPS,V3_SUBSTEPS*2].includes(d.integrationSubsteps)&&
      finite(d.integrationDriftEv)&&finite(d.integrationAbsDriftEv,Math.abs(d.integrationDriftEv)-1e-12)&&
      d.integrationAbsDriftEv>=0&&d.integrationCorrectionEv===0&&d.reactionHeatEv>=-1e-10&&Object.hasOwn(d,'reactionBench'))
    else check(!Object.hasOwn(d,'physicsProfile')&&!Object.hasOwn(d,'integrationDriftEv')&&!Object.hasOwn(d,'integrationAbsDriftEv'))
    const w=new AtomicWorld(d.seed,{count:d.particles.length,physicsVersion:d.version,integrationSubsteps:d.integrationSubsteps,
      temperatureK:d.initialTemperatureK,volumeNm3:d.initialVolumeNm3,bindingEnabled:d.controls.bindingEnabled,
      thermostatEnabled:d.controls.thermostatEnabled})
    check(d.initialMassU===w.initialMassU&&finite(d.initialEnergyEv)&&
      Math.abs(d.initialEnergyEv-w.initialEnergyEv)<1e-11*Math.max(1,Math.abs(w.initialEnergyEv)))
    w.initialEnergyEv=d.initialEnergyEv
    d.particles.forEach((p,i)=>{
      const init=w.particles[i]
      check(p&&['id','element','mass','massU','protons','neutrons','electrons','charge','radiusPm'].every(k=>p[k]===init[k])&&
        keys.every(k=>finite(p[k],0,1))&&vk.every(k=>finite(p[k],-2,2)))
    })
    w.tick=d.tick;w.volumeNm3=d.volumeNm3;w.sideNm=Math.cbrt(d.volumeNm3);w.targetTemperatureK=d.targetTemperatureK
    w.particles=clone(d.particles)
    const degree=new Uint8Array(w.particles.length),seen=new Set()
    check(d.bonds.length<=2*w.particles.length)
    for(const b of d.bonds){
      check(integer(b?.a,1,w.particles.length)&&integer(b.b,b.a+1,w.particles.length)&&integer(b.formedAt,1,d.tick))
      const p=w.particles[b.a-1],q=w.particles[b.b-1],key=pairKey(b.a-1,b.b-1)
      check(!seen.has(key)&&integer(b.order,1,maxBondOrder(p.element,q.element))&&b.energyEv===bondEnergyEv(p.element,q.element,b.order))
      seen.add(key);degree[b.a-1]+=b.order;degree[b.b-1]+=b.order
    }
    check(w.particles.every((p,i)=>degree[i]<=ATOMIC_ELEMENTS[p.element].maxValence))
    w.bonds=clone(d.bonds)
    check(w.bonds.every(b=>finite(b.rest)&&Math.abs(b.rest-w.bondRest(b))<1e-12))
    if(w.version===3){w.integrationDriftEv=d.integrationDriftEv;w.integrationAbsDriftEv=d.integrationAbsDriftEv}
    for(const k of ['bathWorkEv','volumeWorkEv','reactionHeatEv','integrationCorrectionEv']){check(finite(d[k]));w[k]=d[k]}
    for(const k of ['cumulativeFormed','cumulativeBroken','cumulativeUpgraded']){check(integer(d[k]));w[k]=d[k]}
    check(d.integrationCorrectionEv>=0&&w.cumulativeFormed-w.cumulativeBroken===d.bonds.length)
    check(Array.isArray(d.events)&&d.events.length>0&&d.events.length<=128&&Array.isArray(d.history)&&d.history.length>0&&d.history.length<=256&&
      d.flux&&['formed','broken','upgraded'].every(k=>Array.isArray(d.flux[k])&&d.flux[k].length<=2*w.particles.length))
    let prev=-1
    for(const e of d.events){
      check(e&&integer(e.tick,Math.max(0,prev),d.tick)&&['start','temperature','volume','control'].includes(e.type)&&
        typeof e.text==='string'&&e.text.length>0&&e.text.length<=240)
      if(e.type==='start')check(e.tick===0)
      if(e.type==='temperature')check(finite(e.temperatureK,1,3000))
      if(e.type==='volume')check(finite(e.volumeNm3,1,512))
      if(e.type==='control')check(controls.includes(e.control)&&typeof e.enabled==='boolean')
      prev=e.tick
    }
    prev=-1
    for(const h of d.history){check(h&&integer(h.tick,prev+1,d.tick)&&h.atomCount===w.particles.length&&h.totalMassU===w.initialMassU&&
      integer(h.bondCount,0,2*w.particles.length)&&integer(h.moleculeCount,0,Math.floor(w.particles.length/2))&&h.netCharge===0&&
      finite(h.temperatureK,0)&&finite(h.targetTemperatureK,1,3000)&&finite(h.volumeNm3,1,512)&&finite(h.kineticEnergyEv,0)&&
      finite(h.densityKgM3,0)&&Math.abs(h.densityKgM3*h.volumeNm3-w.initialMassU*U_KG/1e-27)<=1e-9*Math.max(1,w.initialMassU)&&
      Math.abs(1.5*h.atomCount*KB*h.temperatureK-h.kineticEnergyEv)<=1e-9*Math.max(1,h.kineticEnergyEv)&&
      finite(h.totalEnergyEv)&&finite(h.energyError));prev=h.tick}
    const byPair=new Map(d.bonds.map(b=>[pairKey(b.a-1,b.b-1),b]))
    const altered=new Set()
    for(const type of ['formed','broken','upgraded'])for(const b of d.flux[type]){
      check(b&&integer(b.a,1,w.particles.length)&&integer(b.b,b.a+1,w.particles.length)&&integer(b.formedAt,1,d.tick))
      const p=w.particles[b.a-1],q=w.particles[b.b-1],key=pairKey(b.a-1,b.b-1)
      check(!altered.has(key)&&integer(b.order,1,maxBondOrder(p.element,q.element))&&
        b.energyEv===bondEnergyEv(p.element,q.element,b.order)&&finite(b.rest,0,1))
      if(type==='broken')check(!byPair.has(key))
      else check(byPair.get(key)?.order===b.order)
      altered.add(key)
    }
    if(d.tick>0)check(finite(d.flux.bathWorkEv)&&finite(d.flux.reactionHeatEv))
    w.field=forces(w);w.flux=clone(d.flux);w.events=clone(d.events);w.history=clone(d.history)
    w.observer=clone(d.observer);check(validateAtomicObservation(w,w.observer)!==false)
    if(Object.hasOwn(d,'reactionBench')){
      check(validateReactionBench(w,d.reactionBench))
      w.reactionBench=clone(d.reactionBench)
    }else{
      w.reactionBench=updateReactionBench(w)
      w.benchLegacyOmitted=true
    }
    const m=w.getMetrics();check(Math.abs(m.ledgerResidualEv)<1e-7*Math.max(1,Math.abs(w.initialEnergyEv),Math.abs(w.volumeWorkEv),Math.abs(w.reactionHeatEv)))
    const last=w.history.at(-1)
    if(last.tick===w.tick)for(const key of Object.keys(last)){
      check(finite(last[key])&&finite(m[key])&&Math.abs(last[key]-m[key])<1e-8*Math.max(1,Math.abs(m[key])))
    }
    return w
  }
}

// Isolated diagnostic fixture. Both the potential and the integrator below
// are the production implementations. No free-atom trajectory is overwritten
// and this prepared topology never enters the checkpoint/archive protocol.
export function createMolecularReferenceFixture(formula,integrationSubsteps,physicsVersion=3) {
  check(['H2','H2O'].includes(formula))
  const world=new AtomicWorld(0,{count:0,volumeNm3:8,integrationSubsteps,physicsVersion,
    temperatureK:1,bindingEnabled:false,thermostatEnabled:false})
  const symbols=formula==='H2'?['H','H']:['O','H','H']
  world.particles=symbols.map((symbol,i)=>{
    const e=ATOMIC_ELEMENTS[symbol]
    return {id:i+1,element:symbol,mass:e.massU,massU:e.massU,radiusPm:e.covalentRadiusPm,protons:e.protons,
      neutrons:e.neutrons,electrons:e.electrons,charge:0,x:0.5,y:0.5,z:0.5,vx:0,vy:0,vz:0}
  })
  world.bonds=symbols.slice(1).map((symbol,i)=>({a:1,b:i+2,order:1,formedAt:0,energyEv:bondEnergyEv(symbols[0],symbol,1)}))
  for(const bond of world.bonds)bond.rest=world.bondRest(bond)
  function reset(coordinatesNm,velocitiesNmFs) {
    check(coordinatesNm.length===symbols.length)
    if(velocitiesNmFs)check(velocitiesNmFs.length===symbols.length)
    for(let i=0;i<symbols.length;i++){
      const p=world.particles[i]
      check(coordinatesNm[i].length===3)
      for(let k=0;k<3;k++){
        check(finite(coordinatesNm[i][k],-0.8,0.8))
        p[keys[k]]=0.5+coordinatesNm[i][k]/world.sideNm
        const speed=velocitiesNmFs?velocitiesNmFs[i]?.[k]:0
        check(finite(speed,-1,1))
        p[vk[k]]=speed
      }
    }
    world.field=forces(world)
    world.integrationCorrectionEv=0
    world.initialEnergyEv=world.field.potential+energyK(world.particles)
    return world.initialEnergyEv
  }
  function sample() {
    return {coordinatesNm:world.particles.map(p=>keys.map(k=>(p[k]-0.5)*world.sideNm)),
      forcesEvPerNm:world.particles.map((p,i)=>Array.from(world.field.f.subarray(3*i,3*i+3))),
      velocitiesNmFs:world.particles.map(p=>vk.map(k=>p[k])),kineticEnergyEv:energyK(world.particles),
      potentialEnergyEv:world.field.potential,
      energyEv:world.field.potential+energyK(world.particles),correctionEv:world.integrationCorrectionEv}
  }
  return Object.freeze({formula,physicsProfile:world.physicsProfile,version:world.version,
    integrationSubsteps:world.integrationSubsteps,dtFs:world.integrationDtFs,reset,sample,
    advance(){world.integrate(); return sample()}})
}

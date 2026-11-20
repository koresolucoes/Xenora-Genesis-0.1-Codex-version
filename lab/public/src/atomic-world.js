// 3D classical, reactive teaching model for neutral atomic parcels. Positions
// are fractions of a cubic vessel. Velocities are nm/fs, mass u, energies eV.
// Coordinates, interactions and topology are resolved; orbitals are not.
import {ATOMIC_ELEMENTS,ATOMIC_SYMBOLS,maxBondOrder,bondEnergyEv} from './atomic-elements.js'
import {observeAtomicWorld,validateAtomicObservation} from './atomic-observer.js'

const KB=8.617333262e-5, UVEL=10364.2696563, U_KG=1.66053906660e-27, EV_J=1.602176634e-19
const DT=1.2, SUBS=4, RC=.40, DEPTH=.013, STEEP=13, SPRING=165, MAX=384
const integer=(x,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(x)&&x>=min&&x<=max
const finite=(x,min=-Infinity,max=Infinity)=>Number.isFinite(x)&&x>=min&&x<=max
const check=v=>{if(!v)throw new Error('Estado da simulação atômica inválido.')}
const clone=o=>JSON.parse(JSON.stringify(o))
const keys=['x','y','z'],vk=['vx','vy','vz']
const controls=['bindingEnabled','thermostatEnabled']
const energyK=(ps)=>ps.reduce((s,p)=>s+0.5*UVEL*p.massU*(p.vx*p.vx+p.vy*p.vy+p.vz*p.vz),0)
const pairKey=(i,j)=>i*MAX+j
export const ATOMIC_PHYSICS=Object.freeze({tickFs:DT*SUBS,dtFs:DT,maxCount:MAX,minTemperatureK:1,
  maxTemperatureK:3000,minVolumeNm3:1,maxVolumeNm3:512,boltzmannEvK:KB,atomicMassKg:U_KG,
  weakAttractionEv:DEPTH,phase:'indeterminada',model:'3D neutral atoms, effective Morse pair potential, harmonic covalent bonds, explicit reaction reservoir and optional thermal bath'})

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

function forces(world){
  const ps=world.particles,side=world.sideNm,f=new Float64Array(ps.length*3)
  let potential=0,virial=0,weak=0,covalent=0
  const bonded=new Set()
  function add(i,j,dx,dy,dz,d,order,energy){
    const [u,g]=pairLaw(d,pairParameters(ps[i],ps[j]),order,energy)
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
  nearby(ps,side,(i,j,dx,dy,dz,d)=>{if(!bonded.has(pairKey(i,j)))add(i,j,dx,dy,dz,d,0,0)})
  return {f,potential,virial,weak,covalent}
}

function scaleVelocity(ps,factor){
  for(const p of ps){p.vx*=factor;p.vy*=factor;p.vz*=factor}
}

export class AtomicWorld {
  get kind(){return 'particle-world'}
  get mode(){return 'particle-world'}
  get version(){return 2}
  constructor(seed=42,options={}){
    const count=options.count??144
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
    this.cumulativeFormed=0;this.cumulativeBroken=0;this.cumulativeUpgraded=0
    this.field=forces(this)
    this.initialEnergyEv=energyK(this.particles)+this.field.potential
    this.initialMassU=this.particles.reduce((s,p)=>s+p.massU,0)
    this.observer=observeAtomicWorld(this,null)
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
    return pairParameters(this.particles[b.a-1],this.particles[b.b-1]).nominal*(1-.064*(b.order-1))/this.sideNm
  }
  changeBonds(){
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
  integrate(){
    const ps=this.particles,k0=energyK(ps),u0=this.field.potential
    const before=new Float64Array(ps.length*6)
    for(let i=0;i<ps.length;i++){
      const p=ps[i],factor=.5*DT/(UVEL*p.massU)
      for(let k=0;k<3;k++){
        before[6*i+k]=p[keys[k]];before[6*i+3+k]=p[vk[k]]
        p[vk[k]]+=factor*this.field.f[3*i+k]
        let pos=p[keys[k]]+DT*p[vk[k]]/this.sideNm
        if(pos<0||pos>1){const folded=((pos%2)+2)%2;pos=folded>1?2-folded:folded;if(folded>1)p[vk[k]]*=-1}
        p[keys[k]]=pos
      }
    }
    const f=forces(this)
    for(let i=0;i<ps.length;i++)for(let k=0;k<3;k++)ps[i][vk[k]]+=.5*DT*f.f[i*3+k]/(UVEL*ps[i].massU)
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
    for(let sub=0;sub<SUBS;sub++)this.integrate()
    if(this.controls.thermostatEnabled&&this.particles.length){
      const k=energyK(this.particles),want=1.5*this.particles.length*KB*this.targetTemperatureK
      const next=k+(want-k)*(-Math.expm1(-SUBS*DT/85))
      if(k>0){scaleVelocity(this.particles,Math.sqrt(next/k));this.flux.bathWorkEv=next-k;this.bathWorkEv+=next-k}
    }
    this.observer=observeAtomicWorld(this,this.observer)
    if(this.tick%10===0)this.record()
    return this.tick
  }
  molecules(){return this.observer.molecules}
  getMetrics(){
    const ps=this.particles,kinetic=energyK(ps),energy=kinetic+this.field.potential
    const elementCounts=Object.fromEntries(ATOMIC_SYMBOLS.map(s=>[s,0]))
    let totalMassU=0,totalProtons=0,totalNeutrons=0,totalElectrons=0
    for(const p of ps){elementCounts[p.element]++;totalMassU+=p.massU;totalProtons+=p.protons;totalNeutrons+=p.neutrons;totalElectrons+=p.electrons}
    const temperatureK=ps.length?2*kinetic/(3*ps.length*KB):0
    return {...this.observer?.metrics,tick:this.tick,timeFs:this.tick*DT*SUBS,atomCount:ps.length,particleCount:ps.length,
      bondCount:this.bonds.length,moleculeCount:this.observer?.molecules?.length??0,elementCounts,totalMassU,totalMass:totalMassU,
      initialMassU:this.initialMassU,massError:totalMassU-this.initialMassU,totalProtons,totalNeutrons,totalElectrons,netCharge:totalProtons-totalElectrons,
      volumeNm3:this.volumeNm3,sideNm:this.sideNm,densityKgM3:totalMassU*U_KG/(this.volumeNm3*1e-27),temperatureK,
      targetTemperatureK:this.targetTemperatureK,idealPressurePa:2*kinetic*EV_J/(3*this.volumeNm3*1e-27),
      pressurePa:(2*kinetic+this.field.virial)*EV_J/(3*this.volumeNm3*1e-27),
      kineticEnergyEv:kinetic,potentialEnergyEv:this.field.potential,weakPotentialEv:this.field.weak,covalentPotentialEv:this.field.covalent,
      totalEnergyEv:energy,initialEnergyEv:this.initialEnergyEv,bathWorkEv:this.bathWorkEv,volumeWorkEv:this.volumeWorkEv,
      reactionHeatEv:this.reactionHeatEv,integrationCorrectionEv:this.integrationCorrectionEv,
      energyError:energy+this.reactionHeatEv-this.initialEnergyEv-this.bathWorkEv-this.volumeWorkEv,
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
    return clone({kind:'particle-world',mode:'particle-world',version:2,seed:this.seed,tick:this.tick,
      targetTemperatureK:this.targetTemperatureK,volumeNm3:this.volumeNm3,controls:this.controls,particles:this.particles,
      bonds:this.bonds,observer:this.observer,initialMassU:this.initialMassU,initialEnergyEv:this.initialEnergyEv,
      initialTemperatureK:this.initialTemperatureK,initialVolumeNm3:this.initialVolumeNm3,
      bathWorkEv:this.bathWorkEv,volumeWorkEv:this.volumeWorkEv,reactionHeatEv:this.reactionHeatEv,
      integrationCorrectionEv:this.integrationCorrectionEv,cumulativeFormed:this.cumulativeFormed,
      cumulativeBroken:this.cumulativeBroken,cumulativeUpgraded:this.cumulativeUpgraded,events:this.events,history:this.history,flux:this.flux})
  }
  static restore(d){
    check(d?.mode==='particle-world'&&d.kind===d.mode&&d.version===2&&integer(d.seed,0,0xffffffff)&&integer(d.tick)&&
      Array.isArray(d.particles)&&d.particles.length<=MAX&&Array.isArray(d.bonds)&&d.controls&&controls.every(k=>typeof d.controls[k]==='boolean')&&
      finite(d.targetTemperatureK,1,3000)&&finite(d.volumeNm3,1,512)&&finite(d.initialTemperatureK,1,3000)&&finite(d.initialVolumeNm3,1,512))
    const w=new AtomicWorld(d.seed,{count:d.particles.length,temperatureK:d.initialTemperatureK,volumeNm3:d.initialVolumeNm3,...d.controls})
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
      check(!seen.has(key)&&integer(b.order,1,maxBondOrder(p.element,q.element))&&b.energyEv===bondEnergyEv(p.element,q.element,b.order)&&
        Math.abs(b.rest-w.bondRest(b))<1e-12)
      seen.add(key);degree[b.a-1]+=b.order;degree[b.b-1]+=b.order
    }
    check(w.particles.every((p,i)=>degree[i]<=ATOMIC_ELEMENTS[p.element].maxValence))
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
    w.bonds=clone(d.bonds);w.field=forces(w);w.flux=clone(d.flux);w.events=clone(d.events);w.history=clone(d.history)
    w.observer=clone(d.observer);check(validateAtomicObservation(w,w.observer)!==false)
    const m=w.getMetrics();check(Math.abs(m.energyError)<1e-7*Math.max(1,Math.abs(w.initialEnergyEv),Math.abs(w.volumeWorkEv),Math.abs(w.reactionHeatEv)))
    const last=w.history.at(-1)
    if(last.tick===w.tick)for(const key of Object.keys(last)){
      check(finite(last[key])&&finite(m[key])&&Math.abs(last[key]-m[key])<1e-8*Math.max(1,Math.abs(m[key])))
    }
    return w
  }
}

// Read-only gas-phase benchmark of the production potential and integrator.
import {createMolecularReferenceFixture,ATOMIC_PHYSICS} from './atomic-world.js'
import {ATOMIC_ELEMENTS} from './atomic-elements.js'

const LIGHT_CM_PER_FS=2.99792458e-5
const DEG=180/Math.PI
const steps=100
const timeFs=steps*ATOMIC_PHYSICS.tickFs
const sampleEveryFs=1.2
const sources=[
  {id:'H2-NIST',label:'NIST Chemistry WebBook · Huber e Herzberg, H₂ no estado eletrônico fundamental',
    url:'https://webbook.nist.gov/cgi/cbook.cgi?ID=C1333740&Mask=1000'},
  {id:'H2O-JCP',label:'Császár et al. (2005), JCP 122, 214305 · geometria espectroscópica de H₂¹⁶O',
    url:'https://doi.org/10.1063/1.1924506'},
  {id:'H2O-NIST',label:'NIST CCCBDB · geometria experimental da água',
    url:'https://cccbdb.nist.gov/expgeom2x.asp?casno=7732185'},
  {id:'water-spectrum',label:'NIST CCCBDB · H₂¹⁶O, números de onda experimentais harmônicos e fundamentais',
    url:'https://cccbdb.nist.gov/exp2x.asp?casno=7732185'}
]
const geometry=(formula,r,angleDeg,asymmetricNm=0)=>{
  if(formula==='H2')return [[-r/2,0,0],[r/2,0,0]]
  const a=angleDeg/(2*DEG),c=Math.cos(a),s=Math.sin(a)
  return [[0,0,0],[(r+asymmetricNm)*c,-(r+asymmetricNm)*s,0],[(r-asymmetricNm)*c,(r-asymmetricNm)*s,0]]
}
function readGeometry(formula,positions){
  const vector=(p,q)=>q.map((v,i)=>v-p[i])
  const u=vector(positions[0],positions[1]),r=Math.hypot(...u)
  if(formula==='H2')return {r,angle:null}
  const v=vector(positions[0],positions[2]),s=Math.hypot(...v)
  const dot=u.reduce((sum,val,i)=>sum+val*v[i],0)
  return {r:(r+s)/2,asymmetricNm:(r-s)/2,angle:DEG*Math.acos(Math.min(1,Math.max(-1,dot/(r*s))))}
}

// Pattern search over bond length and, for water, symmetric H–O–H angle.
// Compare two starts independently; target values are never read by the solver.
function minimum(formula,fixture,r,angle){
  const start={r,angle}
  const evaluate=(d,a)=>fixture.reset(geometry(formula,d,a))
  let e=evaluate(r,angle),dr=.008,da=10, iterations=0
  for(;iterations<800 && (dr>2e-8 || (formula==='H2O' && da>2e-5));iterations++){
    let best=e, nr=r, na=angle
    for(const dir of [-1,0,1]){
      for(const turn of formula==='H2'?[0]:[-1,0,1]){
        if(!dir&&!turn)continue
        const x=r+dir*dr,a=angle+turn*da
        if(x<.032||x>.16||a<35||a>172)continue
        const candidate=evaluate(x,a)
        if(candidate<best){best=candidate;nr=x;na=a}
      }
    }
    if(nr===r&&na===angle){dr/=2;da/=2}
    else{r=nr;angle=na;e=best}
  }
  return {start,r,angle:formula==='H2O'?angle:null,potentialEv:e,iterations,converged:iterations<800}
}

function harmonicWavenumber(samples,center,coordinate){
  const crossings=[]
  for(let i=1;i<samples.length;i++){
    const a=samples[i-1],b=samples[i]
    if(a[coordinate]<center&&b[coordinate]>=center){
      const f=(center-a[coordinate])/(b[coordinate]-a[coordinate])
      crossings.push(a.t+(b.t-a.t)*f)
    }
  }
  if(crossings.length<5) return {value:null,cycles:Math.max(0,crossings.length-1)}
  const meanPeriod=(crossings.at(-1)-crossings[0])/(crossings.length-1)
  return {value:1/(meanPeriod*LIGHT_CM_PER_FS),cycles:crossings.length-1}
}

// Local curvature of the production potential, independent of time integration.
// 1 nm/fs = 10^6 m/s, so one u (nm/fs)^2 is converted to eV below.
function curvatureOfHydrogen(fixture,r){
  const deltaNm=.0001
  const at=distance=>fixture.reset(geometry('H2',distance,90))
  const k=(at(r-deltaNm)-2*at(r)+at(r+deltaNm))/(deltaNm*deltaNm)
  const uNm2PerFs2InEv=ATOMIC_PHYSICS.atomicMassKg*1e12/1.602176634e-19
  const reducedMassU=ATOMIC_ELEMENTS.H.massU/2
  const wavenumberCm1=k>0?Math.sqrt(k/(uNm2PerFs2InEv*reducedMassU))/(2*Math.PI*LIGHT_CM_PER_FS):null
  return {curvatureEvPerNm2:k,deltaNm,reducedMassU,wavenumberCm1}
}

function trajectory(formula,minimum,substeps,physicsVersion,mode){
  const fixture=createMolecularReferenceFixture(formula,substeps,physicsVersion)
  const legacy=physicsVersion===2
  const stretchAmplitude=legacy ? .001 : .00010
  const stretch=mode==='stretch' ? stretchAmplitude : 0
  const bend=mode==='bend' ? .14 : Number(legacy&&formula==='H2O')
  const asymmetric=mode==='asymmetric' ? .00010 : 0
  const geometry0=geometry(formula,minimum.r+stretch,formula==='H2O'?minimum.angle+bend:90,asymmetric)
  const energy0=fixture.reset(geometry0)
  let previous=fixture.sample(),correctionEv=0,held=0,drift=0,maxAcceptedStepCorrectionEv=0
  const samples=[{t:0,...readGeometry(formula,previous.coordinatesNm)}]
  const stride=Math.round(sampleEveryFs/fixture.dtFs)
  for(let i=1;i<=steps*substeps;i++){
    const state=fixture.advance()
    drift=Math.max(drift,Math.abs(state.energyEv-energy0))
    maxAcceptedStepCorrectionEv=Math.max(maxAcceptedStepCorrectionEv,state.correctionEv-correctionEv)
    correctionEv=state.correctionEv
    if(state.coordinatesNm.every((p,j)=>p.every((v,k)=>v===previous.coordinatesNm[j][k])))held++
    previous=state
    if(i%stride===0)samples.push({t:i*fixture.dtFs,...readGeometry(formula,state.coordinatesNm)})
  }
  const coordinate=mode==='bend'?'angle':mode==='asymmetric'?'asymmetricNm':'r'
  const center=legacy ? minimum.r : samples.reduce((sum,s)=>sum+s[coordinate],0)/samples.length
  const vibration=legacy&&formula==='H2O'?{value:null,cycles:0}:harmonicWavenumber(samples,center,coordinate)
  return {samples,summary:{dtFs:fixture.dtFs,substepsPerTick:substeps,steps,elapsedFs:timeFs,
    integrationSteps:steps*substeps,sampleCount:samples.length,initialEnergyEv:energy0,
    maxEnergyErrorEv:drift,correctionEv,maxAcceptedStepCorrectionEv,heldSteps:held,
    wavenumberCm1:held<.05*steps*substeps?vibration.value:null,completedCycles:vibration.cycles}}
}

function compare(id,label,unit,value,reference,tolerance,source,role){
  const absoluteError=value===null?null:Math.abs(value-reference)
  return {id,label,unit,value,reference,tolerance,absoluteError,
    relativeError:value===null?null:absoluteError/Math.abs(reference),role,
    status:value===null?'sem medida':absoluteError<=tolerance?'aceito':'inadequado',source}
}

function compareSteps(modes,runs){
  const changes=modes.map(mode=>{
    const [a,b]=runs[mode].map(r=>r.summary.wavenumberCm1)
    return {mode,coarseCm1:a,fineCm1:b,relativeChange:a!==null&&b>0?Math.abs(a-b)/b:null}
  })
  const missing=changes.some(item=>item.relativeChange===null)
  const max=missing?null:Math.max(...changes.map(item=>item.relativeChange))
  return {status:missing?'sem medida':max<=.01?'aceito':'inadequado',limit:.01,maxRelativeFrequencyChange:max,
    criterion:'Variação relativa máxima de 1% entre os números de onda medidos com dt e dt/2.',
    modes:changes}
}

function assay(formula,physicsVersion,coarseSubsteps){
  const legacy=physicsVersion===2,water=formula==='H2O'
  const fixture=createMolecularReferenceFixture(formula,coarseSubsteps,physicsVersion)
  const starts=water?[[.087,80],[.115,135]]:[[.048,90],[.107,90]]
  const minima=starts.map(([r,a])=>minimum(formula,fixture,r,a))
  const best=minima.reduce((a,b)=>a.potentialEv<=b.potentialEv?a:b)
  const converged=minima.every(m=>m.converged && Math.abs(m.r-best.r)<1e-5 && (!water||Math.abs(m.angle-best.angle)<.02))
  const modes=water&&!legacy?['stretch','bend','asymmetric']:['stretch']
  const runs=Object.fromEntries(modes.map(mode=>[mode,[coarseSubsteps,2*coarseSubsteps].map(n=>
    trajectory(formula,best,n,physicsVersion,mode))]))
  const [coarse,fine]=runs.stretch
  const curvature=!water&&converged?curvatureOfHydrogen(fixture,best.r):null
  const role=name=>legacy?'diagnóstico legado':name
  const results=water?[
    compare('water-re','Comprimento de equilíbrio O–H','nm',converged?best.r:null,.095777,.02*.095777,'H2O-JCP',role('ajuste')),
    compare('water-angle','Ângulo de equilíbrio H–O–H','°',converged?best.angle:null,104.48,3,'H2O-JCP',role('ajuste'))
  ]:[
    compare('h2-re','Comprimento de equilíbrio H–H','nm',converged?best.r:null,.074144,.02*.074144,'H2-NIST',role('ajuste')),
    compare('h2-we','Estiramento medido na trajetória','cm⁻¹',fine.summary.wavenumberCm1,4401.213,.10*4401.213,'H2-NIST',role('verificação numérica')),
    compare('h2-we-curvature','Estiramento harmônico pela curvatura','cm⁻¹',curvature?.wavenumberCm1??null,4401.213,.10*4401.213,'H2-NIST',role('ajuste'))
  ]
  if(water&&!legacy){
    for(const [mode,id,name,reference,assignment] of [
      ['stretch','water-symmetric-trajectory','Estiramento simétrico ν₁',3832,'referência reservada'],
      ['bend','water-bend-trajectory','Flexão ν₂',1649,'ajuste'],
      ['asymmetric','water-asymmetric-trajectory','Estiramento antissimétrico ν₃',3943,'ajuste']
    ])results.push(compare(id,name+' pela trajetória','cm⁻¹',runs[mode][1].summary.wavenumberCm1,
      reference,.10*reference,'water-spectrum',assignment))
  }
  let radiusSquares=0,angleSquares=0
  for(let i=0;i<fine.samples.length;i++){
    radiusSquares+=(coarse.samples[i].r-fine.samples[i].r)**2
    if(water)angleSquares+=(coarse.samples[i].angle-fine.samples[i].angle)**2
  }
  const n=fine.samples.length
  const allSummaries=Object.values(runs).flat().map(r=>r.summary)
  const refinement=compareSteps(modes,runs)
  return {formula,status:results.some(r=>r.status==='inadequado')?'inadequado':
    results.every(r=>r.status==='aceito')?'aceito':'sem medida',measurements:results,minimizations:minima,curvature,
    integration:{coarseDtFs:coarse.summary.dtFs,fineDtFs:fine.summary.dtFs,durationFs:timeFs,
      maxEnergyErrorEv:Math.max(...allSummaries.map(r=>r.maxEnergyErrorEv)),
      maxCorrectionEv:Math.max(...allSummaries.map(r=>r.correctionEv)),
      radiusRmsDifferenceNm:Math.sqrt(radiusSquares/n),angleRmsDifferenceDeg:water?Math.sqrt(angleSquares/n):null,
      wavenumberDifferenceCm1:coarse.summary.wavenumberCm1===null||fine.summary.wavenumberCm1===null?null:
        Math.abs(coarse.summary.wavenumberCm1-fine.summary.wavenumberCm1),
      runs:[coarse.summary,fine.summary],refinement,
      runsByMode:Object.fromEntries(modes.map(mode=>[mode,runs[mode].map(r=>r.summary)]))},
    notes:water?(legacy?['O perfil v2 inclui a interação H–H e avalia apenas a geometria da água.']:
      ['Cada modo é excitado separadamente e medido na trajetória. A flexão e o estiramento antissimétrico calibram duas constantes do potencial.',
       'O estiramento simétrico ficou reservado para comparação independente. Os valores harmônicos são os alvos deste ensaio clássico.',
       'As bandas fundamentais experimentais da água são 3657, 1595 e 3756 cm⁻¹ para ν₁, ν₂ e ν₃.']):[
      'A frequência de H₂ é medida separadamente pela curvatura e pelos cruzamentos ascendentes na trajetória.',
      'Cada trajetória exige cinco cruzamentos ascendentes e menos de 5% de subpassos imóveis.']}
}

export function runMolecularReference({physicsVersion=3}={}){
  if(physicsVersion!==2&&physicsVersion!==3)throw new RangeError('Versão de física molecular inválida.')
  const legacy=physicsVersion===2
  const coarseSubsteps=legacy?4:ATOMIC_PHYSICS.integrationSubsteps
  const coarseDtFs=ATOMIC_PHYSICS.tickFs/coarseSubsteps
  return {version:2,physicsVersion,profile:legacy?'neutral-chonps-v2':'neutral-chonps-h2-h2o-v3',
    protocol:{physicsVersion,durationFs:timeFs,coarseDtFs,fineDtFs:coarseDtFs/2,sampleEveryFs,steps,
    scope:'Moléculas isoladas em fase gasosa, topologia fixa, banho desligado e velocidade inicial zero.',
    tolerances:'Limites de triagem: 2% para comprimento, 3° para ângulo e 10% para número de onda harmônico.',
    dynamics:legacy?'Excitação de +0,001 nm no comprimento e de +1° no ângulo da água.':
      'Comparamos 480 fs em duas resoluções. Cada ensaio parte de uma perturbação de 0,00010 nm ou 0,14° junto ao mínimo medido.',
    energy:legacy?'O resíduo e a correção cinética acumulada são medidos após a projeção de energia do v2.':
      'Monitoramos a deriva mecânica na trajetória livre sem projeção cinética, as correções e os subpassos imóveis.'},
    species:['H2','H2O'].map(formula=>assay(formula,physicsVersion,coarseSubsteps)),sources:sources.map(s=>({...s}))}
}

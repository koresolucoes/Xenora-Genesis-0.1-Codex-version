// Isolated gas-phase benchmark; no calibration or edits to production force constants.
import {createMolecularReferenceFixture,ATOMIC_PHYSICS} from './atomic-world.js'
import {ATOMIC_ELEMENTS} from './atomic-elements.js'

const LIGHT_CM_PER_FS=2.99792458e-5
const DEG=180/Math.PI
const steps=100
const timeFs=steps*ATOMIC_PHYSICS.tickFs
const sources=[
  {id:'H2-NIST',label:'NIST Chemistry WebBook · Huber e Herzberg, H₂ no estado eletrônico fundamental',
    url:'https://webbook.nist.gov/cgi/cbook.cgi?ID=C1333740&Mask=1000'},
  {id:'H2O-JCP',label:'Császár et al. (2005), JCP 122, 214305 · geometria espectroscópica de H₂¹⁶O',
    url:'https://doi.org/10.1063/1.1924506'},
  {id:'H2O-NIST',label:'NIST CCCBDB · geometria experimental da água',
    url:'https://cccbdb.nist.gov/expgeom2x.asp?casno=7732185'}
]
const geometry=(formula,r,angleDeg)=>{
  if(formula==='H2')return [[-r/2,0,0],[r/2,0,0]]
  const a=angleDeg/(2*DEG),x=r*Math.cos(a),y=r*Math.sin(a)
  return [[0,0,0],[x,-y,0],[x,y,0]]
}
function readGeometry(formula,positions){
  const vector=(p,q)=>q.map((v,i)=>v-p[i])
  const u=vector(positions[0],positions[1]),r=Math.hypot(...u)
  if(formula==='H2')return {r,angle:null}
  const v=vector(positions[0],positions[2]),s=Math.hypot(...v)
  const dot=u.reduce((sum,val,i)=>sum+val*v[i],0)
  return {r:(r+s)/2,angle:DEG*Math.acos(Math.min(1,Math.max(-1,dot/(r*s))))}
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

function harmonicWavenumber(samples,center){
  const crossings=[]
  for(let i=1;i<samples.length;i++){
    const a=samples[i-1],b=samples[i]
    if(a.r<center&&b.r>=center){
      const f=(center-a.r)/(b.r-a.r)
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

function trajectory(formula,minimum,substeps){
  const fixture=createMolecularReferenceFixture(formula,substeps)
  const geometry0=geometry(formula,minimum.r+.001,formula==='H2O'?minimum.angle+1:90)
  const energy0=fixture.reset(geometry0)
  const samples=[{t:0,...readGeometry(formula,fixture.sample().coordinatesNm)}]
  let drift=0, correctionEv=0,maxAcceptedStepCorrectionEv=0,held=0, previous=fixture.sample()
  const stride=substeps/4
  for(let i=1;i<=steps*substeps;i++){
    const state=fixture.advance()
    drift=Math.max(drift,Math.abs(state.energyEv-energy0))
    maxAcceptedStepCorrectionEv=Math.max(maxAcceptedStepCorrectionEv,state.correctionEv-correctionEv)
    correctionEv=state.correctionEv
    if(state.coordinatesNm.every((p,j)=>p.every((v,k)=>v===previous.coordinatesNm[j][k])))held++
    previous=state
    if(i%stride===0)samples.push({t:i*fixture.dtFs,...readGeometry(formula,state.coordinatesNm)})
  }
  const vibration=formula==='H2'?harmonicWavenumber(samples,minimum.r):{value:null,cycles:0}
  const advancing=held < 0.05*steps*substeps
  return {samples,summary:{dtFs:fixture.dtFs,substepsPerTick:substeps,steps,elapsedFs:timeFs,
    integrationSteps:steps*substeps,sampleCount:samples.length,initialEnergyEv:energy0,
    maxEnergyErrorEv:drift,correctionEv,maxAcceptedStepCorrectionEv,heldSteps:held,
    wavenumberCm1:advancing?vibration.value:null,completedCycles:vibration.cycles}}
}

function compare(id,label,unit,value,reference,tolerance,source){
  const absoluteError=value===null?null:Math.abs(value-reference)
  return {id,label,unit,value,reference,tolerance,absoluteError,relativeError:relativeError(value,reference),
    status:value===null?'sem medida':absoluteError<=tolerance?'aceito':'inadequado',source}
}
function relativeError(v,ref){return v===null?null:Math.abs(v-ref)/Math.abs(ref)}

function assay(formula){
  const fixture=createMolecularReferenceFixture(formula)
  const starts=formula==='H2'?[[.048,90],[.107,90]]:[[.087,80],[.115,135]]
  const minima=starts.map(([r,a])=>minimum(formula,fixture,r,a))
  const best=minima.reduce((a,b)=>a.potentialEv<=b.potentialEv?a:b)
  const converged=minima.every(m=>m.converged && Math.abs(m.r-best.r)<1e-5 &&
    (formula==='H2'||Math.abs(m.angle-best.angle)<.02))
  const coarse=trajectory(formula,best,4),fine=trajectory(formula,best,8)
  const curvature=formula==='H2'&&converged?curvatureOfHydrogen(fixture,best.r):null
  let radiusSquares=0, angleSquares=0
  for(let i=0;i<fine.samples.length;i++){
    radiusSquares+=(coarse.samples[i].r-fine.samples[i].r)**2
    if(formula==='H2O')angleSquares+=(coarse.samples[i].angle-fine.samples[i].angle)**2
  }
  const n=fine.samples.length, results=formula==='H2'?[
    compare('h2-re','Comprimento de equilíbrio H–H','nm',converged?best.r:null,.074144,.02*.074144,'H2-NIST'),
    compare('h2-we','Estiramento medido na trajetória','cm⁻¹',fine.summary.wavenumberCm1,4401.213,.10*4401.213,'H2-NIST'),
    compare('h2-we-curvature','Estiramento harmônico pela curvatura do potencial','cm⁻¹',curvature?.wavenumberCm1??null,4401.213,.10*4401.213,'H2-NIST')
  ]:[
    compare('water-re','Comprimento de equilíbrio O–H','nm',converged?best.r:null,.095777,.02*.095777,'H2O-JCP'),
    compare('water-angle','Ângulo de equilíbrio H–O–H','°',converged?best.angle:null,104.48,3,'H2O-JCP')
  ]
  return {formula,status:results.some(r=>r.status==='inadequado')?'inadequado':
    results.every(r=>r.status==='aceito')?'aceito':'sem medida',measurements:results,minimizations:minima,curvature,
    integration:{coarseDtFs:coarse.summary.dtFs,fineDtFs:fine.summary.dtFs,durationFs:timeFs,
      maxEnergyErrorEv:Math.max(coarse.summary.maxEnergyErrorEv,fine.summary.maxEnergyErrorEv),
      maxCorrectionEv:Math.max(coarse.summary.correctionEv,fine.summary.correctionEv),
      radiusRmsDifferenceNm:Math.sqrt(radiusSquares/n),
      angleRmsDifferenceDeg:formula==='H2O'?Math.sqrt(angleSquares/n):null,
      wavenumberDifferenceCm1:coarse.summary.wavenumberCm1===null||fine.summary.wavenumberCm1===null?null:
        Math.abs(coarse.summary.wavenumberCm1-fine.summary.wavenumberCm1),
      runs:[coarse.summary,fine.summary]},
    notes:formula==='H2'?['A constante espectroscópica harmônica ωₑ é comparada com o período da trajetória e, separadamente, com a curvatura local do potencial e a massa reduzida.',
       'A medida por trajetória exige pelo menos cinco cruzamentos ascendentes e menos de 5% de subpassos imóveis. A projeção de energia pode rejeitar sucessivos passos perto dos pontos de retorno.']:
      ['Geometria simétrica de H₂¹⁶O em fase gasosa. As duas buscas começam a 80° e 135°.',
       'A avaliação usa o potencial de produção, inclusive a interação H–H. O motor atual não possui potencial específico de flexão H–O–H.',
       'As frequências normais da água não são avaliadas por este protocolo.']}
}

export function runMolecularReference(){
  return {version:1,protocol:{durationFs:timeFs,coarseDtFs:ATOMIC_PHYSICS.dtFs,
    fineDtFs:ATOMIC_PHYSICS.dtFs/2,sampleEveryFs:ATOMIC_PHYSICS.dtFs,steps,
    scope:'Moléculas isoladas preparadas, topologia fixa, banho desligado e velocidade inicial zero.',
    tolerances:'Os limites de aceitação do modelo foram definidos antes da medição em 2% para comprimento, 3° para ângulo e 10% para frequência.',
    dynamics:'Comparação em tempos físicos idênticos. Excitação de +0,001 nm no comprimento e de +1° no ângulo da água.',
    energy:'O resíduo mede a variação da energia mecânica após a projeção. A correção acumula o ajuste absoluto de energia cinética dos subpassos aceitos. A contagem de subpassos imóveis indica quando a trajetória deixa de avançar.'},
    species:['H2','H2O'].map(assay),sources:sources.map(s=>({...s}))}
}

import {mountMolecularBench} from './molecular-bench-panel.js';
import {AtomicWorld, ATOMIC_PHYSICS} from './atomic-world.js';
import {sampleProperties} from './material-properties.js';
import {ATOMIC_ELEMENTS, ATOMIC_SOURCES} from './atomic-elements.js';
import {ParticleView, bondId, colors} from './particle-view.js';
import {mountWorldArchive} from './world-archive.js';
import {readParticleSession, mountParticleSession} from './particle-session.js';

const by=id=>document.getElementById(id);
const fmt=(n,digits=2)=>Number.isFinite(n)?n.toLocaleString('pt-BR',{maximumFractionDigits:digits}):'—';
const quantity=(v,unit,digits=2)=>Number.isFinite(v)?fmt(v,digits)+' '+unit:'—';
const titles={particle:'Átomo',bond:'Ligação',cluster:'Molécula'};
const frame=callback=>globalThis.requestAnimationFrame(callback);
function kineticEnergyEv(atom) {
  const speedMS=1e6*Math.hypot(atom.vx,atom.vy,atom.vz);
  return .5*atom.massU*ATOMIC_PHYSICS.atomicMassKg*speedMS**2/1.602176634e-19;
}
const view=new ParticleView(by('pw-map'));
let world=readParticleSession()??new AtomicWorld(42);
let running=false,speed=1,pending=0,lastTime=0,credit=0,lastPaint=0;
let tab='inspect',selection=null,parents=[],focus=null,session=null,archive=null;
const cache=new WeakMap();
const bench=mountMolecularBench(by('molecular-bench'),{inspect(type,id){
  activate('inspect');select(type,id);
}});


function markup(node,html) {
  if(cache.get(node)!==html){node.innerHTML=html;cache.set(node,html);}
}
function rows(entries) {
  return entries.map(([name,value])=>'<div><dt>'+name+'</dt><dd>'+value+'</dd></div>').join('');
}
function announce(message){by('pw-feedback').textContent=message;}
function list(type) {
  if(type==='particle')return world.particles;
  if(type==='bond')return world.bonds;
  return world.observer.molecules;
}
function objectKey(type,object){return type==='bond'?bondId(object):String(object.id);}
function lookup(ref) {return ref&&list(ref.type).find(o=>objectKey(ref.type,o)===ref.key);}
function title(ref,object=lookup(ref)) {
  if(ref.type==='bond')return object?'Ligação #'+object.a+'–'+object.b:'Ligação '+ref.key;
  return titles[ref.type]+' #'+ref.key+(object?(ref.type==='particle'?' · '+object.element:' · '+(object.displayFormula||object.formula)):'');
}
function coordinates(ref) {
  const o=lookup(ref);if(!o)return null;
  if(ref.type!=='bond')return o;
  const a=world.particles.find(p=>p.id===o.a),b=world.particles.find(p=>p.id===o.b);
  return {x:(a.x+b.x)/2,y:(a.y+b.y)/2};
}
function ref(type,key) {return {type,key:String(key)};}
function select(type,key,path=[]) {
  selection=key==null?null:ref(type,key);parents=path;by('pw-scale').value=type;
  if(selection)focus=coordinates(selection);
  refresh();
}
function go(type,key) {
  const rank={cluster:2,bond:1,particle:0},newRef=ref(type,key);
  const pos=parents.findIndex(p=>p.type===newRef.type&&p.key===newRef.key);
  const path=pos>=0?parents.slice(0,pos):selection&&rank[type]<rank[selection.type]?[...parents,selection]:[];
  select(type,key,path);
}
function first() {
  const type=by('pw-scale').value||'particle',object=list(type)[0];
  select(type,object?objectKey(type,object):null);
}
function link(type,key,label) {return '<button type="button" class="pw-token" data-type="'+type+'" data-key="'+key+'">'+label+'</button>';}
function tokenSection(label,items,open=false) {
  return items.length?'<details'+(open?' open':'')+'><summary>'+label+' ('+items.length+')</summary><div class="pw-tokens">'+items.join('')+'</div></details>':'';
}
function activateToken(e) {
  const el=e.target.closest?.('[data-type][data-key]');if(el)go(el.dataset.type,el.dataset.key);
}
by('pw-breadcrumb').addEventListener('click',activateToken);
by('pw-members').addEventListener('click',activateToken);

function atomDiagram(atom) {
  const canvas=by('pw-atom');
  if(canvas.dataset.element===atom.element)return;
  canvas.dataset.element=atom.element;
  const ctx=canvas.getContext('2d');if(!ctx)return;
  const width=canvas.width,height=canvas.height,cx=width*.42,cy=height/2,e=ATOMIC_ELEMENTS[atom.element];
  ctx.clearRect(0,0,width,height);ctx.lineWidth=1;
  const shells=[2,8,8];let remaining=atom.electrons;
  for(let i=0;i<shells.length&&remaining>0;i++){
    const count=Math.min(shells[i],remaining),r=26+i*15;remaining-=count;
    ctx.strokeStyle='#557167';ctx.beginPath();ctx.ellipse(cx,cy,r*1.45,r,0,0,Math.PI*2);ctx.stroke();
    for(let j=0;j<count;j++){
      const a=j/count*Math.PI*2+.5*i;
      ctx.fillStyle='#bbd6ef';ctx.beginPath();ctx.arc(cx+Math.cos(a)*r*1.45,cy+Math.sin(a)*r,2.8,0,Math.PI*2);ctx.fill();
    }
  }
  let protons=0;
  for(let i=0;i<e.massNumber;i++){
    const proton=Math.floor((i+1)*e.atomicNumber/e.massNumber)>protons;if(proton)protons++;
    const r=Math.sqrt(i)*2.65,a=i*2.4;ctx.fillStyle=proton?'#e99677':'#a9b69c';ctx.beginPath();ctx.arc(cx+Math.cos(a)*r,cy+Math.sin(a)*r,3.8,0,Math.PI*2);ctx.fill();
  }
  ctx.fillStyle=colors[atom.element].edge;ctx.font='30px Georgia';ctx.fillText(atom.element,width*.77,cy+4);
  ctx.fillStyle='#b6c8b3';ctx.font='12px monospace';ctx.fillText('A = '+e.massNumber,width*.76,cy+27);
  canvas.setAttribute('aria-label','Esquema do '+e.name+' com '+atom.protons+' prótons, '+atom.neutrons+' nêutrons e '+atom.electrons+' elétrons.');
}
function atomInspection(p) {
  const e=ATOMIC_ELEMENTS[p.element],bonds=world.bonds.filter(b=>b.a===p.id||b.b===p.id);
  const mol=world.observer.molecules.find(m=>m.members.includes(p.id));
  by('pw-atom').hidden=false;atomDiagram(p);
  const data=[
    ['Origem','Semente '+world.seed+' · #'+p.id+' desde o passo 0'],
    ['Isótopo',p.element+'-'+e.massNumber],['Número atômico (Z)',p.protons],
    ['Prótons / nêutrons / elétrons',p.protons+' / '+p.neutrons+' / '+p.electrons],
    ['Massa',quantity(p.massU,'u',6)],['Raio covalente',quantity(p.radiusPm,'pm')],
    ['Volume da esfera covalente',quantity(e.volumePm3,'pm³',0)],
    ['Elétrons de valência',e.valenceElectrons],['Valência usada / limite',bonds.reduce((sum,b)=>sum+b.order,0)+' / '+e.maxValence],
    ['Carga líquida',quantity(p.charge,'e')],['Energia cinética',quantity(kineticEnergyEv(p),'eV',4)],['Posição x / y / z (nm)',[p.x,p.y,p.z].map(v=>fmt(v*world.sideNm,3)).join(' / ')]
  ];
  const body='<h2>'+e.name+' · #'+p.id+'</h2><p>Esquema das camadas eletrônicas e do núcleo, sem escala.</p><dl class="pw-data">'+rows(data)+'</dl>';
  let members=mol?'<p>Em '+link('cluster',mol.id,(mol.displayFormula||mol.formula)+' #'+mol.id)+'</p>':'<p>Átomo livre neste passo.</p>';
  members+=tokenSection('Ligações incidentes',bonds.map(b=>link('bond',bondId(b),'#'+b.a+'–'+b.b)),true);
  members+='<details><summary>Constituintes do núcleo</summary><p>'+e.upQuarks+' quarks up e '+e.downQuarks+' quarks down de valência. Cada próton contém dois up e um down. Cada nêutron contém um up e dois down.</p></details>';
  return [body,members];
}
function bondInspection(b) {
  const a=world.particles.find(p=>p.id===b.a),z=world.particles.find(p=>p.id===b.b);
  const mol=world.observer.molecules.find(m=>m.members.includes(b.a));
  const data=[['Extremos','#'+b.a+' ↔ #'+b.b],['Formada no passo',b.formedAt],['Ordem',b.order],['Energia de ligação de referência',quantity(b.energyEv,'eV',3)],['Distância entre núcleos',quantity(world.sideNm*Math.hypot(a.x-z.x,a.y-z.y,a.z-z.z),'nm',4)],['Origem dos átomos','Semente '+world.seed+' · passo 0']];
  return ['<h2>'+a.element+' — '+z.element+'</h2><dl class="pw-data">'+rows(data)+'</dl>',
    tokenSection('Átomos ligados',[a,z].map(p=>link('particle',p.id,p.element+' #'+p.id)),true)+(mol?'<p>Em '+link('cluster',mol.id,(mol.displayFormula||mol.formula)+' #'+mol.id)+'</p>':'')];
}
function moleculeInspection(m) {
  const memberIds=new Set(m.members),ps=world.particles.filter(p=>memberIds.has(p.id)),bs=world.bonds.filter(b=>memberIds.has(b.a)&&memberIds.has(b.b));
  const data=[['Fórmula',m.displayFormula||m.formula],['Composição',Object.entries(m.composition).filter(([,n])=>n>0).map(([el,n])=>el+' × '+n).join(' · ')],
    ['Massa',quantity(m.massU,'u',5)],['Átomos',m.members.length],['Ligações',m.bondCount],['Ciclos independentes',m.cycleRank],
    ['Soma das energias de ligação de referência',quantity(bs.reduce((sum,b)=>sum+b.energyEv,0),'eV',3)],['Energia cinética dos átomos',quantity(ps.reduce((sum,p)=>sum+kineticEnergyEv(p),0),'eV',4)],
    ['Mesmos átomos desde','Passo '+(world.tick-m.age+1)],['Mesmas ligações desde','Passo '+(world.tick-m.structureAge+1)],['Origem da matéria','Semente '+world.seed+' · passo 0']];
  return ['<h2>'+(m.displayFormula||m.formula)+' · #'+m.id+'</h2><p>Conjunto de átomos conectados por ligações neste passo.</p><dl class="pw-data">'+rows(data)+'</dl>',
    tokenSection('Átomos constituintes',ps.map(p=>link('particle',p.id,p.element+' #'+p.id)),true)+tokenSection('Ligações constituintes',bs.map(b=>link('bond',bondId(b),'#'+b.a+'–'+b.b)))];
}
function renderInspector() {
  const type=by('pw-scale').value,options=list(type),pick=by('pw-choices');
  if(!selection&&options.length){selection=ref(type,objectKey(type,options[0]));focus=coordinates(selection);}
  const available=!!lookup(selection);
  const optionHTML=options.map(o=>{
    const key=objectKey(type,o),label=type==='particle'?o.element+' #'+o.id:type==='bond'?'#'+o.a+'–'+o.b+' · p'+o.formedAt:(o.displayFormula||o.formula)+' #'+o.id;
    return '<option value="'+key+'">'+label+'</option>';
  }).join('');
  const vanished=selection&&!available?'<option value="">Seleção desfeita</option>':'';
  markup(pick,vanished+optionHTML||'<option value="">Nenhum registro</option>');pick.disabled=!options.length;
  if(selection)pick.value=available?selection.key:'';
  const crumb=parents.map(p=>link(p.type,p.key,title(p))).join(' › ');
  markup(by('pw-breadcrumb'),crumb+(crumb?' › ':'')+(selection?titles[type]:''));
  const object=lookup(selection);
  if(!object) {
    by('pw-atom').hidden=true;
    markup(by('pw-inspect'),'<h2>'+(selection?'Seleção desfeita':'Sem '+(type==='bond'?'ligações':type==='cluster'?'moléculas':'átomos'))+'</h2><p>'+(selection?'O identificador deixou de existir neste passo. Escolha outro para inspecionar.':'Avance o tempo para observar o que se forma neste mundo.')+'</p>');
    markup(by('pw-members'),'');return;
  }
  by('pw-atom').hidden=type!=='particle';
  const [body,members]=type==='particle'?atomInspection(object):type==='bond'?bondInspection(object):moleculeInspection(object);
  markup(by('pw-inspect'),body);markup(by('pw-members'),members);
}
function renderEvidence() {
  const obs=world.observer,m=obs.metrics;
  by('pw-evidence-summary').textContent=world.tick===0?'No passo zero, os átomos estão livres. Acompanhe as ligações que se formam quando o tempo avança.':'Um componente conectado conta como molécula. Um ciclo indica um caminho fechado de ligações.';
  markup(by('pw-evidence'),rows([['Átomos livres',m.freeAtomCount],['Átomos ligados',m.bondedAtomCount],['Moléculas',m.moleculeCount],
    ['Moléculas com anel',m.ringMolecules],['Ciclos de ligação',m.cycleCount],['Maior molécula',m.largestMoleculeAtoms+' átomos']]));
  const names={association:'Associação',dissociation:'Dissociação',rearrangement:'Rearranjo'};
  markup(by('pw-events'),obs.events.slice(-10).reverse().map(e=>'<li>Passo '+e.tick+' · '+names[e.type]+'<br><b>'+e.equation+'</b></li>').join('')||'<li>Nenhuma mudança de conectividade registrada.</li>');

}
function renderConditions(m) {
  const sample=sampleProperties(world);
  const data=[['Perfil físico',world.physicsProfile],['Passo interno do integrador',quantity(world.integrationDtFs,'fs',3)],['Temperatura cinética',quantity(sample.temperatureK,'K')],['Temperatura-alvo',quantity(m.targetTemperatureK,'K')],
    ['Volume do recipiente',quantity(sample.volumeNm3,'nm³',5)],['Densidade',quantity(sample.densityKgM3,'kg/m³',4)],
    ['Fase macroscópica',sample.phase],['Massa total',quantity(sample.massU,'u',4)],['Prótons / nêutrons / elétrons',sample.protons+' / '+sample.neutrons+' / '+sample.electrons],
    ['Carga líquida',quantity(sample.chargeElementary,'e')],['Pressão virial instantânea (estim.)',quantity(m.pressurePa,'Pa',1)],['Referência ideal',quantity(sample.idealPressurePa,'Pa',1)]];
  by('pw-phase-reason').textContent=sample.phaseReason;
  const energies=[['kineticEnergyEv','Energia cinética'],['covalentPotentialEv','Potencial das ligações'],['weakPotentialEv','Potencial de interação fraca'],['totalEnergyEv','Energia do sistema'],['bathWorkEv','Trabalho do banho'],['volumeWorkEv','Trabalho das paredes'],['reactionHeatEv','Energia transferida por reações'],['energyError','Resíduo energético bruto']];
  if(world.version===3)energies.push(['anglePotentialEv','Potencial angular'],['integrationDriftEv','Deriva numérica assinada'],['integrationAbsDriftEv','Deriva numérica absoluta acumulada'],['ledgerResidualEv','Fechamento contábil após incluir a deriva']);
  for(const [key,label] of energies)if(Number.isFinite(m[key])) {
    const value=m[key]!==0&&Math.abs(m[key])<1e-5?m[key].toExponential(3).replace('.',',')+' eV':quantity(m[key],'eV',5);
    data.push([label,value]);
  }
  markup(by('pw-energy'),rows(data));
}
function refreshView() {
  view.draw(world,selection);
  const length=view.span>=100?10**Math.floor(Math.log10(65/view.span)):0;
  const scaleLength=!length?0:length*(65/(view.span*length)>=5?5:65/(view.span*length)>=2?2:1);
  by('pw-scale-bar').querySelector('i').style.width=(view.span*scaleLength)+'px';
  const nm=scaleLength*Math.cbrt(world.getMetrics().volumeNm3);
  by('pw-scale-bar').querySelector('span').textContent=quantity(nm,'nm',3);
  by('pw-zoom').textContent=view.zoom+'×';by('pw-zoom-out').disabled=view.zoom<=1;by('pw-zoom-in').disabled=view.zoom>=8;
}
function refresh() {
  const m=world.getMetrics(),obs=world.observer.metrics;
  by('pw-profile').textContent=world.version===2?'Perfil físico v2 · legado':'Perfil físico v'+world.version;
  by('pw-new-profile').hidden=world.version!==2;
  by('pw-tick').textContent=fmt(world.tick,0);by('pw-physical-time').textContent=m.timeFs>=1000?quantity(m.timeFs/1000,'ps',3):quantity(m.timeFs,'fs',1);by('pw-seed-label').textContent=String(world.seed);
  by('pw-status').textContent=pending?'Avançando':running?'Em curso':'Em pausa';by('pw-status').dataset.running=String(running||pending>0);
  by('pw-play').textContent=running||pending?'Pausar':'Iniciar';by('pw-play').setAttribute('aria-pressed',String(running||pending>0));
  by('pw-count').textContent=String(world.particles.length);by('pw-free').textContent=String(obs.freeAtomCount);
  by('pw-bonds').textContent=String(world.bonds.length);by('pw-clusters').textContent=String(obs.moleculeCount);
  if(tab==='inspect')renderInspector();
  if(tab==='environment')renderConditions(m);
  if(tab==='evidence')renderEvidence();
  if(tab==='bench')bench.update(world);
  refreshView();
}
function pause() {running=false;pending=0;credit=0;lastTime=0;}
function freshControls() {
  const m=world.getMetrics();by('pw-temperature').value=String(m.targetTemperatureK);by('pw-volume').value=String(m.volumeNm3);by('pw-binding').checked=world.controls.bindingEnabled;
}
function replace(next,detach=true) {
  session?.assertCanAccept(next);
  pause();if(detach)archive?.detach();world=next;parents=[];selection=world.particles.length?ref('particle',world.particles[0].id):null;
  focus=coordinates(selection);view.setZoom(1);by('pw-scale').value='particle';by('pw-seed').value=String(next.seed);freshControls();
  session?.changed();refresh();
}
archive=mountWorldArchive(by('world-archive'),{mode:'particle-world',getSnapshot:()=>world.serialize(),restoreSnapshot:s=>replace(AtomicWorld.restore(s),false)});
session=mountParticleSession(by('particle-session'),{getWorld:()=>world,setWorld:w=>replace(w),setPaused:pause,onChange:refresh});
freshControls();by('pw-seed').value=String(world.seed);
function collapse(value){
  const side=by('pw-side');side.dataset.collapsed=String(value);
  by('pw-collapse').setAttribute('aria-expanded',String(!value));by('pw-collapse').setAttribute('aria-label',value?'Abrir instrumentos':'Recolher instrumentos');
}
for(const [key,label] of [['mass','NIST · massas isotópicas'],['radius','Cordero et al. · raios covalentes'],['quarks','CERN · constituintes da matéria'],['bonds','OpenStax · energias médias de ligação']]){
  const li=document.createElement('li'),anchor=document.createElement('a');anchor.href=ATOMIC_SOURCES[key];anchor.textContent=label;li.append(anchor);by('pw-sources').append(li);
}
const small=globalThis.matchMedia?.('(max-width:700px)');
collapse(!!small?.matches);small?.addEventListener?.('change',()=>collapse(small.matches));
function activate(name) {
  tab=name;
  for(const button of document.querySelectorAll('[data-tab]')){
    const active=name===button.dataset.tab;button.tabIndex=active?0:-1;button.setAttribute('aria-selected',String(active));
    by('pw-panel-'+button.dataset.tab).hidden=!active;
  }
  collapse(false);refresh();
}
for(const button of document.querySelectorAll('[data-tab]')){
  button.addEventListener('click',()=>activate(button.dataset.tab));
  button.addEventListener('keydown',e=>{
    const buttons=[...document.querySelectorAll('[data-tab]')],k=buttons.indexOf(button);
    const size=buttons.length;
    const next={ArrowRight:(k+1)%size,ArrowLeft:(k+size-1)%size,Home:0,End:size-1}[e.key];
    if(next!==undefined){e.preventDefault();activate(buttons[next].dataset.tab);buttons[next].focus();}
  });
}
by('pw-collapse').onclick=()=>collapse(by('pw-side').dataset.collapsed!=='true');
by('pw-scale').onchange=first;
by('pw-choices').onchange=e=>select(by('pw-scale').value,e.target.value);
by('pw-play').onclick=()=>{if(running||pending)pause();else{running=true;lastTime=0;}refresh();};
by('pw-step').onclick=()=>{pause();world.step();refresh();};
by('pw-advance').onclick=()=>{pause();pending=100;refresh();};
by('pw-speed').onchange=e=>{speed=Number(e.target.value);credit=0;lastTime=0;};
function startNewWorld(seed,options={}) {
  if(!Number.isSafeInteger(seed)||seed<0||seed>4294967295){announce('Informe uma semente entre 0 e 4294967295.');return;}
  try{
    const next=new AtomicWorld(seed,options);
    session.assertCanAccept(next);session.save();replace(next);
    announce('Nova execução v'+next.version+' aberta no passo zero.');
  }catch(error){announce(error.message);}
}
by('pw-new').onsubmit=e=>{e.preventDefault();startNewWorld(Number(by('pw-seed').value));};
by('pw-new-profile').onclick=()=>startNewWorld(world.seed,{
  count:world.particles.length,temperatureK:world.initialTemperatureK,volumeNm3:world.initialVolumeNm3,...world.controls
});
by('pw-environment-form').onsubmit=e=>{
  e.preventDefault();const temp=Number(by('pw-temperature').value),volume=Number(by('pw-volume').value);
  const fields=world.getMetrics();
  try{
    if(!Number.isFinite(temp)||temp<ATOMIC_PHYSICS.minTemperatureK||temp>ATOMIC_PHYSICS.maxTemperatureK||!Number.isFinite(volume)||volume<ATOMIC_PHYSICS.minVolumeNm3||volume>ATOMIC_PHYSICS.maxVolumeNm3)throw new Error('Use uma temperatura de 1 a 3.000 K e um volume de 1 a 512 nm³.');
    if(temp!==fields.targetTemperatureK||volume!==fields.volumeNm3||world.controls.bindingEnabled!==by('pw-binding').checked) {
      if(temp!==fields.targetTemperatureK)world.setTemperature(temp);
      if(volume!==fields.volumeNm3)world.setVolume(volume);
      if(world.controls.bindingEnabled!==by('pw-binding').checked)world.setControls({bindingEnabled:by('pw-binding').checked});
      session.save();
    }
    freshControls();announce('Condições aplicadas no passo '+world.tick+'.');refresh();
  }catch(error){announce(error.message);}
};
function zoom(factor) {view.setZoom(view.zoom*factor,coordinates(selection)||focus);refreshView();}
by('pw-zoom-in').onclick=()=>zoom(2);by('pw-zoom-out').onclick=()=>zoom(.5);
const canvas=by('pw-map');
let drag=null;
canvas.addEventListener('pointerdown',e=>{drag={id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false};canvas.setPointerCapture?.(e.pointerId);});
canvas.addEventListener('pointermove',e=>{
  if(!drag||drag.id!==e.pointerId)return;
  if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>4)drag.moved=true;
  if(drag.moved){view.pan(e.clientX-drag.x,e.clientY-drag.y);refreshView();}
  drag.x=e.clientX;drag.y=e.clientY;
});
canvas.addEventListener('pointercancel',()=>{drag=null;});
canvas.addEventListener('click',e=>{
  const moved=drag?.moved;drag=null;if(moved)return;
  const bounds=canvas.getBoundingClientRect(),x=e.clientX-bounds.left,y=e.clientY-bounds.top;
  const type=by('pw-scale').value,key=view.pick(world,type,x,y);
  focus=view.unproject(x,y);
  if(key==null){announce('Nenhum item nesta posição na escala escolhida.');return;}
  activate('inspect');select(type,key);announce('');
});
canvas.addEventListener('keydown',e=>{
  const deltas={ArrowLeft:[36,0],ArrowRight:[-36,0],ArrowUp:[0,36],ArrowDown:[0,-36]};
  if(deltas[e.key]){e.preventDefault();view.pan(...deltas[e.key]);refreshView();}
  if(e.key==='+'||e.key==='=')zoom(2);if(e.key==='-')zoom(.5);
});
by('pw-fullscreen').onclick=async()=>{
  if(!document.fullscreenElement&&document.documentElement.requestFullscreen){
    try{await document.documentElement.requestFullscreen();return;}catch{/* use the viewport layout */}
  }
  if(document.fullscreenElement){await document.exitFullscreen();return;}
  document.body.classList.toggle('pw-focus');refreshView();
};
function loop(now) {
  if(pending||running){
    const until=performance.now()+10;
    if(pending){
      let advanced=0;
      do{world.step();pending--;advanced++;}while(pending&&advanced<8&&performance.now()<until);
    }else{
      if(lastTime)credit+=Math.min(200,now-lastTime)*6*speed/1000;
      while(credit>=1&&performance.now()<until){world.step();credit--;}
    }
    lastTime=now;
    if(now-lastPaint>=80||(!running&&!pending)){refresh();lastPaint=now;}
  }
  frame(loop);
}
document.addEventListener('visibilitychange',()=>{lastTime=0;credit=0;});
globalThis.addEventListener?.('resize',refreshView);
globalThis.ResizeObserver&&new ResizeObserver(()=>refreshView()).observe(canvas);
setInterval(()=>{if(running||pending||world.tick!==savedTick){session.save();savedTick=world.tick;}},2000)?.unref?.();
let savedTick=world.tick;
const query=new URLSearchParams(globalThis.location?.search||'');
if(query.has('modo')||query.has('amostra')||query.has('planeta')||query.has('recuperar')||query.has('origem')){
  const recovery=document.createElement('a');recovery.className='pw-recovery';recovery.href='./recovery.html'+(globalThis.location?.search||'');recovery.textContent='Registro da versão anterior';
  by('pw-title').parentElement.append(recovery);
}
first();frame(loop);

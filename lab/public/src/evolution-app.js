import { EvolvingWorld } from "./evolving-world.js";
import { EvolutionView, habitatNames, traitColor } from "./evolution-view.js";
import { openEvolutionSession, EVOLUTION_STEPS_PER_SECOND, MAX_CATCHUP_STEPS } from "./evolution-session.js";
import { readEvolvingPlanet } from "./evolution-link.js";
import { installFieldLens } from "./observatory-lens.js";
import { mountWorldArchive } from "./world-archive.js";
import { mountWorldWatch } from "./world-watch.js";
import { mountBehaviorPanel } from "./behavior-panel.js";
import { renderMatterInspector } from "./matter-inspector.js";

const by=id=>document.getElementById(id);
const fmt=new Intl.NumberFormat("pt-BR",{maximumFractionDigits:2});
const whole=new Intl.NumberFormat("pt-BR",{maximumFractionDigits:0});
const num=v=>Number.isFinite(v)?fmt.format(v):"—";
const pct=v=>Number.isFinite(v)?num(v*100)+"%":"—";
const bestHabitat=m=>m.dominantHabitat||Object.entries(m.habitatCounts).sort((a,b)=>b[1]-a[1])[0]?.[0];
const speeds=[1,4,16];
const session=openEvolutionSession();
let world, sample=null, running=true, speed=1, debt=0, tickTime=0, lastFrame=null, saveTime=0;
let selected=null,probe={x:.5,y:.5}, pulse=false, panel="probe", collapsed=false;
let dirty=true,lastPaint=-Infinity,trial=null,chartKey="",eventKey="",lastHidden=null,sessionWarn=false;
let archive,watch,behavior;
const view=new EvolutionView(by("ev-map"));
function put(id,value){
  const node=by(id);const out=String(value);
  if(node.textContent!==out)node.textContent=out;
}
function msg(text){put("ev-feedback",text);}
function writeRows(container,rows,tags){
  while(container.children.length>rows.length)container.lastElementChild.remove();
  rows.forEach((row,i)=>{
    let parent=container.children[i];
    if(!parent){parent=document.createElement(tags[0]);for(const t of tags.slice(1))parent.append(document.createElement(t));container.append(parent);}
    row.forEach((v,j)=>{if(parent.children[j].textContent!==String(v))parent.children[j].textContent=v;});
  });
}
function save(){
  if(!world)return;
  if(!session.save(world,running,speed,debt)&&!sessionWarn){sessionWarn=true;msg("O navegador não conseguiu guardar a sessão. Exporte o mundo na aba Mundos.");}
  saveTime=performance.now();
}
function refreshControls(){
  put("ev-play",running?"Pausar":"Continuar");by("ev-play").setAttribute("aria-pressed",String(running));
  put("ev-speed",speed+"×");by("ev-speed").setAttribute("aria-label","Velocidade "+speed+" vezes. Alterar velocidade.");
  by("ev-pulse").setAttribute("aria-pressed",String(pulse));
  put("ev-status",debt>0?"Retomando · "+whole.format(debt):running?"Em execução":"Em pausa");
}
function cancelTrial(){trial?.terminate();trial=null;by("ev-control").disabled=false;by("ev-cancel").hidden=true;}
function replace(next,{resume=false,clearWatch=true,detach=true,remember=true}={}){
  world=next;debt=0;running=resume;tickTime=0;lastFrame=null;lastHidden=null;dirty=true;
  selected=world.organisms[0]?.id??null;probe={x:.5,y:.5};pulse=false;chartKey="";eventKey="";
  cancelTrial();put("ev-control-status","");by("ev-control-result").hidden=true;
  behavior?.reset();if(clearWatch)watch?.clearFocus();if(detach)archive?.detach();
  by("ev-seed").value=String(world.seed);by("ev-light").value=String(world.environment.lightForcing);
  if(world.environment.lightForcing===.65)by("ev-light").value=".65";
  by("ev-start-mode").value=String(world.getMetrics().founderCount===0?0:24);
  by("ev-water").value=world.environment.initialWaterInventory===0?"dry":"seed";
  refreshControls();if(remember)save();
}
function selectPanel(value){
  if(!["probe","trials","history","worlds"].includes(value))return;
  if(collapsed)setCollapsed(false);
  panel=value;
  for(const tab of document.querySelectorAll("[data-ev-tab]")){
    const on=tab.dataset.evTab===panel;
    tab.setAttribute("aria-selected",String(on));tab.tabIndex=on?0:-1;by(tab.getAttribute("aria-controls")).hidden=!on;
  }
  dirty=true;chartKey="";if(panel==="worlds")watch?.refresh();paint();
}
function setCollapsed(next){
  collapsed=next;document.querySelector(".ev-workbench").dataset.collapsed=String(next);
  by("ev-dock-toggle").setAttribute("aria-expanded",String(!next));put("ev-dock-toggle",next?"Abrir painel":"Recolher painel");dirty=true;
}
for(const tab of document.querySelectorAll("[data-ev-tab]")){
  tab.addEventListener("click",()=>selectPanel(tab.dataset.evTab));
  tab.addEventListener("keydown",e=>{
    const tabs=[...document.querySelectorAll("[data-ev-tab]")],i=tabs.indexOf(tab);
    const index=e.key==="ArrowRight"?(i+1)%tabs.length:e.key==="ArrowLeft"?(i+tabs.length-1)%tabs.length:e.key==="Home"?0:e.key==="End"?tabs.length-1:-1;
    if(index>=0){e.preventDefault();selectPanel(tabs[index].dataset.evTab);tabs[index].focus();}
  });
}
by("ev-dock-toggle").addEventListener("click",()=>{setCollapsed(!collapsed);paint();});
by("ev-open-worlds").addEventListener("click",e=>{e.preventDefault();selectPanel("worlds");by("world-archive").scrollIntoView?.({block:"start",behavior:"smooth"});});
function fullStatus() {
  const on=Boolean(document.fullscreenElement)||document.body.classList.contains("ev-focus-mode");
  const button=by("ev-fullscreen");
  button.setAttribute("aria-pressed",String(on));
  button.setAttribute("aria-label",on?"Sair da tela cheia":"Abrir tela cheia");
  button.title=on?"Sair da tela cheia":"Abrir tela cheia";
  dirty=true;
}
function toggleFocus() {
  document.body.classList.toggle("ev-focus-mode");
  fullStatus();
}
by("ev-fullscreen").addEventListener("click",async()=>{
  if(document.body.classList.contains("ev-focus-mode")) {toggleFocus();return;}
  try {
    if(document.fullscreenElement)await document.exitFullscreen();
    else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();
    else toggleFocus();
  }catch{toggleFocus();}
});
document.addEventListener("fullscreenchange",fullStatus);
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&document.body.classList.contains("ev-focus-mode"))toggleFocus();
});
function choosePoint(p,id){
  if(pulse){world.addNutrientPulse(p.x,p.y,1);pulse=false;view.lastTick=-1;save();msg("1 u.m. de nutriente adicionada ao terreno neste passo.");}
  selected=id;probe=p;dirty=true;refreshControls();selectPanel("probe");
}
const map=by("ev-map");
map.addEventListener("click",e=>choosePoint(view.point(e.clientX,e.clientY),pulse?null:view.pick(e.clientX,e.clientY)));
map.addEventListener("keydown",e=>{
  const dirs={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]};const dir=dirs[e.key];
  if(dir){
    e.preventDefault();selected=null;probe={x:Math.max(0,Math.min(1,probe.x+dir[0]/world.environment.size)),y:Math.max(0,Math.min(1,probe.y+dir[1]/world.environment.size))};
    selectPanel("probe");
  } else if(e.key==="Enter"){e.preventDefault();choosePoint(probe,null);}
});
by("ev-next").addEventListener("click",()=>{const list=world.organisms;if(!list.length)return;const index=list.findIndex(o=>o.id===selected);selected=list[(index+1)%list.length].id;dirty=true;paint();});
by("ev-cell").addEventListener("click",()=>{const org=world.organisms.find(o=>o.id===selected);if(org)probe={x:org.x,y:org.y};selected=null;dirty=true;paint();});
by("ev-play").addEventListener("click",()=>{running=!running;if(!running)debt=0;tickTime=0;lastFrame=null;refreshControls();save();});
by("ev-step").addEventListener("click",()=>{running=false;debt=0;tickTime=0;world.step();dirty=true;refreshControls();save();paint();});
by("ev-speed").addEventListener("click",()=>{speed=speeds[(speeds.indexOf(speed)+1)%speeds.length];tickTime=0;lastFrame=null;refreshControls();save();});
by("ev-light").addEventListener("change",()=>{world.setLightForcing(Number(by("ev-light").value));dirty=true;save();paint();});
by("ev-layer").addEventListener("change",()=>{dirty=true;paint();});
by("ev-pulse").addEventListener("click",()=>{pulse=!pulse;refreshControls();if(pulse){msg("Escolha a célula do pulso no mapa. Use as setas e Enter pelo teclado.");map.focus({preventScroll:true});}});
by("ev-new").addEventListener("submit",e=>{
  e.preventDefault();const raw=by("ev-seed").value.trim(),seed=Number(raw);
  if(!raw||!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff){msg("Escolha uma semente inteira entre 0 e 4294967295.");return;}
  const options={founderCount:Number(by("ev-start-mode").value)};
  if(by("ev-water").value==="dry")options.waterInventory=0;
  try{
    const next=sample&&sample.seed===seed?EvolvingWorld.fromSurfaceSample(sample,options):new EvolvingWorld(seed,options);
    if(!sample||seed!==sample.seed){sample=null;by("ev-origin-link").href="./primordial.html";by("ev-origin-link").textContent="Origens";}
    replace(next,{resume:true});msg(next.founderCount?"Novo mundo com "+next.founderCount+" fundadores digitais.":options.founderCount?"Nenhuma região permitiu fundação. A superfície inicia estéril.":"Nova superfície estéril, sem fundadores.");
    selectPanel("probe");
  }catch(error){msg(error.message || "Não foi possível iniciar este mundo.");}
});
function probePanel(m){
  const org=world.organisms.find(o=>o.id===selected);
  if(org)probe={x:org.x,y:org.y};
  const local=world.environment.sample(probe.x,probe.y);
  put("ev-focus",org?"Organismo "+org.id:selected?"Organismo "+selected:"Sonda de terreno");
  put("ev-focus-desc",org?"Linhagem "+org.lineage+" · geração "+org.generation+" · "+(habitatNames[local.habitat]||local.habitat):
    selected?"Este indivíduo saiu do mundo. A sonda acompanha o último local observado.":(habitatNames[local.habitat]||local.habitat)+" · leitura no ponto selecionado do mapa.");
  let rows=org?[["Alelo herdado",String(org.genome.allele)],["Ótimo térmico",num(266+4.8*org.genome.allele)+" K"],["Idade",num(org.age)+" passos"],["Biomassa",num(org.mass)+" u.m."],["Reserva",num(org.energy)+" u.e."]]:[];
  rows.push(["Posição relativa",num(probe.x)+" · "+num(probe.y)],["Temperatura local",num(local.temperatureK)+" K"],["Água líquida",num(local.water)],["Gelo",num(local.ice)],["Nutriente disponível",num(local.nutrient)+" u.m."],["Mineral local",num(local.mineral)]);
  writeRows(by("ev-probe-rows"),rows,["div","dt","dd"]);
  by("ev-next").disabled=m.population===0;
  renderMatterInspector(by("matter-inspector"),world,probe);
}
const barNodes=[];
for(let i=0;i<=10;i++){
  const box=document.createElement("div");box.setAttribute("role","listitem");box.innerHTML="<i><b></b></i><span></span>";
  box.querySelector("span").textContent=String(i);box.querySelector("b").style.background=traitColor(i);
  by("ev-traits").append(box);barNodes.push(box);
}
function historyPanel(m){
  const counts=m.traitCounts,freq=m.traitFrequencies;
  for(let i=0;i<barNodes.length;i++){
    const f=m.population?freq[i]:null,box=barNodes[i];
    box.querySelector("b").style.height=(f===null?0:f*100)+"%";
    const title="Alelo "+i+", ótimo térmico "+num(266+4.8*i)+" K, "+num(counts[i])+" organismos, frequência "+pct(f);
    box.title=title;box.setAttribute("aria-label",title);
  }
  put("ev-trait-summary",m.population?"Ótimo térmico médio "+num(266+48*m.meanTrait)+" K · "+num(m.mutations)+" mutações acumuladas.":"Sem organismos vivos. As frequências são indefinidas.");
  const lineageCounts=new Map();for(const org of world.organisms)lineageCounts.set(org.lineage,(lineageCounts.get(org.lineage)||0)+1);
  const ranks=[...world.lineages].sort((a,b)=>(lineageCounts.get(b.id)||0)-(lineageCounts.get(a.id)||0)||a.id-b.id);
  put("ev-lineage-summary",lineageCounts.size+" linhagens com representantes vivos entre "+ranks.length+" linhagens fundadoras.");
  writeRows(by("ev-lineage"),ranks.map(f=>["#"+f.id,num(lineageCounts.get(f.id)||0),num(f.births),num(f.deaths)]),["tr","th","td","td","td"]);
  const sel=by("ev-filter").value,events=world.events.filter(e=>sel==="all"||(sel==="vital"?["birth","death"].includes(e.type):!["birth","death"].includes(e.type))).slice(-22).reverse();
  const signature=JSON.stringify(events);
  if(signature!==eventKey){
    eventKey=signature;const log=by("ev-events");log.replaceChildren();
    for(const e of events){const li=document.createElement("li");li.textContent="Passo "+num(e.tick)+" · "+e.text;log.append(li);}
    if(!events.length){const li=document.createElement("li");li.textContent="Sem eventos deste tipo no histórico disponível.";log.append(li);}
  }
  drawChart(m);
}
function drawChart(m){
  const key=by("ev-history-series").value,c=by("ev-history"),box=c.getBoundingClientRect(),w=Math.max(1,box.width),h=Math.max(1,box.height);
  if(w<=1||h<=1)return;
  const signature=[world.seed,m.tick,key,w,h,m.lightForcing,m.population].join("/");
  if(signature===chartKey)return;chartKey=signature;
  const data=world.history.at(-1)?.tick===m.tick?[...world.history.slice(0,-1),m]:[...world.history,m];
  const points=data.map(row=>[row.tick,key==="meanTrait"?(row.population?266+48*row.meanTrait:null):row[key]]);
  const values=points.map(p=>p[1]).filter(Number.isFinite);
  const unit=key==="population"?"organismos":key==="meanHabitability"?"índice":"K";
  put("ev-history-description", "Semente "+world.seed+" · "+num(points.length)+" registros observados.");
  put("ev-chart-caption","Passos "+num(points[0][0])+" a "+num(m.tick)+" · Leitura atual "+num(points.at(-1)[1])+" "+unit);
  c.setAttribute("aria-label",by("ev-chart-caption").textContent);
  const dpr=Math.min(window.devicePixelRatio||1,2);c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);
  const ctx=c.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const min=key.includes("Temperature")||key==="meanTrait"?Math.floor(Math.min(...values,1e9)-.5):0;
  const max=key==="meanHabitability"?1:Math.max(min+1,Math.ceil(Math.max(...values,0)));
  const lo=points[0][0],hi=Math.max(lo+1,m.tick),left=37,right=w-8,top=10,bottom=h-20;
  const X=t=>left+(t-lo)*(right-left)/(hi-lo),Y=v=>bottom-(v-min)*(bottom-top)/(max-min);
  ctx.font="10px monospace";ctx.lineWidth=1;ctx.fillStyle="#b2c4b6";
  if(!values.length){ctx.fillText("Sem observação definida.",left,28);return;}
  for(let i=0;i<3;i++){const v=min+(max-min)*i/2,y=Y(v);ctx.strokeStyle="#374c40";ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.fillText(num(v),1,y+3);}
  ctx.fillText(num(lo),left,h-4);const end=num(m.tick);ctx.fillText(end,right-ctx.measureText(end).width,h-4);
  ctx.strokeStyle="#bce3a5";ctx.lineWidth=2;ctx.beginPath();let linked=false;
  for(const [t,v] of points){if(!Number.isFinite(v)){linked=false;continue;}if(linked)ctx.lineTo(X(t),Y(v));else ctx.moveTo(X(t),Y(v));linked=true;}ctx.stroke();
  const last=points.at(-1);if(Number.isFinite(last[1])){ctx.fillStyle="#c7e8ab";ctx.beginPath();ctx.arc(X(last[0]),Y(last[1]),3,0,Math.PI*2);ctx.fill();}
}
function paint(){
  if(!world)return;
  const m=world.getMetrics(),hab=bestHabitat(m);
  put("ev-tick",whole.format(m.tick));put("ev-pop",whole.format(m.population));put("ev-generation",num(m.maxGeneration));
  put("ev-habitat",habitatNames[hab]||hab||"—");put("ev-life",m.population?"Povoado":m.founderCount?"Extinto":"Estéril");
  put("ev-map-tag","Semente "+world.seed+" · "+(world.environment.origin.kind==="primordial"?"origem cósmica":"planeta local"));
  const layer=by("ev-layer").value;
  const legends={natural:"Cor dos organismos = alelo térmico · âmbar = nutriente · cristais = mineral",thermal:"Azul = frio · cobre = quente · temperatura em kelvin na sonda",wet:"Verde-escuro = pouca água · ciano = maior estoque líquido",ice:"Escuro = pouco gelo · claro = maior estoque de gelo",mineral:"Escuro = menor fração mineral · violeta = maior fração",food:"Escuro = pouco nutriente disponível · âmbar = maior estoque",bound:"Escuro = pouco nutriente retido · ocre = maior estoque ligado ao substrato"};
  put("ev-map-legend",legends[layer]||"");
  view.draw(world,{layer,selected,probe});
  if(!collapsed&&panel==="probe")probePanel(m);
  if(!collapsed&&panel==="history")historyPanel(m);
  if(!collapsed&&panel==="trials")behavior?.update();
  dirty=false;lastPaint=performance.now();
}
by("ev-history-series").addEventListener("change",()=>{chartKey="";paint();});by("ev-filter").addEventListener("change",()=>{eventKey="";paint();});
by("ev-cancel").addEventListener("click",()=>{cancelTrial();put("ev-control-status","Ensaio cancelado.");});
by("ev-control").addEventListener("click",()=>{
  if(trial)return;
  const error=()=>{cancelTrial();put("ev-control-status","Falha ao executar o controle. Tente novamente.");};
  try{
    const worker=new Worker(new URL("./evolution-trial.js",import.meta.url),{type:"module"});trial=worker;
    by("ev-control").disabled=true;by("ev-cancel").hidden=false;by("ev-control-result").hidden=true;put("ev-control-status","Calculando as duas trajetórias…");
    worker.onmessage=({data})=>{
      if(trial!==worker)return;if(!data.result){error();return;}
      const {seed,start,end,selected:s,neutral:n}=data.result;
      const rows=[["Medida","Seleção","Neutro"],["População",num(s.population),num(n.population)],["Ótimo térmico médio",num(s.meanThermal)+" K",num(n.meanThermal)+" K"],["Mutações acumuladas",num(s.mutations),num(n.mutations)]];
      for(let i=0;i<=10;i++)rows.push(["Frequência do alelo "+i,pct(s.frequencies?.[i]),pct(n.frequencies?.[i])]);
      const result=by("ev-control-result");result.replaceChildren();const table=document.createElement("table");result.append(table);
      writeRows(table,rows,["tr","th","td","td"]);result.hidden=false;
      put("ev-control-status","Uma réplica pareada · semente "+seed+" · passos "+start+" a "+end+". Frequências indefinidas aparecem como —.");
      cancelTrial();
    };
    worker.onerror=()=>{if(trial===worker)error();};worker.onmessageerror=worker.onerror;worker.postMessage(world.serialize());
  }catch{error();}
});

let restoring=null;
try{
  const transferred=readEvolvingPlanet();
  if(transferred){
    sample=transferred.sample;world=EvolvingWorld.fromSurfaceSample(sample,{founderCount:transferred.founders});running=false;
    by("ev-origin-link").href="./primordial.html?universo="+encodeURIComponent(transferred.id);by("ev-origin-link").textContent="Voltar à origem";
    msg("Planeta herdado do passo "+num(sample.tick)+" de Origens. "+world.founderCount+" fundadores introduzidos.");
    // The transfer applies once. Reloading resumes the now-independent local experiment.
    window.history?.replaceState?.(null,"",location.pathname+location.hash);
  }else restoring=session.restore();
}catch(error){msg(error.message || "A transferência de origem expirou.");}
if(restoring){
  world=restoring.world;speed=restoring.speed;running=restoring.running;
  if(world.environment.origin.kind==="primordial")sample={...world.environment.origin,kind:"evolving-surface-sample",version:1};
}
if(!world)world=new EvolvingWorld(42);
replace(world,{resume:running,remember:false,detach:false});
if(restoring?.elapsedSteps){debt=restoring.elapsedSteps;msg((restoring.limited?"Retomada limitada a ":"Retomando ")+whole.format(debt)+" passos desde a última visita.");}
archive=mountWorldArchive(by("world-archive"),{mode:"evolving-world",getSnapshot:()=>world.serialize(),restoreSnapshot:s=>{
  const next=EvolvingWorld.restore(s);sample=next.environment.origin.kind==="primordial"?{...next.environment.origin,kind:"evolving-surface-sample",version:1}:null;
  replace(next,{detach:false});msg("Revisão aberta no passo "+num(next.tick)+", em pausa.");paint();
}});
watch=mountWorldWatch(by("world-watch"),{getWorld:()=>world,getRemoteReference:()=>archive.getRemoteReference?.()||null,
  openWorld:copy=>{sample=copy.environment.origin.kind==="primordial"?{...copy.environment.origin,kind:"evolving-surface-sample",version:1}:null;
    replace(copy,{clearWatch:false});msg("Cópia do mundo acompanhada em pausa.");selectPanel("probe");}});
behavior=mountBehaviorPanel(by("behavior-panel"),()=>world);
installFieldLens(view,()=>world.organisms.find(o=>o.id===selected)??probe,()=>{dirty=true;paint();});
function frame(now){
  if(!document.hidden){
    if(debt>0&&running){
      const before=performance.now();let steps=0;
      do{world.step();debt--;steps++;}while(debt>0&&steps<32&&performance.now()-before<8);
      dirty=true;refreshControls();
      if(!debt){msg("Retomada concluída no passo "+whole.format(world.tick)+".");save();tickTime=0;}
    }else if(running&&lastFrame!==null){
      tickTime+=Math.min(200,Math.max(0,now-lastFrame))*speed*EVOLUTION_STEPS_PER_SECOND/1000;
      const before=performance.now();
      while(tickTime>=1&&performance.now()-before<9){world.step();tickTime--;dirty=true;}
    }
    if(dirty && (now-lastPaint>85||!running))paint();
    if(now-saveTime>=2000 && running)save();
  }
  lastFrame=now;requestAnimationFrame(frame);
}
function hide(){
  if(lastHidden!==null)return;
  lastHidden=Date.now();save();lastFrame=null;tickTime=0;
}
function show(){
  if(lastHidden===null)return;
  if(running){
    const total=debt+Math.floor(Math.max(0,Date.now()-lastHidden)*speed*EVOLUTION_STEPS_PER_SECOND/1000);
    debt=Math.min(MAX_CATCHUP_STEPS,total);
    if(debt)msg((total>debt?"Retomada limitada a ":"Recuperando ")+whole.format(debt)+" passos desde que a aba ficou oculta.");
  }
  lastHidden=null;lastFrame=null;tickTime=0;refreshControls();save();
}
document.addEventListener("visibilitychange",()=>{if(document.hidden)hide();else show();});
window.addEventListener("pagehide",hide);window.addEventListener("pageshow",show);
new ResizeObserver(()=>{dirty=true;chartKey="";}).observe(by("ev-map"));
new ResizeObserver(()=>{dirty=true;chartKey="";}).observe(by("ev-history"));
const smallScreen=window.matchMedia?.("(max-width: 700px)");
if(smallScreen){
  setCollapsed(smallScreen.matches);
  smallScreen.addEventListener?.("change",e=>setCollapsed(e.matches));
}
fullStatus();refreshControls();paint();save();requestAnimationFrame(frame);

import { PrimordialWorld, PRIMORDIAL_PHASES } from "./primordial.js";
import { PrimordialView } from "./primordial-view.js";
import { openSurfaceSample, getOriginReturn } from "./surface-link.js";
import { openEvolvingPlanet, readEvolutionOrigin } from "./evolution-link.js";
import { mountWorldArchive } from "./world-archive.js";

const by = id => document.getElementById(id);
const phases = PRIMORDIAL_PHASES.map(p => p.id);
const brief = ["Plasma", "Núcleos", "Átomos", "Estrelas", "Disco", "Minerais", "Lagoa"];
const descriptions = [
  "A parcela representativa começa quente e densa. A expansão reduz sua temperatura e densidade relativas.",
  "A formação de núcleos leves distribui o inventário primordial entre hidrogênio e hélio.",
  "A recombinação marca a passagem a átomos neutros enquanto cresce a sobredensidade local.",
  "Parte do gás fica retida em estrelas locais. Estrelas vizinhas fornecem os elementos pesados por ejeção.",
  "O disco enriquecido esfria a pressão prescrita. Os elementos disponíveis limitam a formação de sólidos.",
  "O magnésio, o silício e o oxigênio livres se combinam no lote de silicato à medida que o disco esfria.",
  "A amostra de superfície recebe temperatura e pressão prescritas. Partículas livres podem formar ligações e agregados acompanhados entre passos."
];
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const exponent = new Intl.NumberFormat("pt-BR", { notation: "scientific", maximumFractionDigits: 2 });
function num(value) {
  if (!Number.isFinite(value)) return "—";
  return value !== 0 && (Math.abs(value) < .001 || Math.abs(value) >= 1e6) ? exponent.format(value) : number.format(value);
}
function put(id, text) {
  const node = by(id);
  if (node.textContent !== text) node.textContent = text;
}
function cells(container, data, tags) {
  while (container.children.length > data.length) container.lastElementChild.remove();
  data.forEach((row, i) => {
    let line = container.children[i];
    if (!line) {
      line = document.createElement(tags[0]);
      for (const tag of tags.slice(1)) line.append(document.createElement(tag));
      container.append(line);
    }
    row.forEach((value,j) => { if (line.children[j].textContent !== value) line.children[j].textContent = value; });
  });
}

let world = new PrimordialWorld({seed:42});
let running = true, elapsed = 0, previous = null, dirty = true;
let selection = null, previousPhase = null, compare = null, compareSession = 0, seeking = false;
const view = new PrimordialView(by("po-canvas"));
const archive = mountWorldArchive(by("world-archive"), {
  mode: "primordial",
  getSnapshot: () => world.serialize(),
  restoreSnapshot: snapshot => replace(PrimordialWorld.restore(snapshot))
});
const tabs = PRIMORDIAL_PHASES.map((p,i) => {
  const tab = document.createElement("li"); tab.textContent = brief[i]; tab.title = p.label;
  by("po-timeline").append(tab); return tab;
});
const combo = by("po-target");
for (const {id,label} of PRIMORDIAL_PHASES.slice(1)) {
  const opt = document.createElement("option"); opt.value = id; opt.textContent = label; combo.append(opt);
}
function replace(next) {
  world = next; by("po-seed").value = String(next.seed);
  compareSession++; compare = null; seeking = false; selection = null; previousPhase = null;
  setRunning(false); put("po-compare-status","");
  by("po-compare").disabled = false; put("po-compare","Comparar desde a origem"); by("po-comparison").hidden = true;
  draw();
}
function setRunning(next) {
  running = next; previous = null; elapsed = 0; dirty = true;
  put("po-play", running ? "Pausar" : "Continuar");
  by("po-play").setAttribute("aria-pressed", String(running));
  put("po-state", running ? "Em execução" : "Em pausa");
}
function step() {
  world.step();
  if (compare?.ready) { compare.reference.step(); compare.control.step(); }
  dirty = true;
}
function showSelection(m, stage) {
  const lagoon = world.lagoon, selected = selection;
  const lot = world.mineralLot;
  let heading = m.phaseLabel, desc = descriptions[stage], rows;
  if (selected?.type === "lot" || selected?.type === "site") {
    const site = selected.type === "site" ? lagoon?.sites.find(s=>s.id===selected.id) : null;
    heading = site ? "Sítio mineral " + selected.id : "Lote de silicato";
    desc = site ? "Este sítio representa a superfície disponível na amostra da lagoa. Sua procedência remete ao lote condensado no disco." :
      "O lote reúne material condensado no disco a partir de Mg, Si e O da ejeção de estrelas vizinhas.";
    rows = [["Lote",lot.id],["Fórmula","Mg₂SiO₄"],["Estoque",num(lot.units)+" lotes de fórmula"],
      ["Receita por fórmula","2 Mg + 1 Si + 4 O"],["Origem dos elementos","Ejeção estelar vizinha"],["Início da condensação","Passo "+num(lot.firstTick)],
      ["Última incorporação","Passo "+num(lot.lastTick)]];
  } else if (selected?.type === "cluster") {
    const c = lagoon?.observer.clusters.find(x=>x.id===selected.id);
    heading = "Agregado " + selected.id;
    desc = c ? "Conjunto conectado de partículas neste passo. A persistência é medida pela continuidade do agregado." : "O observador já não encontra este agregado na lagoa.";
    rows = c ? [["Partículas",num(c.members.length)],["Idade observada",num(c.age)+" passos"],["Persistente",c.stable?"Sim":"Ainda não"],
      ["Ciclo de ligações",c.closed?"Presente":"Ausente"],["Área do contorno",num(c.area * 100)+"% do campo"],["Vida demonstrada","Não"]] : [["Última observação","Grupo disperso"]];
  } else if (selected?.type === "particle") {
    const p = lagoon?.particles.find(x=>x.id===selected.id);
    heading = "Partícula " + selected.id;
    desc = "A classe virtual determina quais interações de contato estão disponíveis nesta amostra.";
    rows = p ? [["Classe",p.kind.toUpperCase()],["Massa",num(p.mass)+" u.m."],["Energia interna",num(p.energy)+" u.e."],
      ["Posição",num(p.x)+", "+num(p.y)],["Ligações",num(lagoon.bonds.filter(b=>b.a===p.id||b.b===p.id).length)]] : [];
  } else if (stage < 3) {
    rows = [["Escala relativa",num(m.scaleFactor)],["H no gás",num(m.gas.H)+" lotes"],["He no gás",num(m.gas.He)+" lotes"],
      ["Inventário a resolver",num(m.unresolvedBaryons)+" bárions"],["Sobredensidade",num(m.overdensity)]];
  } else if (stage === 3) {
    rows = [["Massa retida localmente",num(m.stellarProcessed)+" bárions"],["O recebido",num(m.ejecta.O)+" lotes"],
      ["Mg recebido",num(m.ejecta.Mg)+" lotes"],["Si recebido",num(m.ejecta.Si)+" lotes"]];
  } else if (stage < 6) {
    rows = [["Temperatura do disco",num(m.diskTemperature)+" K"],["Pressão prescrita",num(m.diskPressureBar)+" bar"],
      ["Mg livre",num(m.gas.Mg)+" lotes"],["Si livre",num(m.gas.Si)+" lotes"],["O livre",num(m.gas.O)+" lotes"],
      ["Mg₂SiO₄",num(m.mineralUnits)+" lotes de fórmula"]];
  } else {
    rows = [["Passo da lagoa",num(lagoon.tick)],["Superfície prescrita",num(m.surfaceTemperatureK)+" K · "+num(m.surfacePressureBar)+" bar"],["Partículas",num(m.particleCount)],["Grupos ligados",num(m.componentCount)],
      ["Agregados persistentes",num(m.stableCount)],["Grupos com ciclo",num(m.cycleCount)],["Vida",m.lifeStatus]];
  }
  put("po-focus",heading); put("po-focus-text",desc);
  cells(by("po-properties"),rows,["div","dt","dd"]);
  by("po-lot").hidden = !lot.units || selected?.type==="lot";
  by("po-cluster").hidden = !lagoon?.observer.clusters.length;
  by("po-general").hidden = !selected;
  by("po-surface").hidden = !lagoon;
  by("po-planet").hidden = stage < 5;
}
function draw() {
  const m = world.getMetrics(), stage = phases.indexOf(m.phase);
  if (m.phase !== previousPhase) {
    previousPhase = m.phase;
    selection = null;
    tabs.forEach((tab,i) => {
      tab.dataset.reached = String(i <= stage);
      if (i===stage) tab.setAttribute("aria-current","step"); else tab.removeAttribute("aria-current");
      if (world.phaseTicks[phases[i]] !== null) tab.title = PRIMORDIAL_PHASES[i].label + " · passo " + world.phaseTicks[phases[i]];
      else tab.title = PRIMORDIAL_PHASES[i].label;
    });
    for (const opt of combo.options) opt.disabled = phases.indexOf(opt.value) <= stage;
    combo.value = phases[stage+1] || "";
    combo.disabled = stage === 6; by("po-seek").disabled = stage === 6;
  }
  const count = num(m.tick);
  put("po-badge",m.phaseLabel); put("po-tick",count); put("po-kind", stage===6 ? "Amostra particulada" : "Campo esquemático");
  put("po-map-caption",stage===6 ? "Âmbar A · Ciano B · Lilás C · Traços entre partículas = ligações" :
    stage>=5 && m.mineralUnits>0 ? "Cristais esquemáticos · clique para inspecionar o lote" :
    stage>=3 ? "Distribuição ilustrativa da região · inventários no inspetor" : "Expansão relativa · distribuição ilustrativa da matéria");
  const gauges = stage===6 ? [["Ligações",num(m.bondCount)],["Agregados persistentes",num(m.stableCount)],["Vida demonstrada",num(m.lifeCount)]] :
    stage>=4 ? [["Temperatura do disco",num(m.diskTemperature)+" K"],["Silicato condensado",num(m.mineralUnits)+" lotes"],["Resíduo elementar máximo",num(m.maxElementResidual)]] :
    [["Temperatura T/T₀",num(m.cosmicTemperature)],["Densidade ρ/ρ₀",num(m.matterDensity)],["Resíduo elementar máximo",num(m.maxElementResidual)]];
  gauges.forEach(([label,v],i)=>{put("po-r"+(i+1)+"label",label); put("po-r"+(i+1),v);});
  put("po-mode",world.silicon ? "Ramo ativo · com silício" : "Ramo ativo · Si livre exportado desde o passo " + num(world.branchTick));
  by("po-fork").disabled = !world.silicon;
  by("po-fork").title = world.silicon ? "Desviar o Si livre a partir do passo atual; preservar sólidos existentes" : "O silício livre já é desviado neste ramo";
  showSelection(m,stage);
  view.draw(world,m,selection);
  const log = by("po-events");
  const signature = world.events.map(e=>e.tick + e.text).join("|");
  if (log.dataset.signature !== signature) {
    log.dataset.signature = signature; log.replaceChildren();
    for(const event of [...world.events].reverse()) {
      const li=document.createElement("li"); li.textContent="Passo "+num(event.tick)+" · "+event.text; log.append(li);
    }
  }
  if (compare?.ready) updateComparison();
  dirty = false;
}
function updateComparison() {
  const a=compare.reference.getMetrics(), b=compare.control.getMetrics();
  const rows = [
    ["Passo",num(a.tick),num(b.tick)],["Si livre (lotes)",num(a.gas.Si),num(b.gas.Si)],
    ["Si exportado (lotes)",num(a.exported.Si),num(b.exported.Si)],
    ["Mg₂SiO₄ (lotes)",num(a.mineralUnits),num(b.mineralUnits)],
    ["Sítios na lagoa",a.lagoonReady?num(a.mineralSiteCount):"—",b.lagoonReady?num(b.mineralSiteCount):"—"],
    ["Agregados persistentes",a.lagoonReady?num(a.stableCount):"—",b.lagoonReady?num(b.stableCount):"—"]
  ];
  cells(by("po-comparison").querySelector("tbody"),rows,["tr","th","td","td"]);
}
function choose(sel) {selection=sel;dirty=true;draw();}
by("po-canvas").addEventListener("click",e=>choose(view.pick(e.clientX,e.clientY)));
by("po-canvas").addEventListener("keydown", e=>{
  if (!["ArrowRight","ArrowLeft"].includes(e.key) || !view.targets.length) return;
  e.preventDefault();
  const objects = [...new Map(view.targets.map(t=>[t.type+":"+t.id,t])).values()];
  const i = objects.findIndex(t=>t.type===selection?.type && t.id===selection?.id);
  const n = i<0?0:(i+(e.key==="ArrowRight"?1:-1)+objects.length)%objects.length;
  choose({type:objects[n].type,id:objects[n].id});
});
by("po-lot").addEventListener("click",()=>choose({type:"lot",id:world.mineralLot.id}));
by("po-cluster").addEventListener("click",()=>{
  const groups=world.lagoon?.observer.clusters;
  if (!groups?.length) return;
  const i=groups.findIndex(c=>c.id===selection?.id && selection?.type==="cluster");
  choose({type:"cluster",id:groups[(i+1)%groups.length].id});
});
by("po-evolution").addEventListener("click", () => {
  try { openEvolvingPlanet(world, Number(by("po-evolution-start").value)); }
  catch (e) { put("po-error", e.message || "Não foi possível abrir a superfície planetária."); }
});
by("po-observe-cell").addEventListener("click", async () => {
  try { await openSurfaceSample(world); }
  catch (e) { put("po-error", e.message || "Não foi possível abrir a amostra da superfície."); }
});
by("po-general").addEventListener("click",()=>choose(null));
by("po-play").addEventListener("click",()=>{ if (!seeking) setRunning(!running); });
by("po-step").addEventListener("click",()=>{ if (seeking) return; setRunning(false); step(); draw(); });
by("po-seek").addEventListener("click",()=>{
  const target = phases.indexOf(combo.value);
  if (target<=phases.indexOf(world.phase) || seeking) return;
  setRunning(false); seeking=true;
  try {
    for(let i=0;i<600 && phases.indexOf(world.phase)<target;i++) step();
    if (phases.indexOf(world.phase)<target) throw new Error("A época escolhida ainda não foi atingida.");
  } catch(e) { put("po-error",e.message); }
  finally {seeking=false;draw();}
});
by("po-seed-form").addEventListener("submit",e=>{
  e.preventDefault();const input=by("po-seed"), raw=input.value.trim(), seed=Number(raw);
  if(!raw || !Number.isInteger(seed)||seed<0||seed>0xffffffff) {put("po-error","Escolha uma semente inteira entre 0 e 4294967295.");return;}
  const next=new PrimordialWorld({seed});archive.detach();replace(next);put("po-error","");
});
by("po-fork").addEventListener("click",async()=>{
  setRunning(false);
  try {await archive.forkWith(s=>PrimordialWorld.restore(s).branchWithoutSilicon().serialize(),"Controle sem silício");}
  catch(e){put("po-error",e.message || "O ramo sem silício não foi criado.");}
});
by("po-compare").addEventListener("click",async()=>{
  if(compare){
    compareSession++; compare=null; by("po-comparison").hidden=true;put("po-compare-status","");put("po-compare","Comparar desde a origem");return;
  }
  const session=++compareSession, seed=world.seed, target=world.tick;
  setRunning(false); put("po-compare","Cancelar comparação");
  const reference=new PrimordialWorld({seed}), control=new PrimordialWorld({seed,silicon:false});
  compare={reference,control,ready:false};
  try {
    while(reference.tick<world.tick){
      const until=performance.now()+12;
      do {reference.step();control.step();} while(reference.tick<world.tick && performance.now()<until);
      if(reference.tick<world.tick){
        put("po-compare-status","Reconstituindo a semente "+seed+" · passo "+num(reference.tick)+" de "+num(Math.max(target,world.tick))+".");
        await new Promise(resolve=>setTimeout(resolve,0)); if(session!==compareSession)return;
      }
    }
    if(session!==compareSession)return;
    compare.ready=true;by("po-comparison").hidden=false;
    put("po-compare-status","Semente "+seed+" · trajetórias pareadas desde o passo 0.");
    put("po-compare","Fechar comparação");updateComparison();
  } catch (e) {compare=null;put("po-compare","Comparar desde a origem");put("po-compare-status",e.message || "Falhou a comparação.");}
  finally {if(session===compareSession)by("po-compare").disabled=false;}
});
function frame(now){
  if(running && !document.hidden) {
    if(previous!==null) elapsed+=Math.min(400,now-previous);
    while(elapsed>=290){try{step();}catch(e){setRunning(false);put("po-error",e.message);break;}elapsed-=290;}
  }
  previous=now;
  if(dirty) draw();
  requestAnimationFrame(frame);
}
document.addEventListener("visibilitychange",()=>{previous=null;elapsed=0;});
new ResizeObserver(()=>{dirty=true;}).observe(by("po-canvas"));
setRunning(true);
try {
  const returning = readEvolutionOrigin() || getOriginReturn();
  if (returning) replace(PrimordialWorld.restore(returning));
} catch (error) {
  setRunning(false);
  put("po-error", error.message || "A amostra desta aba expirou.");
}
draw();requestAnimationFrame(frame);

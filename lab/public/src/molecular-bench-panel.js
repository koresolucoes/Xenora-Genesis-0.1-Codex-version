import {getCurrentSpecies,getReactionBenchReport} from './reaction-bench.js';

const n=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('pt-BR',{maximumFractionDigits:d}):'—';
const precise=v=>Number.isFinite(v)&&v!==0&&Math.abs(v)<1e-7?v.toExponential(3).replace('.',','):n(v,9);
const fs=v=>n(v,3)+' fs';
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const eventType={association:'Associação',dissociation:'Dissociação',rearrangement:'Rearranjo'};
const fragment=(kind,id,label)=>'<button type="button" class="pw-token" data-mb-inspect="'+kind+'" data-id="'+id+'">'+escape(label)+'</button>';
const rows=entries=>entries.map(([title,value])=>'<div><dt>'+title+'</dt><dd>'+value+'</dd></div>').join('');
const tokenIds=(ids,atoms)=>ids.map(id=>fragment('particle',id,(atoms.get(id)?.element??'')+' #'+id)).join('');
const identity=(s)=>s.key??'unresolved:'+s.instances[0].members.join(',');
const instanceKey=i=>i.members.join(',');

function writeCSV(world,report) {
  const headers=['semente','inicio_passo','fim_passo','janela_inicio_fs','janela_fim_fs','estrutura_reacao','tipo','equacao','ocorrencias','primeiro_passo','ultimo_passo','janela_persistencia_fs','atingiram','terminaram_antes','censurados_antes'];
  const lines=[headers];
  for(const g of report.groups){
    for(const w of g.persistence)lines.push([world.seed,report.startTick,report.tick,report.windowFromFs,report.windowToFs,g.key,g.type,g.equation,g.occurrences,g.firstTick,g.lastTick,w.windowFs,w.reached,w.endedBefore,w.censoredBefore]);
  }
  const text=lines.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(';')).join('\r\n');
  const href=URL.createObjectURL(new Blob(['\ufeff',text],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=href;a.download='xenora-reacoes-'+world.seed+'-passo-'+world.tick+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
}

export function mountMolecularBench(root,{inspect}) {
  root.classList.add('pw-bench');
  root.innerHTML=`
    <div class="pw-panel-block"><h2>Bancada molecular</h2><p id="mb-coverage" class="mb-current"></p>
      <h3>Espécies no recipiente</h3><p>Átomos e ordens de ligação distinguem estruturas com a mesma fórmula.</p>
      <label>Estrutura atual<select id="mb-species"></select></label><div id="mb-species-detail">
      <label>Ocorrência no campo<select id="mb-instance"></select></label><div id="mb-instance-detail"></div></div>
      <details><summary>Identidade estrutural</summary><p id="mb-key" class="mb-key"></p></details></div>
    <div class="pw-panel-block"><h3>Transformações agrupadas</h3><p id="mb-window"></p>
      <div id="mb-reactions"><label>Reagentes e produtos<select id="mb-reaction"></select></label><div id="mb-reaction-detail"></div></div>
      <details><summary>Eventos recentes</summary><ol id="mb-recent" class="mb-checks"></ol></details>
      <button type="button" id="mb-export">Baixar tabela de reações</button></div>
    <div class="pw-panel-block"><h3>Ensaios de referência</h3><p>Duas amostras de referência medem H₂ e H₂O em recipientes próprios.</p>
      <button type="button" id="mb-reference">Medir H₂ e H₂O</button><p id="mb-reference-status" role="status"></p><div id="mb-reference-result"></div></div>`;
  const q=sel=>root.querySelector(sel);
  const speciesSelect=q('#mb-species'),instanceSelect=q('#mb-instance'),reactionSelect=q('#mb-reaction');
  const memo=new WeakMap();
  let currentWorld=null,catalog=[],report=null,atomById=new Map(),lastObserver=null;
  let speciesLabels=new Map(),reactionLabels=new Map(),choseSpecies=false,sawMolecule=false;
  function html(node,value) {
    if(memo.get(node)===value)return;
    const open=[...node.querySelectorAll('details')].map(details=>details.open);
    node.innerHTML=value;
    if(open.length)[...node.querySelectorAll('details')].forEach((details,index)=>{details.open=!!open[index];});
    memo.set(node,value);
  }
  function choices(node,entries,empty) {
    const old=node.value;
    const markup=entries.map(({value,label})=>'<option value="'+escape(value)+'">'+escape(label)+'</option>').join('');
    html(node,markup||'<option value="">'+empty+'</option>');
    node.disabled=entries.length===0;
    node.value=entries.some(e=>e.value===old)?old:(entries[0]?.value??'');
  }
  function speciesName(s) {
    if(s.status!=='exact')return s.formula+' · identidade inconclusiva';
    if(!speciesLabels.has(s.key))speciesLabels.set(s.key,speciesLabels.size+1);
    return s.formula+' · espécie '+speciesLabels.get(s.key);
  }
  function paintInstance() {
    const s=catalog.find(item=>identity(item)===speciesSelect.value),i=s?.instances.find(item=>instanceKey(item)===instanceSelect.value);
    if(!i){html(q('#mb-instance-detail'),'');return;}
    const m=i.id==null?null:currentWorld.observer.molecules.find(item=>item.id===i.id);
    const lines=[['Ocorrências desta espécie',n(s.count)],['Átomos nesta ocorrência',n(i.members.length)]];
    if(m)lines.push(['Mesma estrutura há',n(m.structureAge,0)+' passos']);
    const open=m?fragment('cluster',m.id,'Inspecionar molécula #'+m.id):'';
    html(q('#mb-instance-detail'),'<dl class="pw-data">'+rows(lines)+'</dl><div class="mb-molecule">'+open+'<div class="mb-atoms">'+tokenIds(i.members,atomById)+'</div></div>');
  }
  function paintSpecies() {
    const s=catalog.find(item=>identity(item)===speciesSelect.value);
    q('#mb-species-detail').hidden=!s;
    q('#mb-key').textContent=s?(s.key??'O limite da busca impediu determinar uma identidade exata. Esta ocorrência está listada individualmente.'):'Sem espécie no recipiente.';
    choices(instanceSelect,(s?.instances??[]).map(i=>({value:instanceKey(i),label:i.id==null?'Átomo livre #'+i.members[0]:'Molécula #'+i.id+' · '+i.members.length+' átomos'})),'Sem ocorrência');
    paintInstance();
  }
  function paintReaction() {
    const g=report.groups.find(item=>item.key===reactionSelect.value);
    if(!g){html(q('#mb-reaction-detail'),'<p>Aguardando uma transformação com identidades estruturais resolvidas.</p>');return;}
    const examples=g.evidence.map(e=>{
      const changes=e.bondChanges.map(([a,b,before,after])=>'#'+a+'–'+b+' · ordem '+before+' → '+after).join(', ');
      return '<li><b>Passo '+n(e.tick,0)+'</b><p>'+escape(changes)+'</p><div class="mb-atoms">'+tokenIds(e.atomIds,atomById)+'</div></li>';
    }).join('');
    const survival=g.persistence.map(w=>'<tr><td>'+fs(w.windowFs)+'</td><td>'+n(w.reached,0)+'</td><td>'+n(w.endedBefore,0)+'</td><td>'+n(w.censoredBefore,0)+'</td></tr>').join('');
    const terms=side=>side.map(t=>'<p>'+n(t.count,0)+' × '+escape(t.formula)+'<code class="mb-key">'+escape(t.key)+'</code></p>').join('');
    const residence=g.residence;
    const durationRows=[['Produtos cuja observação terminou',n(residence.completedCount,0)],['Duração média completa',residence.completedCount?fs(residence.completedMeanFs):'Ainda sem duração completa'],
      ['Produtos ainda em observação',n(residence.ongoingCount,0)],['Maior duração ainda em curso',residence.ongoingCount?'Pelo menos '+fs(residence.ongoingMaxFs):'Nenhum']];
    const products=g.recentProducts.map(product=>'<li><b>'+escape(product.formula)+'</b> · '+(product.endedTick==null?'desde o passo '+product.formedTick:'passos '+product.formedTick+' a '+product.endedTick)+' · '+fs(product.observedFs)+'<div class="mb-atoms">'+tokenIds(product.members,atomById)+'</div></li>').join('');
    html(q('#mb-reaction-detail'),'<p class="mb-reaction"><b>'+escape(g.equation)+'</b><small>'+escape(eventType[g.type]??g.type)+' · '+n(g.occurrences,0)+' ocorrência(s) · passos '+n(g.firstTick,0)+' a '+n(g.lastTick,0)+'</small></p>'+
      '<div class="mb-result"><h4>Persistência dos produtos</h4><p class="mb-note">Cada produto molecular é seguido pelos mesmos átomos e ligações. Censura indica que o produto seguia em observação no fim da janela, antes de alcançar o prazo.</p>'+
      '<table><thead><tr><th>Prazo</th><th>Atingiu</th><th>Cessou</th><th>Censura</th></tr></thead><tbody>'+survival+'</tbody></table><details><summary>Duração observada dos produtos</summary><dl class="pw-data">'+rows(durationRows)+'</dl><ul class="mb-checks">'+products+'</ul></details></div>'+
      '<details><summary>Amostras das mudanças de ligação</summary><ul class="mb-checks">'+examples+'</ul></details><details><summary>Estruturas da transformação</summary><h4>Reagentes</h4>'+terms(g.reactants)+'<h4>Produtos</h4>'+terms(g.products)+'</details>');
  }
  function update(world) {
    if(currentWorld!==world){speciesLabels=new Map();reactionLabels=new Map();choseSpecies=false;sawMolecule=false;lastObserver=null;currentWorld=world;}
    if(world.observer===lastObserver)return;
    lastObserver=world.observer;
    atomById=new Map(world.particles.map(p=>[p.id,p]));
    catalog=getCurrentSpecies(world);report=getReactionBenchReport(world);
    const bonded=catalog.filter(s=>s.instances.some(i=>i.id!=null));
    const unresolved=bonded.filter(s=>s.status!=='exact').length;
    q('#mb-coverage').textContent='Semente '+world.seed+' · passo '+n(world.tick,0)+' · '+n(bonded.length-unresolved,0)+' espécies moleculares resolvidas'+(unresolved?' · '+n(unresolved,0)+' ocorrências inconclusivas':'')+'.';
    const displayed=[...catalog].sort((a,b)=>Number(b.instances[0].id!=null)-Number(a.instances[0].id!=null)||b.count-a.count||a.formula.localeCompare(b.formula));
    choices(speciesSelect,displayed.map(s=>({value:identity(s),label:speciesName(s)+' · '+n(s.count,0)+'×'})),'Recipiente vazio');
    if(!choseSpecies&&!sawMolecule&&bonded.length)speciesSelect.value=identity(displayed[0]);
    sawMolecule ||= bonded.length>0;
    paintSpecies();
    const base=Array.isArray(report.baselineMolecules)?report.baselineMolecules.length:report.baselineMolecules;
    q('#mb-window').textContent='Cobertura dos passos '+n(report.startTick,0)+' a '+n(report.tick,0)+' ('+fs(report.windowFromFs)+' a '+fs(report.windowToFs)+'). '+n(report.eventCount,0)+' transformações, '+n(report.silentTicks,0)+' passos sem transformação e '+n(report.unresolvedEvents,0)+' eventos de identidade inconclusiva.'+(base?' '+n(base,0)+' moléculas já existiam no início dessa cobertura.':'');
    choices(reactionSelect,report.groups.map(g=>{
      if(!reactionLabels.has(g.key))reactionLabels.set(g.key,reactionLabels.size+1);
      return {value:g.key,label:'R'+reactionLabels.get(g.key)+' · '+g.equation+' · '+n(g.occurrences,0)+'×'};
    }),'Nenhuma transformação agrupada');paintReaction();
    html(q('#mb-recent'),report.recentEvents.slice(-6).reverse().map(e=>'<li>Passo '+n(e.tick,0)+' · '+escape(e.equation)+(e.key?'':' · identidade inconclusiva')+'</li>').join('')||'<li>Nenhum evento nessa janela.</li>');
    q('#mb-export').disabled=!report.groups.length;
  }
  speciesSelect.addEventListener('change',()=>{choseSpecies=true;paintSpecies();});
  instanceSelect.addEventListener('change',paintInstance);reactionSelect.addEventListener('change',paintReaction);
  root.addEventListener('click',e=>{const btn=e.target.closest?.('[data-mb-inspect]');if(btn)inspect(btn.dataset.mbInspect,Number(btn.dataset.id));});
  q('#mb-export').addEventListener('click',()=>{if(report)writeCSV(currentWorld,report);});
  q('#mb-reference').addEventListener('click',async()=>{
    const button=q('#mb-reference'),status=q('#mb-reference-status');button.disabled=true;status.textContent='Medindo as moléculas de referência…';
    try{
      const result=await referenceMeasurement();
      renderReference(q('#mb-reference-result'),result);status.textContent='Medições de referência concluídas.';
    }catch(error){status.textContent='O ensaio de referência falhou. '+error.message;}
    finally{button.disabled=false;}
  });
  return {update};
}

async function referenceMeasurement() {
  if(typeof Worker!=='function'){
    const {runMolecularReference}=await import('./molecular-reference.js');
    return runMolecularReference();
  }
  const worker=new Worker(new URL('./molecular-reference-worker.js',import.meta.url),{type:'module'});
  return new Promise((resolve,reject)=>{
    worker.onmessage=e=>{worker.terminate();if(e.data.error)reject(new Error(e.data.error));else resolve(e.data.report);};
    worker.onerror=()=>{worker.terminate();reject(new Error('O cálculo da referência foi interrompido.'));};
    worker.postMessage('measure');
  });
}
function renderReference(root,result) {
  const p=result.protocol;
  const results=result.species.map(species=>{
    const measurements=species.measurements.map(m=>{
      const data=[['Referência',n(m.reference,5)+' '+escape(m.unit)],['Modelo',m.value==null?'Sem medida':n(m.value,5)+' '+escape(m.unit)],
        ['Erro absoluto',m.absoluteError==null?'Sem medida':n(m.absoluteError,5)+' '+escape(m.unit)],['Tolerância',n(m.tolerance,5)+' '+escape(m.unit)],['Resultado',escape(m.status)]];
      return '<li><b>'+escape(m.label)+'</b><dl class="pw-data">'+rows(data)+'</dl></li>';
    }).join('');
    const integration=species.integration;
    const runs=integration?.runs?.map(run=>'<tr><td>'+fs(run.dtFs)+'</td><td>'+n(run.completedCycles,0)+'</td><td>'+n(run.heldSteps,0)+' / '+n(run.integrationSteps,0)+'</td></tr>').join('');
    const runTable=species.formula==='H2'&&runs?'<table><thead><tr><th>Passo</th><th>Ciclos medidos</th><th>Subpassos estacionários</th></tr></thead><tbody>'+runs+'</tbody></table>':'';
    const numerical=integration?'<details><summary>Refinamento do passo de integração</summary><dl class="pw-data">'+rows([
      ['Passos internos',fs(integration.coarseDtFs)+' / '+fs(integration.fineDtFs)],
      ['Duração física comum',fs(integration.durationFs)],['Maior resíduo após projeção',precise(integration.maxEnergyErrorEv)+' eV'],['Maior correção acumulada por execução',precise(integration.maxCorrectionEv)+' eV'],['Diferença RMS dos comprimentos',precise(integration.radiusRmsDifferenceNm)+' nm']
    ])+'</dl>'+runTable+'</details>':'';
    return '<article class="mb-result"><h4>'+escape(species.formula)+' · '+escape(species.status)+'</h4><ul class="mb-checks">'+measurements+'</ul>'+numerical+
      (species.notes||[]).map(note=>'<p class="mb-note">'+escape(note)+'</p>').join('')+'</article>';
  }).join('');
  root.innerHTML='<p>'+escape(p.scope)+'</p><p>Trajetórias de '+fs(p.durationFs)+' com passos internos de '+fs(p.coarseDtFs)+' e '+fs(p.fineDtFs)+'.</p><p>'+escape(p.tolerances)+'</p>'+results;
  const details=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('ul');
  summary.textContent='Fontes das referências';
  for(const source of result.sources){
    const url=new URL(source.url);if(url.protocol!=='https:'&&url.protocol!=='http:')continue;
    const a=document.createElement('a'),li=document.createElement('li');a.href=url.href;a.textContent=source.label;li.append(a);list.append(li);
  }
  details.append(summary,list);root.append(details);
}

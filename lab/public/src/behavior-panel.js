import { exploreProbability } from './behavior-learning.js';
import { BEHAVIOR_TRIAL_STEPS, createBehaviorTrial } from './behavior-trial.js';

const percent = new Intl.NumberFormat('pt-BR', {style:'percent', maximumFractionDigits:1});
const value = new Intl.NumberFormat('pt-BR', {maximumFractionDigits:3, signDisplay:'exceptZero'});
const count = new Intl.NumberFormat('pt-BR', {maximumFractionDigits:0});
const format = (x, formatter) => Number.isFinite(x) ? formatter.format(x) : '—';
const contexts = ['Escasso', 'Abundante'];

// Visits count updates to this individual's action values, not all decisions
// in the population. A disabled learner can make decisions without any visits.
export function individualLearning(world, id) {
  const organism = world.organisms.find(cell => cell.id === id);
  if (!organism) {
    const state = world.organisms.length ? (id == null ? 'unselected' : 'absent')
      : world.founderCount === 0 ? 'sterile' : 'extinct';
    return {state, id};
  }
  const {memory} = organism;
  const learning = world.controls.learningEnabled;
  return {
    state:'present', id, allele:organism.genome.allele, learning,
    visits:memory.visits.reduce((a,b)=>a+b,0),
    contexts:contexts.map((label,i)=>({
      label, stay:{score:memory.values[i*2],n:memory.visits[i*2]},
      explore:{score:memory.values[i*2+1],n:memory.visits[i*2+1]},
      probability:exploreProbability(memory,i,learning)
    }))
  };
}

export function pairedRewardDifference(outcome) {
  const a=outcome.learner.meanReward, b=outcome.control.meanReward;
  return Number.isFinite(a) && Number.isFinite(b) ? a-b : null;
}

function textNode(tag, text) {
  const element=document.createElement(tag);
  element.textContent=text;
  return element;
}

function memoryRow(row) {
  const tr=document.createElement('tr');
  const heading=textNode('th',row.label); heading.scope='row'; tr.append(heading);
  for(const action of [row.stay,row.explore]) {
    const td=document.createElement('td');
    td.append(textNode('span',action.n ? format(action.score,value) : '—'),
      textNode('small','n='+count.format(action.n)));
    tr.append(td);
  }
  tr.append(textNode('td',percent.format(row.probability)));
  return tr;
}

function contextRate(result) {
  return format(result.exploreRate,percent)+' · n='+count.format(result.decisions);
}

const metrics = [
  ['Decisões (n)', a=>count.format(a.decisions)],
  ['Recompensa por decisão', a=>format(a.meanReward,value)],
  ['Recompensa acumulada', a=>format(a.reward,value)],
  ['Explorou · escasso', a=>contextRate(a.contexts[0])],
  ['Explorou · abundante', a=>contextRate(a.contexts[1])]
];

function csv(outcome) {
  const header='semente,passo_inicial,passo_final,grupo,contexto,decisoes,exploracoes,fracao_exploracao,recompensa_acumulada_do_grupo,recompensa_media_do_grupo,atualizacoes_do_grupo,populacao_final';
  const lines=[header];
  for(const [name,arm] of [['aprende',outcome.learner],['controle',outcome.control]]) {
    arm.contexts.forEach((c,i)=>lines.push([outcome.seed,outcome.start,outcome.start+outcome.steps,name,
      i?'abundante':'escasso',c.decisions,c.explores,c.exploreRate,arm.reward,arm.meanReward,arm.updates,arm.population].join(',')));
  }
  return lines.join('\n')+'\n';
}

export function mountBehaviorPanel(element, getWorld, getSelected = () => getWorld()?.organisms[0]?.id) {
  element.classList.add('behavior-panel');
  element.innerHTML=`<section class="bh-individual" aria-label="Memória individual">
    <h2 data-b="organism">Memória individual</h2><p data-b="individual-state"></p>
    <div data-b="memory" hidden><table aria-label="Memória individual por contexto de nutriente">
      <thead><tr><th scope="col">Nutriente</th><th scope="col">Ficar</th><th scope="col">Explorar</th><th scope="col">Chance de explorar</th></tr></thead><tbody></tbody></table>
      <p class="bh-note">Cada valor estima a recompensa da ação (−1 a +1), que combina o saldo de energia e a matéria incorporada. n conta atualizações da memória. Escasso significa menos de 0,6 de nutriente local.</p>
    </div><p class="bh-world" data-b="live"></p></section>
    <section class="bh-trial" aria-label="Comparação pareada">
      <h3>Aprender muda o resultado?</h3>
      <p>Duas cópias começam com a memória zerada. Em uma, as decisões atualizam a memória. No controle, a chance de explorar permanece em 50%.</p>
      <div class="behavior-actions"><button type="button" data-b="run">Comparar por ${BEHAVIOR_TRIAL_STEPS} passos</button><button type="button" data-b="cancel" hidden>Cancelar</button></div>
      <p class="bh-note" data-b="status" role="status" aria-live="polite"></p>
      <div data-b="results" hidden><p class="bh-result" data-b="difference"></p>
        <table aria-label="Resultados da comparação"><thead><tr><th scope="col">Medida</th><th scope="col">Aprende</th><th scope="col">Controle</th></tr></thead><tbody></tbody></table>
        <button type="button" class="bh-download" data-b="download">Baixar CSV deste ensaio</button>
      </div></section>`;
  const field = key=>element.querySelector('[data-b="'+key+'"]');
  const memory=field('memory'), results=field('results');
  let job=0, worker=null, active=false, result=null, previousWorld=null, previousKey='';
  function controls() {
    field('run').disabled=active || !getWorld()?.organisms.length;
    field('cancel').hidden=!active;
  }
  function release() {
    worker?.terminate();worker=null;active=false;controls();
  }
  function reset() {
    job++;release();result=null;results.hidden=true;
    field('status').textContent='';previousWorld=null;previousKey='';
  }
  function update() {
    const w=getWorld();
    if (!w) return;
    const id=getSelected()??null;
    const key=[w.tick,id,w.controls.learningEnabled].join('|');
    if(previousWorld===w && previousKey===key) return;
    previousWorld=w;previousKey=key;
    const individual=individualLearning(w,id), m=w.getMetrics();
    field('live').textContent='Mundo · '+count.format(m.behaviorDecisions)+' decisões · recompensa acumulada '+format(m.behaviorRewardTotal,value)+'.';
    memory.hidden=individual.state!=='present';
    if (individual.state==='present') {
      field('organism').textContent='Memória do organismo '+individual.id;
      let info='Alelo térmico '+individual.allele+' herdado. ';
      if (!individual.learning) info+='Aprendizagem desligada. A chance de explorar é fixa.';
      else if (!individual.visits) info+='Sem experiências registradas. Ambas as ações começam com valor zero.';
      else info+='Esta memória foi adquirida em vida. Cada descendente começa com memória vazia.';
      field('individual-state').textContent=info;
      memory.querySelector('tbody').replaceChildren(...individual.contexts.map(memoryRow));
    } else {
      const labels={
        sterile:['Mundo sem fundadores','Não há organismos para tomar decisões.'],
        extinct:['População extinta','Os totais do mundo preservam as decisões anteriores.'],
        absent:['Organismo fora do mapa','Selecione um indivíduo vivo no mapa para consultar a memória.'],
        unselected:['Selecione um organismo','Clique em um indivíduo no mapa para consultar sua memória.']
      };
      const [heading,description]=labels[individual.state];
      field('organism').textContent=heading;field('individual-state').textContent=description;
    }
    controls();
  }
  function complete(outcome) {
    release();result=outcome;
    const delta=pairedRewardDifference(outcome);
    const direction=delta>0 ? 'maior' : 'menor';
    field('difference').textContent=delta===null ? 'Sem decisões suficientes para calcular a diferença.' :
      delta===0 ? 'A recompensa média foi igual nos dois mundos deste par.' :
      'Recompensa média '+direction+' com aprendizagem neste par. Diferença (aprende − controle) '+format(delta,value)+' por decisão.';
    const body = results.querySelector('tbody');
    body.replaceChildren(...metrics.map(([label,measure])=>{
      const row=document.createElement('tr'), heading=textNode('th',label);heading.scope='row';
      row.append(heading,textNode('td',measure(outcome.learner)),textNode('td',measure(outcome.control)));
      return row;
    }));
    results.hidden=false;
    field('status').textContent='1 par de mundos · semente '+outcome.seed+' · passos '+outcome.start+' a '+(outcome.start+outcome.steps)+'. O n de cada contexto conta decisões.';
  }
  function fail() { release();field('status').textContent='Não foi possível concluir o ensaio a partir deste estado.'; }
  function progress(n) { field('status').textContent='Comparando os mundos · '+n+'/'+BEHAVIOR_TRIAL_STEPS; }
  field('run').onclick=async()=>{
    if(active || !getWorld()?.organisms.length)return;
    reset();const current=job;active=true;controls();progress(0);
    try {
      const snapshot=getWorld().serialize();
      if (typeof Worker==='function') {
        worker=new Worker(new URL('./behavior-trial.js',import.meta.url),{type:'module'});
        worker.onmessage=({data})=>{
          if(job!==current)return;
          if(data.error)fail();else if(data.result)complete(data.result);else progress(data.steps);
        };
        worker.onerror=()=>{if(job===current)fail();};
        worker.postMessage(snapshot);return;
      }
      const trial=createBehaviorTrial(snapshot);
      for(let n=0;n<BEHAVIOR_TRIAL_STEPS;){
        await new Promise(resolve=>setTimeout(resolve,0));
        if(job!==current)return;
        const deadline=performance.now()+10;
        do {trial.step();n++;} while(n<BEHAVIOR_TRIAL_STEPS && performance.now()<deadline);
        progress(n);
      }
      complete(trial.result());
    } catch {if(job===current)fail();}
  };
  field('cancel').onclick=()=>{reset();field('status').textContent='Comparação interrompida.';update();};
  field('download').onclick=()=>{
    if(!result)return;
    const url=URL.createObjectURL(new Blob([csv(result)],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='xenora-aprendizagem-'+result.seed+'-'+result.start+'.csv';
    link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  update();
  return {update,reset};
}

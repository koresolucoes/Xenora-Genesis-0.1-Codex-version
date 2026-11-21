import { WATCH_LIMIT, WorldWatch, openWatchStore } from './world-watch-model.js';

const integer = new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 0});
const decimal = new Intl.NumberFormat('pt-BR', {maximumFractionDigits: 2});
const signed = x => (x > 0 ? '+' : '') + integer.format(x);

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

function action(label, intent, id) {
  const btn = element('button', 'ww-btn', label);
  btn.type = 'button';
  btn.dataset.wwAction = intent;
  if (id) btn.dataset.card = id;
  return btn;
}

function edgeDescription(edge, parentName) {
  const step='Passo '+integer.format(edge.tick)+' de '+parentName+' · ';
  switch(edge.action) {
    case 'control': return step+'luz mantida em '+decimal.format(edge.to)+'×';
    case 'light': return step+'luz de '+decimal.format(edge.from)+'× para '+decimal.format(edge.to)+'×';
    case 'open': return step+'cópia aberta no mapa';
    case 'fork': return step+'bifurcação com as condições de origem';
    case 'capture': return step+'cópia do estado do mapa';
    default: return step+'intervenção não registrada';
  }
}

function drawRelations(list,panel,relations) {
  const children=new Map(), roots=[];
  for(const node of relations.values()) {
    if(!node.parent)roots.push(node);
    else {
      if(!children.has(node.parent.id))children.set(node.parent.id,[]);
      children.get(node.parent.id).push(node);
    }
  }
  const lines=document.createDocumentFragment();
  const stack=roots.reverse().map(node=>({node,depth:0}));
  while(stack.length) {
    const {node,depth}=stack.pop();
    const current=node.id===panel.focusId, card=panel.entries.get(node.id);
    const row=element('li','ww-node');
    row.dataset.wwNode=node.id;
    if(node.parent)row.dataset.wwParent=node.parent.id;
    if(current)row.setAttribute('aria-current','true');
    row.style.setProperty('--ww-level',Math.min(depth,4));
    const label=card ? action(node.name,'open',node.id) : element('strong','ww-node-name',node.name);
    if(card) {
      label.classList.add('ww-node-link');
      label.setAttribute('aria-label','Abrir '+node.name+' no mapa');
    }
    const title=element('div','ww-node-title');
    title.append(label);
    if(current)title.append(element('span','ww-focus-label','Foco atual do mapa'));
    else if(!card)title.append(element('span','ww-node-role',node.kind==='map'?'Mapa anterior':
      node.kind==='reference'?'Origem referenciada':'Cartão retirado'));
    row.append(title);
    let detail;
    if(node.parent)detail=edgeDescription(node.parent,relations.get(node.parent.id).name);
    else if(node.kind==='seed')detail='Mundo independente';
    else if(node.kind==='map')detail='Mundo de origem do mapa';
    else detail='Sem origem anterior registrada';
    if(!node.parent && Number.isInteger(node.seed))detail+=' · semente '+node.seed;
    row.append(element('span','ww-node-description',detail));
    if(node.lightChange){
      const change=node.lightChange;
      row.append(element('span','ww-node-description','Última alteração de luz no passo '+integer.format(change.tick)+
        ' · '+decimal.format(change.from)+'× para '+decimal.format(change.to)+'×'));
    }
    lines.append(row);
    for(const child of [...(children.get(node.id) || [])].reverse())stack.push({node:child,depth:depth+1});
  }
  list.replaceChildren(lines);
}

function makeCard(id) {
  const card = element('article','ww-card');
  card.dataset.worldWatchCard = id;
  const top = element('div','ww-title');
  const title = element('h3');
  const status = element('span','ww-state');
  top.append(title, status);
  const ancestry = element('p','ww-origin');
  const info = element('dl','ww-stats');
  const measures = {};
  for (const [key, label] of [['tick','Passo'],['population','População'],['lineages','Linhagens vivas'],['temp','Temperatura média']]) {
    const pair = element('div'); const value = element('dd');
    pair.append(element('dt','',label),value); info.append(pair); measures[key] = value;
  }
  const trace = element('p','ww-trace');
  const lightLabel = element('label','ww-light','Intensidade de luz');
  const select = element('select'); select.dataset.wwLight = id;
  for (const [value,label] of [[0,'0×'],[0.25,'0,25×'],[0.5,'0,5×'],[0.75,'0,75×'],[1,'1×'],[1.5,'1,5×'],[2,'2×']]) {
    const opt = element('option','',label); opt.value = String(value); select.append(opt);
  }
  lightLabel.append(select);
  const buttons = element('div','ww-actions');
  const play = action('Rodar','play',id), step = action('+1 passo','step',id);
  buttons.append(play,step,action('Abrir no foco','open',id),action('Bifurcar','fork',id),action('Renomear','rename',id),action('Retirar','remove',id));
  card.append(top,ancestry,info,trace,lightLabel,buttons);
  return {card,title,status,ancestry,trace,select,measures,play,step};
}

export function mountWorldWatch(root, {getWorld, openWorld, getRemoteReference = () => null, storeFactory = openWatchStore}) {
  if (!root) return {refresh(){},clearFocus(){},getFocusLabel(){return null;},destroy(){}};
  root.classList.add('ww-panel');
  root.innerHTML = `<header class="ww-header"><div><h2>Origens e ramos</h2><p>Selecione o nome de uma execução acompanhada para abrir uma cópia no mapa.</p></div><span class="ww-count" data-ww="count"></span></header>
    <ol class="ww-tree" data-ww="tree" aria-label="Relações entre mundos e foco atual"></ol>
    <div class="ww-setup"><label>Nome do mundo ou ramo<input data-ww="name" type="text" maxlength="56" placeholder="Ex. Lagoa de referência"></label>
      <label>Semente<input data-ww="seed" type="number" min="0" max="4294967295" step="1" value="42"></label>
      <div class="ww-actions" data-ww="add"></div></div>
    <div class="ww-controls"><div class="ww-actions" data-ww="all"></div><span class="ww-save" data-ww="save"></span></div>
    <div class="ww-grid" data-ww="list"></div><p class="ww-empty" data-ww="empty">Compare a mesma população com duas intensidades de luz ou acompanhe mundos de sementes diferentes.</p>
    <div class="ww-bottom"><p data-ww="notice" role="status" aria-live="polite"></p></div>`;
  const find = key => root.querySelector('[data-ww="'+key+'"]');
  const nameInput = find('name'), seedInput = find('seed'), grid = find('list');
  const add = find('add'), controls = find('all'), notice = find('notice'), saveStatus = find('save');
  const capture = action('Acompanhar foco','capture'), fresh = action('Criar por semente','new');
  const compare = action('Comparar luz em dois ramos','pair'); compare.classList.add('ww-primary');
  add.append(compare,capture,fresh);
  const go = action('Rodar todos','go'), stop = action('Pausar todos','stop'), batch = action('+5 passos em todos','batch');
  controls.append(go,stop,batch);
  const undo = action('Desfazer retirada','undo');
  undo.hidden = true; notice.parentNode.append(undo);
  const nodes = new Map();
  let panel = new WorldWatch(), store = null, ready = false, destroyed = false;
  let dirty = false, saving = null, saveTimer = null, timer = null, pendingRounds = 0;
  let unsavedRecoverable = false;
  let treeSignature='';
  const announce = text => { notice.textContent = text; };

  function draw() {
    const count = panel.entries.size;
    find('count').textContent = count+' / '+WATCH_LIMIT;
    find('empty').hidden = count > 0;
    capture.disabled = fresh.disabled = !ready || count >= WATCH_LIMIT;
    compare.disabled = !ready || count > WATCH_LIMIT - 2;
    go.disabled = stop.disabled = batch.disabled = !ready || count === 0;
    undo.hidden = !panel.removed;
    undo.disabled = count >= WATCH_LIMIT;
    const relations=panel.relations();
    const signature=JSON.stringify([[...relations.values()],[...panel.entries.keys()],panel.focusId]);
    if(treeSignature!==signature) {
      drawRelations(find('tree'),panel,relations);
      treeSignature=signature;
    }
    for (const [id, view] of nodes) {
      if (!panel.entries.has(id)) { view.card.remove(); nodes.delete(id); }
    }
    for (const entry of panel.entries.values()) {
      let view = nodes.get(entry.id);
      if (!view) { view = makeCard(entry.id); nodes.set(entry.id,view); grid.append(view.card); }
      const world = entry.world, m = world.getMetrics();
      const focussed = panel.node(panel.focusId)?.parent?.id===entry.id;
      view.card.classList.toggle('ww-focused',focussed);
      view.title.textContent = entry.name;
      view.status.textContent = entry.playing ? 'Rodando' : 'Em pausa';
      view.status.classList.toggle('ww-running',entry.playing);
      view.ancestry.textContent = 'Semente '+world.seed+(focussed ? ' · Cartão de origem do mapa atual' : '');
      view.measures.tick.textContent = integer.format(world.tick);
      view.measures.population.textContent = integer.format(m.population)+' ('+signed(m.population-entry.base.population)+')';
      view.measures.lineages.textContent = integer.format(m.livingLineages)+' ('+signed(m.livingLineages-entry.base.livingLineages)+')';
      view.measures.temp.textContent = Number.isFinite(m.meanTemperatureK) ? decimal.format(m.meanTemperatureK)+' K' : '—';
      view.trace.textContent = 'Variações desde o passo '+integer.format(entry.base.tick)+
        (entry.remote ? ' · Origem no arquivo, revisão '+entry.remote.revision+(entry.remote.tick !== null ? ', passo '+integer.format(entry.remote.tick) : '') : '')+'.';
      const light = Number(world.environment.lightForcing);
      if (Number.isFinite(light)) {
        const str = String(Number(light.toFixed(5)));
        if (![...view.select.options].some(option => option.value === str)) {
          const opt = element('option','',decimal.format(light)+'×'); opt.value = str; view.select.append(opt);
        }
        view.select.value = str;
      }
      view.play.textContent = entry.playing ? 'Pausar' : 'Rodar';
      view.play.setAttribute('aria-pressed', String(entry.playing));
      view.card.querySelector('[data-ww-action="fork"]').disabled = count >= WATCH_LIMIT;
    }
  }

  function markDirty(now = false) {
    dirty = true;
    if (!store || unsavedRecoverable || destroyed) return;
    if (now && saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (now) void persist();
    else if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; void persist(); }, 3200);
  }

  async function persist() {
    if (!store || !dirty || unsavedRecoverable) return;
    if (saving) { await saving; if (dirty) return persist(); return; }
    dirty = false;
    const record = panel.checkpoint();
    saving = Promise.resolve().then(() => store.write(record)).then(() => {
      if (!destroyed) saveStatus.textContent = 'Painel salvo neste navegador';
    }).catch(err => {
      dirty = true; unsavedRecoverable = true;
      if (!destroyed && err?.message?.startsWith('Outra aba')) announce(err.message);
      if (!destroyed) saveStatus.textContent = 'Não foi possível salvar. Os cartões continuam nesta aba.';
    }).finally(() => { saving = null; });
    await saving;
  }

  const pauseAll = () => { for (const item of panel.entries.values()) item.playing = false; };
  function schedule() {
    if (destroyed || timer || (!pendingRounds && ![...panel.entries.values()].some(x=>x.playing))) return;
    timer = setTimeout(() => {
      timer = null;
      if (destroyed) return;
      const batchStep = pendingRounds > 0;
      const active = [...panel.entries.values()].filter(x=>batchStep || x.playing).map(x=>x.id);
      try {
        panel.advance(active);
        if (batchStep) pendingRounds--;
        markDirty(); draw();
      } catch (err) {
        pauseAll(); pendingRounds=0; announce(err.message); draw();
      }
      schedule();
    },pendingRounds ? 30 : 300);
  }

  function consumeName() { return nameInput.value.trim(); }
  function clearName() { nameInput.value = ''; }
  function onClick(event) {
    const button = event.target.closest('[data-ww-action]');
    if (!button || !root.contains(button) || !ready || button.disabled) return;
    const id = button.dataset.card, intent = button.dataset.wwAction;
    try {
      switch (intent) {
        case 'capture': panel.capture(getWorld(),consumeName(),getRemoteReference()); clearName(); announce('Cópia do foco adicionada.'); break;
        case 'new': {
          const value=seedInput.value.trim(); if(!value) throw new Error('Informe uma semente.');
          panel.create(Number(value),consumeName()); clearName(); announce('Novo mundo adicionado.'); break;
        }
        case 'pair': panel.pair(getWorld(),consumeName(),getRemoteReference()); clearName(); announce('Os dois ramos estão rodando. A intensidade de luz difere entre eles.'); break;
        case 'go': for(const item of panel.entries.values()) item.playing=true; break;
        case 'stop': pauseAll(); pendingRounds=0; announce('Todas as execuções estão em pausa.'); break;
        case 'batch': pendingRounds=Math.min(10,pendingRounds+5); announce('Avançando cinco passos em cada execução.'); break;
        case 'play': { const card=panel.get(id); card.playing=!card.playing; break; }
        case 'step': panel.advance([id]); break;
        case 'open': {
          const copy=panel.open(id); openWorld(copy);
          announce('O mapa principal recebeu uma cópia independente de '+panel.get(id).name+'.'); break;
        }
        case 'fork': panel.fork(id,consumeName()); clearName(); announce('Ramo criado no passo atual do cartão.'); break;
        case 'rename': {
          const n=consumeName();
          if(!n) { nameInput.focus(); announce('Preencha o campo Nome e clique em Renomear neste cartão.'); return; }
          panel.get(id).name=n.slice(0,56); clearName(); break;
        }
        case 'remove': panel.remove(id); announce('Cartão retirado do painel local.'); break;
        case 'undo': panel.undoRemove(); announce('Cartão restaurado em pausa.'); break;
        default: return;
      }
      markDirty(true); draw(); schedule();
    } catch (err) { announce(err.message); }
  }
  function onChange(event) {
    const el=event.target, id=el.dataset.wwLight;
    if (!id || !ready) return;
    try {
      panel.setLight(id,Number(el.value));
      markDirty(true); draw(); announce('Intensidade de luz atualizada neste cartão.');
    } catch(err) { announce(err.message); }
  }
  function hidden() {
    if (document.visibilityState==='hidden') void persist();
  }
  root.addEventListener('click',onClick); root.addEventListener('change',onChange);
  document.addEventListener('visibilitychange',hidden);
  globalThis.addEventListener?.('pagehide',persist);
  panel.bindFocus(getWorld());
  draw();
  const loaded = (async()=>{
    try {
      const opened=await storeFactory();
      if (destroyed) { opened.close(); return; }
      const recovered = await opened.read();
      if (destroyed) { opened.close(); return; }
      panel=WorldWatch.restore(recovered); store=opened;
      saveStatus.textContent = recovered ? 'Painel retomado em pausa' : 'Salvamento local';
    } catch {
      saveStatus.textContent='Armazenamento local indisponível. Os cartões permanecem nesta aba.';
    } finally {
      if (!destroyed) { panel.bindFocus(getWorld()); ready=true; draw(); }
    }
  })();
  return {
    ready:loaded, refresh:draw,
    clearFocus(){ panel.bindFocus(getWorld()); if(ready)markDirty(true); draw(); },
    getFocusOrigin(){
      const edge=panel.node(panel.focusId)?.parent;
      if (!edge) return null;
      const parent=panel.node(edge.id);
      const branch=parent?.parent;
      if (edge.action==='open' && branch) {
        return parent.name+' · '+edgeDescription(branch,panel.node(branch.id)?.name || branch.name)+'.';
      }
      return edgeDescription(edge,parent?.name || edge.name)+'.';
    },
    getFocusLabel(){ const parent=panel.node(panel.focusId)?.parent; return parent?.action==='open' ? panel.node(parent.id)?.name || parent.name : null; },
    async flush(){ await loaded; await persist(); },
    destroy(){
      destroyed=true; clearTimeout(timer); clearTimeout(saveTimer);
      root.removeEventListener('click',onClick); root.removeEventListener('change',onChange);
      document.removeEventListener('visibilitychange',hidden); globalThis.removeEventListener?.('pagehide',persist);
      void persist().finally(()=>store?.close());
    }
  };
}

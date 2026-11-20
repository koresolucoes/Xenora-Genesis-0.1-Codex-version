import {listRuns,listRevisions,openRevision,readObservations,newCapability,readKey,recoveryKey,makeOperation,writeOperation} from './archive-client.js';

function stored(area, key) {
  try { return globalThis[area]?.getItem(key) || ''; } catch { return ''; }
}

function store(area,key,value) {
  try {
    if (!globalThis[area]) return false;
    if (value === null) globalThis[area].removeItem(key);
    else globalThis[area].setItem(key,value);
    return true;
  } catch { return false; }
}

export function mountWorldArchive(root, {mode,getSnapshot,restoreSnapshot}) {
  if (!root) return {detach(){}, getRemoteReference(){return null;}, async forkWith(){return false;}};
  const localKey = 'xenora.archive.' + mode;
  const pendingKey = localKey + '.outbox';
  const primordial = mode === 'primordial';
  const evolving = mode === 'evolving-world';
  const files = primordial || evolving;
  root.classList.add('world-archive');
  root.innerHTML = `
    <div class="wa-head"><div><h2>Arquivo de mundos</h2><p>Salve uma revisão ou abra outro ramo para comparar sua evolução.</p></div>
    <button type="button" data-act="save" class="primary">Salvar revisão</button></div>
    <p class="wa-current" data-current></p>
    <details><summary>Chave e histórico de revisões</summary>
    <label>Chave de recuperação<input type="password" data-key spellcheck="false" autocomplete="off" placeholder="Identificador e código do mundo"></label>
    <div class="wa-actions"><button type="button" data-act="open">Abrir mundo</button><button type="button" data-act="copy">Copiar chave</button></div>
    <div class="wa-history" data-history hidden>
    <label>Ramo<select data-runs></select></label><p data-run-origin class="wa-current"></p><label>Revisão<select data-revisions></select></label>
    <div class="wa-actions"><button type="button" data-act="more" hidden>Mais revisões</button><button type="button" data-act="load">Restaurar revisão</button>
    <button type="button" data-act="fork">Bifurcar esta revisão</button></div>
    <label>Registros desta revisão<select data-view><option value="events">Acontecimentos</option>
    <option value="minerals">Origem dos minerais</option>
    ${primordial ? '<option value="quantities">Inventário dos elementos</option>' : '<option value="genealogy">Genealogia observada</option>'}
    <option value="samples">Medições do mundo</option></select></label>
    <div class="wa-actions"><button type="button" data-act="query">Consultar registros</button><button type="button" data-act="next-rows" hidden>Mais registros</button></div>
    <div data-observations class="wa-rows" aria-live="polite"></div></div>
    <label class="wa-auto"><input type="checkbox" data-auto> Salvar a cada 250 passos enquanto esta janela estiver aberta</label>
    </details>
    <div class="wa-actions"><button type="button" data-act="retry" hidden>Concluir envio pendente</button>
    ${files ? '<button type="button" data-act="export">Baixar arquivo JSON</button><button type="button" data-act="import">Abrir arquivo JSON</button><input data-file type="file" accept=".json,application/json" hidden>' : ''}</div>
    <p data-status role="status" class="wa-status"></p>`;
  const q = sel => root.querySelector(sel);
  const action = name => q('[data-act="' + name + '"]');
  const keyInput=q('[data-key]'), runSelect=q('[data-runs]'), revSelect=q('[data-revisions]');
  let attached=null, browse=null, busy=false, generation=0, lastPage=0, pending=null;
  let archivedTick=0, knownRuns=[], rowsAfter=null, archivedState=null;
  try { pending=JSON.parse(stored('sessionStorage',pendingKey) || 'null'); } catch { /* unreadable local draft */ }
  keyInput.value=stored('localStorage',localKey);
  if (pending?.key) keyInput.value=recoveryKey(pending.key.worldId,pending.key.token);
  const say = text => { q('[data-status]').textContent=text; };
  function refresh() {
    q('[data-current]').textContent=attached ? 'Ramo ' + attached.runId.slice(0,8) + ' · revisão ' + attached.revision + ' · passo salvo ' + archivedTick : 'Simulação local';
    action('retry').hidden=!pending;
    for (const el of root.querySelectorAll('button,select,input')) el.disabled=busy;
    if (!busy) {
      action('save').disabled=!!pending;
      if (pending) {action('fork').disabled=true;action('load').disabled=true;action('open').disabled=true;}
    }
  }
  function clearPending() {
    pending=null;
    store('sessionStorage',pendingKey,null);
  }
  function detach() {
    generation++;
    attached=null;archivedState=null;
    browse=null;
    q('[data-history]').hidden=true;
    q('[data-auto]').checked=false;
    refresh();
  }
  async function execute(fn) {
    if (busy) return false;
    busy=true;refresh();
    try { await fn();return true; }
    catch (error) {
      say(error.message === 'Failed to fetch' ? 'Conexão interrompida. Você pode repetir o envio.' : error.message);
      return false;
    } finally {busy=false;refresh();}
  }
  async function perform(op) {
    const now=generation;
    pending=op;
    store('sessionStorage',pendingKey,JSON.stringify(op));
    keyInput.value=recoveryKey(op.key.worldId,op.key.token);
    store('localStorage',localKey,keyInput.value);
    let result;
    try { result=await writeOperation(op); }
    catch (error) {
      if ([400,404,405,409,413,415,422].includes(error.status)) clearPending();
      if (error.status===409) q('[data-auto]').checked=false;
      throw error;
    }
    clearPending();
    if (now!==generation) throw new Error('A gravação anterior foi confirmada. A simulação em tela mudou.');
    attached={...op.key,runId:result.runId,revision:result.revision};
    archivedTick=result.tick;
    archivedState=op.body.checkpoint ? JSON.stringify(op.body.checkpoint) : null;
    return result;
  }
  async function save(snapshot=getSnapshot()) {
    if (pending) throw new Error('Conclua o envio pendente antes de salvar uma nova revisão.');
    if (attached) {
      return perform(makeOperation('append', {worldId:attached.worldId,token:attached.token},
        {mode,expectedRevision:attached.revision,checkpoint:snapshot},attached.runId));
    }
    const key=newCapability(), runId=crypto.randomUUID();
    return perform(makeOperation('create',key,{mode,worldId:key.worldId,runId,checkpoint:snapshot,
      label:(primordial ? 'Universo ' : evolving ? 'Mundo ' : 'Lagoa ') + (snapshot.seed ?? '')},runId));
  }
  function showOptions(node,items) {
    node.replaceChildren();
    for (const item of items) {
      const option=document.createElement('option');option.value=String(item.value);option.textContent=item.text;
      node.append(option);
    }
  }
  async function showRevisions(start=0) {
    clearRows();
    const runId=runSelect.value;
    const active=knownRuns.find(row=>row.runId===runId);
    const parent=knownRuns.find(row=>row.runId===active?.parentRunId);
    const origin=q('[data-run-origin]');
    if (active?.parentRunId) {
      const source=parent?.label || 'Ramo '+active.parentRunId.slice(0,8);
      origin.textContent='Ramo de '+source+' · revisão de origem '+active.parentRevision+'.';
    } else if (active) {
      origin.textContent='Primeira execução registrada neste mundo.';
    } else { origin.textContent=''; }
    const result=await listRevisions(browse,runId,start);
    if (!start) revSelect.replaceChildren();
    for (const row of result.revisions) {
      const opt=document.createElement('option');opt.value=String(row.revision);
      opt.textContent='Revisão '+row.revision+' · passo '+row.tick;
      revSelect.append(opt);
    }
    lastPage=result.nextAfter ?? result.revisions.reduce((n,row)=>Math.max(n,row.revision),start);
    const head=knownRuns.find(r=>r.runId===runId)?.revision||0;
    action('more').hidden=('nextAfter' in result) ? result.nextAfter == null : lastPage>=head || result.revisions.length===0;
    const wanted=attached?.runId===runId ? attached.revision : head;
    if ([...revSelect.options].some(o=>Number(o.value)===wanted)) revSelect.value=String(wanted);
  }
  async function showHistory(key,preferred) {
    knownRuns=[];
    let after=0;
    do {
      const result=await listRuns(key,after);
      knownRuns.push(...result.runs.filter(row=>row.mode===mode));
      if (!Number.isSafeInteger(result.nextAfter) || result.nextAfter<=after) break;
      after=result.nextAfter;
    } while (true);
    if (!knownRuns.length) throw new Error('Esta chave pertence a outro tipo de simulação.');
    browse=key;
    showOptions(runSelect,knownRuns.map(row=>({value:row.runId,text:(row.label||'Ramo')+' · '+row.runId.slice(0,8)+' · passo '+row.tick})));
    if (knownRuns.some(row=>row.runId===preferred)) runSelect.value=preferred;
    q('[data-history]').hidden=false;
    await showRevisions();
  }
  async function restore(key,runId,revision) {
    const result=await openRevision(key,runId,revision);
    if (result.mode!==mode) throw new Error('Arquivo de outro tipo de simulação.');
    restoreSnapshot(result.checkpoint);
    attached={...key,runId,revision};archivedTick=result.tick;archivedState=JSON.stringify(getSnapshot());
    keyInput.value=recoveryKey(key.worldId,key.token);
    store('localStorage',localKey,keyInput.value);
  }
  function bind(name,fn) {action(name)?.addEventListener('click',()=>execute(fn));}
  bind('save',async()=>{
    const r=await save();
    say('Revisão '+r.revision+' salva no Supabase. Guarde a chave de recuperação.');
    try {await showHistory(attached,attached.runId);}
    catch {say('Revisão '+r.revision+' salva. Para consultar o histórico, use Abrir mundo.');}
  });
  bind('open',async()=>{
    const key=readKey(keyInput.value);
    await showHistory(key,attached?.runId);
    const run=knownRuns.find(row=>row.runId===runSelect.value);
    await restore(key,run.runId,run.revision);
    say('Última revisão do ramo restaurada. Selecione uma revisão para consultar o passado.');
  });
  bind('load',async()=>{await restore(browse,runSelect.value,Number(revSelect.value));say('Revisão restaurada.');});
  bind('fork',async()=>{
    const r=await perform(makeOperation('fork',browse,{revision:Number(revSelect.value),newRunId:crypto.randomUUID(),label:'Ramo da revisão '+revSelect.value},runSelect.value));
    await restore(browse,r.runId,r.revision);
    await showHistory(browse,r.runId);say('Novo ramo aberto a partir da revisão selecionada.');
  });
  function clearRows() {
    rowsAfter=null;q('[data-observations]').replaceChildren();action('next-rows').hidden=true;
  }
  function describe(view,row) {
    if (view==='events') return 'Passo '+row.tick+' · '+(row.data?.text||row.type);
    if (view==='minerals') {
      const interval=row.inventoryScope==='source-disk' ? 'amostra no passo '+row.sourceTick+(Number.isSafeInteger(row.sampleSites)?' · '+row.sampleSites+' sítios locais':'') : 'passos '+row.firstTick+'–'+row.lastTick;
      return (row.formula||'Mineral')+' · '+Number(row.units).toLocaleString('pt-BR',{maximumFractionDigits:4})+' lotes do disco · '+(row.source==='stellar-neighborhood'?'ejeção estelar':row.source)+' · '+interval;
    }
    if (view==='quantities') return row.symbol+' · gás '+row.gas+' · mineral '+row.mineral+' · exportado '+row.exported;
    if (view==='genealogy') {
      const gene = evolving ? 'alelo térmico '+row.allele : 'fita '+row.sequence;
      const origin = {birth:'nascimento',death:'morte',living:'vivo'}[row.observedIn];
      const evidence = origin && Number.isSafeInteger(row.observedAtTick) ? ' · '+origin+' no passo '+row.observedAtTick : '';
      return '#'+row.id+' · geração '+row.generation+' · '+(row.parentId==null?'fundador':'progenitor #'+row.parentId)+' · '+gene+evidence;
    }
    const d=row.data||{};
    const values=[['population','organismos'],['scaleFactor','fator de escala'],['mineralUnits','un. de mineral'],['bodyMass','biomassa'],['cosmicTemperature','temperatura relativa'],['matterDensity','densidade relativa'],['meanTemperatureK','K'],['meanHumidity','umidade relativa'],['meanTrait','traço térmico médio'],['mutations','mutações']]
      .filter(([key])=>Number.isFinite(d[key])).map(([key,label])=>d[key].toLocaleString('pt-BR',{maximumFractionDigits:3})+' '+label);
    return 'Passo '+row.tick+(values.length?' · '+values.join(' · '):' · medição arquivada');
  }
  async function queryRows(next=false) {
    if (!next) clearRows();
    const view=q('[data-view]').value;
    const result=await readObservations(browse,runSelect.value,Number(revSelect.value),view,next?rowsAfter:0);
    const list=q('[data-observations]');
    for (const row of result[view]) {
      const line=document.createElement('p');line.textContent=describe(view,row);list.append(line);
    }
    if (!list.children.length) list.textContent='Esta revisão ainda não contém registros desse tipo.';
    rowsAfter=result.nextAfter;action('next-rows').hidden=rowsAfter==null;
  }
  bind('query',()=>queryRows());bind('next-rows',()=>queryRows(true));
  revSelect.addEventListener('change',clearRows);q('[data-view]').addEventListener('change',clearRows);
  bind('more',()=>showRevisions(lastPage));
  runSelect.addEventListener('change',()=>execute(()=>showRevisions()));
  bind('retry',async()=>{
    const op=pending;if (!op) return;
    const r=await perform(op);
    await restore(op.key,r.runId,r.revision);
    say('O servidor confirmou o envio. Revisão '+r.revision+' restaurada.');
  });
  bind('copy',async()=>{
    if (!keyInput.value.trim()) throw new Error('Salve um mundo para obter a chave.');
    try {await navigator.clipboard.writeText(keyInput.value.trim());say('Chave copiada.');}
    catch {keyInput.focus();keyInput.select();say('Use o comando Copiar do navegador.');}
  });
  if (files) {
    bind('export',()=>{
      const snapshot=getSnapshot(),link=document.createElement('a');
      const url=URL.createObjectURL(new Blob([JSON.stringify(snapshot)],{type:'application/json'}));
      link.href=url;link.download='xenora-'+mode+'-'+snapshot.seed+'-'+snapshot.tick+'.json';link.click();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
    });
    action('import').addEventListener('click',()=>q('[data-file]').click());
    q('[data-file]').addEventListener('change',event=>{
      const file=event.target.files?.[0];event.target.value='';
      if (!file) return;
      execute(async()=>{
        if (file.size>4*1024*1024) throw new Error('O arquivo excede 4 MiB.');
        restoreSnapshot(JSON.parse(await file.text()));detach();say('Mundo aberto a partir do arquivo.');
      });
    });
  }
  const timer=globalThis.setInterval?.(()=>{
    if (!q('[data-auto]').checked || !attached || busy || pending || document.hidden) return;
    const s=getSnapshot();
    if (s.tick-archivedTick>=250) execute(async()=>{await save(s);say('Revisão automática salva no passo '+s.tick+'.');});
  },15000);
  timer?.unref?.();
  refresh();
  if (pending) say('Há um envio anterior aguardando confirmação.');
  function getRemoteReference() {
    if (!attached) return null;
    return {worldId:attached.worldId, runId:attached.runId, revision:attached.revision, tick:archivedTick};
  }
  function getRunOrigin() {
    if (!attached) return null;
    const run=knownRuns.find(row=>row.runId===attached.runId);
    if (!run) return null;
    if (!run.parentRunId) return 'Execução inicial deste mundo no arquivo.';
    const parent=knownRuns.find(row=>row.runId===run.parentRunId);
    return 'Ramo aberto da revisão '+run.parentRevision+' de '+(parent?.label || 'ramo '+run.parentRunId.slice(0,8))+'.';
  }
  return {detach, getRemoteReference, getRunOrigin, forkWith(transform,label) {
    return execute(async()=>{
      if (pending) throw new Error('Conclua o envio pendente antes de bifurcar.');
      const base=getSnapshot(), changed=transform(base);
      if (!attached) {restoreSnapshot(changed);detach();say('Controle local aberto. Salve uma revisão para arquivá-lo.');return;}
      if (JSON.stringify(base)!==archivedState) await save(base);
      const key={worldId:attached.worldId,token:attached.token};
      await perform(makeOperation('fork',key,{revision:attached.revision,newRunId:crypto.randomUUID(),label},attached.runId));
      restoreSnapshot(changed);
      await save(changed);
      say('Controle arquivado em um novo ramo.');
    });
  }};
}

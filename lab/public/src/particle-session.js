import {AtomicWorld} from "./atomic-world.js";

const key="xenora.atoms.session.v2";
const limit=4;
const identities=new WeakMap();
let recovered=null;
function read(storage) {
  try {return JSON.parse(globalThis[storage]?.getItem(key) || "null");} catch {return null;}
}
function write(storage,data) {
  try {globalThis[storage]?.setItem(key,JSON.stringify(data));return Boolean(globalThis[storage]);} catch {return false;}
}
function checkedRecord(data) {
  if (data?.version!==1 || typeof data.id!=="string" || !Number.isSafeInteger(data.revision) ||
      !Array.isArray(data.entries) || data.entries.length<1 || data.entries.length>limit) return null;
  const ids=new Set();
  try {
    for(const entry of data.entries) {
      if (typeof entry.id!=="string" || ids.has(entry.id) || typeof entry.name!=="string" ||
          entry.name.length>80 || !Number.isSafeInteger(entry.tick) || entry.tick<0) return null;
      if (entry.parent && (typeof entry.parent.id!=="string" || !Number.isSafeInteger(entry.parent.tick) ||
          entry.parent.tick<0 || typeof entry.parent.name!=="string")) return null;
      const world=AtomicWorld.restore(entry.snapshot);
      if(world.tick!==entry.tick)return null;
      ids.add(entry.id);
    }
    return ids.has(data.focus) ? data : null;
  } catch {return null;}
}
export function readParticleSession() {
  recovered=checkedRecord(read("sessionStorage")) ?? checkedRecord(read("localStorage"));
  if(!recovered)return null;
  const entry=recovered.entries.find(e=>e.id===recovered.focus);
  const world=AtomicWorld.restore(entry.snapshot);
  identities.set(world,entry.id);
  return world;
}

export function mountParticleSession(root,{getWorld,setWorld,setPaused=()=>{},onChange=()=>{}}) {
  let data=recovered || {version:1,id:crypto.randomUUID(),revision:0,entries:[],focus:null};
  recovered=null;
  let conflict=false,removed=data.removed??null;
  root.innerHTML='<h3>Mundo e ramos</h3><p>Um ramo começa com as mesmas partículas e ligações do passo escolhido.</p><ol data-p-branches></ol><label>Nome do ramo<input data-p-name maxlength="60" placeholder="Experimento"></label><div class="p-actions"><button type="button" data-p-fork>Criar ramo deste passo</button></div><p data-p-session-status role="status"></p><button type="button" data-p-undo hidden>Desfazer retirada</button>';
  const list=root.querySelector("[data-p-branches]"),status=root.querySelector("[data-p-session-status]");
  function entryFor(world) {
    const known=identities.get(world);
    let entry=data.entries.find(e=>e.id===known);
    if(!entry){
      if(data.entries.length>=limit)throw new Error("Até quatro mundos podem ficar nesta sessão. Baixe um registro antes de iniciar outro.");
      entry={id:crypto.randomUUID(),name:"Mundo "+world.seed,parent:null,tick:world.tick,snapshot:world.serialize()};
      identities.set(world,entry.id);data.entries.push(entry);
    }
    data.focus=entry.id;
    return entry;
  }
  function draw() {
    list.replaceChildren();
    for(const entry of data.entries) {
      const row=document.createElement("li"),button=document.createElement("button"),line=document.createElement("p");
      button.type="button";button.textContent=entry.name+" · perfil v"+entry.snapshot.version+" · passo "+entry.tick;
      button.disabled=entry.id===data.focus;
      if(button.disabled)button.setAttribute("aria-current","true");
      line.textContent=entry.parent ? "Derivado de "+entry.parent.name+" no passo "+entry.parent.tick+"." : "Origem independente · semente "+entry.snapshot.seed+".";
      button.onclick=()=>{
        try {
          save();setPaused();const world=AtomicWorld.restore(entry.snapshot);
          identities.set(world,entry.id);data.focus=entry.id;setWorld(world);save();onChange();
        } catch(e){status.textContent=e.message;}
      };
      row.append(button,line);
      if(entry.id!==data.focus){
        const remove=document.createElement("button");remove.type="button";remove.textContent="Retirar da sessão";
        remove.onclick=()=>{
          removed=entry;data.entries=data.entries.filter(e=>e.id!==entry.id);save();
          status.textContent="Cópia retirada da sessão local.";

        };
        row.append(remove);
      }
      list.append(row);
    }
    root.querySelector("[data-p-fork]").disabled=data.entries.length>=limit;
    root.querySelector("[data-p-undo]").hidden=!removed;
    root.querySelector("[data-p-undo]").disabled=data.entries.length>=limit;
  }
  function save() {
    try{
      const world=getWorld(),entry=entryFor(world);
      entry.tick=world.tick;entry.snapshot=world.serialize();
      const previous=read("localStorage");
      if(previous?.id===data.id && previous.revision>data.revision)conflict=true;
      data.removed=removed;
      data.revision++;
      const tabSaved=write("sessionStorage",data);
      const localSaved=conflict ? false : write("localStorage",data);
      status.textContent=conflict ? "Outra aba avançou esta sessão. Esta cópia está guardada nesta aba. Use o arquivo para preservá-la." :
        tabSaved||localSaved ? "Sessão guardada. Os mundos reabrem em pausa." : "Armazenamento indisponível. Baixe o arquivo do mundo.";
      draw();return tabSaved||localSaved;
    }catch(e){status.textContent=e.message;return false;}
  }
  root.querySelector("[data-p-undo]").onclick=()=>{
    if(!removed||data.entries.length>=limit)return;
    data.entries.push(removed);removed=null;save();
  };
  root.querySelector("[data-p-fork]").onclick=()=>{
    if(data.entries.length>=limit)return;
    const snapshot=getWorld().serialize();
    if(!save())return;
    const parent=data.entries.find(e=>e.id===data.focus),world=AtomicWorld.restore(snapshot);
    const name=root.querySelector("[data-p-name]").value.trim().slice(0,60) || "Ramo "+data.entries.length;
    const next={id:crypto.randomUUID(),name,parent:{id:parent.id,name:parent.name,tick:parent.tick},tick:world.tick,snapshot};
    data.entries.push(next);data.focus=next.id;identities.set(world,next.id);
    setPaused();setWorld(world);save();onChange();root.querySelector("[data-p-name]").value="";
  };
  save();
  globalThis.addEventListener?.("pagehide",save);
  document.addEventListener("visibilitychange",()=>{if(document.hidden)save();});
  return {save,
    assertCanAccept(world){
      const id=identities.get(world);
      if(data.entries.length>=limit&&!data.entries.some(e=>e.id===id)){
        throw new Error("A sessão tem quatro mundos. Na lista de ramos, retire uma cópia antes de abrir outro mundo.");
      }
    },
    changed(){save();},getLabel(){return data.entries.find(e=>e.id===data.focus)?.name || "Mundo de partículas";}};
}

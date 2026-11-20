import {readKey,listRuns,listRevisions,openRevision} from "./archive-client.js";

const by=id=>document.getElementById(id);
let record=null,capability=null;
function message(text){by("recovery-status").textContent=text;}
function display(data){
  if(!data || typeof data!=="object" || Array.isArray(data))throw Error("O arquivo precisa conter um objeto de registro.");
  record=data;
  const snapshot=data.checkpoint ?? data;
  const mode=snapshot.mode || snapshot.kind || (snapshot.organisms ? "lagoon-molecular" : "registro");
  const labels={"evolving-world":"População com fundadores introduzidos","primordial":"Cronologia primordial","lagoon-molecular":"Cultura molecular","particle-world":"Mundo de partículas"};
  const rows=[["Modelo de origem",labels[mode] || mode],["Versão",snapshot.version ?? "não registrada"],["Semente",snapshot.seed ?? "não registrada"],["Passo",snapshot.tick ?? "não registrado"]];
  if(Array.isArray(snapshot.organisms))rows.push(["Indivíduos salvos",snapshot.organisms.length]);
  if(Array.isArray(snapshot.particles))rows.push(["Partículas salvas",snapshot.particles.length]);
  const info=by("recovery-info");info.replaceChildren();
  for(const [label,value]of rows){
    const dt=document.createElement("dt"),dd=document.createElement("dd");dt.textContent=label;dd.textContent=String(value);info.append(dt,dd);
  }
  by("recovery-result").hidden=false;
  message("Registro disponível para leitura e exportação.");
}
by("recovery-file").onchange=async()=>{
  try{
    const file=by("recovery-file").files[0];if(!file)return;
    if(file.size>4*1024*1024)throw Error("Use um registro de até 4 MiB.");
    display(JSON.parse(await file.text()));
  }catch(e){message(e.message || "Não foi possível ler o arquivo.");}
};
async function revisions(){
  const run=by("recovery-runs").value;if(!capability||!run)return;
  const options=by("recovery-revisions");options.replaceChildren();
  let after=0;
  do{
    const page=await listRevisions(capability,run,after);
    for(const row of page.revisions){const opt=document.createElement("option");opt.value=row.revision;opt.textContent="Revisão "+row.revision+" · passo "+row.tick;options.append(opt);}
    if(!page.nextAfter || page.nextAfter<=after)break;
    after=page.nextAfter;
  }while(true);
}
by("recovery-form").onsubmit=async event=>{
  event.preventDefault();
  try{
    capability=readKey(by("recovery-key").value);
    const options=by("recovery-runs");options.replaceChildren();
    let after=0;
    do{
      const page=await listRuns(capability,after);
      for(const row of page.runs){
        const opt=document.createElement("option");opt.value=row.runId;
        opt.textContent=(row.label||row.mode)+" · "+row.mode+" · passo "+row.tick;
        options.append(opt);
      }
      if(!page.nextAfter||page.nextAfter<=after)break;
      after=page.nextAfter;
    }while(true);
    await revisions();message(options.children.length+" execuções disponíveis.");
  }catch(e){message(e.message);}
};
by("recovery-runs").onchange=()=>revisions().catch(e=>message(e.message));
by("recovery-load").onclick=async()=>{
  try{
    if(!capability||!by("recovery-revisions").value)throw Error("Consulte uma chave e selecione uma revisão.");
    const result=await openRevision(capability,by("recovery-runs").value,Number(by("recovery-revisions").value));
    display(result.checkpoint);
  }catch(e){message(e.message);}
};
by("recovery-download").onclick=()=>{
  if(!record)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(record)],{type:"application/json"}));
  const a=document.createElement("a");a.href=url;a.download="xenora-registro-recuperado.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};

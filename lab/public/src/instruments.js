import {decodeInstrument} from "./instrument-route.js";
import {getPlanetTransfer} from "./evolution-link.js";

const names = {origens:"Origem da matéria", cultura:"Cultura molecular"};
const baseUrl = () => new URL("./", location.href);
const withoutInstrument = url => {
  const clean = new URL(url);
  for (const key of ["modo","instrumento","amostra","universo","origem"]) clean.searchParams.delete(key);
  clean.hash = "";
  return clean;
};

export function installInstruments({getWorld, setPaused, resume, acceptPlanet}) {
  if (!globalThis.location?.href) return {refresh(){}};
  let dialog, frame, tracking=null, wasRunning=false, focusAtOpen=null;
  let lastOrigin=null, savedLink=null, trigger=null;

  function sourceLink() {
    const origin = getWorld()?.environment?.origin;
    if (origin===lastOrigin) return savedLink;
    lastOrigin=origin; savedLink=null;
    if (!origin?.transferId) return null;
    try {
      const {sample}=getPlanetTransfer(origin.transferId);
      if (sample.seed===origin.seed && sample.tick===origin.tick && sample.branchTick===origin.branchTick &&
          sample.phase===origin.phase && sample.silicon===origin.silicon) {
        savedLink="./primordial.html?universo="+encodeURIComponent(origin.transferId);
      }
    } catch { /* The source may belong to an archive opened on another device. */ }
    return savedLink;
  }
  function refresh() {
    const link=document.getElementById("ev-origin-link");
    if (link) {
      const recorded=sourceLink();
      link.href=recorded || "./primordial.html";
      link.textContent=recorded ? "Inspecionar a origem registrada" : "Abrir experimento de origem";
    }
  }
  function stash() {
    try { frame?.contentWindow?.dispatchEvent(new Event("xenora-save-instrument")); } catch { /* Frame may be loading. */ }
  }
  function hide(restoreClock=true) {
    if (!tracking) return;
    tracking=null;
    stash(); frame.remove(); frame=null;
    if (dialog.open && typeof dialog.close==="function") dialog.close();
    else {dialog.removeAttribute("open");dialog.hidden=true;}
    if (restoreClock && wasRunning && getWorld()===focusAtOpen) resume();
    wasRunning=false; focusAtOpen=null;
    if (trigger?.isConnected) trigger.focus({preventScroll:true});
    trigger=null;
  }
  function close() {
    if (!tracking) return;
    const back=Boolean(history.state?.xenoraInstrument);
    hide();
    if (back) history.back();
    else history.replaceState(null,"",withoutInstrument(location.href));
  }
  function createDialog() {
    dialog=document.createElement("dialog");
    dialog.className="world-instrument"; dialog.setAttribute("aria-labelledby","instrument-title");
    dialog.innerHTML='<header><div><span>Instrumento do observatório</span><h2 id="instrument-title"></h2><p data-relation></p></div><button type="button" data-close-instrument>Voltar ao mundo</button></header>';
    document.body.append(dialog);
    dialog.querySelector("button").addEventListener("click",close);
    dialog.addEventListener("cancel",event=>{event.preventDefault();close();});
  }
  function show(route,historyMode) {
    if (!dialog) createDialog();
    if (!tracking) {
      trigger=document.activeElement; focusAtOpen=getWorld(); wasRunning=setPaused();
    } else { stash(); frame.remove(); }
    tracking=route;
    if (historyMode==="push") history.pushState({xenoraInstrument:true},"",route.shell.href);
    else if (historyMode==="replace") history.replaceState(history.state,"",route.shell.href);
    const recorded=route.documentUrl.searchParams.has("universo") || route.documentUrl.searchParams.has("origem");
    const culture=route.documentUrl.searchParams.has("amostra");
    dialog.querySelector("h2").textContent=names[route.name];
    dialog.querySelector("[data-relation]").textContent=recorded ? "Origem registrada da amostra. O mapa principal está em pausa." :
      culture ? "Cultura criada da amostra escolhida. O mapa principal está em pausa." :
      "Experimento independente. O mapa principal está em pausa.";
    frame=document.createElement("iframe");
    frame.name="xenora-instrument"; frame.title=names[route.name]; frame.src=route.documentUrl.href;
    frame.allow="fullscreen"; dialog.append(frame);
    if (!dialog.open && typeof dialog.showModal==="function") {dialog.hidden=false;dialog.showModal();}
    else {dialog.hidden=false;dialog.setAttribute("open","");}
  }
  document.addEventListener("click", event=>{
    const anchor=event.target.closest?.("#ev-origin-link,#ev-molecular-link");
    if (!anchor || event.defaultPrevented || event.button!==0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    refresh();
    const route=decodeInstrument(anchor.getAttribute("href"),baseUrl());
    if (route) {event.preventDefault();show(route,"push");}
  });
  window.addEventListener("message",event=>{
    if (!tracking || event.origin!==location.origin || event.source!==frame.contentWindow ||
        event.data?.type!=="xenora-instrument-navigate" || typeof event.data.path!=="string") return;
    let target;
    try {target=new URL(event.data.path,baseUrl());} catch {return;}
    if (target.origin!==location.origin) return;
    const route=decodeInstrument(target,baseUrl());
    if (route) {show(route,"replace");return;}
    if (target.pathname!==baseUrl().pathname && target.pathname!==new URL("index.html",baseUrl()).pathname) return;
    const id=target.searchParams.get("planeta");
    if (!id) {close();return;}
    try {
      const transfer=getPlanetTransfer(id);
      if (!transfer) return;
      acceptPlanet(transfer);
      hide(false);history.replaceState(null,"",baseUrl());
      refresh();
    } catch {
      dialog.querySelector("[data-relation]").textContent="A amostra não pôde ser aberta. Colete outra amostra neste experimento.";
    }
  });
  window.addEventListener("popstate",()=>{
    const route=decodeInstrument(location.href,baseUrl());
    if (route) show(route,"none"); else hide();
  });
  refresh();
  const initial=decodeInstrument(location.href,baseUrl());
  if (initial) show(initial,"replace");
  return {refresh};
}

const instruments = {origens:"primordial.html", cultura:"lagoa.html"};
const inheritedParameters = ["origem", "universo", "amostra"];

export function decodeInstrument(input, base) {
  const url = new URL(input, base);
  if (url.origin !== new URL(base).origin) return null;
  const page = url.pathname.split("/").pop();
  let name = Object.keys(instruments).find(key => instruments[key] === page);
  if (!name && (page === "" || page === "index.html")) {
    if (url.searchParams.has("amostra") || url.searchParams.get("modo") === "lagoa") name = "cultura";
    else name = url.searchParams.get("instrumento");
  }
  if (!Object.hasOwn(instruments, name)) return null;
  const shell = new URL("./", base), documentUrl = new URL(instruments[name], shell);
  shell.searchParams.set("instrumento", name);
  for (const key of inheritedParameters) {
    const value = url.searchParams.get(key);
    if (value && value.length <= 100) {
      shell.searchParams.set(key, value);
      documentUrl.searchParams.set(key, value);
    }
  }
  shell.hash = documentUrl.hash = url.hash;
  return {name, shell, documentUrl};
}

export function insideInstrument() {
  return typeof window !== "undefined" && window.name === "xenora-instrument" && window.parent !== window;
}

export function navigateFromInstrument(path) {
  if (insideInstrument()) {
    window.parent.postMessage({type:"xenora-instrument-navigate",path}, location.origin);
  } else {
    location.assign(path);
  }
}

// A working experiment may be reopened in the same tab. A link to a recorded
// parent always opens the original sampling point, independently of this draft.
export function rememberInstrument(readSnapshot, restoreSnapshot) {
  if (!insideInstrument()) return;
  const url=new URL(location.href);
  if (url.searchParams.has("universo") || url.searchParams.has("origem")) return;
  const slot="xenora.instrument.draft.v1."+url.pathname+"."+(url.searchParams.get("amostra") || "independent");
  try {
    const draft=sessionStorage.getItem(slot);
    if (draft) restoreSnapshot(JSON.parse(draft));
  } catch { /* A missing or incompatible draft leaves the initial experiment available. */ }
  const save=()=>{
    try {sessionStorage.setItem(slot,JSON.stringify(readSnapshot()));} catch { /* Explicit archive is still available. */ }
  };
  window.addEventListener("xenora-save-instrument",save);
  window.addEventListener("pagehide",save);
}

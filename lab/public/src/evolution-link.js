import { evolutionarySurfaceSample } from "./evolving-environment.js";
import { PrimordialWorld } from "./primordial.js";

const slot = "xenora.evolution-source.v1";

export function openEvolvingPlanet(primordial, founders) {
  if (![0,24].includes(founders)) throw new Error("Condição inicial de população inválida.");
  const sample = evolutionarySurfaceSample(primordial);
  const id = crypto.randomUUID();
  try {
    sessionStorage.setItem(slot,JSON.stringify({id, founders, original:primordial.serialize()}));
  } catch {
    throw new Error("O navegador não conseguiu guardar a origem deste planeta.");
  }
  if (!sample) throw new Error("A superfície ainda não está disponível.");
  location.assign("./?planeta=" + id);
}

function fromTab(param) {
  const id = new URLSearchParams(globalThis.location?.search || "").get(param);
  if (!id) return null;
  let item;
  try { item = JSON.parse(sessionStorage.getItem(slot) || "null"); } catch {}
  if (!item || item.id !== id || ![0,24].includes(item.founders)) {
    throw new Error("A ligação com Origens expirou nesta aba. Abra o percurso cósmico para coletar o planeta novamente.");
  }
  const origin = PrimordialWorld.restore(item.original);
  return { id, founders: item.founders, original:item.original, sample:evolutionarySurfaceSample(origin) };
}

export const readEvolvingPlanet = () => fromTab("planeta");
export const readEvolutionOrigin = () => fromTab("universo")?.original || null;

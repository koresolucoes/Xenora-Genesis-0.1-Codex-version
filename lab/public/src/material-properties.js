import {ATOMIC_ELEMENTS,ATOMIC_SYMBOLS} from "./atomic-elements.js";

const atomicMassKg=1.66053906660e-27;
const boltzmann=1.380649e-23;

export function materialInventory(particles) {
  const elements=Object.fromEntries(ATOMIC_SYMBOLS.map(symbol=>[symbol,0]));
  let massU=0, protons=0,neutrons=0,electrons=0,referenceVolumeNm3=0;
  for(const p of particles) {
    const e=ATOMIC_ELEMENTS[p.element];
    if(!e)throw new TypeError("Elemento fora do inventário atômico.");
    elements[p.element]++;
    massU+=e.massU;protons+=e.protons;neutrons+=e.neutrons;electrons+=p.electrons;
    referenceVolumeNm3+=e.volumePm3/1e9;
  }
  return {elements,massU,protons,neutrons,electrons,chargeElementary:protons-electrons,referenceVolumeNm3};
}

// A formula is an inventory of nuclei. It does not identify a unique substance
// or its geometry, charge distribution, optical response or phase.
export function molecularFormula(particles) {
  const counts=materialInventory(particles).elements;
  const order=counts.C ? ["C","H",...ATOMIC_SYMBOLS.filter(s=>s!=="C"&&s!=="H").sort()] : [...ATOMIC_SYMBOLS].sort();
  return order.filter(s=>counts[s]).map(s=>s+(counts[s]===1?"":counts[s])).join("");
}

export function sampleProperties(world) {
  const inventory=materialInventory(world.particles);
  const metrics=world.getMetrics();
  const volumeNm3=metrics.volumeNm3;
  const temperatureK=metrics.temperatureK;
  const molecules=world.molecules();
  const covered=new Set(molecules.flatMap(m=>m.members));
  const moleculeCount=molecules.length+world.particles.length-covered.size;
  const validVolume=Number.isFinite(volumeNm3)&&volumeNm3>0;
  return {...inventory,volumeNm3,temperatureK,moleculeCount,
    densityKgM3:validVolume ? inventory.massU*atomicMassKg/(volumeNm3*1e-27) : null,
    // Ideal-gas comparison for the independent molecular components. Interacting
    // systems require a virial/force measurement for their actual pressure.
    idealPressurePa:validVolume&&Number.isFinite(temperatureK) ? moleculeCount*boltzmann*temperatureK/(volumeNm3*1e-27) : null,
    phase:"Não determinada",
    phaseReason:"Este modelo acompanha átomos e ligações. Uma fase macroscópica exige interações e uma análise de equilíbrio próprias da substância."};
}

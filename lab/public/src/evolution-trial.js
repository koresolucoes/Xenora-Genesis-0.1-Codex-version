import { EvolvingWorld } from "./evolving-world.js";

export function runEvolutionTrial(snapshot) {
  const world = EvolvingWorld.restore(snapshot);
  const selected = world.fork({selectionEnabled:true});
  const neutral = world.fork({selectionEnabled:false});
  for (let i=0; i<200; i++) { selected.step(); neutral.step(); }
  function report(state) {
    const m=state.getMetrics();
    return { population:m.population, meanThermal:m.population?266+48*m.meanTrait:null,
      mutations:m.mutations, frequencies:m.population?m.traitFrequencies:null };
  }
  return { seed:world.seed, start:world.tick, end:selected.tick, selected:report(selected), neutral:report(neutral) };
}
if(typeof WorkerGlobalScope!=="undefined" && globalThis instanceof WorkerGlobalScope){
  globalThis.addEventListener("message",({data})=>{
    try{globalThis.postMessage({result:runEvolutionTrial(data)});}
    catch{globalThis.postMessage({error:"Não foi possível comparar estas trajetórias."});}
  });
}

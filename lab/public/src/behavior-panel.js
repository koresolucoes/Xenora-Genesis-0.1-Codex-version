import { BEHAVIOR_TRIAL_STEPS, createBehaviorTrial } from "./behavior-trial.js";

const number = new Intl.NumberFormat("pt-BR", {maximumFractionDigits: 3});
const percent = new Intl.NumberFormat("pt-BR", {style:"percent", maximumFractionDigits: 1});
const display = (n, format=number) => Number.isFinite(n) ? format.format(n) : "—";

export function mountBehaviorPanel(element, getWorld) {
  element.classList.add("behavior-panel");
  element.innerHTML = `
    <h2>Aprendizagem individual</h2>
    <p>A célula escolhe ficar ou explorar um sítio vizinho. O ganho após a escolha ajusta sua preferência em locais pobres ou ricos em nutriente. Cada descendente começa com memória vazia.</p>
    <p data-b="live"></p>
    <div class="behavior-actions"><button type="button" data-b="run">Comparar por ${BEHAVIOR_TRIAL_STEPS} passos</button>
      <button type="button" data-b="cancel" hidden>Cancelar</button></div>
    <small>Duas cópias do mundo começam com memória vazia. O controle mantém 50% de chance de explorar. O mundo em foco segue independente.</small>
    <p data-b="status" aria-live="polite"></p>
    <div data-b="results" hidden><table><thead><tr><th>Medida</th><th>Aprende</th><th>Controle</th></tr></thead><tbody></tbody></table>
    <button type="button" data-b="download">Baixar dados CSV</button></div>`;
  const field = key => element.querySelector(`[data-b="${key}"]`);
  const tbody = element.querySelector("tbody");
  let worker = null, job = 0, active = false, result = null, lastWorld = null, lastTick = -1;

  function release() {
    worker?.terminate();
    worker = null;
    active = false;
    field("run").disabled = false;
    field("cancel").hidden = true;
  }
  function reset() {
    job++;
    release();
    result = null;
    field("results").hidden = true;
    field("status").textContent = "";
    lastWorld = null;
  }
  function update() {
    const world = getWorld();
    if (!world || (lastWorld === world && lastTick === world.tick)) return;
    lastWorld = world;
    lastTick = world.tick;
    const m = world.getMetrics();
    const fraction = m.behaviorDecisions ? m.exploreDecisions / m.behaviorDecisions : null;
    field("live").textContent = `${m.learningEnabled ? "Aprendizagem ligada" : "Controle sem aprendizagem"} · ${display(m.behaviorDecisions)} decisões · ${display(fraction, percent)} de exploração`;
  }
  const rows = [
    ["Decisões", b=>display(b.decisions)], ["Explorações em locais pobres", b=>display(b.contexts[0].exploreRate, percent)],
    ["Decisões em locais pobres", b=>display(b.contexts[0].decisions)], ["Explorações em locais ricos", b=>display(b.contexts[1].exploreRate, percent)],
    ["Decisões em locais ricos", b=>display(b.contexts[1].decisions)], ["Recompensa média por decisão", b=>display(b.meanReward)],
    ["Atualizações de memória", b=>display(b.updates)], ["População final", b=>display(b.population)]
  ];
  function complete(outcome) {
    release();
    result = outcome;
    tbody.replaceChildren();
    for (const [label, format] of rows) {
      const tr = document.createElement("tr");
      const title = document.createElement("th");
      title.scope = "row"; title.textContent = label; tr.append(title);
      for (const arm of [outcome.learner, outcome.control]) {
        const td = document.createElement("td"); td.textContent = format(arm); tr.append(td);
      }
      tbody.append(tr);
    }
    field("results").hidden = false;
    field("status").textContent = `Semente ${outcome.seed} · passos ${outcome.start}–${outcome.start + outcome.steps}. Uma execução pareada. O traço térmico continua herdável nos dois grupos.`;
  }
  function fail() {
    release(); field("status").textContent = "Não foi possível concluir a comparação neste navegador.";
  }
  function progress(n) { field("status").textContent = `Comparando os mundos · ${n}/${BEHAVIOR_TRIAL_STEPS}`; }
  field("run").onclick = async () => {
    if (active) return;
    reset();
    const world = getWorld();
    if (!world.organisms.length) {
      field("status").textContent = "Este mundo está sem organismos. Selecione uma população viva para comparar decisões.";
      return;
    }
    const selected = job;
    active = true; field("run").disabled = true; field("cancel").hidden = false; progress(0);
    try {
      const snapshot = world.serialize();
      if (typeof Worker === "function") {
        worker = new Worker(new URL("./behavior-trial.js", import.meta.url), {type:"module"});
        worker.onmessage = ({data}) => {
          if (job !== selected) return;
          if (data.error) fail();
          else if (data.result) complete(data.result);
          else progress(data.steps);
        };
        worker.onerror = () => { if (job === selected) fail(); };
        worker.postMessage(snapshot);
        return;
      }
      const trial = createBehaviorTrial(snapshot);
      for (let count = 0; count < BEHAVIOR_TRIAL_STEPS;) {
        await new Promise(r => setTimeout(r, 0));
        if (job !== selected) return;
        const until = performance.now() + 10;
        do { trial.step(); count++; } while (count < BEHAVIOR_TRIAL_STEPS && performance.now() < until);
        progress(count);
      }
      complete(trial.result());
    } catch { if (job === selected) fail(); }
  };
  field("cancel").onclick = () => { reset(); field("status").textContent = "Comparação interrompida."; };
  field("download").onclick = () => {
    if (!result) return;
    const lines = ["semente,passo_inicial,passo_final,grupo,contexto,decisoes,exploracoes,fracao_exploracao,recompensa_media_do_grupo,atualizacoes_do_grupo,populacao_final"];
    for (const [label, arm] of [["aprende",result.learner],["controle",result.control]]) {
      arm.contexts.forEach((c,i) => lines.push([result.seed,result.start,result.start+result.steps,label,
        i ? "rico" : "pobre",c.decisions,c.explores,c.exploreRate,arm.meanReward,arm.updates,arm.population].join(",")));
    }
    const url = URL.createObjectURL(new Blob([lines.join("\n")+"\n"], {type:"text/csv;charset=utf-8"}));
    const link = document.createElement("a"); link.href = url; link.download = `xenora-comportamento-${result.seed}-${result.start}.csv`;
    link.click(); setTimeout(()=>URL.revokeObjectURL(url), 1000);
  };
  return {update, reset};
}

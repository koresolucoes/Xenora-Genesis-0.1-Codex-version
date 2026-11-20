const fmt = new Intl.NumberFormat("pt-BR", {maximumFractionDigits: 3});
const formatStat = stat => fmt.format(stat.mean) + " ± " + fmt.format(stat.sd);
const conditionName = condition => Math.round(100 * condition.light) + "% · +" + condition.nutrient + " u.m.";

function appendRow(body, cells) {
  const row = document.createElement("tr");
  cells.forEach((text, index) => {
    const cell = document.createElement(index ? "td" : "th");
    if (!index) cell.scope = "row";
    cell.textContent = text;
    row.append(cell);
  });
  body.append(row);
}

export function mountMolecularTrial(container) {
  container.classList.add("molecular-trial");
  container.innerHTML = `
    <div class="mt-head"><div><h3>Seleção de linhagens moleculares</h3>
      <p>Compare descendentes de fundadores com maior investimento em transporte ou em pigmentos.
      Cada lagoa começa com 12 fundadores de cada tipo e evolui por 600 passos.</p></div>
      <div class="mt-actions"><button type="button" class="secondary" data-molecular-start>Iniciar ensaio molecular</button>
      <button type="button" class="secondary" data-molecular-cancel hidden>Cancelar</button></div></div>
    <details class="mt-method"><summary>Condições e controles</summary>
      <p>A condição de referência conserva a luz original e os nutrientes da lagoa. Cruzamos a luz original ou reduzida pela metade
      com a aplicação de zero ou 12 u.m. de nutrientes no início, distribuídas igualmente nos centros dos quatro quadrantes.</p>
      <p>As sementes 42, 127, 719 e 2027 geram as mesmas quatro condições. Cada condição é repetida com os tipos trocados de posição,
      de modo que cada fundador forneça a mesma massa e energia inicial a ambos os tipos. Na sequência digital de 20 bits, o tipo de transporte começa com 3 bits ativos
      e o de pigmentação com 17. Os demais bits favorecem os transportadores. Os descendentes são identificados pela linhagem de origem.</p>
    </details>
    <p class="mt-status" data-molecular-status role="status"></p>
    <div class="mt-results" hidden>
      <div class="mt-scroll"><table><caption>Descendentes vivos por fundador · média ± desvio-padrão entre sementes</caption>
        <thead><tr><th scope="col">Luz · nutrientes adicionados</th><th scope="col">Transporte</th>
        <th scope="col">Pigmentação</th><th scope="col">Pigmentação − transporte</th></tr></thead>
        <tbody data-molecular-summary></tbody></table></div>
      <p class="mt-note">Contagem no passo 600, excluindo os fundadores. Cada semente contribui com a média das duas alocações recíprocas.</p>
      <details><summary>Efeitos pareados da luz e do nutriente</summary>
        <p class="mt-note">Mudança na diferença entre pigmentação e transporte, em descendentes por fundador. A interação mede quanto o efeito do nutriente muda quando a luz é reduzida à metade.</p>
        <div class="mt-scroll"><table><thead><tr><th scope="col">Comparação</th><th scope="col">Média ± desvio-padrão</th></tr></thead>
        <tbody data-molecular-effects></tbody></table></div></details>
      <details><summary>Resultados por semente</summary><div class="mt-scroll"><table>
        <thead><tr><th scope="col">Luz · nutrientes adicionados</th><th scope="col">Semente</th>
        <th scope="col">Transporte</th><th scope="col">Pigmentação</th></tr></thead>
        <tbody data-molecular-raw></tbody></table></div></details></div>`;
  const get = selector => container.querySelector(selector);
  const start = get("[data-molecular-start]");
  const cancel = get("[data-molecular-cancel]");
  const status = get("[data-molecular-status]");
  const results = get(".mt-results");
  let active;

  function finish() {
    active?.terminate();
    active = null;
    start.disabled = false;
    cancel.hidden = true;
  }

  function failed() {
    finish();
    status.textContent = "O ensaio não foi concluído. Tente novamente.";
  }

  cancel.addEventListener("click", () => {
    finish();
    status.textContent = "Ensaio cancelado.";
  });
  start.addEventListener("click", () => {
    if (active) return;
    try {
      active = new Worker(new URL("./molecular-trial.js", import.meta.url), { type: "module" });
      const pending = active;
      start.disabled = true;
      cancel.hidden = false;
      results.hidden = true;
      status.textContent = "Em execução · preparando as lagoas.";
      pending.onmessage = ({ data }) => {
        if (active !== pending) return;
        if (data.progress) {
          status.textContent = "Em execução · " + data.progress.completed + " de " + data.progress.total + " lagoas concluídas.";
          return;
        }
        if (!data.result) { failed(); return; }
        const result = data.result;
        const rows = get("[data-molecular-summary]");
        const raw = get("[data-molecular-raw]");
        rows.replaceChildren();
        raw.replaceChildren();
        for (const condition of result.conditions) {
          const label = conditionName(condition);
          appendRow(rows, [label, formatStat(condition.transport), formatStat(condition.pigment), formatStat(condition.difference)]);
          for (const rep of condition.replicates) {
            appendRow(raw, [label, String(rep.seed), fmt.format(rep.transport), fmt.format(rep.pigment)]);
          }
        }
        const effects = get("[data-molecular-effects]");
        effects.replaceChildren();
        appendRow(effects, ["Reduzir a luz, sem adição de nutriente", formatStat(result.effects.light)]);
        appendRow(effects, ["Adicionar nutriente, sob luz original", formatStat(result.effects.nutrient)]);
        appendRow(effects, ["Interação entre luz e nutriente", formatStat(result.effects.interaction)]);
        finish();
        results.hidden = false;
        status.textContent = "Concluído · " + result.seeds.length + " sementes · " + result.worlds + " lagoas · " + result.steps + " passos por lagoa.";
      };
      pending.onerror = () => { if (pending === active) failed(); };
      pending.onmessageerror = () => { if (pending === active) failed(); };
      pending.postMessage({});
    } catch {
      failed();
    }
  });
  return finish;
}

// A view of measured allele frequencies. The founders remain in the family
// registry after death, so their tick-zero frequencies survive history pruning.
const whole = new Intl.NumberFormat("pt-BR", {maximumFractionDigits: 0});
const decimal = new Intl.NumberFormat("pt-BR", {maximumFractionDigits: 2});
const percentage = new Intl.NumberFormat("pt-BR", {style: "percent", maximumFractionDigits: 2});
const countText = n => whole.format(n);
const pct = value => percentage.format(value);
const carriers = (count,population) => countText(count) + "/" + countText(population);
const numberOf = (n,singular,plural) => countText(n) + " " + (n === 1 ? singular : plural);

function founderSample(world) {
  const counts = Array(11).fill(0);
  for (const family of world.lineages) counts[Math.round(family.trait * 10)]++;
  return {tick: 0, population: world.lineages.length, counts};
}

function observation(row) {
  return {tick: row.tick, population: row.population, counts: row.traitCounts.slice()};
}

function biggestShift(before, after) {
  let focus = null, maxGap = -1;
  for (let allele = 0; allele < before.counts.length; allele++) {
    const beforeCount = before.counts[allele], afterCount = after.counts[allele];
    if (!beforeCount && !afterCount) continue;
    // Compare exact integer cross-products so equal frequencies are not mistaken
    // for changes and the tie break is reproducible across browsers.
    const difference = afterCount * before.population - beforeCount * after.population;
    const gap = Math.abs(difference);
    if (gap < maxGap || (gap === maxGap && afterCount <= focus.afterCount)) continue;
    maxGap = gap;
    focus = {allele, beforeCount, afterCount, beforeFraction: beforeCount / before.population,
      afterFraction: afterCount / after.population, delta: difference / (before.population * after.population)};
  }
  return focus;
}

function frequenciesSentence(before, after, focus) {
  const optimum = decimal.format(266 + 4.8 * focus.allele);
  return "No passo " + countText(before.tick) + ", o alelo " + focus.allele + " (ótimo térmico codificado de " +
    optimum + " K) aparecia em " + carriers(focus.beforeCount,before.population) +
    (before.population===1 ? " indivíduo" : " indivíduos") + " (" + pct(focus.beforeFraction) + "). No passo " +
    countText(after.tick) + ", aparecia em " + carriers(focus.afterCount,after.population) + " (" + pct(focus.afterFraction) + ").";
}

function listFounders(baseline) {
  const groups = new Map();
  baseline.counts.forEach((count,allele) => {
    if (!count) return;
    if (!groups.has(count)) groups.set(count, []);
    groups.get(count).push(allele);
  });
  return Array.from(groups, ([count, alleles]) => {
    const label = alleles.length > 1 ? "Os alelos " : "O alelo ";
    const names = new Intl.ListFormat("pt-BR", {type:"conjunction"}).format(alleles.map(String));
    return label + names + (alleles.length > 1 ? " começam com " : " começa com ") +
      carriers(count, baseline.population) + " fundadores (" + pct(count / baseline.population) +
      (alleles.length > 1 ? " cada)." : ").");
  }).join(" ");
}

export function readEvolutionEvidence(world) {
  const current = world.getMetrics();
  const baseline = founderSample(world);
  const oldestRetainedTick = world.history[0]?.tick ?? current.tick;
  const lastLiving = current.population ? current : world.history.findLast(sample => sample.population > 0);
  const comparison = lastLiving ? observation(lastLiving) : null;
  const focus = comparison && baseline.population && comparison.tick > 0 ? biggestShift(baseline,comparison) : null;
  const info = {baseline, comparison, focus, latestTick: current.tick, oldestRetainedTick};
  const coverage = oldestRetainedTick > 0
    ? "A contagem do passo 0 vem das linhagens fundadoras. A série guardada começa no passo " + countText(oldestRetainedTick) + "."
    : "";
  const demography = "Desde a fundação houve " + numberOf(current.births,"nascimento","nascimentos") + " e " +
    numberOf(current.mutations,"mutação no alelo transmitido","mutações no alelo transmitido") + ". A maior geração registrada foi " +
    current.maxGeneration + " (fundadores = 0).";
  const control = current.selectionEnabled
    ? "Seleção e deriva podem mudar frequências. Compare com o controle neutro, no qual todos os alelos têm o mesmo desempenho térmico, e repita com outras sementes."
    : "Neste passo o controle neutro está ativo. Todos os alelos têm o mesmo desempenho térmico. Deriva e, quando habilitada, mutação ainda podem alterar as frequências.";
  if (baseline.population === 0) {
    const statement = world.requestedFounders === 0 ? "Esta execução começou sem fundadores." :
      "Nenhuma região satisfez as condições de introdução dos fundadores.";
    const short = "Superfície sem população no passo " + countText(current.tick) + ".";
    return {...info,status:"sterile",short,title:"Nenhuma população observada",
      observation:statement + " Até o passo " + countText(current.tick) + " não houve indivíduos nem frequências de alelos para comparar.",
      demography:"",coverage:"",control:""};
  }
  if (current.tick === 0) {
    const short = "Passo 0 · " + numberOf(baseline.population,"fundador","fundadores") + ". Ainda não há duas observações.";
    return {...info,status:"baseline",short,title:"Distribuição inicial",
      observation:"Passo 0. " + listFounders(baseline),demography:"Os fundadores são a geração 0. Ainda não houve nascimentos ou mutações nesta execução.",
      coverage:"",control:""};
  }
  if (current.population === 0) {
    const short = "População extinta no passo " + countText(current.extinctionTick) + ".";
    let statement = short + " No passo " + countText(current.tick) + " há zero indivíduos vivos. A frequência relativa está indefinida.";
    if (focus) {
      statement += " A última amostra guardada com indivíduos vivos é do passo " + countText(comparison.tick) +
        ". " + frequenciesSentence(baseline,comparison,focus);
    } else if (oldestRetainedTick > 0) {
      statement += " A janela guardada já não contém amostras com indivíduos vivos.";
    }
    return {...info,status:"extinct",short,title:"A população se extinguiu",observation:statement,demography,coverage,control:""};
  }
  const status = focus.delta === 0 ? "unchanged" : "changed";
  const short = "Alelo " + focus.allele + " do passo 0 ao " + countText(current.tick) + " · " +
    pct(focus.beforeFraction) + " → " + pct(focus.afterFraction) + ".";
  let title, statement = frequenciesSentence(baseline,comparison,focus);
  if (status === "changed") {
    title = "Mudou a frequência de um traço herdável";
    const amount = decimal.format(Math.abs(100*focus.delta));
    statement += " Foi a maior mudança entre os alelos, " + (focus.delta>0 ? "uma alta de " : "uma queda de ") +
      amount + (amount==="1" ? " ponto percentual." : " pontos percentuais.");
    if (!current.births) statement += " A mudança ocorreu entre os fundadores sobreviventes, antes do primeiro nascimento.";
  } else {
    title = "A distribuição atual coincide com a fundação";
    // Endpoint equality can coexist with intervening movement in the frequencies.
    const temporary = world.history.find(row => row.tick>0 && row.tick<current.tick && row.population>0 &&
      row.traitCounts.some((n,a) => n*baseline.population !== baseline.counts[a]*row.population));
    if (temporary) {
      const t = observation(temporary), transient = biggestShift(baseline,t);
      statement += " Houve variação intermediária. No passo " + countText(t.tick) + ", o alelo " + transient.allele +
        " aparecia em " + carriers(transient.afterCount,t.population) + " indivíduos (" + pct(transient.afterFraction) + ").";
    }
  }
  return {...info,status,short,title,observation:statement,demography,coverage,control};
}

export class EvolutionEvidence {
  constructor(container) {
    this.container = container;
    container.classList.add("ev-panel");
    const heading = document.createElement("h2");
    heading.textContent = "Evidência de evolução";
    this.nodes = {};
    const children = [heading];
    for (const field of ["title","observation","demography","coverage","control"]) {
      const node = document.createElement(field==="title" ? "h3" : "p");
      if (field==="coverage" || field==="control") node.className = "ev-foot";
      this.nodes[field] = node;
      children.push(node);
    }
    container.replaceChildren(...children);
  }
  update(world) {
    if (this.world===world && this.tick===world.tick && this.selection===world.controls.selectionEnabled) return this.result;
    this.world=world;
    this.tick=world.tick;
    this.selection=world.controls.selectionEnabled;
    const result=readEvolutionEvidence(world);
    for(const [field,node] of Object.entries(this.nodes)) {
      const text=result[field];
      if (node.textContent!==text) node.textContent=text;
      node.hidden=!text;
    }
    this.container.dataset.state=result.status;
    this.result=result;
    return result;
  }
}

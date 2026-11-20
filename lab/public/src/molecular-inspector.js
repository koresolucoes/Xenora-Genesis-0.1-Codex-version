const compartments = [
  ["membrane", "Membrana"],
  ["pigment", "Pigmento"],
  ["transporters", "Transportadores"],
  ["reserve", "Reserva de matéria"]
];

const massFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const fluxFormat = new Intl.NumberFormat("pt-BR", { maximumSignificantDigits: 3 });
const percentFormat = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const deltaFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2, signDisplay: "exceptZero" });

function write(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

function measurement(value, unit, format = massFormat) {
  return Number.isFinite(value) ? format.format(value) + " " + unit : "—";
}

export function mountCellInspector(anchor, selectLiveCell) {
  const panel = document.createElement("section");
  panel.id = "cell-compartments";
  panel.className = "cell-compartments";
  panel.hidden = true;
  panel.setAttribute("aria-labelledby", "cell-composition-title");
  panel.innerHTML = `
    <div class="cell-composition-head"><h3 id="cell-composition-title">Composição celular</h3><b data-cell-total></b></div>
    <div class="cell-stack" aria-hidden="true"></div>
    <dl class="cell-stocks"></dl>
    <details class="cell-metabolism">
      <summary>Metabolismo e herança</summary>
      <div class="cell-gene">
        <h4>Polímero herdado</h4>
        <code class="cell-sequence" aria-label="Sequência herdada"></code>
        <p>Cada 1 destina uma parte da capacidade de síntese aos pigmentos. Cada 0 destina uma parte aos transportadores.</p>
        <p class="cell-change"></p>
      </div>
      <dl></dl>
      <div class="cell-relatives">
        <button type="button" data-relative="parent"></button>
        <button type="button" data-relative="child"></button>
      </div>
    </details>`;
  anchor.before(panel);
  const stack = panel.querySelector(".cell-stack");
  const stocks = panel.querySelector(".cell-stocks");
  const totalText = panel.querySelector("[data-cell-total]");
  const details = panel.querySelector("details");
  const records = compartments.map(([key, label]) => {
    const segment = document.createElement("i");
    segment.dataset.stock = key;
    stack.append(segment);
    const pair = document.createElement("div");
    pair.dataset.stock = key;
    const term = document.createElement("dt");
    term.textContent = label;
    const value = document.createElement("dd");
    pair.append(term, value);
    stocks.append(pair);
    return { key, segment, value };
  });

  const code = details.querySelector(".cell-sequence");
  const changeNote = details.querySelector(".cell-change");
  const navigation = details.querySelector(".cell-relatives");
  const parentButton = navigation.querySelector('[data-relative="parent"]');
  const childButton = navigation.querySelector('[data-relative="child"]');
  for (const button of [parentButton, childButton]) {
    button.addEventListener("click", () => selectLiveCell(Number(button.dataset.id)));
  }
  let displayedSequence = null;
  const rows = new Map();
  const definitions = [
    ["energy", "Reserva de energia"],
    ["light", "Energia de luz captada"],
    ["uptake", "Nutriente dissolvido captado"],
    ["allocation", "Alocação a pigmento"],
    ["mutation", "Variação ao nascer"],
    ["parent", "Progenitor"],
    ["lineage", "Fundador da linhagem"],
    ["generation", "Geração"]
  ];
  const list = details.querySelector("dl");
  for (const [key, label] of definitions) {
    const pair = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = label;
    const definition = document.createElement("dd");
    pair.append(term, definition);
    list.append(pair);
    rows.set(key, definition);
  }
  const note = document.createElement("p");
  note.textContent = "Os fluxos referem-se ao último passo. A variação compara a alocação da filha à do progenitor, em pontos percentuais.";
  details.append(note);

  return {
    open() { details.open = true; },
    show(organism, population) {
      panel.hidden = !organism?.cell;
      if (panel.hidden) return;
      const parent = organism.parent == null ? null : population.find(other => other.id === organism.parent);
      const daughters = population.filter(other => other.parent === organism.id);
      const daughter = daughters.find(other => other.mutationDelta !== 0) || daughters.at(-1);
      for (const [relative, button, label] of [[parent, parentButton, "Ver progenitor"], [daughter, childButton, "Ver filha"]]) {
        button.hidden = !relative;
        if (relative) {
          button.dataset.id = String(relative.id);
          write(button, label + " #" + relative.id);
        }
      }
      navigation.hidden = !parent && !daughter;
      const sequence = organism.genome?.sequence;
      const ancestorSequence = parent?.genome?.sequence;
      const signature = (sequence || "") + "|" + (ancestorSequence || "");
      if (signature !== displayedSequence) {
        displayedSequence = signature;
        code.replaceChildren();
        let changedLocus = -1;
        if (typeof sequence === "string") {
          for (const [i, bit] of Array.from(sequence).entries()) {
            if (ancestorSequence && ancestorSequence[i] !== bit) {
              const changed = document.createElement("mark");
              changed.textContent = bit;
              code.append(changed);
              changedLocus = i;
            } else {
              code.append(bit);
            }
          }
        } else {
          code.textContent = "—";
        }
        changeNote.hidden = changedLocus < 0;
        if (changedLocus >= 0) {
          write(changeNote, "Posição " + (changedLocus + 1) + " · " + ancestorSequence[changedLocus] + " → " + sequence[changedLocus] + " em relação ao progenitor.");
        }
      }
      const stock = organism.cell;
      write(totalText, measurement(organism.mass, "u.m."));
      for (const {key, value, segment} of records) {
        write(value, measurement(stock[key], "u.m."));
        const fraction = organism.mass > 0 ? stock[key] / organism.mass : 0;
        segment.style.width = (Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) * 100 : 0) + "%";
      }
      write(rows.get("energy"), measurement(organism.energy, "u.e."));
      write(rows.get("light"), measurement(organism.flux?.light, "u.e./passo", fluxFormat));
      write(rows.get("uptake"), measurement(organism.flux?.uptake, "u.m./passo", fluxFormat));
      const allocation = organism.genome?.allocation;
      write(rows.get("allocation"), Number.isFinite(allocation) ? percentFormat.format(allocation) : "—");
      const delta = organism.mutationDelta;
      const mutation = Number.isFinite(delta) ? deltaFormat.format(delta * 100) + " p.p." : "—";
      write(rows.get("mutation"), organism.parent == null ? "Fundador" : mutation);
      write(rows.get("parent"), organism.parent == null ? "Fundador" : "#" + organism.parent);
      write(rows.get("lineage"), Number.isInteger(organism.lineage) ? "#" + organism.lineage : "—");
      write(rows.get("generation"), String(organism.generation));
    }
  };
}

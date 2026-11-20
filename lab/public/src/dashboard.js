const NS = "http://www.w3.org/2000/svg";
const HISTORY_LIMIT = 512;
const SAMPLE_PERIOD = 10;
const colors = ["#bce6a6", "#eab66f", "#d997ae", "#b8a6eb", "#79c9ce"];
const dashes = ["", "7 4", "2 4", "10 3 2 3", "4 3"];
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const scientific = new Intl.NumberFormat("pt-BR", { notation: "scientific", maximumFractionDigits: 2 });

const groups = {
  population: {
    label: "População", unit: "organismos",
    description: "A população atual incorpora os nascimentos e as mortes acumulados desde o início do experimento.",
    series: [["population", "População viva"], ["births", "Nascimentos acumulados"], ["deaths", "Mortes acumuladas"]]
  },
  matter: {
    label: "Matéria", unit: "u.m.",
    description: "Os cinco estoques compõem a matéria reativa da lagoa. Um pulso de nutrientes acrescenta matéria externa ao balanço.",
    series: [["nutrientMass", "Nutrientes dissolvidos"], ["grainMass", "Grãos"], ["bodyMass", "Biomassa viva"],
      ["detritusMass", "Detrito"], ["wasteMass", "Resíduos dissolvidos"]]
  },
  energy: {
    label: "Energia", unit: "u.e.",
    description: "A reserva inicial somada à energia absorvida e descontada a energia dissipada resulta na reserva atual.",
    series: [["totalEnergy", "Reserva atual"], ["absorbedEnergy", "Absorção acumulada"], ["dissipatedEnergy", "Dissipação acumulada"]]
  },
  environment: {
    label: "Meio", unit: "índice do modelo",
    description: "A turbidez média resume as condições de visibilidade no campo. Valores locais variam entre regiões.",
    series: [["meanTurbidity", "Turbidez média"]]
  }
};

const csvColumns = [
  ["seed", "semente"], ["tick", "passo"], ["population", "organismos_vivos"],
  ["births", "nascimentos_acumulados"], ["deaths", "mortes_acumuladas"],
  ["nutrientMass", "nutrientes_dissolvidos_um"], ["wasteMass", "residuos_dissolvidos_um"],
  ["grainMass", "graos_um"], ["detritusMass", "detrito_um"], ["bodyMass", "biomassa_um"],
  ["totalMass", "materia_total_um"], ["initialMass", "materia_inicial_um"], ["nutrientInputTotal", "entrada_externa_acumulada_um"],
  ["massError", "desvio_materia_um"],
  ["totalEnergy", "energia_armazenada_ue"], ["absorbedEnergy", "energia_absorvida_acumulada_ue"],
  ["dissipatedEnergy", "energia_dissipada_acumulada_ue"], ["initialEnergy", "energia_inicial_ue"],
  ["energyError", "desvio_energia_ue"], ["meanTurbidity", "turbidez_media"],
  ["lightX", "luz_x_relativa"], ["lightY", "luz_y_relativa"]
];

const cards = [
  ["massError", "Desvio de matéria", "u.m."], ["bodyMass", "Biomassa viva", "u.m."],
  ["totalEnergy", "Energia armazenada", "u.e."], ["meanTurbidity", "Turbidez média", ""]
];

function valueText(value) {
  if (!Number.isFinite(value)) return "—";
  if (value !== 0 && Math.abs(value) < 0.01) return scientific.format(value);
  return number.format(value);
}

function svgNode(tag, attributes = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

function put(node, value) {
  if (node.textContent !== value) node.textContent = value;
}

function scaleCeiling(maximum, integers) {
  if (maximum <= 0) return integers ? 2 : 1;
  const rough = maximum / 2;
  const decade = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find(n => n * decade >= rough) || 10) * decade;
  return integers ? Math.max(2, 2 * Math.ceil(step)) : 2 * step;
}

export class ScienceDashboard {
  constructor(root) {
    this.root = root;
    this.group = "population";
    this.visible = new Set();
    this.root.classList.add("science-dashboard");
    this.root.setAttribute("aria-label", "Painel científico");
    this.root.innerHTML = `
      <div class="sd-heading">
        <h2>Painel científico</h2>
        <button type="button" class="sd-export secondary" data-export>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3"/></svg>
          Exportar CSV
        </button>
      </div>
      <dl class="sd-cards"></dl>
      <div class="sd-plot-card">
        <div class="sd-plot-head"><h3>Séries temporais</h3>
          <div class="sd-controls">
            <label>Grandeza <select data-group></select></label>
            <label>Período <select data-window>
              <option value="0">Todo o histórico</option><option value="300">Últimos 300 passos</option>
              <option value="1000">Últimos 1.000 passos</option>
            </select></label>
          </div>
        </div>
        <div class="sd-chart-layout"><div class="sd-graph">
          <div class="sd-axis-caption" data-unit></div>
          <svg class="sd-plot" role="img" focusable="false"><title></title></svg>
          <div class="sd-time-caption">Passo da simulação</div>
        </div>
        <div class="sd-series" role="group" aria-label="Séries visíveis"></div></div>
        <p class="sd-description"></p>
        <p class="sd-period"></p>
      </div>
      <section class="sd-trial" aria-label="Ensaio pareado">
        <div class="sd-trial-head"><div><h3>Ensaio pareado de nutrientes</h3>
          <p>Duas cópias deste passo avançam por 150 passos. Uma recebe 1 u.m. de nutrientes no centro da lagoa. A outra serve de controle.</p></div>
          <button type="button" class="secondary" data-run-trial>Comparar pulso com controle</button>
        </div>
        <p class="sd-trial-status" data-trial-status role="status" aria-live="polite"></p>
        <dl class="sd-trial-results" data-trial-results hidden>
          <div><dt>Δ Nutrientes dissolvidos</dt><dd data-trial="nutrientMass"></dd></div>
          <div><dt>Δ Biomassa viva</dt><dd data-trial="bodyMass"></dd></div>
          <div><dt>Δ População</dt><dd data-trial="population"></dd></div>
        </dl>
      </section>`;
    this.find = selector => this.root.querySelector(selector);
    this.values = new Map();
    for (const [key, label, unit] of cards) {
      const tile = document.createElement("div");
      tile.innerHTML = '<dt></dt><dd><strong></strong> <small></small></dd><p></p>';
      tile.querySelector("dt").textContent = label;
      tile.querySelector("small").textContent = unit;
      this.find(".sd-cards").append(tile);
      this.values.set(key, { amount: tile.querySelector("strong"), detail: tile.querySelector("p") });
    }
    this.chooser = this.find("[data-group]");
    this.window = this.find("[data-window]");
    for (const [key, group] of Object.entries(groups)) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = group.label;
      this.chooser.append(option);
    }
    this.plot = this.find(".sd-plot");
    this.title = this.plot.querySelector("title");
    this.grid = svgNode("g", { class: "sd-grid" });
    this.marks = svgNode("g", { class: "sd-lines" });
    this.plot.append(this.grid, this.marks);
    this.yAxis = Array.from({ length: 3 }, () => {
      const line = svgNode("line");
      const label = svgNode("text", { "text-anchor": "end", "dominant-baseline": "central" });
      this.grid.append(line, label);
      return { line, label };
    });
    this.xAxis = ["start", "middle", "end"].map(anchor => {
      const label = svgNode("text", { "text-anchor": anchor });
      this.grid.append(label);
      return label;
    });
    this.chooser.addEventListener("change", () => this.selectGroup(this.chooser.value));
    this.window.addEventListener("change", () => this.draw());
    this.find("[data-export]").addEventListener("click", () => this.exportCsv());
    this.find("[data-run-trial]").addEventListener("click", () => this.runTrial());
    this.selectGroup(this.group);
    this.resize = new ResizeObserver(() => this.draw());
    this.resize.observe(this.plot);
  }

  selectGroup(key) {
    this.group = key;
    const group = groups[key];
    this.visible.clear();
    this.series = [];
    const legend = this.find(".sd-series");
    legend.replaceChildren();
    this.marks.replaceChildren();
    this.find("[data-unit]").textContent = group.unit;
    this.find(".sd-description").textContent = group.description;
    group.series.forEach(([name, label], index) => {
      this.visible.add(name);
      const color = colors[index];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sd-legend";
      button.setAttribute("aria-pressed", "true");
      button.setAttribute("aria-label", label);
      button.title = "Alternar série " + label.toLowerCase();
      button.innerHTML = '<span class="sd-line-key"></span><span class="sd-series-name"></span><strong></strong>';
      const glyph = svgNode("svg", { viewBox: "0 0 24 8", "aria-hidden": true });
      glyph.append(svgNode("path", { d: "M1 4H23", stroke: color, "stroke-width": 2.4, "stroke-dasharray": dashes[index] }));
      button.querySelector(".sd-line-key").append(glyph);
      button.querySelector(".sd-series-name").textContent = label;
      legend.append(button);
      const line = svgNode("path", { fill: "none", stroke: color, "stroke-dasharray": dashes[index], "stroke-width": 2.2, "stroke-linejoin": "round", "stroke-linecap": "round" });
      const dot = svgNode("circle", { r: 3, fill: color });
      this.marks.append(line, dot);
      this.series.push({ name, line, dot, value: button.querySelector("strong") });
      button.addEventListener("click", () => {
        if (this.visible.has(name) && this.visible.size === 1) return;
        if (this.visible.has(name)) this.visible.delete(name);
        else this.visible.add(name);
        for (const [index, entry] of group.series.entries()) {
          const enabled = this.visible.has(entry[0]);
          const toggle = legend.children[index];
          toggle.setAttribute("aria-pressed", String(enabled));
          toggle.disabled = enabled && this.visible.size === 1;
        }
        this.draw();
      });
      button.disabled = group.series.length === 1;
    });
    this.draw();
  }

  reset(world) {
    this.clearTrial();
    this.world = world;
    this.localHistory = [];
    this.current = null;
    this.record(world);
    this.draw();
  }

  record(world) {
    if (this.world !== world) { this.reset(world); return; }
    if (this.current && world.tick === this.current.tick &&
        world.nutrientInputTotal === this.current.nutrientInputTotal &&
        world.light.x === this.current.lightX && world.light.y === this.current.lightY) return;
    this.current = world.getMetrics();
    if (!Array.isArray(world.telemetry) && (!this.localHistory.length || world.tick % SAMPLE_PERIOD === 0)) {
      this.localHistory.push(this.current);
      if (this.localHistory.length > HISTORY_LIMIT) this.localHistory.shift();
    }
  }

  update(world) {
    if (this.world !== world) { this.reset(world); return; }
    this.record(world);
    if (this.lastPainted !== this.current) this.draw();
  }

  samples() {
    const saved = this.world.telemetry || this.localHistory;
    return saved.at(-1)?.tick === this.current.tick ? [...saved.slice(0, -1), this.current] : [...saved, this.current];
  }

  draw() {
    if (!this.current) return;
    this.lastPainted = this.current;
    const current = this.current;
    const totalMass = valueText(current.totalMass);
    const initialMass = valueText(current.initialMass);
    const details = {
      massError: "Atual " + totalMass + " · inicial " + initialMass + " · entrada " + valueText(current.nutrientInputTotal) + " u.m.",
      bodyMass: "Soma da massa dos organismos",
      totalEnergy: "Reserva de todos os organismos",
      meanTurbidity: "Índice médio das células do campo"
    };
    for (const [key, tile] of this.values) {
      put(tile.amount, valueText(current[key]));
      put(tile.detail, details[key]);
    }
    const history = this.samples();
    const span = Number(this.window.value);
    const start = Math.max(history[0].tick, span ? current.tick - span : history[0].tick);
    const first = history.findIndex(row => row.tick >= start);
    const rows = history.slice(first);
    const end = current.tick;
    const box = this.plot.getBoundingClientRect();
    const width = Math.max(180, Math.round(box.width));
    const height = 160;
    const left = width < 360 ? 38 : 48, right = width - 10, top = 10, bottom = height - 24;
    this.plot.setAttribute("viewBox", "0 0 " + width + " " + height);
    const x = tick => start === end ? left : left + (tick - start) * (right - left) / (end - start);
    let maximum = 0;
    for (const row of rows) {
      for (const key of this.visible) {
        if (Number.isFinite(row[key])) maximum = Math.max(maximum, row[key]);
      }
    }
    const limit = scaleCeiling(maximum, this.group === "population");
    const y = value => bottom - value * (bottom - top) / limit;
    this.yAxis.forEach(({ line, label }, i) => {
      const value = limit * i / 2;
      const at = y(value);
      line.setAttribute("x1", left); line.setAttribute("x2", right);
      line.setAttribute("y1", at); line.setAttribute("y2", at);
      label.setAttribute("x", left - 6); label.setAttribute("y", at);
      put(label, valueText(value));
    });
    const ticks = [start, Math.round((start + end) / 2), end];
    this.xAxis.forEach((label, i) => {
      const tick = ticks[i];
      label.setAttribute("x", x(tick)); label.setAttribute("y", bottom + 18);
      put(label, width < 330 && i === 1 || ticks.indexOf(tick) !== i ? "" : whole.format(tick));
    });
    for (const { name, line, dot, value } of this.series) {
      put(value, valueText(current[name]));
      let path = "", last, contiguous = false;
      if (this.visible.has(name)) {
        for (const row of rows) {
          if (!Number.isFinite(row[name])) { contiguous = false; continue; }
          last = [x(row.tick), y(row[name])];
          path += (contiguous ? "L" : "M") + last.map(n => n.toFixed(2)).join(" ");
          contiguous = true;
        }
      }
      line.setAttribute("d", path);
      dot.style.display = last ? "" : "none";
      if (last) { dot.setAttribute("cx", last[0]); dot.setAttribute("cy", last[1]); }
    }
    const interval = "passos " + whole.format(start) + " a " + whole.format(end);
    put(this.title, groups[this.group].label + " por passo de simulação, " + interval + ".");
    const origin = Array.isArray(this.world.telemetry) ? "Histórico do mundo" : "Histórico desta sessão";
    const multiple = history.length !== 1;
    put(this.find(".sd-period"), origin + " · " + whole.format(history.length) + (multiple ? " registros" : " registro") +
      " · Gráfico dos " + interval + ". Amostragem a cada 10 passos, com leitura do passo atual.");
  }

  clearTrial() {
    this.trialWorker?.terminate();
    this.trialWorker = null;
    this.find("[data-run-trial]").disabled = false;
    this.find("[data-trial-status]").textContent = "";
    this.find("[data-trial-results]").hidden = true;
  }

  runTrial() {
    if (!this.world || this.trialWorker) return;
    this.clearTrial();
    const status = this.find("[data-trial-status]");
    const button = this.find("[data-run-trial]");
    const fail = () => {
      this.clearTrial();
      status.textContent = "O ensaio não foi concluído. Tente novamente.";
    };
    try {
      const worker = new Worker(new URL("./paired-trial.js", import.meta.url), { type: "module" });
      this.trialWorker = worker;
      button.disabled = true;
      status.textContent = "Em execução · semente " + this.world.seed + " · início no passo " + whole.format(this.world.tick) + ".";
      worker.onmessage = ({ data }) => {
        if (this.trialWorker !== worker) return;
        if (!data.result) { fail(); return; }
        const { seed, startTick, endTick, differences } = data.result;
        this.clearTrial();
        for (const [key, value] of Object.entries(differences)) {
          const sign = value > 0 ? "+" : "";
          const unit = key === "population" ? (Math.abs(value) === 1 ? " organismo" : " organismos") : " u.m.";
          this.find('[data-trial="' + key + '"]').textContent = sign + valueText(value) + unit;
        }
        this.find("[data-trial-results]").hidden = false;
        status.textContent = "Concluído · semente " + seed + " · passos " + whole.format(startTick) + " a " +
          whole.format(endTick) + ". Diferenças finais (pulso menos controle) para esta réplica.";
      };
      worker.onerror = () => { if (this.trialWorker === worker) fail(); };
      worker.onmessageerror = () => { if (this.trialWorker === worker) fail(); };
      worker.postMessage(this.world.serialize());
    } catch {
      fail();
    }
  }

  exportCsv() {
    if (!this.current) return;
    const lines = [csvColumns.map(([, label]) => label).join(",")];
    for (const row of this.samples()) {
      lines.push(csvColumns.map(([key]) => {
        const value = key === "seed" ? this.world.seed : row[key];
        return Number.isFinite(value) ? String(value) : "";
      }).join(","));
    }
    const url = URL.createObjectURL(new Blob([lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "xenora-lagoa-" + this.world.seed + "-passo-" + this.current.tick + ".csv";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

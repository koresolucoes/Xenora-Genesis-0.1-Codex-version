import { getSurfaceTransfer } from './surface-link.js';
import { mountWorldArchive } from './world-archive.js';
import { World } from './engine.js';
import { LagoonView } from './render.js';
import { ScienceDashboard } from './dashboard.js';
import { mountCellInspector } from './molecular-inspector.js';

const byId = id => document.getElementById(id);
const canvas = byId('lagoon');
const view = new LagoonView(canvas);
const dashboard = new ScienceDashboard(byId('dashboard'));
const cellInspector = mountCellInspector(byId('inspector-rows'), examineOrganism);
const examineCell = document.createElement('button');
examineCell.type = 'button';
examineCell.id = 'examine-cell';
examineCell.className = 'examine-cell';
examineCell.textContent = 'Examinar uma célula';
examineCell.setAttribute('aria-controls', 'cell-compartments');
document.querySelector('.key').append(examineCell);
const seedInput = byId('seed-input');
const keyInput = byId('cloud-key');
const speedLevels = [0.5, 1, 2];
const baseTicksPerSecond = 4;
const locale = 'pt-BR';
const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
const fixed = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const entityTypes = {
  organism: { list: 'organisms', name: 'Organismo', kind: 'Vida digital' },
  grain: { list: 'grains', name: 'Grão', kind: 'Partícula de recurso' },
  mineral: { list: 'minerals', name: 'Mineral', kind: 'Estrutura mineral' },
  detritus: { list: 'detritus', name: 'Detrito', kind: 'Matéria em reciclagem' }
};

let world = new World(42);
let selected = firstSelection(world);
let running = true;
let speedIndex = 1;
let showLight = true;
let tool = 'inspect';
let layer = 'natural';
let waterProbe = null;
let cursor = { x: 0.5, y: 0.5 };
let lastFrame = null;
let lastWaterPaint = -Infinity;
const visualFrameMs = 1000 / 15;
let elapsed = 0;
let dirty = true;
let renderedLog = null;
let cloudAvailable = false;
let cloudBusy = false;
let flashTimer;

function firstSelection(model) {
  for (const [type, meta] of Object.entries(entityTypes)) {
    const first = model[meta.list][0];
    if (first) return { type, id: first.id };
  }
  return null;
}

function findSelected() {
  if (!selected || !entityTypes[selected.type]) return null;
  return world[entityTypes[selected.type].list].find(item => item.id === selected.id) || null;
}

function setText(id, text) {
  const node = byId(id);
  if (node && node.textContent !== String(text)) node.textContent = text;
}

function announce(message, delay = 5000) {
  const flash = byId('flash');
  if (!flash) return;
  clearTimeout(flashTimer);
  const container = document.querySelector('dialog[open]') || document.body;
  if (flash.parentElement !== container) container.append(flash);
  flash.hidden = false;
  flash.textContent = message;
  flash.classList.add('visible');
  flashTimer = setTimeout(() => {
    flash.classList.remove('visible');
    flash.textContent = '';
    flash.hidden = true;
  }, delay);
}

function updateControls() {
  dirty = true;
  const play = byId('play');
  const playText = running ? 'Pausar' : 'Continuar';
  if (byId('play-label')) setText('play-label', playText);
  else play.textContent = playText;
  play.setAttribute('aria-label', playText + ' simulação');
  play.setAttribute('aria-pressed', String(running));
  play.querySelectorAll('[data-play-icon]').forEach(icon => icon.toggleAttribute('hidden', running));
  play.querySelectorAll('[data-pause-icon]').forEach(icon => icon.toggleAttribute('hidden', !running));
  setText('state-label', running ? 'Em execução' : 'Em pausa');
  byId('state-label')?.setAttribute('data-state', running ? 'running' : 'paused');
  const speedText = format.format(speedLevels[speedIndex]) + '×';
  if (byId('speed-label')) setText('speed-label', speedText);
  else setText('speed', speedText);
  byId('speed').setAttribute('aria-label', 'Velocidade ' + speedText + '. Alterar velocidade');
  byId('move-light').setAttribute('aria-pressed', String(tool === 'light'));
  byId('light-layer').setAttribute('aria-pressed', String(showLight));
  byId('light-layer').classList.toggle('active', showLight);
  byId('pulse').setAttribute('aria-pressed', String(tool === 'pulse'));
  canvas.style.cursor = tool === 'inspect' ? '' : 'crosshair';
}

function pauseOrPlay(next) {
  running = next;
  elapsed = 0;
  lastFrame = null;
  updateControls();
}

function selectEntity(next, point = null) {
  selected = next;
  waterProbe = next ? null : point;
  dirty = true;
}

function replaceWorld(next, play = false, archiveRestore = false) {
  if (!archiveRestore) archive.detach();
  world = next;
  selected = firstSelection(next);
  seedInput.value = String(next.seed);
  tool = 'inspect';
  waterProbe = null;
  dashboard.reset(world);
  view.invalidate?.();
  renderedLog = null;
  dirty = true;
  pauseOrPlay(play);
}

function kvRows(rows) {
  const target = byId('inspector-rows');
  const fragment = document.createDocumentFragment();
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.className = 'inspector-row';
    const term = document.createElement('dt');
    term.textContent = label;
    const definition = document.createElement('dd');
    definition.textContent = value;
    row.append(term, definition);
    fragment.append(row);
  }
  target.replaceChildren(fragment);
}

function positionText(item) {
  return fixed.format(item.x * 100) + '%, ' + fixed.format(item.y * 100) + '%';
}

function waterReadings(point) {
  const sample = world.environment.sample(point.x, point.y);
  const flow = world.environment.flowAt(point.x, point.y);
  return [
    ['Nutriente', format.format(sample.nutrient) + ' u.m./área'],
    ['Resíduo', format.format(sample.waste) + ' u.m./área'],
    ['Luz disponível', format.format(world.lightAt(point.x, point.y) * 100) + '%'],
    ['Transmissão da água', format.format(sample.transmission * 100) + '%'],
    ['Corrente', new Intl.NumberFormat(locale, {maximumFractionDigits: 5}).format(Math.hypot(flow.x, flow.y)) + ' L/passo']
  ];
}

function renderInspector() {
  const reticle = byId('sample-reticle');
  const target = tool !== 'inspect' ? cursor : waterProbe;
  reticle.hidden = !target;
  if (target) {
    reticle.style.left = (target.x * 100) + '%';
    reticle.style.top = (target.y * 100) + '%';
  }
  byId('specimen-canvas').hidden = Boolean(waterProbe);
  byId('water-lens').hidden = !waterProbe;
  const item = findSelected();
  examineCell.disabled = world.organisms.length === 0;
  cellInspector.show(!waterProbe && selected?.type === 'organism' ? item : null, world.organisms);
  if (waterProbe) {
    setText('inspector-title', 'Coluna de água');
    setText('inspector-kind', 'Sonda ambiental');
    setText('water-coordinate', positionText(waterProbe));
    kvRows(waterReadings(waterProbe));
    return;
  }
  if (!item) {
    setText('inspector-title', selected ? entityTypes[selected.type].name + ' ' + selected.id : 'Selecione uma entidade');
    setText('inspector-kind', selected ? 'Saiu do campo' : 'Inspeção');
    kvRows([[selected ? 'Último estado' : 'No mapa', selected ? 'Entidade encerrada' : 'Clique em uma entidade']]);
    return;
  }
  const info = entityTypes[selected.type];
  setText('inspector-title', info.name + ' ' + String(item.id).padStart(3, '0'));
  setText('inspector-kind', info.kind);
  let rows;
  if (selected.type === 'organism' && item.cell) {
    rows = [
      ['Sensibilidade', fixed.format(item.sensitivity)],
      ['Luz local', format.format(world.lightAt(item.x, item.y) * 100) + '%'],
      ['Nutriente local', format.format(world.environment.sample(item.x, item.y).nutrient) + ' u.m./área'],
      ['Idade', format.format(item.age) + ' passos']
    ];
  } else if (selected.type === 'organism') {
    rows = [
      ['Geração', String(item.generation)],
      ['Reserva de energia', fixed.format(item.energy)],
      ['Massa estrutural', fixed.format(item.mass)],
      ['Sensibilidade', fixed.format(item.sensitivity)],
      ['Luz local', format.format(world.lightAt(item.x, item.y) * 100) + '%'],
      ['Nutriente local', format.format(world.environment.sample(item.x, item.y).nutrient) + ' u.m./área'],
      ['Idade', format.format(item.age) + ' passos'],
      ['Progenitor', item.parent == null ? 'Fundador' : '#' + item.parent]
    ];
  } else if (selected.type === 'mineral') {
    rows = [['Raio no campo', fixed.format(item.radius * 100) + '%']];
  } else {
    rows = [['Massa', fixed.format(item.mass)]];
  }
  rows.push(['Posição', positionText(item)]);
  kvRows(rows);
}

function renderEvents() {
  const events = world.events.slice().reverse();
  const signature = JSON.stringify(events);
  if (renderedLog === signature) return;
  renderedLog = signature;
  const list = byId('log-list');
  const rows = events.map(event => {
    const li = document.createElement('li');
    const time = document.createElement('span');
    time.className = 'log-tick';
    time.textContent = String(event.tick).padStart(4, '0');
    const description = document.createElement('span');
    description.className = 'log-message';
    description.textContent = event.text;
    li.append(time, description);
    return li;
  });
  if (!rows.length) {
    const empty = document.createElement('li');
    empty.textContent = 'Aguardando o primeiro evento.';
    rows.push(empty);
  }
  list.replaceChildren(...rows);
}

function renderPanels() {
  dashboard.update(world);
  const metrics = world.getMetrics();
  setText('field-name', (world.originSample ? 'Amostra de superfície ' : 'Lagoa ') + String(world.seed).padStart(3, '0'));
  setText('tick', String(metrics.tick).padStart(4, '0'));
  setText('population', metrics.population);
  setText('grain-count', world.grains.length);
  renderInspector();
  renderEvents();
}

function frame(now) {
  if (lastFrame !== null && running) {
    elapsed += Math.min(now - lastFrame, 250);
    const interval = 1000 / (baseTicksPerSecond * speedLevels[speedIndex]);
    while (elapsed >= interval) {
      world.step();
      dashboard.record(world);
      elapsed -= interval;
      dirty = true;
    }
  }
  lastFrame = now;
  const repaintWater = dirty || (running && layer === 'natural' && now - lastWaterPaint >= visualFrameMs);
  if (dirty) {
    renderPanels();
    const specimen = byId('specimen-canvas');
    if (!waterProbe && specimen && typeof view.drawSpecimen === 'function') {
      view.drawSpecimen(specimen, world, selected, now);
    }
    dirty = false;
  }
  if (repaintWater) {
    const rate = baseTicksPerSecond * speedLevels[speedIndex];
    const renderTick = running ? world.tick + Math.min(1, elapsed * rate / 1000) : world.tick;
    view.draw(world, {selected, showLight, now, layer, renderTick});
    lastWaterPaint = now;
  }
  requestAnimationFrame(frame);
}

function examineOrganism(id) {
  const organism = world.organisms.find(other => other.id === id);
  if (!organism) { announce('Esta célula já saiu da lagoa.'); return; }
  tool = 'inspect';
  selectEntity({ type: 'organism', id: organism.id });
  updateControls();
  renderInspector();
  cellInspector.open();
  const heading = byId('inspector-title');
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
  document.querySelector('.specimen').scrollIntoView({ block: 'nearest' });
}

examineCell.addEventListener('click', () => {
  const current = selected?.type === 'organism' ? findSelected() : null;
  const organism = current || world.organisms[0];
  if (organism) examineOrganism(organism.id);
});

byId('play').addEventListener('click', () => pauseOrPlay(!running));
byId('step').addEventListener('click', () => {
  pauseOrPlay(false);
  world.step();
  dashboard.record(world);
  dirty = true;
});
byId('speed').addEventListener('click', () => {
  speedIndex = (speedIndex + 1) % speedLevels.length;
  elapsed = 0;
  updateControls();
});
byId('light-layer').addEventListener('click', () => {
  showLight = !showLight;
  updateControls();
});
const fieldKeys = {
  nutrient: ['Nutriente · meia escala em 65 u.m./área', '#f0e7aa'],
  waste: ['Resíduo · meia escala em 35 u.m./área', '#ed8299'],
  flow: ['Velocidade · 0 a 0,00058 L/passo', '#81d8c8'],
  light: ['Intensidade local · 0 a 100%', '#fff0bd']
};
byId('field-layer').addEventListener('change', event => {
  layer = event.target.value;
  const key = fieldKeys[layer];
  const legend = byId('map-legend');
  legend.hidden = !key;
  if (key) {
    legend.textContent = key[0];
    legend.style.setProperty('--keycolor', key[1]);
  }
  dirty = true;
});

function armTool(next) {
  tool = tool === next ? 'inspect' : next;
  const item = findSelected();
  const initial = tool === 'light' ? world.light : waterProbe || item || world.light;
  cursor = {x:initial.x, y:initial.y};
  updateControls();
  if (tool !== 'inspect') {
    canvas.focus({preventScroll:true});
    const action = tool === 'light' ? 'mover a luz' : 'injetar 1 unidade de nutriente';
    announce('Clique na água para ' + action + '. Teclado: setas e Enter.', 5500);
  }
}
byId('move-light').addEventListener('click', () => armTool('light'));
byId('pulse').addEventListener('click', () => armTool('pulse'));

function applyTool(point) {
  const {x, y} = point;
  if (tool === 'light') {
    world.setLight(x, y);
    announce('Fonte de luz reposicionada.');
  } else if (tool === 'pulse') {
    world.addNutrientPulse(x, y, 1);
    selectEntity(null, {x, y});
    announce('1 unidade de nutriente adicionada. A sonda acompanha este ponto.');
  }
  view.invalidate?.();
  dashboard.record(world);
  tool = 'inspect';
  updateControls();
}

canvas.addEventListener('click', event => {
  const point = view.coordinates(event.clientX, event.clientY);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  if (tool !== 'inspect') { applyTool(point); return; }
  selectEntity(view.pick(world, event.clientX, event.clientY) || null, point);
});

canvas.tabIndex = 0;
canvas.addEventListener('keydown', event => {
  if (tool !== 'inspect') {
    const delta = {ArrowLeft:[-0.04,0], ArrowRight:[0.04,0], ArrowUp:[0,-0.04], ArrowDown:[0,0.04]}[event.key];
    if (delta) {
      event.preventDefault();
      cursor = {x:Math.max(0,Math.min(1,cursor.x+delta[0])),y:Math.max(0,Math.min(1,cursor.y+delta[1]))};
      dirty = true;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      applyTool(cursor);
    } else if (event.key === 'Escape') {
      tool = 'inspect';
      updateControls();
    }
    return;
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    const entities = Object.entries(entityTypes).flatMap(([type, spec]) =>
      world[spec.list].map(({ id }) => ({ type, id })));
    if (!entities.length) return;
    const current = entities.findIndex(item => item.type === selected?.type && item.id === selected.id);
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const index = current === -1 ? 0 : (current + direction + entities.length) % entities.length;
    selectEntity(entities[index]);
  }
});

byId('reset').addEventListener('click', () => {
  const input = seedInput.value.trim();
  const seed = Number(input);
  if (!input || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
    announce('Use uma semente inteira entre 0 e 4294967295.');
    seedInput.focus();
    return;
  }
  replaceWorld(new World(seed), running);
  announce('Lagoa reiniciada com a semente ' + seed + '.');
});

const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.json,application/json';
fileInput.hidden = true;
document.body.append(fileInput);

byId('save').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(world.serialize())], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'xenora-lagoa-' + world.seed + '-passo-' + world.tick + '.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  announce('Checkpoint exportado no passo ' + world.tick + '.');
});

byId('load').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  try {
    const restored = World.restore(JSON.parse(await file.text()));
    replaceWorld(restored);
    announce('Checkpoint aberto no passo ' + restored.tick + '.');
  } catch {
    announce('Arquivo inválido ou incompatível. A lagoa atual foi preservada.');
  }
});

function showCloud(available) {
  cloudAvailable = available;
  const group = byId('cloud-controls');
  if (group) group.hidden = !available;
  for (const id of ['cloud-key', 'cloud-save', 'cloud-load', 'copy-key']) {
    const element = byId(id);
    if (element) element.hidden = !available;
  }
}

async function checkCloud() {
  showCloud(false);
  try {
    const response = await fetch('/api/health', { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (response.ok) showCloud((await response.json()).storage === true);
  } catch {
    showCloud(false);
  }
}

function setCloudBusy(busy) {
  cloudBusy = busy;
  byId('cloud-save').disabled = busy;
  byId('cloud-load').disabled = busy;
}

function cloudFailure(status) {
  if (status === 401 || status === 403 || status === 404) return 'Chave inválida ou checkpoint indisponível.';
  if (status === 413) return 'Este checkpoint excede o limite da nuvem.';
  if (status === 429) return 'Muitas solicitações. Aguarde e tente novamente.';
  return 'Serviço de checkpoints indisponível. Você pode usar um arquivo local.';
}

byId('cloud-save').addEventListener('click', async () => {
  if (!cloudAvailable || cloudBusy) return;
  const tick = world.tick;
  setCloudBusy(true);
  try {
    const response = await fetch('/api/checkpoints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ checkpoint: world.serialize() })
    });
    if (!response.ok) { announce(cloudFailure(response.status)); return; }
    const { id, token } = await response.json();
    if (typeof id !== 'string' || typeof token !== 'string' || !id || !token) throw new Error();
    keyInput.value = id + '.' + token;
    keyInput.focus({ preventScroll: true });
    keyInput.select();
    announce('Passo ' + tick + ' salvo. Copie e guarde a chave para reabrir a lagoa.');
  } catch {
    announce('Não foi possível salvar na nuvem.');
  } finally {
    setCloudBusy(false);
  }
});

byId('cloud-load').addEventListener('click', async () => {
  if (!cloudAvailable || cloudBusy) return;
  const parts = keyInput.value.trim().split('.');
  if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) {
    announce('Informe a chave completa no formato identificador.token.');
    keyInput.focus();
    return;
  }
  setCloudBusy(true);
  try {
    const response = await fetch('/api/checkpoints/' + encodeURIComponent(parts[0]), {
      headers: { Authorization: 'Bearer ' + parts[1], Accept: 'application/json' },
      cache: 'no-store'
    });
    if (!response.ok) { announce(cloudFailure(response.status)); return; }
    const { checkpoint } = await response.json();
    const restored = World.restore(checkpoint);
    replaceWorld(restored);
    announce('Checkpoint da nuvem aberto no passo ' + restored.tick + '.');
  } catch {
    announce('Não foi possível abrir o checkpoint da nuvem.');
  } finally {
    setCloudBusy(false);
  }
});

byId('copy-key')?.addEventListener('click', async () => {
  if (!keyInput.value.trim()) { announce('Salve um checkpoint para gerar a chave.'); return; }
  try {
    await navigator.clipboard.writeText(keyInput.value.trim());
    announce('Chave copiada.');
  } catch {
    keyInput.focus();
    keyInput.select();
    announce('Chave selecionada. Use o comando Copiar do navegador.');
  }
});

const archive = mountWorldArchive(byId('world-archive'), {
  mode: 'lagoon-molecular',
  getSnapshot: () => world.serialize(),
  restoreSnapshot: snapshot => replaceWorld(World.restore(snapshot), false, true)
});

document.addEventListener('visibilitychange', () => { lastFrame = null; elapsed = 0; });
const resize = new ResizeObserver(() => { dirty = true; });
resize.observe(canvas);
if (byId('specimen-canvas')) resize.observe(byId('specimen-canvas'));
try {
  const transfer = getSurfaceTransfer();
  if (transfer) {
    replaceWorld(World.fromSurfaceSample(transfer.sample), false);
    const originLink = document.querySelector('.origin-nav');
    originLink.href = './primordial.html?origem=' + encodeURIComponent(transfer.id);
    originLink.textContent = 'Voltar à origem';
    announce('Uma célula virtual foi introduzida nesta amostra de superfície.', 6500);
  }
} catch (error) { announce(error.message); }
dashboard.reset(world);
seedInput.value = String(world.seed);
byId('flash')?.setAttribute('role', 'status');
updateControls();
checkCloud();
requestAnimationFrame(frame);

import { World } from './engine.js';
import { LagoonView } from './render.js';

const byId = id => document.getElementById(id);
const canvas = byId('lagoon');
const view = new LagoonView(canvas);
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
let movingLight = false;
let lastFrame = null;
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
  byId('move-light').setAttribute('aria-pressed', String(movingLight));
  byId('light-layer').setAttribute('aria-pressed', String(showLight));
  byId('light-layer').classList.toggle('active', showLight);
  canvas.classList.toggle('placing-light', movingLight);
  canvas.style.cursor = movingLight ? 'crosshair' : '';
}

function pauseOrPlay(next) {
  running = next;
  elapsed = 0;
  lastFrame = null;
  updateControls();
}

function selectEntity(next) {
  selected = next;
  dirty = true;
}

function replaceWorld(next, play = false) {
  world = next;
  selected = firstSelection(next);
  seedInput.value = String(next.seed);
  movingLight = false;
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

function renderInspector() {
  const item = findSelected();
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
  if (selected.type === 'organism') {
    rows = [
      ['Geração', String(item.generation)],
      ['Reserva de energia', fixed.format(item.energy)],
      ['Massa estrutural', fixed.format(item.mass)],
      ['Sensibilidade', fixed.format(item.sensitivity)],
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
  const metrics = world.getMetrics();
  setText('field-name', 'Lagoa ' + String(world.seed).padStart(3, '0'));
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
      elapsed -= interval;
      dirty = true;
    }
  }
  lastFrame = now;
  if (dirty) {
    renderPanels();
    view.draw(world, { selected, showLight, now });
    const specimen = byId('specimen-canvas');
    if (specimen && typeof view.drawSpecimen === 'function') {
      view.drawSpecimen(specimen, world, selected, now);
    }
    dirty = false;
  }
  requestAnimationFrame(frame);
}

byId('play').addEventListener('click', () => pauseOrPlay(!running));
byId('step').addEventListener('click', () => {
  pauseOrPlay(false);
  world.step();
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
byId('move-light').addEventListener('click', () => {
  movingLight = !movingLight;
  updateControls();
  if (movingLight) {
    canvas.focus({ preventScroll: true });
    announce('Clique na lagoa para mover a luz. Pelo teclado, use as setas e confirme com Enter.', 7500);
  }
});

function moveLight(x, y) {
  world.setLight(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)));
  dirty = true;
}

canvas.addEventListener('click', event => {
  if (movingLight) {
    const point = view.coordinates(event.clientX, event.clientY);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    moveLight(point.x, point.y);
    movingLight = false;
    updateControls();
    announce('Fonte de luz reposicionada.');
    return;
  }
  selectEntity(view.pick(world, event.clientX, event.clientY) || null);
});

canvas.tabIndex = 0;
canvas.addEventListener('keydown', event => {
  if (movingLight) {
    const offset = { ArrowLeft: [-0.05, 0], ArrowRight: [0.05, 0], ArrowUp: [0, -0.05], ArrowDown: [0, 0.05] }[event.key];
    if (offset) {
      event.preventDefault();
      moveLight(world.light.x + offset[0], world.light.y + offset[1]);
    } else if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      movingLight = false;
      updateControls();
      announce('Posicionamento da luz encerrado.');
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

document.addEventListener('visibilitychange', () => { lastFrame = null; elapsed = 0; });
const resize = new ResizeObserver(() => { dirty = true; });
resize.observe(canvas);
if (byId('specimen-canvas')) resize.observe(byId('specimen-canvas'));
view.back?.addEventListener('load', () => { dirty = true; }, { once: true });
seedInput.value = String(world.seed);
byId('flash')?.setAttribute('role', 'status');
updateControls();
checkCloud();
requestAnimationFrame(frame);

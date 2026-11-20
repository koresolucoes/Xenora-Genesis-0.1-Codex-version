import { LivingWater } from './living-water.js'

const TAU = Math.PI * 2
const groups = { organism: 'organisms', grain: 'grains', mineral: 'minerals', detritus: 'detritus' }
const paintOrder = ['mineral', 'detritus', 'grain', 'organism']
const sprites = new Map()
const specimenFrames = new WeakMap()
const clamp = (value, lo, hi) => Math.max(lo, Math.min(value, hi))

function hash(value) {
  let h = 2166136261
  for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}

function random(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function dimensions(canvas) {
  const rect = canvas.getBoundingClientRect()
  const w = Math.max(1, canvas.clientWidth || rect.width || 1)
  const h = Math.max(1, canvas.clientHeight || rect.height || 1)
  const dpr = clamp(window.devicePixelRatio || 1, 1, 2)
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  const ctx = canvas.getContext('2d')
  ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0)
  return { ctx, w, h }
}

function ellipse(ctx, x, y, rx, ry, fill, rotation = 0, stroke = '', lineWidth = 0.6) {
  ctx.beginPath()
  ctx.ellipse(x, y, rx, ry, rotation, 0, TAU)
  if (fill) { ctx.fillStyle = fill; ctx.fill() }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke() }
}

function polygon(ctx, points, fill, stroke, width = 1) {
  ctx.beginPath()
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y))
  ctx.closePath()
  if (fill) { ctx.fillStyle = fill; ctx.fill() }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke() }
}

function gradient(ctx, x, y, r, colors) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  for (const [at, color] of colors) g.addColorStop(at, color)
  return g
}

function smoothPath(ctx, vertices, scale = 1) {
  const n = vertices.length
  const p = i => vertices[(i + n) % n]
  const mid = (a, b, k) => (a[k] + b[k]) * 0.5 * scale
  ctx.beginPath()
  ctx.moveTo(mid(p(-1), p(0), 0), mid(p(-1), p(0), 1))
  for (let i = 0; i < n; i++) {
    ctx.quadraticCurveTo(p(i)[0] * scale, p(i)[1] * scale, mid(p(i), p(i + 1), 0), mid(p(i), p(i + 1), 1))
  }
  ctx.closePath()
}

// All specimen art is drawn in the same local coordinate system as its overview sprite.
function organism(ctx, seed) {
  const rng = random(seed + 337)
  const phase = rng() * TAU
  const broad = 20 + rng() * 8
  const point = a => {
    const shape = 1 + 0.075 * Math.sin(3 * a + phase) + 0.04 * Math.sin(5 * a - phase)
    return [Math.cos(a) * 42 * shape, Math.sin(a) * broad * shape * (1.04 - 0.17 * Math.cos(a)) + 2.6 * Math.cos(2 * a + phase)]
  }
  const membrane = Array.from({ length: 22 }, (_, i) => point(TAU * i / 22))
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Paired translucent flagella have a dark core behind their lit rim.
  for (let i = 0; i < 3; i++) {
    const a = Math.PI + (i - 1) * 0.27
    const [x, y] = point(a)
    const extension = 10 + rng() * 12
    const bend = (i - 1) * 9 + Math.sin(phase) * 4
    ctx.beginPath()
    ctx.moveTo(x + 2, y)
    ctx.bezierCurveTo(x - 8, y + bend * 0.2, x - 10, y + bend + 6, x - extension, y + bend)
    ctx.lineWidth = 1.7 - i * 0.19
    ctx.strokeStyle = 'rgba(45,103,88,.8)'
    ctx.stroke()
    ctx.lineWidth = 0.74
    ctx.strokeStyle = 'rgba(173,238,187,.77)'
    ctx.stroke()
  }
  const ciliaCount = 31
  for (let i = 0; i < ciliaCount; i++) {
    const a = (i + rng() * 0.48) / ciliaCount * TAU
    const [x, y] = point(a)
    const l = 2.2 + rng() * 6
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.75, y + Math.sin(a) * l * 0.75, x + Math.cos(a + 0.26) * l, y + Math.sin(a + 0.28) * l)
    ctx.lineWidth = 0.52 + rng() * 0.38
    ctx.strokeStyle = 'rgba(166,224,186,' + (0.32 + rng() * 0.45) + ')'
    ctx.stroke()
  }

  const body = ctx.createLinearGradient(-12, -30, 10, 34)
  body.addColorStop(0, 'rgba(163,225,176,.91)')
  body.addColorStop(0.13, 'rgba(74,153,126,.90)')
  body.addColorStop(0.40, 'rgba(27,97,81,.86)')
  body.addColorStop(0.75, 'rgba(41,100,82,.87)')
  body.addColorStop(1, 'rgba(110,175,137,.94)')
  smoothPath(ctx, membrane)
  ctx.fillStyle = body
  ctx.fill()
  ctx.lineWidth = 2.0
  ctx.strokeStyle = 'rgba(26,67,56,.98)'
  ctx.stroke()
  const rim = ctx.createLinearGradient(-30, -24, 28, 25)
  rim.addColorStop(0, '#e1f8c9')
  rim.addColorStop(0.36, '#93cfa5')
  rim.addColorStop(0.65, '#4c9f8c')
  rim.addColorStop(1, '#b5db9e')
  ctx.lineWidth = 1.2
  ctx.strokeStyle = rim
  ctx.stroke()

  ctx.save()
  ctx.clip()
  const translight = gradient(ctx, -9, -4, 32, [[0, 'rgba(184,237,126,.29)'], [0.5, 'rgba(100,186,120,.15)'], [1, 'rgba(20,70,62,0)']])
  ctx.fillStyle = translight
  ctx.fillRect(-55, -40, 110, 80)
  for (let i = 0; i < 86; i++) {
    const x = (rng() - 0.5) * 83
    const y = (rng() - 0.5) * broad * 2.1
    const size = 0.18 + rng() * 0.95
    ellipse(ctx, x, y, size * 1.3, size, i % 3 ? 'rgba(191,224,149,.40)' : 'rgba(14,59,58,.66)', rng() * Math.PI)
  }
  // Thin folded membranes just inside the cell wall.
  for (let i = 0; i < 17; i++) {
    const a = (i / 17 + 0.022 * rng()) * TAU
    const end = a + 0.23 + rng() * 0.22
    const p = point(a), q = point(end), m = point((a + end) * 0.5)
    const inset = 0.69 + rng() * 0.21
    ctx.beginPath()
    ctx.moveTo(p[0] * 0.93, p[1] * 0.93)
    ctx.quadraticCurveTo(m[0] * inset, m[1] * inset, q[0] * 0.93, q[1] * 0.93)
    ctx.strokeStyle = i % 3 ? 'rgba(168,216,155,.73)' : 'rgba(19,76,68,.83)'
    ctx.lineWidth = i % 3 ? 0.65 : 1.1
    ctx.stroke()
  }
  for (let i = 0; i < 8; i++) {
    const a = TAU * (i + rng()) / 8
    const x = Math.cos(a) * (19 + rng() * 11), y = Math.sin(a) * (broad * 0.53 + rng() * 4)
    const rx = 2 + rng() * 3.4, ry = rx * (0.48 + rng() * 0.34)
    const rot = rng() * Math.PI
    ellipse(ctx, x, y, rx, ry, 'rgba(21,77,68,.80)', rot, 'rgba(161,212,156,.80)', 0.69)
    ellipse(ctx, x - 0.5, y - 0.4, rx * 0.43, ry * 0.4, 'rgba(125,181,139,.65)', rot)
  }
  // A dense, irregular nucleus is distinct from the clear, watery cytoplasm.
  const nx = -6 + rng() * 12, ny = -2 + rng() * 4
  const nucleus = Array.from({ length: 15 }, (_, i) => {
    const a = i * TAU / 15
    const k = 0.87 + rng() * 0.23
    return [Math.cos(a) * 14.4 * k, Math.sin(a) * 9.3 * k]
  })
  ctx.save()
  ctx.translate(nx, ny)
  ctx.rotate((rng() - 0.5) * 0.7)
  ctx.fillStyle = gradient(ctx, -1, 0, 22, [[0, 'rgba(204,241,103,.50)'], [0.51, 'rgba(156,216,91,.30)'], [1, 'rgba(126,203,78,0)']])
  ctx.fillRect(-24, -24, 48, 48)
  smoothPath(ctx, nucleus)
  const nuc = ctx.createLinearGradient(-5, -9, 5, 10)
  nuc.addColorStop(0, '#ebf8ab')
  nuc.addColorStop(0.26, '#d7ee85')
  nuc.addColorStop(0.72, '#9bbd55')
  nuc.addColorStop(1, '#759a56')
  ctx.fillStyle = nuc
  ctx.fill()
  ctx.strokeStyle = '#8baf64'
  ctx.lineWidth = 1.1
  ctx.stroke()
  ctx.clip()
  for (let i = 0; i < 28; i++) {
    const x = (rng() - 0.5) * 29, y = (rng() - 0.5) * 18
    const r = 0.47 + rng() * 1.65
    ellipse(ctx, x, y, r, r * 0.66, i % 3 ? 'rgba(97,137,70,.52)' : 'rgba(244,255,191,.81)', rng() * Math.PI)
  }
  ellipse(ctx, -3, -3.8, 3.5, 1.7, 'rgba(251,255,185,.86)', -0.3)
  ctx.restore()
  ctx.restore()
}

function crystal(ctx, x, y, radius, palette, rng, stretch = 0.75, angle = 0) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  const count = 6 + Math.floor(rng() * 2)
  const pts = Array.from({ length: count }, (_, i) => {
    const a = (i + 0.1 * rng()) * TAU / count
    const k = radius * (0.80 + rng() * 0.18)
    return [Math.cos(a) * k, Math.sin(a) * k * stretch]
  })
  polygon(ctx, pts, palette[0], palette[0], 1.6)
  const ridge = [-radius * 0.16, -radius * stretch * 0.25]
  for (let i = 0; i < count; i++) {
    polygon(ctx, [pts[i], pts[(i + 1) % count], ridge], palette[(i + 1) % palette.length], null)
  }
  const ridge2 = [radius * 0.34, radius * stretch * 0.09]
  polygon(ctx, [ridge, ridge2, pts[0], pts[count-1]], palette[1], null)
  // Fine inclusions and short reflected fractures sit underneath the polished edge.
  ctx.save()
  polygon(ctx, pts, null, null)
  ctx.clip()
  for (let i = 0; i < 24; i++) {
    const x = (rng()-0.5)*radius*1.7, y = (rng()-0.5)*radius*1.5*stretch
    const size = radius * (0.009 + rng()*0.02)
    ellipse(ctx,x,y,size*1.5,size,i%4 ? 'rgba(243,232,215,.20)' : 'rgba(34,30,37,.32)',angle)
  }
  ctx.beginPath()
  ctx.moveTo(-radius*0.62, 0)
  ctx.lineTo(-radius*0.14,-radius*stretch*0.35)
  ctx.lineTo(radius*0.12,-radius*stretch*0.23)
  ctx.lineWidth = 0.54
  ctx.strokeStyle = 'rgba(251,240,226,.53)'
  ctx.stroke()
  ctx.restore()
  ctx.strokeStyle = palette[palette.length - 1]; ctx.lineWidth = 0.65
  ctx.beginPath(); ctx.moveTo(...pts[count-2]); ctx.lineTo(...ridge); ctx.lineTo(...ridge2); ctx.lineTo(...pts[0]); ctx.stroke()
  ctx.restore()
}

function particulate(ctx, type, seed) {
  const rng = random(seed + 813)
  const angle = (rng() - 0.5) * 0.8
  if (type === 'mineral') {
    const cold = ['#453b55', '#786583', '#95859d', '#bba7be', '#7f778a', '#62556d', '#62596d', '#c8bbcd']
    crystal(ctx, -15, 6, 19, cold, rng, 0.84, -0.6)
    crystal(ctx, 14, 5, 18, cold, rng, 0.73, -0.92)
    crystal(ctx, 0, -5, 33, cold, rng, 0.56, -0.79 + angle)
    crystal(ctx, -3, 14, 13, cold, rng, 0.65, 0.3)
  } else if (type === 'grain') {
    const gold = ['#704a29', '#d39b52', '#e4ad5a', '#f5cf7b', '#b5793e', '#9b6637', '#edb56b', '#ffe5a2']
    ctx.fillStyle = gradient(ctx, 0, 0, 47, [[0, 'rgba(217,145,48,.27)'], [0.45, 'rgba(222,155,50,.10)'], [1, 'rgba(222,155,50,0)']])
    ctx.fillRect(-48, -48, 96, 96)
    crystal(ctx, 0, 0, 32, gold, rng, 0.72, -0.32 + angle)
    crystal(ctx, -12, 10, 11.5, gold, rng, 0.68, -0.12)
    ellipse(ctx, -7, -6, 3, 1.6, 'rgba(255,237,174,.87)', -0.38)
  } else {
    const ruby = ['#4b2f37', '#875056', '#a75f63', '#c87975', '#72434a', '#673942', '#a96163', '#d58f84']
    crystal(ctx, -4, 3, 25, ruby, rng, 0.73, angle)
    crystal(ctx, 10, -8, 15, ruby, rng, 0.75, -0.7)
    crystal(ctx, 14, 14, 7, ruby, rng, 0.63, 0.3)
  }
}

function sprite(type, entity) {
  const variant = hash(entity.id) % (type === 'organism' ? 96 : 32)
  const key = type + variant
  if (sprites.has(key)) return sprites.get(key)
  const image = makeCanvas(264, 224)
  const ctx = image.getContext('2d')
  ctx.translate(132, 112)
  ctx.scale(2, 2)
  const seed = hash(key)
  if (type === 'organism') organism(ctx, seed)
  else particulate(ctx, type, seed)
  sprites.set(key, image)
  return image
}

function sizeFor(type, entity, width, height) {
  const scale = clamp(Math.min(width, height * 1.35) / 650, 0.70, 1.65)
  const m = Math.max(0.1, Number(entity.mass) || 1)
  if (type === 'organism') return scale * clamp(16.2 + 2.0 * Math.log2(m + 1), 14, 32)
  if (type === 'grain') return scale * clamp(3.7 + Math.log2(m + 1) * 0.58, 3.5, 11)
  if (type === 'mineral') {
    const r = Number(entity.radius) || 0
    return r > 0 && r <= 0.15 ? clamp(r * Math.min(width, height), 5 * scale, 29 * scale) : 11.2 * scale
  }
  return scale * clamp(3.1 + Math.log2(m + 1) * 0.65, 3.2, 9)
}

function orientation(type, entity) {
  return type === 'organism' ? Number(entity.angle) || 0 : ((hash(entity.id) % 180) / 180 - 0.5) * Math.PI
}

function paintEntity(ctx, type, ent, x, y, radius, tick = 0) {
  const s = radius / (type === 'organism' ? 42 : type === 'grain' ? 31 : type === 'mineral' ? 34 : 27)
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(orientation(type, ent))
  // A slight contraction is tied to simulation time, including in the microscope.
  const pulse = type === 'organism' ? 1 + 0.020 * Math.sin(tick * 0.33 + (ent.phase || 0)) : 1
  ctx.scale(s * pulse, s / pulse)
  ctx.drawImage(sprite(type, ent), -66, -56, 132, 112)
  ctx.restore()
}

function markSelection(ctx, x, y, radius) {
  const r = radius + Math.max(4,radius * 0.28)
  ctx.save()
  ctx.lineWidth = 0.95
  ctx.strokeStyle = 'rgba(202,224,131,.92)'
  for (let i = 0; i<4; i++) {
    const a = i * Math.PI/2
    ctx.beginPath(); ctx.arc(x,y,r,a+0.25,a+1.28); ctx.stroke()
  }
  ctx.restore()
}

function selectedEntity(world, sel) {
  if (!sel || !groups[sel.type]) return null
  return world[groups[sel.type]]?.find(e => String(e.id) === String(sel.id)) || null
}

export class LagoonView {
  constructor(canvas) {
    this.canvas = canvas
    this.water = new LivingWater()
    this.zoom = 1
    this.center = { x: 0.5, y: 0.5 }
  }

  setZoom(value, center = this.center) {
    const factor = clamp(Number(value) || 1, 1, 3)
    const half = 0.5 / factor
    this.zoom = factor
    this.center = { x: clamp(center?.x ?? 0.5, half, 1 - half), y: clamp(center?.y ?? 0.5, half, 1 - half) }
  }

  invalidate() {
    this.lastFrame = null
    this.water.frame = null
  }

  coordinates(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect()
    return {
      x: clamp(this.center.x + ((clientX - rect.left) / (rect.width || 1) - 0.5) / this.zoom, 0, 1),
      y: clamp(this.center.y + ((clientY - rect.top) / (rect.height || 1) - 0.5) / this.zoom, 0, 1)
    }
  }

  pick(world, clientX, clientY) {
    const { x, y } = this.coordinates(clientX, clientY)
    const rect = this.canvas.getBoundingClientRect()
    let best = null, bestDistance = Infinity
    for (const type of paintOrder) {
      for (const entity of world[groups[type]] || []) {
        const dx = (x - entity.x) * rect.width, dy = (y - entity.y) * rect.height
        const a = orientation(type, entity), cs = Math.cos(a), sn = Math.sin(a)
        const r = sizeFor(type, entity, rect.width, rect.height)
        const rx = Math.max(8, r * 1.05 + 3)
        const ry = Math.max(8, r * (type === 'organism' ? 0.72 : 0.83) + 3)
        const d = ((cs*dx+sn*dy)/rx)**2 + ((cs*dy-sn*dx)/ry)**2
        if (d <= 1 && d <= bestDistance) { bestDistance = d; best = { type, id: entity.id } }
      }
    }
    return best
  }

  draw(world, { selected = null, showLight = true, layer = 'natural', zoom, renderTick = world.tick } = {}) {
    const { ctx, w, h } = dimensions(this.canvas)
    const ent = selectedEntity(world, selected)
    const sample = selected?.type === 'water' ? selected : null
    if (zoom !== undefined && zoom !== this.zoom) this.setZoom(zoom, ent || sample || this.center)
    const env = world.environment
    // Cap optical states to four per model tick. Numbers/chemistry stay at record time.
    const opticalTick = layer === 'natural' && Number.isFinite(renderTick)
      ? Math.floor(clamp(renderTick, world.tick, world.tick + 1) * 4) / 4 : world.tick
    const frame = [world.tick, opticalTick, selected?.type, selected?.id, sample?.x, sample?.y, showLight, layer,
      world.light?.x, world.light?.y, this.zoom, this.center.x, this.center.y,
      this.canvas.width, this.canvas.height, env?.revision].join('|')
    if (this.lastWorld === world && this.lastFrame === frame && env?.nutrient === this.nutrient && env?.waste === this.waste) return
    this.lastWorld = world
    this.lastFrame = frame
    this.nutrient = env?.nutrient
    this.waste = env?.waste
    ctx.save()
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.translate(w / 2, h / 2)
    ctx.scale(this.zoom, this.zoom)
    ctx.translate(-this.center.x * w, -this.center.y * h)
    this.water.draw(ctx, world, w, h, layer, showLight, this.zoom, opticalTick)
    for (const type of paintOrder) {
      for (const body of world[groups[type]] || []) {
        const radius = sizeFor(type, body, w, h), x = body.x * w, y = body.y * h
        paintEntity(ctx, type, body, x, y, radius, world.tick)
      }
    }
    if (ent) markSelection(ctx, ent.x*w, ent.y*h, sizeFor(selected.type,ent,w,h))
    else if (sample && Number.isFinite(sample.x) && Number.isFinite(sample.y)) markSelection(ctx,sample.x*w,sample.y*h,4/this.zoom)
    ctx.restore()
  }

  drawSpecimen(canvas, world, selected, now) {
    drawSpecimen(canvas, world, selected, now)
  }
}

export function drawSpecimen(canvas, world, selected, now) {
  if (!canvas) return
  const { ctx, w, h } = dimensions(canvas)
  const ent = selectedEntity(world, selected)
  const frame = [world.tick, selected?.id, selected?.type, !!ent, canvas.width, canvas.height].join('|')
  const previous = specimenFrames.get(canvas)
  if (previous?.world === world && previous?.frame === frame) return
  specimenFrames.set(canvas, {world, frame})
  const cx = w * 0.51, cy = h * 0.50
  ctx.fillStyle = '#101716'; ctx.fillRect(0,0,w,h)
  ctx.fillStyle = gradient(ctx,cx,cy,Math.max(w,h)*0.57,[[0,'rgba(70,91,66,.36)'],[0.55,'rgba(34,58,46,.22)'],[1,'rgba(22,35,30,0)']])
  ctx.fillRect(0,0,w,h)
  const rng = random(813)
  for(let i=0; i<Math.min(360, w*h/52); i++) {
    const x=rng()*w, y=rng()*h
    ctx.fillStyle=i%4 ? 'rgba(174,192,153,.11)' : 'rgba(137,157,136,.20)'
    ctx.fillRect(x,y,0.5+rng()*0.8,0.55)
  }
  if (!ent) return
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const radius = Math.min(w*0.31, h*0.37)
  const displayEntity = { ...ent, angle: -0.23 }
  paintEntity(ctx, selected.type, displayEntity, cx, cy, radius, world.tick)
}

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

// Geometry is inherited per lineage and shared by the map and microscope.
// Only geometry is cached. The four material stocks are read at draw time.
const anatomyShapes = new Map()

function organismShape(seed) {
  if (anatomyShapes.has(seed)) return anatomyShapes.get(seed)
  const rng = random(seed + 337)
  const phase = rng() * TAU
  const broad = 20 + rng() * 8
  const point = a => {
    const shape = 1 + 0.075 * Math.sin(3 * a + phase) + 0.04 * Math.sin(5 * a - phase)
    return [Math.cos(a) * 42 * shape, Math.sin(a) * broad * shape * (1.04 - 0.17 * Math.cos(a)) + 2.6 * Math.cos(2 * a + phase)]
  }
  const membrane = Array.from({ length: 28 }, (_, i) => point(TAU * i / 28))
  // Golden-angle placement keeps pigment sites apart as their number changes.
  const pigmentSites = Array.from({ length: 25 }, (_, i) => {
    const angle = phase + i * 2.399963
    const [x, y] = point(angle)
    const inset = 0.46 + 0.33 * rng()
    return { x: x * inset, y: y * inset, rotation: angle + Math.PI / 2 + (rng() - 0.5) * 0.55,
      size: 0.78 + rng() * 0.42 }
  })
  const shape = { point, membrane, phase, broad, pigmentSites }
  anatomyShapes.set(seed, shape)
  return shape
}

function organism(ctx, seed) {
  const rng = random(seed + 619)
  const { point, membrane, phase, broad } = organismShape(seed)
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
  body.addColorStop(0, 'rgba(163,206,182,.92)')
  body.addColorStop(0.15, 'rgba(83,151,140,.88)')
  body.addColorStop(0.43, 'rgba(29,86,88,.88)')
  body.addColorStop(0.8, 'rgba(40,92,92,.88)')
  body.addColorStop(1, 'rgba(120,166,151,.94)')
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
  ctx.restore()
}

function moleculeStocks(entity) {
  const cell = entity.cell
  if (!cell) return null
  const mass = cell.membrane + cell.pigment + cell.transporters + cell.reserve
  if (!(mass > 0)) return null
  return { wall: cell.membrane / mass, pigment: cell.pigment / mass,
    transport: cell.transporters / mass, reserve: cell.reserve, reserveFraction: cell.reserve / mass }
}

function paintMolecules(ctx, entity, seed, fine) {
  const stock = moleculeStocks(entity)
  if (!stock) return
  const shape = organismShape(seed)
  const pigment = clamp(stock.pigment / 0.4, 0, 1)
  const allocation = clamp(entity.genome?.allocation ?? 0.5, 0, 1)
  const innerScale = 0.975 - 0.17 * clamp(stock.wall, 0, 1)
  ctx.save()
  ctx.lineCap = 'round'
  smoothPath(ctx, shape.membrane, innerScale)
  ctx.fillStyle = 'rgba(143,184,47,' + 0.54 * pigment + ')'
  ctx.fill()
  ctx.strokeStyle = 'rgba(16,52,54,.92)'
  ctx.lineWidth = 2.15
  ctx.stroke()
  ctx.strokeStyle = 'rgba(219,240,199,.78)'
  ctx.lineWidth = 0.85
  ctx.stroke()
  ctx.save()
  ctx.clip()

  // Peripheral discs are the light-absorbing material. Density and color
  // track the current pigment fraction. The genome biases their placement
  // slightly along the body axis without changing the amount expressed.
  const count = Math.min(shape.pigmentSites.length, Math.round(stock.pigment * 60))
  const green = Math.round(176 + 57 * pigment)
  const color = 'rgb(' + Math.round(112 + 83 * pigment) + ',' + green + ',77)'
  for (let i = 0; i < count; i++) {
    const site = shape.pigmentSites[i]
    const x = site.x * (0.94 + 0.09 * allocation)
    const y = site.y
    const r = site.size * (3.1 + 0.95 * pigment)
    ellipse(ctx,x,y,r,r*0.61,color,site.rotation,'rgba(37,78,56,.92)',0.8)
    if (fine) {
      const dx = Math.cos(site.rotation) * r * 0.56
      const dy = Math.sin(site.rotation) * r * 0.56
      ctx.beginPath()
      ctx.moveTo(x-dx, y-dy)
      ctx.lineTo(x+dx, y+dy)
      ctx.strokeStyle = 'rgba(248,255,176,.9)'
      ctx.lineWidth = 0.72
      ctx.stroke()
    }
  }

  // Amber inclusions are stored matter. Their area responds to the actual
  // reserve, retaining a visible change even during proportional body growth.
  if (stock.reserve > 0) {
    const areaScale = clamp(0.8 * stock.reserve + 1.5 * stock.reserveFraction, 0, 2.6)
    const size = Math.sqrt(areaScale)
    const offsetY = Math.sin(shape.phase) * 2
    const stores = [[-4,1.5,6.1,3.9], [5,-1.8,3.4,2.5], [0,6.0,2.5,1.6]]
    for (const [x,y,rx,ry] of stores) {
      ellipse(ctx,x,y+offsetY,rx*size,ry*size,'rgba(218,164,71,.95)',-0.28,'rgba(68,77,48,.94)',0.85)
      if (fine) ellipse(ctx,x-rx*size*0.22,y+offsetY-ry*size*0.3,rx*size*0.46,ry*size*0.22,'#f4dca0',-0.28)
    }
  }
  ctx.restore()

  // Transport complexes traverse both membrane layers. Two turquoise sides
  // flank a dark aperture; the number of visible pores follows the stock.
  const pores = Math.min(32, Math.round(stock.transport * 37))
  for (let i = 0; i < pores; i++) {
    const angle = shape.phase + i * TAU / pores
    const [x, y] = shape.point(angle)
    const inner = innerScale - 0.045
    ctx.beginPath()
    ctx.moveTo(x * inner, y * inner)
    ctx.lineTo(x * 1.018, y * 1.018)
    ctx.strokeStyle = '#67cfca'
    ctx.lineWidth = fine ? 2.75 : 3.25
    ctx.stroke()
    ctx.strokeStyle = '#185255'
    ctx.lineWidth = 1.15
    ctx.stroke()
  }
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

function appearanceKey(type, entity) {
  const variant = type === 'organism' ? hash(entity.lineage ?? entity.id) % 96 : hash(entity.id) % 32
  return type + variant
}

function sprite(type, key) {
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

function paintEntity(ctx, type, ent, x, y, radius, tick = 0, zoom = 1) {
  const s = radius / (type === 'organism' ? 42 : type === 'grain' ? 31 : type === 'mineral' ? 34 : 27)
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(orientation(type, ent))
  // A slight contraction is tied to simulation time, including in the microscope.
  const pulse = type === 'organism' ? 1 + 0.020 * Math.sin(tick * 0.33 + (ent.phase || 0)) : 1
  ctx.scale(s * pulse, s / pulse)
  const key = appearanceKey(type, ent)
  ctx.drawImage(sprite(type, key), -66, -56, 132, 112)
  if (type === 'organism') {
    paintMolecules(ctx, ent, hash(key), radius * zoom >= 34)
  }
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
        paintEntity(ctx, type, body, x, y, radius, world.tick, this.zoom)
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
  const cell = ent?.cell
  const frame = [world.tick, selected?.id, selected?.type, !!ent, canvas.width, canvas.height,
    cell?.membrane, cell?.pigment, cell?.transporters, cell?.reserve, ent?.genome?.allocation].join('|')
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

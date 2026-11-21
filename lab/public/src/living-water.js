// Optical rendering is derived from the saved simulation clock and aqueous fields.
// Coordinates are fractions of the world. Solutes are sampled as mass per unit area.
const SIZE = 256
const MASK = SIZE - 1
const PI2 = Math.PI * 2
const clamp = (x, a, b) => Math.max(a, Math.min(b, x))
const mix = (a, b, t) => a + (b - a) * t
const smooth = t => t * t * (3 - 2 * t)

function hash(x, y, seed) {
  let n = Math.imul(x ^ seed, 1597334677) ^ Math.imul(y + seed, 3812015801)
  n = Math.imul(n ^ n >>> 16, 2246822519)
  return ((n ^ n >>> 13) >>> 0) / 4294967296
}

function sampleTile(tile, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const fx = x - xi, fy = y - yi
  const x0 = xi & MASK, x1 = (xi+1) & MASK, y0 = (yi & MASK) * SIZE, y1 = ((yi+1) & MASK) * SIZE
  return mix(mix(tile[y0+x0],tile[y0+x1],fx),mix(tile[y1+x0],tile[y1+x1],fx),fy)
}

function periodicNoise(u, v, freq, seed) {
  const x = u * freq, y = v * freq, ix = Math.floor(x), iy = Math.floor(y)
  const wrap = k => (k % freq + freq) % freq
  const x0 = wrap(ix), y0 = wrap(iy), x1 = wrap(ix+1), y1 = wrap(iy+1)
  const a = smooth(x-ix), b = smooth(y-iy)
  return mix(mix(hash(x0,y0,seed),hash(x1,y0,seed),a),mix(hash(x0,y1,seed),hash(x1,y1,seed),a),b)
}

// Tileable refracted crests. The distance between the nearest two warped wave cells
// produces branching caustic filaments, with a soft skirt around each sharp core.
function opticalTables(seed) {
  const caustic = new Float32Array(SIZE*SIZE), relief = new Float32Array(SIZE*SIZE)
  const cells = 6
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const u = x/SIZE, v = y/SIZE
    const nx = periodicNoise(u,v,3,seed), ny = periodicNoise(u,v,3,seed+31)
    const detail = periodicNoise(u,v,9,seed+19)
    relief[y*SIZE+x] = nx*0.48 + detail*0.29 + periodicNoise(u,v,23,seed+7)*0.16 + periodicNoise(u,v,62,seed+8)*0.07
    const ax = u*cells + (nx-0.5)*1.1 + 0.19*Math.sin(PI2*(v*2+detail*0.33))
    const ay = v*cells + (ny-0.5)*1.1 + 0.15*Math.sin(PI2*(u*2+detail*0.37))
    const ci = Math.floor(ax), cj = Math.floor(ay)
    let first=Infinity, second=Infinity
    for(let j=cj-1; j<=cj+1; j++) for(let i=ci-1; i<=ci+1; i++) {
      const ii=(i+cells)%cells, jj=(j+cells)%cells
      const dx=i+0.18+0.64*hash(ii,jj,seed+61)-ax, dy=j+0.18+0.64*hash(ii,jj,seed+71)-ay
      const d=dx*dx+dy*dy
      if (d < first) { second=first; first=d }
      else if (d < second) second=d
    }
    const gap=Math.sqrt(second)-Math.sqrt(first)
    caustic[y*SIZE+x] = Math.exp(-gap*gap*2550)*0.73 + Math.exp(-gap*gap*235)*0.27
  }
  return {caustic,relief}
}

function palette(stops) {
  return Array.from({length:256}, (_,i) => {
    const x=i*(stops.length-1)/255, a=Math.min(stops.length-2,Math.floor(x)), t=x-a
    return stops[a].map((v,c)=>Math.round(mix(v,stops[a+1][c],t)))
  })
}

const palettes = {
  nutrient: palette([[10,32,40],[32,80,72],[96,143,84],[192,195,109],[247,220,148]]),
  waste: palette([[13,31,40],[64,52,69],[119,65,81],[181,90,94],[242,150,124]]),
  light: palette([[10,30,39],[32,79,82],[102,148,122],[189,193,137],[251,228,165]]),
  flow: palette([[12,27,38],[29,59,74],[38,95,110],[63,137,144],[152,206,180]])
}

function createSurface(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width=width; canvas.height=height
  return canvas
}

function coordinates(length, n) {
  const low=new Uint16Array(length), frac=new Float32Array(length)
  for(let i=0; i<length; i++) {
    const x=clamp((i+0.5)/length*n-0.5,0,n-1)
    low[i]=Math.min(n-2,Math.floor(x)); frac[i]=x-low[i]
  }
  return {low,frac}
}

function readFields(world, n) {
  const env=world.environment
  const out = {n}
  for(const key of ['food','waste','light','vx','vy','activity']) out[key]=new Float32Array(n*n)
  for(let j=0; j<n; j++) for(let i=0; i<n; i++) {
    const x=(i+0.5)/n, y=(j+0.5)/n, k=i+j*n
    const state=env?.sample(x,y)
    const flow=env?.flowAt(x,y)
    const food=Math.max(0,state?.nutrient || 0), waste=Math.max(0,state?.waste || 0)
    // These fixed half-response scales retain comparability between runs. Physical
    // concentrations remain available at full precision from environment.sample.
    out.food[k]=food
    out.waste[k]=waste
    out.vx[k]=flow?.x || 0; out.vy[k]=flow?.y || 0
    out.activity[k]=state?.mineralActivity || 0
    const dx=x-(world.light?.x ?? 0.34), dy=y-(world.light?.y ?? 0.39)
    out.light[k]=clamp(typeof world.lightAt==='function' ? world.lightAt(x,y) : Math.exp(-(dx*dx+dy*dy)/0.055)*(state?.transmission ?? 1),0,1)
  }
  return out
}

function fieldValue(a, i, j, y, x) {
  return mix(mix(a[i],a[i+1],x),mix(a[j],a[j+1],x),y)
}

function makeBed(w,h,relief,seed) {
  const len=w*h
  const bed=new Float32Array(len), bank=new Float32Array(len), grain=new Float32Array(len)
  const ru=new Float32Array(len), rv=new Float32Array(len), vein=new Float32Array(len)
  const aspect=w/h
  for(let j=0; j<h; j++) for(let i=0; i<w; i++) {
    const u=(i+0.5)/w, v=(j+0.5)/h, k=j*w+i
    const a=sampleTile(relief,u*245+16,v*180+4)
    const b=sampleTile(relief,u*430+120,v*430/aspect+39)
    const c=sampleTile(relief,u*1020+45*b,v*1020/aspect+64*a)
    const micro=sampleTile(relief,u*4220+31*c,v*4220/aspect)
    const edge=Math.min(u,1-u,v/aspect,(1-v)/aspect)
    // Irregular shelf exposures are restricted to the shore. The interior water
    // and its lighting are computed each tick, including over these exposures.
    const corner=Math.max(0.10-u*0.64-v*0.32,0.10-(1-u)*0.76-(1-v)*0.29,0.036-u*0.57-(1-v)*0.52)
    const exposure=corner*0.60+0.045*(a-0.47)+0.031*(c-0.47)
    bank[k]=smooth(clamp((exposure-edge)*109,0,1))
    bed[k]=(a-0.48)*1.22+(b-0.5)*0.65+(c-0.5)*0.55
    grain[k]=(micro-0.48)*0.80+(hash(i,j,seed)-0.5)*0.21
    vein[k]=Math.max(0,1-Math.abs(c+0.24*micro-0.67)*38)
    ru[k]=u*421+31*a+18*c+6*micro
    rv[k]=v*421/aspect+39*b+13*c+5*a
  }
  return {bed,bank,grain,ru,rv,vein}
}

function vectorArrows(ctx,w,h,world) {
  const env=world.environment
  if (!env) return
  const spacing=clamp(Math.min(w,h)*0.10,28,50)
  const nx=Math.max(5,Math.round(w/spacing)), ny=Math.max(4,Math.round(h/spacing))
  ctx.save(); ctx.lineCap='round'; ctx.lineJoin='round'
  for(let j=0;j<ny;j++) for(let i=0;i<nx;i++) {
    const u=(i+0.5)/nx, v=(j+0.5)/ny, vel=env.flowAt(u,v)
    const sx=vel.x*w, sy=vel.y*h, speed=Math.hypot(vel.x,vel.y)
    if (speed<0.00001) continue
    const len=spacing*(0.15+0.56*clamp(speed/0.00058,0,1))
    const norm=Math.hypot(sx,sy), dx=sx/norm, dy=sy/norm
    const x=u*w-len*dx/2, y=v*h-len*dy/2, endX=x+dx*len, endY=y+dy*len
    ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(endX,endY)
    ctx.moveTo(endX-dx*4.5-dy*2.5,endY-dy*4.5+dx*2.5);ctx.lineTo(endX,endY);ctx.lineTo(endX-dx*4.5+dy*2.5,endY-dy*4.5-dx*2.5)
    ctx.lineWidth=1.1; ctx.strokeStyle='rgba(207,240,225,.75)'; ctx.stroke()
  }
  ctx.restore()
}

// The fixed display probes show a short tangent to the actual local vector
// field. Position along a probe is a clock-based visualisation, not extra matter.
function glints(ctx,w,h,world,magnification,opticalTick) {
  const env=world.environment
  if(!env) return
  const count=Math.max(74,Math.min(200,w*h/2400))
  const phase=opticalTick
  ctx.save();ctx.lineCap='round'
  for(let i=0; i<count; i++) {
    const x0=hash(i,7,world.seed), y0=hash(i,13,world.seed)
    const f=env.flowAt(x0,y0), life=(phase/50+hash(i,71,world.seed))%1
    const speed=Math.hypot(f.x,f.y)
    if (speed<0.00001) continue
    const u=x0+f.x*50*(life-0.5), v=y0+f.y*50*(life-0.5)
    const opacity=(0.08+hash(i,21,world.seed)*0.25)*Math.sin(life*Math.PI)
    ctx.lineWidth=(0.48+hash(i,34,world.seed)*0.38)/Math.sqrt(magnification)
    ctx.strokeStyle='rgba(203,226,197,'+opacity+')'
    ctx.beginPath(); ctx.moveTo(u*w,v*h); ctx.lineTo((u+f.x*5)*w,(v+f.y*5)*h); ctx.stroke()
  }
  ctx.restore()
}

export class LivingWater {
  constructor() { this.seed=null; this.surface=null }

  draw(ctx, world, w, h, layer, showLight, magnification=1, opticalTick=world.tick) {
    // Bounded raster resolution keeps the high-frequency optics responsive on mobile.
    // A separate, DPR-aware pass preserves sharp entities, vectors and instruments.
    const ratio=Math.min(1.0,565/w,355/h)
    const sw=Math.max(1,Math.round(w*ratio)), sh=Math.max(1,Math.round(h*ratio))
    const seed=Number(world.seed)>>>0
    const n=Math.max(2,world.environment?.size || 24)
    if (!this.tables || seed!==this.seed) { this.tables=opticalTables(seed); this.seed=seed; this.surface=null }
    if (!this.surface || this.surface.width!==sw || this.surface.height!==sh || this.n!==n) {
      this.surface=createSurface(sw,sh);this.context=this.surface.getContext('2d')
      this.interpolant=createSurface(sw,sh); this.nextContext=this.interpolant.getContext('2d')
      this.pixels=this.context.createImageData(sw,sh);this.terrain=makeBed(sw,sh,this.tables.relief,seed)
      this.xs=coordinates(sw,n);this.ys=coordinates(sh,n);this.n=n
    }
    const displayLayer=Object.hasOwn(palettes,layer) ? layer : 'natural'
    const frame=[world.tick,world.light?.x,world.light?.y,displayLayer,showLight,world.environment?.revision].join('|')
    if(this.lastWorld!==world || this.frame!==frame || this.lastSurface!==this.surface || this.nutrient!==world.environment?.nutrient || this.waste!==world.environment?.waste) {
      this.nutrient=world.environment?.nutrient; this.waste=world.environment?.waste
      this.lastWorld=world;this.frame=frame;this.lastSurface=this.surface
      this.fields=readFields(world,n)
      this.shade(world.tick,sw,sh,this.fields,displayLayer,showLight)
      this.context.putImageData(this.pixels,0,0)
      this.nextReady=false
    }
    ctx.drawImage(this.surface,0,0,w,h)
    if(displayLayer==='flow') vectorArrows(ctx,w,h,world)
    else if(displayLayer==='natural') {
      const alpha=clamp(opticalTick-world.tick,0,1)
      if(alpha>0) {
        // Both optical endpoints use exactly the same mass, velocity, irradiance
        // and solute fields. The second endpoint predicts only wave appearance.
        if(!this.nextReady) {
          this.shade(world.tick+1,sw,sh,this.fields,displayLayer,showLight)
          this.nextContext.putImageData(this.pixels,0,0)
          this.nextReady=true
        }
        ctx.save(); ctx.globalAlpha*=alpha
        ctx.drawImage(this.interpolant,0,0,w,h); ctx.restore()
      }
      glints(ctx,w,h,world,magnification,opticalTick)
    }
  }

  shade(t,w,h,f,layer,showLight) {
    const rgba=this.pixels.data, terrain=this.terrain, tiles=this.tables
    // Crossfading two advection windows avoids the shear/stretch that accumulates
    // when a changing velocity field is multiplied by an ever-growing clock.
    const age0=t%100, age1=(t+50)%100, fade=Math.abs(age0-50)/50
    const swayX=Math.sin(t*0.032)*5.1, swayY=Math.cos(t*0.025)*4.4
    const aspect=w/h, n=f.n
    const palette=palettes[layer]
    for(let y=0;y<h;y++) {
      const y0=this.ys.low[y], fy=this.ys.frac[y], row=y0*n
      for(let x=0;x<w;x++) {
        const k=y*w+x, p=k*4, fx=this.xs.frac[x], i=row+this.xs.low[x], j=i+n
        const vx=fieldValue(f.vx,i,j,fy,fx), vy=fieldValue(f.vy,i,j,fy,fx)
        const lit=fieldValue(f.light,i,j,fy,fx)
        const nutrient=fieldValue(f.food,i,j,fy,fx), waste=fieldValue(f.waste,i,j,fy,fx)
        const nw=nutrient/(65+nutrient), rw=waste/(35+waste)
        if (palette) {
          const value=layer==='nutrient'?nw:layer==='waste'?rw:layer==='flow'?Math.min(1,Math.hypot(vx,vy)/0.00058):lit
          const c=palette[Math.round(value*255)]
          rgba[p]=c[0];rgba[p+1]=c[1];rgba[p+2]=c[2];rgba[p+3]=255
          continue
        }
        const X=terrain.ru[k]+swayX, Y=terrain.rv[k]+swayY
        const dx=vx*620, dy=vy*620/aspect
        const a=sampleTile(tiles.caustic,X-dx*age0,Y-dy*age0)
        const b=sampleTile(tiles.caustic,X-dx*age1,Y-dy*age1)
        const first=mix(a,b,fade)
        const fineX=X*1.95+26+swayY, fineY=Y*1.95-89+swayX
        const fineA=sampleTile(tiles.caustic,fineX-dx*age0*0.53,fineY-dy*age0*0.53)
        const fineB=sampleTile(tiles.caustic,fineX-dx*age1*0.53,fineY-dy*age1*0.53)
        const smaller=mix(fineA,fineB,fade)
        const optical=showLight ? lit : 0
        const relief=terrain.bed[k], grain=terrain.grain[k], bank=terrain.bank[k]
        const activity=fieldValue(f.activity,i,j,fy,fx)
        const v=(relief*34+grain*12)*(0.8+optical*0.6)
        // Deep-water blue-green, local olive food blooms, and wine-brown turbidity.
        // Waste blocks light in the solver and independently colours suspended matter.
        const murk=rw*(0.75+0.18*relief), bloom=nw*(0.72+0.29*relief)
        const clear=1-0.79*murk, bright=0.17+0.93*optical
        const filament=(first*first*92+smaller*smaller*41)*bright*clear
        let r=(9+optical*36+optical*optical*optical*21+v*0.62+bloom*51+activity*6)*clear+murk*37+filament*1.13
        let g=(48+optical*56+v*1.05+bloom*27+activity*7)*clear+murk*18+filament*0.98
        let blue=(54+optical*22+v*0.93-bloom*6+activity*3)*clear+murk*20+filament*0.62
        if (bank>0) {
          const stone=relief*76+grain*80+terrain.vein[k]*23
          r=mix(r,37+stone+optical*55+filament*0.83,bank)
          g=mix(g,48+stone*0.91+optical*34+filament*0.67,bank)
          blue=mix(blue,44+stone*0.73+optical*15+filament*0.47,bank)
        }
        rgba[p]=r;rgba[p+1]=g;rgba[p+2]=blue;rgba[p+3]=255
      }
    }
  }
}

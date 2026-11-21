const tau = Math.PI * 2;
const phases = ["plasma", "nuclei", "atoms", "stars", "disk", "minerals", "lagoon"];

function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function lattice(x, y, seed) {
  let v = Math.imul(x + 163, 374761393) + Math.imul(y - 82, 668265263) + seed;
  v = Math.imul(v ^ (v >>> 13), 1274126177);
  return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
}

function noise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (lattice(ix, iy, seed) * (1 - u) + lattice(ix + 1, iy, seed) * u) * (1 - v) +
    (lattice(ix, iy + 1, seed) * (1 - u) + lattice(ix + 1, iy + 1, seed) * u) * v;
}

function texture(seed, phase) {
  const canvas = document.createElement("canvas");
  canvas.width = 248; canvas.height = 150;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(canvas.width, canvas.height);
  const water = phase === 6;
  const warm = phase < 2;
  for (let j = 0; j < canvas.height; j++) {
    for (let i = 0; i < canvas.width; i++) {
      const x = i / canvas.width, y = j / canvas.height;
      const warp = noise(x * 4.9, y * 3.1, seed);
      const fine = noise(x * 12 + 4 * warp, y * 8 + 3 * warp, seed + 5);
      const detail = noise(x * 42 + 8 * fine, y * 24 + 5 * warp, seed + 33);
      const rough = 0.58 * warp + 0.30 * fine + 0.12 * noise(x * 36, y * 25, seed + 17);
      const wave = water ? Math.sin(19 * x + 17 * y + 12 * warp + 8 * fine) :
        Math.sin(4 * x + 9 * y + 12 * warp + 4 * fine);
      const sculpt = Math.pow(0.5 + 0.5 * wave, water ? 8 : 3.5);
      const vignette = Math.max(0.3, 1 - 0.95 * ((x - 0.5) ** 2 + (y - 0.5) ** 2));
      const density = (0.22 + 0.78 * sculpt) * rough * vignette;
      const spot = Math.exp(-((x - 0.55) ** 2 / 0.19 + (y - 0.5) ** 2 / 0.24));
      const glow = density * spot;
      const index = (j * canvas.width + i) * 4;
      if (water) {
        image.data[index] = 4 + 17 * rough + 19 * glow;
        image.data[index + 1] = 26 + 41 * rough + 62 * glow;
        image.data[index + 2] = 32 + 43 * rough + 52 * glow;
      } else if (warm) {
        const distance = Math.abs(y - .77 + .58 * x + .36 * Math.sin(5*x + 4*warp));
        const band = Math.exp(-distance*distance * 13);
        const filament = Math.pow(Math.max(0, 1 - Math.abs(.91 - fine - .48 * warp - .30 * detail) * 3.6), 3);
        const emission = band * (.11 + .58 * glow + filament * (.22 + .56*detail)) * vignette;
        image.data[index] = 18 + 28*rough + 212*emission;
        image.data[index+1] = 15 + 10*rough + 116*emission*emission + 30*emission;
        image.data[index+2] = 32 + 45*rough + 39*emission;
      } else {
        image.data[index] = 8 + (warm ? 31 : 16) * rough + (warm ? 213 : 85) * glow;
        image.data[index + 1] = 12 + 11 * rough + (warm ? 84 : 62) * glow;
        image.data[index + 2] = 24 + 38 * rough + (warm ? 78 : 85) * glow;
      }
      image.data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function haze(ctx, x, y, radius, stops) {
  if (radius <= 0) return;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function disc(ctx, x, y, radius, color) {
  ctx.beginPath(); ctx.arc(x, y, Math.max(0.3, radius), 0, tau);
  ctx.fillStyle = color; ctx.fill();
}

export class PrimordialView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.targets = [];
  }

  init(seed, phase) {
    if (seed !== this.seed) {
      this.seed = seed;
      const random = generator(seed);
      this.field = Array.from({ length: 770 }, () => ({
        x: random(), y: random(), a: random() * tau, r: Math.sqrt(random()), q: random(), z: random()
      }));
    }
    const key = seed + ":" + phase;
    if (key !== this.textureKey) {
      this.base = texture(seed, phase);
      this.textureKey = key;
    }
  }

  draw(world, metrics, selection) {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const phase = phases.indexOf(metrics.phase);
    this.init(world.seed, phase);
    this.targets = [];
    ctx.drawImage(this.base, 0, 0, w, h);
    if (phase === 6 && world.lagoon) this.water(world.lagoon, w, h);
    else this.space(world, metrics, phase, w, h);
    const target = this.targets.find(t => t.type === selection?.type && t.id === selection.id);
    if (target) {
      ctx.save(); ctx.strokeStyle = "#e9fee1"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(target.x, target.y, target.r + 5, 0, tau); ctx.stroke(); ctx.restore();
    }
  }

  space(world, metrics, phase, w, h) {
    const ctx = this.ctx, t = world.tick, cx = .53 * w, cy = .5 * h;
    const disk = phase >= 4;
    const stage = Math.max(phase, 0);
    const thermal = Math.max(0, Math.min(1, metrics.cosmicTemperature || 0));
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 315; i++) {
      const p = this.field[i];
      const alpha = (phase < 2 ? 0.12 : 0.28) + p.q * (phase === 3 ? .66 : .49);
      const r = Math.max(.38, p.z ** 4 * (phase >= 2 ? 1.4 : 1.1));
      disc(ctx, p.x * w, p.y * h, r, "rgba(200,218,233," + alpha.toFixed(2) + ")");
    }
    if (phase < 3) {
      const scatter = .49 + .07 * Math.min(1,Math.log1p(world.tick)/5);
      for (let i = 0; i < 235; i++) {
        const p = this.field[i + 315];
        const a = p.a + .14 * Math.sin(t * .009 + p.r * 4) + p.r * 2.6;
        const x = cx + Math.cos(a) * p.r * w * scatter;
        const y = cy + Math.sin(a) * p.r * h * .43 + h * .07 * Math.sin(a*2+p.r*4);
        const radius = (.65 + 1.45 * p.z) * (1.12 - 0.25 * phase);
        disc(ctx, x, y, radius, p.q < .6 ? "rgba(255,194,131,.63)" : "rgba(174,168,232,.65)");
        if (phase === 1 && i % 4 === 0) disc(ctx, x + radius, y + .8 * radius, radius * .63, "#b2bbdf");
        if (phase === 2 && i % 12 === 0) {
          ctx.beginPath(); ctx.ellipse(x, y, radius * 3.7, radius * 1.7, a, 0, tau);
          ctx.strokeStyle = "#a0c5de77"; ctx.lineWidth = .6; ctx.stroke();
        }
      }
      haze(ctx, cx, cy, Math.min(w,h) * .4, [[0,"rgba(251,177,115," + (0.05 + 0.12 * thermal) + ")"],[1,"rgba(80,35,80,0)"]]);
    } else {
      const process = Math.max(0, Math.min(1, metrics.stellarProcessed || 0));
      ctx.translate(cx, cy); ctx.rotate(-.19);
      if (disk) {
        ctx.save(); ctx.scale(1, .23);
        const diskRadius = w * .4;
        haze(ctx, 0, 0, diskRadius, [[0,"#ffe6a640"],[.17,"#fac68a35"],[.35,"#d99a7630"],[.64,"#ac726124"],[1,"#40375300"]]);
        for(let ring=0;ring<18;ring++) {
          const rr=diskRadius*(.1+ring*.044);
          ctx.beginPath();ctx.ellipse(0,0,rr,rr*.94,0,0,tau);
          ctx.lineWidth=.5+1.8*(1-ring/18);ctx.strokeStyle=ring%3?"#eebd8b18":"#d0b6ac32";ctx.stroke();
        }
        ctx.restore();
      }
      for (let i = 0; i < this.field.length; i++) {
        const p = this.field[i];
        const radius = (.033 + .47 * p.r) * w;
        const a = p.a + p.r * (disk ? 3.0 : 5.0) + t * .0018 / (.55 + p.r);
        const b = disk ? .23 : .48;
        const spread = (p.q - .5) * h * (disk ? .105 : .225) * p.r;
        const x = Math.cos(a) * radius, y = Math.sin(a) * radius * b + spread;
        const hot = 1 - p.r;
        const color = p.q > .65 ? "rgba(150,174,220,.54)" : "rgba(239,174,110," + (.26 + .61 * hot).toFixed(2) + ")";
        disc(ctx, x, y, .46 + p.z ** 3 * (disk ? 1.5 : 2.15), color);
      }
      const core = Math.min(w,h) * (disk ? .16 : .22) * (1 + process * .12);
      haze(ctx, 0, 0, core, [[0,"#fff6d8"],[.065,"#ffd38c"],[.15,"#ec9c5aa8"],[.47,"#ad684348"],[1,"#9b594700"]]);
      ctx.rotate(.19); ctx.translate(-cx, -cy);
    }
    ctx.restore();
    if (world.mineralLot?.units > 0) {
      const shown = Math.min(32, Math.max(1, Math.ceil(Math.sqrt(world.mineralLot.units) * 7)));
      for (let i = 0; i < shown; i++) {
        const p = this.field[i];
        const a = p.a + t * .0014;
        const x = cx + w * (.16 + .27 * p.r) * Math.cos(a);
        const y = cy + h * .21 * Math.sin(a) - .13 * (x - cx);
        const r = 3.5 + 3.2 * p.z;
        this.crystal(x, y, r, a);
        this.targets.push({ type: "lot", id: world.mineralLot.id, x, y, r });
      }
    }
  }

  crystal(x, y, r, a) {
    const ctx = this.ctx;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(-r, -.18 * r); ctx.lineTo(.08 * r, -.58 * r); ctx.lineTo(1.45 * r, .03 * r);
    ctx.lineTo(.2 * r, .57 * r); ctx.closePath(); ctx.fillStyle = "#99b4b1"; ctx.fill();
    ctx.beginPath(); ctx.moveTo(-r, -.18*r); ctx.lineTo(.25*r, .04*r); ctx.lineTo(1.45*r,.03*r); ctx.lineTo(.2*r,.57*r);
    ctx.closePath(); ctx.fillStyle = "#506d80"; ctx.fill(); ctx.restore();
  }

  water(lagoon, w, h) {
    const ctx = this.ctx;
    const unit = Math.min(w, h);
    const source = lagoon.source, particles = lagoon.particles;
    if (source?.power > 0) haze(ctx, source.x*w, source.y*h, unit * .36,
      [[0,"rgba(191,211,134,.23)"],[.57,"rgba(74,164,139,.13)"],[1,"rgba(50,150,140,0)"]]);
    for (const site of lagoon.sites) {
      this.crystal(site.x*w, site.y*h, Math.max(2.3, Math.min(14,site.radius*unit)), site.id * .2 || 0);
      this.targets.push({ type:"site",id:site.id,x:site.x*w,y:site.y*h,r:Math.max(7,site.radius*unit) });
    }
    const positions = new Map(particles.map(p => [p.id, p]));
    ctx.strokeStyle = "#addfc1a6"; ctx.lineWidth = 1.2; ctx.beginPath();
    for (const bond of lagoon.bonds) {
      const a = positions.get(bond.a), b = positions.get(bond.b);
      if (a && b) { ctx.moveTo(a.x*w, a.y*h); ctx.lineTo(b.x*w, b.y*h); }
    }
    ctx.stroke();
    for (const p of particles) {
      const x = p.x*w, y = p.y*h, r = Math.max(1.8, Math.min(4.5, 2.2*Math.sqrt(p.mass)));
      const color = p.kind === "a" ? "#daae77" : p.kind === "b" ? "#9ad7cf" : "#d0b4dd";
      disc(ctx, x, y, r + 1.6, "#061e2180"); disc(ctx, x, y, r, color);
      this.targets.push({ type:"particle", id:p.id, x, y, r });
    }
    const clusters = lagoon.observer?.clusters || [];
    for (const cluster of clusters) {
      const x=cluster.x*w, y=cluster.y*h;
      const rx=Math.max(5,cluster.radius*w), ry=Math.max(5,cluster.radius*h);
      ctx.beginPath();
      if (cluster.contour?.length >= 3) {
        cluster.contour.forEach((id,i)=>{
          const p=positions.get(id);
          if(i===0)ctx.moveTo(p.x*w,p.y*h);else ctx.lineTo(p.x*w,p.y*h);
        });
        ctx.closePath();
      } else ctx.ellipse(x,y,rx+3,ry+3,0,0,tau);
      ctx.strokeStyle=cluster.stable ? "#cfe19d90" : "#a4caa53d";
      ctx.setLineDash([3,4]); ctx.lineWidth=1; ctx.stroke(); ctx.setLineDash([]);
      this.targets.push({type:"cluster",id:cluster.id,x,y,r:Math.min(rx,ry)});
    }
  }

  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    let best = null, closest = Infinity;
    for (const target of this.targets) {
      const distance = Math.hypot(target.x-x, target.y-y);
      if (distance <= Math.max(8, target.r+3) && distance < closest) { best = target; closest = distance; }
    }
    return best ? { type:best.type, id:best.id } : null;
  }
}

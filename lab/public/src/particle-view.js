export const colors = {
  H: {fill:'#b6b8a8',edge:'#f0f2dc',light:'#fffbe8',haze:'#e4ead51c'},
  C: {fill:'#5f7473',edge:'#9caaa2',light:'#b1bfaf',haze:'#a7bcad20'},
  N: {fill:'#5c85b4',edge:'#99c7e8',light:'#d4e9ec',haze:'#84b9f327'},
  O: {fill:'#b86a59',edge:'#ee947b',light:'#ffe3ba',haze:'#f38d6a26'},
  P: {fill:'#b68755',edge:'#efb677',light:'#f7deb4',haze:'#ef9b4828'},
  S: {fill:'#a8a151',edge:'#dbd774',light:'#f1e9a9',haze:'#e6d47626'}
};

export const bondId = b => [Math.min(b.a,b.b),Math.max(b.a,b.b),b.formedAt].join('-');

function segmentDistance(x,y,a,b) {
  const dx=b.x-a.x,dy=b.y-a.y;
  const t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1)));
  return Math.hypot(x-a.x-t*dx,y-a.y-t*dy);
}

// The fine field contours are isodensity lines calculated from the particles currently on screen.
function densityContours(ctx,world,project,span) {
  const n=30, density=new Float32Array(n*n);
  for(const p of world.particles) {
    const cx=p.x*(n-1),cy=p.y*(n-1),x0=Math.round(cx),y0=Math.round(cy);
    for(let j=Math.max(0,y0-3);j<=Math.min(n-1,y0+3);j++){
      for(let i=Math.max(0,x0-3);i<=Math.min(n-1,x0+3);i++){
        const d=(i-cx)**2+(j-cy)**2;
        if(d<9)density[j*n+i]+=Math.exp(-d*.39);
      }
    }
  }
  const levels=[1.15,2.15,3.35],step=span/(n-1),origin=project({x:0,y:0});
  for(const level of levels) {
    ctx.beginPath();
    for(let j=0;j<n-1;j++)for(let i=0;i<n-1;i++){
      const v=[density[j*n+i],density[j*n+i+1],density[(j+1)*n+i+1],density[(j+1)*n+i]];
      if(Math.min(...v)>level||Math.max(...v)<level)continue;
      const corners=[[0,0],[1,0],[1,1],[0,1]],crossings=[];
      for(let k=0;k<4;k++){
        const next=(k+1)%4;
        if((v[k]>=level)===(v[next]>=level))continue;
        const t=(level-v[k])/(v[next]-v[k]);
        crossings.push([corners[k][0]+t*(corners[next][0]-corners[k][0]),corners[k][1]+t*(corners[next][1]-corners[k][1])]);
      }
      for(let k=1;k<crossings.length;k+=2){
        ctx.moveTo(origin.x+(i+crossings[k-1][0])*step,origin.y+(j+crossings[k-1][1])*step);
        ctx.lineTo(origin.x+(i+crossings[k][0])*step,origin.y+(j+crossings[k][1])*step);
      }
    }
    ctx.strokeStyle=level>3?'#90ae8b22':'#739f7a17';ctx.lineWidth=.85;ctx.stroke();
  }
}

export class ParticleView {
  constructor(canvas) {
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.zoom=1;this.center={x:.5,y:.5};
  }
  size() {
    const bounds=this.canvas.getBoundingClientRect();
    this.width=Math.max(1,bounds.width);this.height=Math.max(1,bounds.height);
    this.span=Math.min(this.width*.96,this.height*.98)*this.zoom;
    const pixelRatio=Math.min(2,globalThis.devicePixelRatio||1);
    const w=Math.round(this.width*pixelRatio),h=Math.round(this.height*pixelRatio);
    if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
    this.ctx?.setTransform(pixelRatio,0,0,pixelRatio,0,0);
  }
  point(p) {return {x:this.width/2+(p.x-this.center.x)*this.span,y:this.height/2+(p.y-this.center.y)*this.span};}
  unproject(x,y) {return {x:this.center.x+(x-this.width/2)/this.span,y:this.center.y+(y-this.height/2)/this.span};}
  setZoom(value,focus) {
    this.zoom=Math.max(1,Math.min(8,value));
    if(this.zoom===1)this.center={x:.5,y:.5};
    else if(focus)this.center={x:focus.x,y:focus.y};
    this.constrain();
  }
  constrain() {
    this.center.x=Math.max(0,Math.min(1,this.center.x));
    this.center.y=Math.max(0,Math.min(1,this.center.y));
  }
  pan(dx,dy) {if(this.zoom===1)return;this.center.x-=dx/this.span;this.center.y-=dy/this.span;this.constrain();}
  pick(world,type,x,y) {
    const all=world.particles,byId=new Map(all.map(p=>[p.id,p]));
    let best=null,distance=Infinity;
    function consider(id,d,limit){if(d<distance&&d<limit){best=id;distance=d;}}
    if(type==='particle')for(const p of all){
      const pos=this.point(p);consider(p.id,Math.hypot(pos.x-x,pos.y-y),Math.max(17,7*Math.sqrt(this.zoom)));
    }
    if(type==='bond')for(const b of world.bonds){
      consider(bondId(b),segmentDistance(x,y,this.point(byId.get(b.a)),this.point(byId.get(b.b))),14);
    }
    if(type==='cluster')for(const c of world.observer.molecules){
      const pos=this.point(c),r=c.radius*this.span;
      let nearest=Math.hypot(pos.x-x,pos.y-y);
      for(const id of c.members){const p=this.point(byId.get(id));nearest=Math.min(nearest,Math.hypot(p.x-x,p.y-y));}
      consider(c.id,nearest,Math.max(16,Math.min(r,40)));
    }
    return best;
  }
  draw(world,selected) {
    this.size();
    const ctx=this.ctx;if(!ctx)return;
    const w=this.width,h=this.height;
    const center=world.particles.reduce((p,a)=>({x:p.x+a.x/world.particles.length,y:p.y+a.y/world.particles.length}),{x:0,y:0});
    const source=this.point(center);
    const atmosphere=ctx.createRadialGradient(source.x,source.y,0,source.x,source.y,Math.max(w,h)*.82);
    atmosphere.addColorStop(0,'#233b2f');atmosphere.addColorStop(.37,'#142b24');atmosphere.addColorStop(.72,'#10221f');atmosphere.addColorStop(1,'#0b1717');
    ctx.fillStyle=atmosphere;ctx.fillRect(0,0,w,h);
    const map=new Map(world.particles.map(p=>[p.id,p]));
    const chosen=this.selection(world,selected,map);
    ctx.save();
    const tl=this.point({x:0,y:0});
    ctx.beginPath();ctx.rect(tl.x,tl.y,this.span,this.span);ctx.clip();
    densityContours(ctx,world,p=>this.point(p),this.span);
    const particles=world.particles.slice().sort((a,b)=>a.z-b.z);
    for(const c of world.observer.molecules) {
      if(c.ring.length<3)continue;
      ctx.beginPath();c.ring.forEach((id,i)=>{const p=this.point(map.get(id));if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);});ctx.closePath();
      ctx.fillStyle=selected?.type==='cluster'&&selected.key===String(c.id)?'#b9e8a035':'#b9e8a017';ctx.fill();
    }
    for(const b of world.bonds) {
      const a=this.point(map.get(b.a)),z=this.point(map.get(b.b)),highlight=chosen.has(b.a)&&chosen.has(b.b);
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(z.x,z.y);
      ctx.strokeStyle=highlight?'#d9ec9890':'#dca68529';ctx.lineWidth=highlight?5:4;ctx.stroke();
      ctx.strokeStyle=highlight?'#e7f6b4':'#e0b190bf';ctx.lineWidth=highlight?2:1.3;ctx.stroke();
      if(b.order>1){const dx=z.x-a.x,dy=z.y-a.y,length=Math.hypot(dx,dy)||1;
        for(let i=1;i<b.order;i++){const offset=(i===1?1:-1)*2.6;
          ctx.beginPath();ctx.moveTo(a.x+dy/length*offset,a.y-dx/length*offset);ctx.lineTo(z.x+dy/length*offset,z.y-dx/length*offset);ctx.stroke();}
      }
    }
    for(const p of particles) {
      const pos=this.point(p),r=Math.max(2.4,p.radiusPm/1000/world.sideNm*this.span);
      if(pos.x< -3*r||pos.y< -3*r||pos.x>w+3*r||pos.y>h+3*r)continue;
      const color=colors[p.element];
      ctx.save();ctx.translate(pos.x,pos.y);ctx.globalAlpha=chosen.has(p.id)?1:.68+.32*p.z;
      ctx.fillStyle=color.haze;ctx.beginPath();ctx.arc(0,0,r*1.26,0,Math.PI*2);ctx.fill();
      const depth=ctx.createRadialGradient(-r*.3,-r*.36,0,r*.1,r*.13,r*1.15);
      depth.addColorStop(0,color.light);depth.addColorStop(.4,color.fill);depth.addColorStop(1,'#182a27');
      ctx.beginPath();ctx.arc(0,0,r,0,2*Math.PI);ctx.fillStyle=depth;ctx.fill();ctx.strokeStyle=color.edge;ctx.lineWidth=.9;ctx.stroke();
      if(r>=13){ctx.font='600 '+Math.max(9,Math.min(16,r*.96))+'px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#0a1618';ctx.fillText(p.element,0,1);}
      if(chosen.has(p.id)){
        ctx.beginPath();ctx.setLineDash([3,2]);ctx.strokeStyle='#e6f1bb';ctx.lineWidth=1.3;
        ctx.arc(0,0,r+6,0,2*Math.PI);ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
    ctx.strokeStyle='#92b39445';ctx.lineWidth=1;
    for(const dx of [0,1])for(const dy of [0,1]){
      const corner=this.point({x:dx,y:dy}),sx=dx?-1:1,sy=dy?-1:1;
      ctx.beginPath();ctx.moveTo(corner.x+sx*11,corner.y);ctx.lineTo(corner.x,corner.y);ctx.lineTo(corner.x,corner.y+sy*11);ctx.stroke();
    }
  }
  selection(world,s,map) {
    if(!s)return new Set();
    if(s.type==='particle')return new Set(map.has(+s.key)?[+s.key]:[]);
    if(s.type==='bond'){
      const b=world.bonds.find(b=>bondId(b)===s.key);return new Set(b?[b.a,b.b]:[]);
    }
    return new Set(world.observer.molecules.find(c=>String(c.id)===s.key)?.members||[]);
  }
}

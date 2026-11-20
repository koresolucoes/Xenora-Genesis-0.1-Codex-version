export const habitatNames = { dry:"Árido", ice:"Gelo", wetland:"Área úmida", lagoon:"Lagoa", temperate:"Temperado" };
const clamp = v => Math.min(1,Math.max(0,v));
const TAU = Math.PI*2;
const rock=[145,121,128], soil=[132,99,69], grass=[58,96,69], shore=[74,139,122], deep=[18,65,81], frost=[170,210,207];
const mineralVein=[191,171,205], shallowLight=[137,190,158];
const nutrient=[226,178,68], bound=[179,142,93], cool=[80,157,188], heat=[216,119,70], crystal=[171,161,198];
const layers={thermal:[cool,heat],wet:[[58,55,39],[78,183,192]],ice:[[51,62,60],frost],mineral:[[45,59,48],crystal],food:[[40,54,42],nutrient],bound:[[52,53,40],bound]};

function hash(x,y,seed) {
  let v=Math.imul(x+17,374761393)+Math.imul(y-9,668265263)+seed;
  v=Math.imul(v^(v>>>13),1274126177); return ((v^(v>>>16))>>>0)/4294967296;
}
function noise(x,y,seed) {
  const ix=Math.floor(x),iy=Math.floor(y);let u=x-ix,v=y-iy;
  u=u*u*(3-2*u);v=v*v*(3-2*v);
  return (hash(ix,iy,seed)*(1-u)+hash(ix+1,iy,seed)*u)*(1-v)+(hash(ix,iy+1,seed)*(1-u)+hash(ix+1,iy+1,seed)*u)*v;
}
function field(data, i,j,k,l, a,b){
  return (data[i]*(1-a)+data[j]*a)*(1-b)+(data[k]*(1-a)+data[l]*a)*b;
}
function blend(a,b,w){return a+(b-a)*clamp(w);}
export const traitColor = allele => "hsl("+(176-allele*14)+" 60% "+(64-Math.abs(5-allele)*1.5)+"%)";
export class EvolutionView {
  constructor(canvas){this.canvas=canvas;this.ctx=canvas.getContext("2d");this.off=document.createElement("canvas");this.targets=[];}
  terrain(world,layer,w,h) {
    const env=world.environment,n=env.size,W=Math.max(100,Math.min(400,Math.round(w/2.0))),H=Math.max(80,Math.min(310,Math.round(h/2.0)));
    const cache=this.cache;
    if(cache && cache.seed===world.seed && cache.W===W && cache.H===H && this.lastWorld===world && this.lastTick===world.tick && this.lastLayer===layer && this.lastInput===world.nutrientInputTotal && this.lastLight===env.lightForcing)return;
    if(!cache || cache.seed!==world.seed || cache.W!==W || cache.H!==H){
      const texture=new Float32Array(W*H);
      for(let py=0;py<H;py++){
        for(let px=0;px<W;px++){
          const x=px/W,y=py/H,warp=noise(x*7,y*8,world.seed);
          const medium=noise(x*24+3*warp,y*25+2*warp,world.seed+127);
          const rough=noise(x*91+5*medium,y*95+3*warp,world.seed+23);
          const channel=Math.max(0,1-7*Math.abs(.94-medium-.53*warp-.28*rough));
          texture[py*W+px]=(rough-.5)*.24+(medium-.5)*.26+(warp-.5)*.24+channel*.07;
        }
      }
      this.cache={W,H,seed:world.seed,texture};this.off.width=W;this.off.height=H;
    }
    this.lastWorld=world;this.lastTick=world.tick;this.lastLayer=layer;this.lastInput=world.nutrientInputTotal;this.lastLight=env.lightForcing;
    const off=this.off.getContext("2d"),img=off.createImageData(W,H), pix=img.data;
    const relief = new Float32Array(n*n);
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){
      const west=env.elevation[y*n+Math.max(0,x-1)],east=env.elevation[y*n+Math.min(n-1,x+1)];
      const north=env.elevation[Math.max(0,y-1)*n+x],south=env.elevation[Math.min(n-1,y+1)*n+x];
      relief[y*n+x]=(west-east+north-south)*.5;
    }
    for(let py=0;py<H;py++){
      const gy=Math.max(0,Math.min(n-1,(py+.5)*n/H-.5)),iy=Math.floor(gy),jy=Math.min(n-1,iy+1),b=gy-iy;
      for(let px=0;px<W;px++){
        const gx=Math.max(0,Math.min(n-1,(px+.5)*n/W-.5)),ix=Math.floor(gx),jx=Math.min(n-1,ix+1),a=gx-ix;
        const i=iy*n+ix,j=iy*n+jx,k=jy*n+ix,l=jy*n+jx,idx=py*W+px;
        const f=data=>field(data,i,j,k,l,a,b);
        const elev=f(env.elevation),water=f(env.water),ice=f(env.ice),humidity=f(env.humidity),mineral=f(env.mineral),temp=f(env.temperature);
        const available=f(env.nutrient),texture=this.cache.texture[idx];
        const shade=clamp(.62+f(relief)*.61+texture*.98+(f(env.light)-.5)*.055);
        const high=clamp((elev-.51+texture*.17)*3.1)*(.70+.30*mineral),vegetation=clamp(humidity*.95+f(env.cover)*.35+texture*.75);
        const wet=clamp((water-.085+texture*.18)/.26),frozen=clamp(ice/.22);
        // Stylized sediment bands follow local relief and mineral abundance. Light
        // on shallow water moves with the simulated clock and vanishes on dry land.
        const strata=1-Math.abs(Math.sin(elev*48+texture*13));
        const veins=strata**5*clamp(mineral*1.7)*(1-.76*wet)*(1-frozen);
        const ripple=1-Math.abs(Math.sin(water*55+texture*17-world.tick*.027));
        const margins=ripple**5*clamp(water/.11)*clamp(1-water/.48)*(1-frozen);
        let value;
        if(layer!=="natural"){
          value={thermal:clamp((temp-245)/78),wet:clamp(water/.65),ice:clamp(ice/.6),mineral,food:clamp(available/1.65),bound:clamp(f(env.boundNutrient)/1.1)}[layer];
        }
        for(let c=0;c<3;c++){
          let color;
          if(layer==="natural"){
            color=blend(soil[c],grass[c],vegetation);color=blend(color,rock[c],high);
            color=blend(color,shore[c],Math.min(1,wet*2));color=blend(color,deep[c],Math.max(0,(wet-.22)/.78));
            color=blend(color,mineralVein[c],veins*.65);
            color=blend(color,shallowLight[c],margins*.40);
            color=blend(color,frost[c],frozen);
          }else color=blend(layers[layer][0][c],layers[layer][1][c],value);
          pix[idx*4+c]=color*(.55+shade*.72);
        }
        pix[idx*4+3]=255;
      }
    }
    off.putImageData(img,0,0);
  }
  draw(world,{layer,selected,probe}){
    const c=this.canvas,ctx=this.ctx,box=c.getBoundingClientRect(),w=Math.max(1,box.width),h=Math.max(1,box.height),dpr=Math.min(2,window.devicePixelRatio||1);
    if(c.width!==Math.round(w*dpr)||c.height!==Math.round(h*dpr)){c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);}
    const cam=this.camera ?? {scale:1,x:0,y:0};
    const factor=dpr*cam.scale;
    ctx.setTransform(factor,0,0,factor,-cam.x*w*factor,-cam.y*h*factor);
    this.terrain(world,layer,w,h);ctx.imageSmoothingEnabled=true;ctx.drawImage(this.off,0,0,w,h);
    const env=world.environment,n=env.size;this.targets=[];
    if(layer==="natural"||layer==="food"||layer==="mineral"){
      for(let i=0;i<n*n;i++){
        const x=(i%n+hash(i,4,world.seed)*.78+.11)/n*w,y=(Math.floor(i/n)+hash(i,5,world.seed)*.78+.11)/n*h;
        const q=hash(i,6,world.seed);
        if(layer!=="food"&&env.mineral[i]>.04+q*.37){
          const r=1.1+env.mineral[i]*5;ctx.fillStyle="rgba(193,187,204,.79)";ctx.beginPath();ctx.moveTo(x-r,y);
          ctx.lineTo(x+.25*r,y-.68*r);ctx.lineTo(x+1.3*r,y+.12*r);ctx.lineTo(x+.35*r,y+.65*r);ctx.closePath();ctx.fill();
        }
        if(layer!=="mineral"&&env.nutrient[i]>.22+q*.85){
          const r=Math.min(2.8,1+env.nutrient[i]*.55);ctx.fillStyle="rgba(236,190,90,.87)";ctx.beginPath();ctx.arc(x+3,y+4,r,0,TAU);ctx.fill();
        }
      }
    }
    for(const org of world.organisms){
      const x=org.x*w,y=org.y*h,r=Math.min(12,Math.max(5.5,Math.sqrt(org.mass)*4.4)),active=org.id===selected;
      const angle=Number.isFinite(org.angle)?org.angle:hash(org.id,8,world.seed)*TAU;
      ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.fillStyle="rgba(4,24,26,.52)";
      ctx.beginPath();ctx.ellipse(1,2,r*1.35,r*.82,0,0,TAU);ctx.fill();
      ctx.strokeStyle="#15382e";ctx.lineWidth=1.1;
      const membrane=ctx.createLinearGradient(0,-r,0,r);
      membrane.addColorStop(0,"#daead0");membrane.addColorStop(.38,traitColor(org.genome.allele));membrane.addColorStop(1,"#294e40");
      ctx.fillStyle=membrane;
      ctx.beginPath();ctx.moveTo(-1.4*r,0);ctx.bezierCurveTo(-r,-r, .58*r,-1.04*r,1.35*r,-.08*r);
      ctx.bezierCurveTo(r,.84*r,-.65*r,1.05*r,-1.4*r,0);ctx.closePath();ctx.fill();ctx.stroke();
      ctx.beginPath();ctx.moveTo(-r*.85,0);ctx.quadraticCurveTo(-1.8*r,r*.35,-2.18*r,-.12*r);ctx.stroke();
      ctx.fillStyle="#193d37";ctx.beginPath();ctx.ellipse(.34*r,0,.32*r,.28*r,0,0,TAU);ctx.fill();
      ctx.fillStyle="#f2e9c7";ctx.beginPath();ctx.arc(.43*r,-.08*r,.12*r,0,TAU);ctx.fill();
      ctx.fillStyle="rgba(249,216,135,.88)";
      const granules=Math.min(4,Math.max(0,Math.floor(org.energy*2)));
      for(let j=0;j<granules;j++){const a=j*2.1+.2;ctx.beginPath();ctx.arc((-.42+.3*Math.cos(a))*r,Math.sin(a)*r*.36,.11*r,0,TAU);ctx.fill();}
      ctx.restore();
      if(active){ctx.strokeStyle="#f5f0cc";ctx.lineWidth=1;ctx.setLineDash([4,3]);ctx.beginPath();ctx.arc(x,y,r*1.85+3,0,TAU);ctx.stroke();ctx.setLineDash([]);}
      this.targets.push({id:org.id,x,y,r});
    }
    if(!selected&&probe){const x=probe.x*w,y=probe.y*h;ctx.strokeStyle="#e9f2d5";ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(x-8,y);ctx.lineTo(x-3,y);ctx.moveTo(x+3,y);ctx.lineTo(x+8,y);ctx.moveTo(x,y-8);ctx.lineTo(x,y-3);ctx.moveTo(x,y+3);ctx.lineTo(x,y+8);ctx.stroke();}
  }
  point(clientX,clientY){
    const b=this.canvas.getBoundingClientRect(), cam=this.camera ?? {scale:1,x:0,y:0};
    return {x:clamp(cam.x+(clientX-b.left)/(cam.scale*b.width)),y:clamp(cam.y+(clientY-b.top)/(cam.scale*b.height))};
  }
  pick(clientX,clientY){
    const b=this.canvas.getBoundingClientRect(), point=this.point(clientX,clientY);
    const scale=this.camera?.scale ?? 1;
    let found=null,best=Infinity;
    for(const p of this.targets){
      const d=Math.hypot(p.x-point.x*b.width,p.y-point.y*b.height);
      if(d<=Math.max(10/scale,p.r*1.7)&&d<best){best=d;found=p.id;}
    }
    return found;
  }
}

// Passive measurements of the explicit atomic graph. A covalent ring denotes a
// cycle of atomic bonds; a 2-D polygon is not evidence for a membrane or a cell.
const EVENT_LIMIT = 96;
const EPS = 1e-10;
const keyForEdge = (a,b) => Math.min(a,b) + '/' + Math.max(a,b);
const sameIds = (a,b) => Array.isArray(a) && a.length===b.length && a.every((x,i)=>x===b[i]);
const near = (a,b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b)<=EPS*Math.max(1,Math.abs(a),Math.abs(b));
const natural = n => Number.isSafeInteger(n) && n>=0;
const cmp = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const counters = () => ({associations:0,dissociations:0,rearrangements:0});

function elementsOf(ids,atoms) {
  const result={};
  for(const id of ids) { const symbol=atoms.get(id).element;result[symbol]=(result[symbol]??0)+1; }
  return result;
}

// Hill notation provides a stable composition key, independent of atom order.
// Formulas never distinguish isomers or identify a substance's bulk phase.
export function molecularFormula(composition) {
  const symbols=Object.keys(composition).filter(s=>composition[s]>0).sort();
  if(composition.C) {
    const ordered=['C',...(composition.H?['H']:[]),...symbols.filter(s=>s!=='C'&&s!=='H')];
    return ordered.map(s=>s+(composition[s]>1?composition[s]:'')).join('');
  }
  return symbols.map(s=>s+(composition[s]>1?composition[s]:'')).join('');
}
const displayFormula = formula => ({H3N:'NH3',H3P:'PH3'})[formula] ?? formula;
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function on(a,b,p) {
  return Math.abs(cross(a,b,p))<=EPS && p.x>=Math.min(a.x,b.x)-EPS && p.x<=Math.max(a.x,b.x)+EPS &&
    p.y>=Math.min(a.y,b.y)-EPS && p.y<=Math.max(a.y,b.y)+EPS;
}
function intersects(a,b,c,d) {
  if(on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))return true;
  return (cross(a,b,c)>0)!==(cross(a,b,d)>0) && (cross(c,d,a)>0)!==(cross(c,d,b)>0);
}
function projectedArea(ids,atoms) {
  const vertices=ids.map(id=>atoms.get(id));let area2=0;
  for(let i=0;i<vertices.length;i++) {
    const a=vertices[i],b=vertices[(i+1)%vertices.length],prev=vertices[(i+vertices.length-1)%vertices.length];
    if(Math.hypot(a.x-b.x,a.y-b.y)<=EPS || (Math.abs(cross(prev,a,b))<=EPS &&
       (prev.x-a.x)*(b.x-a.x)+(prev.y-a.y)*(b.y-a.y)>EPS))return 0;
    area2+=a.x*b.y-a.y*b.x;
    for(let j=i+2;j<vertices.length;j++) {
      if(i===0&&j===vertices.length-1)continue;
      if(intersects(a,b,vertices[j],vertices[(j+1)%vertices.length]))return 0;
    }
  }
  return Math.abs(area2)>2e-8?Math.abs(area2)/2:0;
}
function treePath(a,b,parent) {
  const aa=[],bb=[],indices=new Map();
  for(let p=a;p!=null;p=parent.get(p)){indices.set(p,aa.length);aa.push(p);}
  let p=b;
  while(!indices.has(p)){bb.push(p);p=parent.get(p);}
  return aa.slice(0,indices.get(p)+1).concat(bb.reverse());
}

function measureAtomicGraph(world) {
  const atoms=new Map(), adj=new Map(),edges=new Map();
  for(const p of world.particles) {
    if(!Number.isSafeInteger(p.id)||atoms.has(p.id)||!/^[A-Z][a-z]?$/.test(p.element)||
       !(p.massU>0)||!Number.isFinite(p.massU))throw new Error('Átomo inválido para observação.');
    atoms.set(p.id,p);adj.set(p.id,[]);
  }
  for(const bond of world.bonds) {
    const {a,b,order}=bond,key=keyForEdge(a,b);
    if(a===b||!atoms.has(a)||!atoms.has(b)||edges.has(key)||!Number.isInteger(order)||order<1)
      throw new Error('Ligação atômica inválida.');
    adj.get(a).push(b);adj.get(b).push(a);edges.set(key,{a:Math.min(a,b),b:Math.max(a,b),order});
  }
  const seen=new Set(),molecules=[],freeAtomIds=[];
  const sorted=[...atoms.keys()].sort((a,b)=>a-b);
  for(const id of sorted) {
    if(!adj.get(id).length){freeAtomIds.push(id);continue;}
    if(seen.has(id))continue;
    const members=[id],parent=new Map([[id,null]]),treeEdges=new Set(),edgesHere=[];
    seen.add(id);
    for(let i=0;i<members.length;i++) {
      const a=members[i];
      for(const b of adj.get(a).sort((x,y)=>x-y)) {
        const key=keyForEdge(a,b);
        if(a<b)edgesHere.push(edges.get(key));
        if(seen.has(b))continue;
        seen.add(b);parent.set(b,a);treeEdges.add(key);members.push(b);
      }
    }
    members.sort((a,b)=>a-b);edgesHere.sort((u,v)=>u.a-v.a||u.b-v.b);
    const composition=elementsOf(members,atoms),formula=molecularFormula(composition);
    let massU=0,charge=0,x=0,y=0,bondOrderSum=0;
    for(const a of members){const p=atoms.get(a);massU+=p.massU;charge+=p.charge??0;x+=p.massU*p.x;y+=p.massU*p.y;}
    x/=massU;y/=massU;
    let ring=[],area=0;
    const cycleRank=edgesHere.length-members.length+1;
    for(const e of edgesHere) {
      bondOrderSum+=e.order;
      if(!treeEdges.has(keyForEdge(e.a,e.b))) {
        const cycle=treePath(e.a,e.b,parent),candidate=projectedArea(cycle,atoms);
        if(candidate>0&&(!ring.length||cycle.length<ring.length)){ring=cycle;area=candidate;}
      }
    }
    const signature=edgesHere.map(e=>e.a+'-'+e.b+':'+e.order).join(',');
    const radius=members.reduce((r,id)=>Math.max(r,Math.hypot(atoms.get(id).x-x,atoms.get(id).y-y)),0);
    molecules.push({members,composition,formula,displayFormula:displayFormula(formula),massU,charge,x,y,radius,
      bondCount:edgesHere.length,bondOrderSum,cycleRank,ring,projectedRingArea:area,signature});
  }
  return {atoms,molecules,freeAtomIds};
}

function speciesGroups(mols,freeAtoms,atoms) {
  return mols.map(m=>({id:m.id,members:m.members,formula:m.formula,signature:m.signature})).concat(
    freeAtoms.map(id=>({id:null,members:[id],formula:atoms.get(id).element,signature:''})));
}
function compactGroup(group) { return {id:group.id,members:group.members.slice(),formula:group.formula}; }
function editedBonds(before,after) {
  const changes=new Map();
  for(const [side,groups] of [['before',before],['after',after]]) {
    for(const g of groups) for(const bond of g.signature.split(',')) {
      if(!bond)continue;
      const [pair,value]=bond.split(':'),[a,b]=pair.split('-').map(Number);
      if(!changes.has(pair))changes.set(pair,{a,b,before:0,after:0});
      changes.get(pair)[side]=Number(value);
    }
  }
  return [...changes.values()].filter(c=>c.before!==c.after).sort((a,b)=>a.a-b.a||a.b-b.b);
}
function equation(groups) {
  const counts=new Map();
  for(const g of groups) counts.set(g.formula,(counts.get(g.formula)??0)+1);
  return [...counts].sort(([a],[b])=>cmp(a,b)).map(([formula,n])=>(n>1?n+' ':'')+displayFormula(formula)).join(' + ');
}

// A reaction record compares two complete graph observations. It groups old and
// new pieces connected by shared atom IDs, so a simultaneous exchange has one
// balanced record instead of a fictitious birth and death of matter.
function transitions(current,previous,graph,tick) {
  const before=speciesGroups(previous.molecules,previous.freeAtomIds,graph.atoms);
  const after=speciesGroups(current,graph.freeAtomIds,graph.atoms);
  const source=new Map(),oldToNew=before.map(()=>new Set());
  before.forEach((g,i)=>g.members.forEach(id=>source.set(id,i)));
  const newToOld=after.map((g,i)=>{
    const old=new Set();
    for(const atom of g.members) {
      const k=source.get(atom);
      if(k===undefined)throw new Error('Inventário atômico mudou durante a comparação.');
      old.add(k);oldToNew[k].add(i);
    }
    return old;
  });
  const visited=new Set(),events=[];
  for(let i=0;i<after.length;i++) {
    if(visited.has(i))continue;
    const queue=[i],old=new Set();visited.add(i);
    for(let q=0;q<queue.length;q++) {
      for(const parent of newToOld[queue[q]]) {
        if(old.has(parent))continue;
        old.add(parent);
        for(const child of oldToNew[parent])if(!visited.has(child)){visited.add(child);queue.push(child);}
      }
    }
    const reactants=[...old].map(index=>before[index]),products=queue.map(index=>after[index]);
    if(reactants.length===1&&products.length===1&&reactants[0].signature===products[0].signature)continue;
    const type=reactants.length>products.length?'association':reactants.length<products.length?'dissociation':'rearrangement';
    events.push({tick,type,reactants:reactants.map(compactGroup),products:products.map(compactGroup),
      bondChanges:editedBonds(reactants,products),equation:equation(reactants)+' → '+equation(products)});
  }
  return events;
}

function measurements(world,graph,molecules,tally) {
  const formulas={},composition=elementsOf([...graph.atoms.keys()],graph.atoms);
  let ringMolecules=0,cycleCount=0,largestMoleculeAtoms=0,bondOrderTotal=0;
  for(const m of molecules) {
    formulas[m.formula]=(formulas[m.formula]??0)+1;
    if(m.cycleRank>0)ringMolecules++;
    cycleCount+=m.cycleRank;bondOrderTotal+=m.bondOrderSum;
    largestMoleculeAtoms=Math.max(largestMoleculeAtoms,m.members.length);
  }
  const totalMassU=world.particles.reduce((a,p)=>a+p.massU,0);
  return {atomCount:world.particles.length,freeAtomCount:graph.freeAtomIds.length,
    bondedAtomCount:world.particles.length-graph.freeAtomIds.length,moleculeCount:molecules.length,
    ringMolecules,cycleCount,largestMoleculeAtoms,bondCount:world.bonds.length,bondOrderTotal,formulas,composition,
    distinctFormulas:Object.keys(formulas).length,totalMassU,
    netCharge:world.particles.reduce((a,p)=>a+(p.charge??0),0),...tally,
    demonstratedMembraneCount:0,demonstratedLifeCount:0,demonstratedReproductions:0,lifeStatus:'não demonstrada'};
}

export function observeAtomicWorld(world,previous=null) {
  const tick=world.tick;
  if(!natural(tick)||previous&&(tick<previous.tick||tick>previous.tick+1)) throw new Error('Passos de observação atômica incompatíveis.');
  const graph=measureAtomicGraph(world);
  const priorByAtoms=new Map((previous?.molecules??[]).map(m=>[m.members.join(','),m]));
  let nextId=previous?.nextId??1;
  const advance=previous&&previous.tick===tick?0:1;
  const molecules=graph.molecules.map(m=>{
    const former=priorByAtoms.get(m.members.join(','));
    return {...m,id:former?.id??nextId++,age:former?former.age+advance:1,
      compositionAge:former?former.age+advance:1,structureAge:former?.signature===m.signature?former.structureAge+advance:1};
  });
  const fresh=previous?transitions(molecules,previous,graph,tick):[];
  const tally=previous?{...previous.counters}:counters();
  for(const e of fresh)tally[e.type==='association'?'associations':e.type==='dissociation'?'dissociations':'rearrangements']++;
  return {version:1,tick,nextId,molecules,freeAtomIds:graph.freeAtomIds,
    events:(previous?.events??[]).concat(fresh).slice(-EVENT_LIMIT),counters:tally,metrics:measurements(world,graph,molecules,tally)};
}

function sameDictionary(a,b) {
  return a&&typeof a==='object'&&!Array.isArray(a)&&Object.keys(a).length===Object.keys(b).length&&
    Object.keys(b).every(k=>a[k]===b[k]);
}
export function validateAtomicObservation(world,data) {
  try {
    if(data?.version!==1||data.tick!==world.tick||!natural(world.tick)||!natural(data.nextId)||data.nextId<1||
       !Array.isArray(data.molecules)||!Array.isArray(data.events)||data.events.length>EVENT_LIMIT||
       !sameDictionary(data.counters,Object.fromEntries(Object.keys(counters()).map(k=>[k,data.counters?.[k]])))||
       !Object.values(data.counters).every(natural))return false;
    const graph=measureAtomicGraph(world),n=graph.atoms.size;
    if(data.molecules.length!==graph.molecules.length||!sameIds(data.freeAtomIds,graph.freeAtomIds)||
       data.nextId>(world.tick+1)*Math.floor(n/2)+1)return false;
    const ids=new Set();
    for(let i=0;i<data.molecules.length;i++){
      const m=data.molecules[i],v=graph.molecules[i];
      if(!natural(m.id)||m.id<1||m.id>=data.nextId||ids.has(m.id)||!natural(m.age)||m.age<1||m.age>world.tick+1||
          !natural(m.structureAge)||m.structureAge<1||m.structureAge>m.age||m.compositionAge!==m.age||
          !sameIds(m.members,v.members)||!sameIds(m.ring,v.ring)||!sameDictionary(m.composition,v.composition)||
          !['formula','displayFormula','signature','charge','bondCount','bondOrderSum','cycleRank'].every(k=>m[k]===v[k])||
          !['x','y','radius','massU','projectedRingArea'].every(k=>near(m[k],v[k])))return false;
      ids.add(m.id);
    }
    let last=-1;
    const recorded=counters();
    for(const e of data.events) {
      if(!natural(e.tick)||e.tick<last||e.tick>world.tick||!Array.isArray(e.reactants)||!Array.isArray(e.products)||
          !e.reactants.length||!e.products.length||e.reactants.length>n||e.products.length>n)return false;
      last=e.tick;
      function elements(groups) {
        const all=[];
        for(const g of groups) {
          if(!Array.isArray(g.members)||!g.members.length||g.members.length>n||new Set(g.members).size!==g.members.length||
            !g.members.every(id=>graph.atoms.has(id))||g.formula!==molecularFormula(elementsOf(g.members,graph.atoms))||
            (g.members.length===1?g.id!==null:!natural(g.id)||g.id<1||g.id>=data.nextId))return null;
          all.push(...g.members);
        }
        return new Set(all).size===all.length?all.sort((a,b)=>a-b):null;
      }
      const left=elements(e.reactants),right=elements(e.products);
      if(!left||!right||!sameIds(left,right)||e.equation!==equation(e.reactants)+' → '+equation(e.products))return false;
      if(!Array.isArray(e.bondChanges)||!e.bondChanges.length||e.bondChanges.length>n*(n-1)/2)return false;
      const touched=new Set(left), changedPairs=new Set();
      for(const b of e.bondChanges) {
        if(!touched.has(b.a)||!touched.has(b.b)||b.a>=b.b||changedPairs.has(keyForEdge(b.a,b.b))||
            !natural(b.before)||!natural(b.after)||b.before>3||b.after>3||b.before===b.after)return false;
        changedPairs.add(keyForEdge(b.a,b.b));
      }
      const type=e.reactants.length>e.products.length?'association':e.reactants.length<e.products.length?'dissociation':'rearrangement';
      if(e.type!==type)return false;
      recorded[type==='association'?'associations':type==='dissociation'?'dissociations':'rearrangements']++;
    }
    if(Object.keys(recorded).some(k=>recorded[k]>data.counters[k]))return false;
    const expected=measurements(world,graph,data.molecules,data.counters);
    return Object.keys(expected).every(k=>typeof expected[k]==='object'?sameDictionary(data.metrics?.[k],expected[k]):
      typeof expected[k]==='number'?near(data.metrics?.[k],expected[k]):data.metrics?.[k]===expected[k]);
  } catch{return false;}
}

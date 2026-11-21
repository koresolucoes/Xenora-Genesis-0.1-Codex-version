// A passive rolling record. The physical graph at the current tick plus its
// reversible bond edits determine every observed graph in the covered interval.
import { ATOMIC_ELEMENTS, maxBondOrder } from './atomic-elements.js';
import { ATOMIC_PHYSICS } from './atomic-world.js';
import { identifyMolecularGraph } from './molecular-identity.js';

export const REACTION_BENCH_LIMITS = Object.freeze({ ticks: 128, edits: 2048 });
const windowsFs = Object.freeze([24, 96, 240]);
const orderEdges = (p, q) => p[0] - q[0] || p[1] - q[1];
const byText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const natural = n => Number.isSafeInteger(n) && n >= 0;
const baseline = tick => ({version: 1, startTick: tick, tick, frames: []});

function readChanges(flux) {
  const changes = [];
  function append(b,before,after) {
    changes.push([Math.min(b.a,b.b),Math.max(b.a,b.b),before,after]);
  }
  for (const b of flux.formed) append(b,0,b.order);
  for (const b of flux.broken) append(b,b.order,0);
  for (const b of flux.upgraded) append(b,b.order-1,b.order);
  return changes.sort(orderEdges);
}

export function updateReactionBench(world, previous = null) {
  if (!previous) return baseline(world.tick);
  if (previous.tick === world.tick) return previous;
  if (previous.tick + 1 !== world.tick) return baseline(world.tick);
  const changes = readChanges(world.flux);
  let startTick = Math.max(previous.startTick, world.tick - REACTION_BENCH_LIMITS.ticks);
  let frames = previous.frames;
  if (frames[0]?.tick <= startTick) frames = frames.filter(f => f.tick > startTick);
  if (changes.length) {
    frames = [...frames, {tick: world.tick, changes}];
    let edits = frames.reduce((sum, f) => sum + f.changes.length, 0);
    let i = 0;
    while (edits > REACTION_BENCH_LIMITS.edits) {
      startTick = frames[i].tick;
      edits -= frames[i++].changes.length;
    }
    if (i) frames = frames.slice(i);
  }
  return {version: 1, startTick, tick: world.tick, frames};
}

function graphOf(world) {
  const graph = new Map(world.particles.map(atom => [atom.id, {atom, adjacent: new Map()}]));
  for (const {a,b,order} of world.bonds) setOrder(graph,a,b,order);
  return graph;
}
function setOrder(graph, a, b, order) {
  const left = graph.get(a).adjacent, right = graph.get(b).adjacent;
  if (order) { left.set(b,order); right.set(a,order); }
  else { left.delete(b); right.delete(a); }
}

export function validateReactionBench(world, data) {
  if (data?.version !== 1 || Object.keys(data).length !== 4 || data.tick !== world.tick || !natural(data.tick) ||
      !natural(data.startTick) || data.startTick > data.tick ||
      data.tick - data.startTick > REACTION_BENCH_LIMITS.ticks ||
      !Array.isArray(data.frames) || data.frames.length > data.tick - data.startTick) return false;
  let last = data.startTick, count = 0;
  for (const f of data.frames) {
    if (!natural(f?.tick) || Object.keys(f).length !== 2 || f.tick <= last || f.tick > data.tick ||
        !Array.isArray(f.changes) || !f.changes.length) return false;
    count += f.changes.length;
    if (count > REACTION_BENCH_LIMITS.edits) return false;
    last = f.tick;
  }
  const graph = graphOf(world);
  const formationTicks = new Map();
  for (const bond of world.bonds) if (natural(bond.formedAt)) {
    formationTicks.set(bond.a+'/'+bond.b,bond.formedAt);
  }
  const tallies = {cumulativeFormed: 0, cumulativeBroken: 0, cumulativeUpgraded: 0};
  for (let i = data.frames.length - 1; i >= 0; i--) {
    let prev = [0,0];
    const touched = new Set();
    for (const change of data.frames[i].changes) {
      if (!Array.isArray(change) || change.length !== 4) return false;
      const [a,b,before,after] = change;
      if (!graph.has(a) || !graph.has(b) || a >= b || orderEdges(prev,change) >= 0 ||
          !natural(before) || !natural(after) ||
          !(before > 0 && after === 0 || after === before+1)) return false;
      const left = graph.get(a), right = graph.get(b);
      if (Math.max(before,after) > maxBondOrder(left.atom.element,right.atom.element) ||
          (left.adjacent.get(b) ?? 0) !== after) return false;
      if (before === 0) {
        const pair = a+'/'+b;
        if (formationTicks.has(pair) && formationTicks.get(pair) !== data.frames[i].tick) return false;
        formationTicks.delete(pair);
      }
      setOrder(graph,a,b,before);
      touched.add(a); touched.add(b); prev = change;
      tallies[before === 0 ? 'cumulativeFormed' : after === 0 ? 'cumulativeBroken' : 'cumulativeUpgraded']++;
    }
    for (const id of touched) {
      const {atom,adjacent} = graph.get(id);
      let valence = 0;
      for (const order of adjacent.values()) valence += order;
      if (valence > ATOMIC_ELEMENTS[atom.element].maxValence) return false;
    }
  }
  for (const tick of formationTicks.values()) if (tick > data.startTick) return false;
  for (const [field, value] of Object.entries(tallies)) {
    if (world[field] !== undefined &&
        (value > world[field] || (data.startTick === 0 && value !== world[field]))) return false;
  }
  if (data.startTick < data.tick && world.flux) {
    const final = data.frames.at(-1);
    const expected = final?.tick === data.tick ? final.changes : [];
    if (JSON.stringify(expected) !== JSON.stringify(readChanges(world.flux))) return false;
  }
  if (data.startTick === 0 && [...graph.values()].some(v => v.adjacent.size)) return false;
  return true;
}

// This cache is independent of trajectory, observation windows, and RNG. Its
// lookup includes atom properties as well as actual bond endpoints and orders.
const identityCache = new Map();
function identityOf(graph, members) {
  const atoms = members.map(id => graph.get(id).atom);
  const bonds = [];
  for (const a of members) for (const [b,order] of graph.get(a).adjacent) {
    if (a < b) bonds.push({a,b,order});
  }
  bonds.sort((p,q) => p.a - q.a || p.b - q.b);
  const cacheKey = JSON.stringify([atoms.map(a=>[a.id,a.element,a.charge,a.neutrons,a.massNumber,a.isotope,a.protons,a.electrons]),
    bonds.map(b=>[b.a,b.b,b.order])]);
  if (identityCache.has(cacheKey)) return identityCache.get(cacheKey);
  const identity = identifyMolecularGraph(atoms,bonds);
  if (identityCache.size >= 640) identityCache.delete(identityCache.keys().next().value);
  identityCache.set(cacheKey,identity);
  return identity;
}

function components(graph, seeds) {
  const seen = new Set(), result = [];
  for (const seed of seeds) {
    if (seen.has(seed)) continue;
    const members = [seed];
    seen.add(seed);
    for (let i = 0; i < members.length; i++) {
      for (const id of graph.get(members[i]).adjacent.keys()) {
        if (!seen.has(id)) { seen.add(id); members.push(id); }
      }
    }
    members.sort((a,b)=>a-b);
    result.push(members);
  }
  return result;
}

export function getCurrentSpecies(world) {
  const graph = graphOf(world), groups = [], byKey = new Map();
  const labels = new Map((world.observer?.molecules ?? []).map(m => [m.members.join(','),m.id]));
  for (const members of components(graph,graph.keys())) {
    const identity = identityOf(graph,members);
    let group = identity.key === null ? undefined : byKey.get(identity.key);
    if (!group) {
      group = {status:identity.status,key:identity.key,formula:identity.formula,count:0,instances:[]};
      groups.push(group);
      if (identity.key !== null) byKey.set(identity.key,group);
    }
    group.count++;
    group.instances.push({id:labels.get(members.join(',')) ?? null,members});
  }
  return groups.sort((a,b)=>b.count-a.count || byText(a.formula,b.formula) || byText(a.key??'',b.key??''));
}

function participantRows(items) {
  const rows = [], known = new Map();
  for (const {key,formula} of items) {
    let row = key === null ? undefined : known.get(key);
    if (!row) {
      row = {key,formula,count:0};
      if (key !== null) known.set(key,row);
      rows.push(row);
    }
    row.count++;
  }
  return rows.sort((a,b)=>byText(a.formula,b.formula) || byText(a.key??'',b.key??''));
}
const label = rows => rows.map(r=>(r.count > 1 ? r.count+' ' : '')+r.formula).join(' + ');

function bondEditProfile(graph, changes) {
  const rows = new Map();
  for (const [a,b,before,after] of changes) {
    const elements = [graph.get(a).atom.element,graph.get(b).atom.element].sort().join('–');
    const key = JSON.stringify([elements,before,after]);
    rows.set(key,(rows.get(key) ?? 0)+1);
  }
  return [...rows].sort(([a],[b])=>byText(a,b)).map(([raw,count])=>{
    const [elements,before,after] = JSON.parse(raw);
    return {elements,before,after,count};
  });
}

// Simultaneous edits connected by unchanged bonds or by a shared atom belong
// to a single net event. Independent edits in the same tick stay separate.
function frameEvents(graph, frame) {
  const touched = new Set();
  for (const [a,b] of frame.changes) { touched.add(a); touched.add(b); }
  const before = components(graph,touched).map(members=>({members,...identityOf(graph,members)}));
  for (const [a,b,,after] of frame.changes) setOrder(graph,a,b,after);
  const after = components(graph,touched).map(members=>({members,...identityOf(graph,members)}));
  const oldOf = new Map(), newOf = new Map(), visited = new Set();
  for (const g of before) for (const id of g.members) oldOf.set(id,g);
  for (const g of after) for (const id of g.members) newOf.set(id,g);
  const results = [];
  for (const start of before) {
    if (visited.has(start)) continue;
    const old = [start], fresh = new Set();
    visited.add(start);
    for (let i=0;i<old.length;i++) for (const id of old[i].members) {
      const product = newOf.get(id);
      if (fresh.has(product)) continue;
      fresh.add(product);
      for (const member of product.members) {
        const parent = oldOf.get(member);
        if (!visited.has(parent)) {visited.add(parent);old.push(parent);}
      }
    }
    const atomIds = old.flatMap(g=>g.members).sort((a,b)=>a-b);
    const involved = new Set(atomIds);
    const bondChanges = frame.changes.filter(([a])=>involved.has(a));
    const edits = bondEditProfile(graph,bondChanges);
    const type = old.length > fresh.size ? 'association' : old.length < fresh.size ? 'dissociation' : 'rearrangement';
    const reactants = participantRows(old), products = participantRows(fresh);
    const complete = [...reactants,...products].every(r=>r.key !== null);
    const key = complete ? JSON.stringify([type,reactants.map(r=>[r.key,r.count]),
      products.map(r=>[r.key,r.count]),edits]) : null;
    results.push({type,key,reactants,products,edits,equation:label(reactants)+' → '+label(products),
      tick:frame.tick,atomIds,bondChanges,old,fresh});
  }
  return results;
}

function newGroup(event) {
  const {type,key,reactants,products,edits,equation,tick} = event;
  return {type,key,reactants,products,edits,equation,occurrences:0,firstTick:tick,lastTick:tick,evidence:[],
    persistence:windowsFs.map(windowFs=>({windowFs,reached:0,endedBefore:0,censoredBefore:0})),
    residence:{completedCount:0,completedMeanFs:null,completedMinFs:null,completedMaxFs:null,
      ongoingCount:0,ongoingMaxFs:null},recentProducts:[]};
}
function measureStay(episode, untilTick, ongoing, tickFs) {
  const {group,startTick,members,formula,key} = episode;
  if (!group) return;
  const observedFs = (untilTick-startTick)*tickFs;
  const residence = group.residence;
  if (ongoing) {
    residence.ongoingCount++;
    residence.ongoingMaxFs = Math.max(residence.ongoingMaxFs ?? 0,observedFs);
  } else {
    residence.completedCount++;
    const mean = residence.completedMeanFs ?? 0;
    residence.completedMeanFs = mean + (observedFs-mean)/residence.completedCount;
    residence.completedMaxFs = Math.max(residence.completedMaxFs ?? 0,observedFs);
    residence.completedMinFs = Math.min(residence.completedMinFs ?? Infinity,observedFs);
  }
  for (const window of group.persistence) {
    if (observedFs >= window.windowFs) window.reached++;
    else if (ongoing) window.censoredBefore++;
    else window.endedBefore++;
  }
  group.recentProducts.push({formula,key,members,formedTick:startTick,endedTick:ongoing ? null : untilTick,observedFs});
  if (group.recentProducts.length > 3) group.recentProducts.shift();
}

export function getReactionBenchReport(world) {
  const bench = world.reactionBench ?? baseline(world.tick);
  const tickFs = ATOMIC_PHYSICS.tickFs;
  const {tick,startTick,frames} = bench;
  const graph = graphOf(world);
  for (let i = frames.length-1; i >= 0; i--) {
    for (const [a,b,before] of frames[i].changes) setOrder(graph,a,b,before);
  }
  const atStart = components(graph,graph.keys()).filter(m=>m.length>1);
  const preexisting = new Set(atStart.map(m=>m.join(',')));
  const groupsByKey = new Map(), open = new Map(), recentEvents = [];
  let eventCount=0, unresolvedEvents=0;
  for (const frame of frames) for (const event of frameEvents(graph,frame)) {
    const {tick:when,key,type,equation,atomIds,bondChanges} = event;
    eventCount++;
    const evidence = {tick:when,atomIds,bondChanges:bondChanges.map(change=>change.slice())};
    recentEvents.push({key,type,equation,...evidence});
    if (recentEvents.length > 24) recentEvents.shift();
    let group = null;
    if (key === null) unresolvedEvents++;
    else {
      group = groupsByKey.get(key) ?? newGroup(event);
      groupsByKey.set(key,group);
      group.occurrences++; group.lastTick=when;
      group.evidence.push(evidence);
      if (group.evidence.length > 3) group.evidence.shift();
    }
    for (const item of event.old) {
      const material = item.members.join(',');
      preexisting.delete(material);
      const episode = open.get(material);
      if (episode) {measureStay(episode,when,false,tickFs);open.delete(material);}
    }
    for (const item of event.fresh) if (item.members.length>1) {
      open.set(item.members.join(','),{group,startTick:when,members:item.members,formula:item.formula,key:item.key});
    }
  }
  for (const episode of open.values()) measureStay(episode,tick,true,tickFs);
  const groups = [...groupsByKey.values()].sort((a,b)=>b.occurrences-a.occurrences || b.lastTick-a.lastTick || byText(a.key,b.key));
  return {startTick,tick,tickFs,physicsVersion:world.version ?? null,physicsProfile:world.physicsProfile ?? null,
    integrationDtFs:world.integrationDtFs ?? null,
    windowFromFs:startTick*tickFs,windowToFs:tick*tickFs,coverageFs:(tick-startTick)*tickFs,
    comparedSteps:tick-startTick,silentTicks:tick-startTick-frames.length,eventCount,unresolvedEvents,
    baselineMolecules:atStart.length,survivingBaselineMolecules:preexisting.size,
    windowsFs:[...windowsFs],groups,recentEvents};
}

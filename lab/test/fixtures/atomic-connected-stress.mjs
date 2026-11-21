import assert from 'node:assert/strict';
import {AtomicWorld} from '../../public/src/atomic-world.js';
import {ATOMIC_ELEMENTS,bondEnergyEv} from '../../public/src/atomic-elements.js';
import {observeAtomicWorld} from '../../public/src/atomic-observer.js';
import {updateReactionBench} from '../../public/src/reaction-bench.js';

// Prepared symmetry stress case for archive validation. No formation trajectory
// is asserted. The checkpoint begins observing this connected graph at tick 1.
export function connectedAtomicFixture() {
  const world=new AtomicWorld(42,{count:384});
  world.step();
  world.bonds=[];
  world.flux={formed:[],upgraded:[],broken:[],reactionHeatEv:0,bathWorkEv:0};
  const available=Object.fromEntries(Object.keys(ATOMIC_ELEMENTS).map(symbol=>
    [symbol,world.particles.filter(p=>p.element===symbol)]));
  const degree=new Map(world.particles.map(p=>[p.id,0]));
  function connect(left,right) {
    const edge={a:Math.min(left.id,right.id),b:Math.max(left.id,right.id),order:1,
      energyEv:bondEnergyEv(left.element,right.element,1),formedAt:1};
    assert(edge.energyEv>0);
    for(const atom of [left,right]){
      degree.set(atom.id,degree.get(atom.id)+1);
      assert(degree.get(atom.id)<=ATOMIC_ELEMENTS[atom.element].maxValence);
    }
    edge.rest=world.bondRest(edge);
    world.bonds.push(edge);
  }

  // Each ring has two equivalent three-edge paths between its carbon atoms.
  // Swapping either arm preserves the graph, independently in all 16 rings.
  const anchors=[];
  for(let i=0;i<16;i++){
    const left=available.C.pop(),right=available.C.pop();
    if(anchors.length)connect(anchors.at(-1),left);
    for(let arm=0;arm<2;arm++){
      const first=available.O.pop(),last=available.O.pop();
      connect(left,first);connect(first,last);connect(last,right);
    }
    anchors.push(left,right);
  }
  const remainder=[anchors.at(-1),...available.C,...available.S,...available.P,...available.N,...available.O];
  for(let i=1;i<remainder.length;i++)connect(remainder[i-1],remainder[i]);
  for(const atom of new Set([...anchors,...remainder])){
    while(available.H.length && degree.get(atom.id)<ATOMIC_ELEMENTS[atom.element].maxValence)
      connect(atom,available.H.pop());
  }
  assert.equal(available.H.length,0);
  world.cumulativeFormed=world.bonds.length;
  world.cumulativeBroken=0;
  world.cumulativeUpgraded=0;
  world.observer=observeAtomicWorld(world,null);
  world.reactionBench=updateReactionBench(world);
  // Refresh the physical field and book the work of the prepared configuration.
  world.setVolume(world.volumeNm3+1);
  return world.serialize();
}

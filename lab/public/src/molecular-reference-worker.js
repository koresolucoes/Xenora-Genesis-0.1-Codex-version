import {runMolecularReference} from './molecular-reference.js';

self.onmessage=event=>{
  try{self.postMessage({report:runMolecularReference({physicsVersion:event.data?.physicsVersion})});}
  catch(error){self.postMessage({error:error.message});}
};

import {runMolecularReference} from './molecular-reference.js';

self.onmessage=()=>{
  try{self.postMessage({report:runMolecularReference()});}
  catch(error){self.postMessage({error:error.message});}
};

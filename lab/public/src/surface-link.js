import {navigateFromInstrument} from "./instrument-route.js";
const SLOT = 'xenora.surface-transfer.v1';

function transfer(param) {
  const search = new URLSearchParams(globalThis.location?.search || '');
  const id = search.get(param);
  if (!id) return null;
  try {
    const item = JSON.parse(sessionStorage.getItem(SLOT+'.'+id) || sessionStorage.getItem(SLOT) || 'null');
    if (item?.id === id && item.sample && item.snapshot) return item;
  } catch { /* This browser has no accessible transfer. */ }
  throw new Error('A amostra desta aba expirou. Abra o laboratório Origens para coletar outra.');
}

export function openSurfaceSample(world) {
  const sample=world.surfaceSample();
  const id=crypto.randomUUID();
  try {
    const value=JSON.stringify({id,sample,snapshot:world.serialize()});
    sessionStorage.setItem(SLOT,value);
    try {sessionStorage.setItem(SLOT+'.'+id,value);} catch { /* Latest sample remains available. */ }
  }
  catch {throw new Error('O navegador não conseguiu guardar a amostra nesta aba.');}
  navigateFromInstrument('./?amostra='+id);
}

export function getSurfaceTransfer() {return transfer('amostra');}

export function getOriginReturn() {return transfer('origem')?.snapshot || null;}

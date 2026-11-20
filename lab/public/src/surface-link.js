const SLOT = 'xenora.surface-transfer.v1';

function transfer(param) {
  const search = new URLSearchParams(globalThis.location?.search || '');
  const id = search.get(param);
  if (!id) return null;
  try {
    const item = JSON.parse(sessionStorage.getItem(SLOT) || 'null');
    if (item?.id === id && item.sample && item.snapshot) return item;
  } catch { /* This browser has no accessible transfer. */ }
  throw new Error('A amostra desta aba expirou. Abra o laboratório Origens para coletar outra.');
}

export function openSurfaceSample(world) {
  const sample=world.surfaceSample();
  const id=crypto.randomUUID();
  try {sessionStorage.setItem(SLOT, JSON.stringify({id,sample,snapshot:world.serialize()}));}
  catch {throw new Error('O navegador não conseguiu guardar a amostra nesta aba.');}
  location.assign('./?amostra='+id);
}

export function getSurfaceTransfer() {return transfer('amostra');}

export function getOriginReturn() {return transfer('origem')?.snapshot || null;}

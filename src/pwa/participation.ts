let active = false;
let retainedUntil = 0;
const tabId = typeof crypto !== 'undefined' ? crypto.randomUUID() : String(Math.random());
const storageKey = `bricks-network-active-${tabId}`;
let lastStored = 0;
const listeners = new Set<() => void>();
export function setNetworkParticipation(value: boolean): void {
  const changed = active !== value || (!value&&retainedUntil>0); active=value;retainedUntil=0;
  if(!changed && Date.now()-lastStored<2000)return;lastStored=Date.now();
  try {if(value)localStorage.setItem(storageKey,String(Date.now()+36_000));else localStorage.removeItem(storageKey);} catch {}
  if(changed)for(const listener of listeners)listener();
}
/** Closing presentation retains a bounded return guard even when storage is unavailable. */
export function retainNetworkParticipation():void {
  if(!active)return;
  retainedUntil=Date.now()+36_000;active=false;lastStored=Date.now();
  try{localStorage.setItem(storageKey,String(retainedUntil));}catch{}
  for(const listener of listeners)listener();
}
export function isNetworkParticipationActive(): boolean {
  if(active||Date.now()<retainedUntil)return true;
  try {for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith('bricks-network-active-')&&Number(localStorage.getItem(key))>Date.now())return true;}return false;}catch{return false;}
}
export function onParticipationChange(listener:()=>void):()=>void {listeners.add(listener);return()=>listeners.delete(listener);}

import {it,expect,vi} from 'vitest';
import {ClientUpdate} from '../src/pwa/clientUpdate';
import {registerPwaServiceWorker} from '../src/pwa/register';
import {setNetworkParticipation,retainNetworkParticipation,isNetworkParticipationActive} from '../src/pwa/participation';
it('blocks manual activation throughout network participation and requires a click after leaving',async()=>{
  setNetworkParticipation(true);
  const postMessage=vi.fn();const reload=vi.fn();let controllerChange:EventListener|undefined;
  const browser={serviceWorker:{controller:{} as ServiceWorker,register:vi.fn().mockResolvedValue({waiting:{postMessage}}),
    addEventListener:vi.fn((event:string,listener:EventListenerOrEventListenerObject)=>{if(event==='controllerchange')controllerChange=listener as EventListener;})}};
  const updates = new ClientUpdate(reload);
  await registerPwaServiceWorker(browser,'https://test.example/',true,reload,updates);
  expect(updates.apply()).toBe(false);
  expect(postMessage).not.toHaveBeenCalled();controllerChange?.(new Event('controllerchange'));expect(reload).not.toHaveBeenCalled();
  setNetworkParticipation(false);expect(postMessage).not.toHaveBeenCalled();expect(reload).not.toHaveBeenCalled();
  updates.apply();expect(reload).toHaveBeenCalledTimes(1);updates.dispose();
});
it('closed presentation retains a bounded deadline without storage and repeated disposal cannot renew it',()=>{
  vi.useFakeTimers();vi.setSystemTime(100000);setNetworkParticipation(true);retainNetworkParticipation();
  expect(isNetworkParticipationActive()).toBe(true);vi.advanceTimersByTime(35000);retainNetworkParticipation();
  expect(isNetworkParticipationActive()).toBe(true);vi.advanceTimersByTime(1000);expect(isNetworkParticipationActive()).toBe(false);
  setNetworkParticipation(true);retainNetworkParticipation();setNetworkParticipation(false);expect(isNetworkParticipationActive()).toBe(false);vi.useRealTimers();
});

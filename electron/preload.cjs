const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bricksDesktop', {
  updateState: () => ipcRenderer.invoke('desktop:update-state'),
  check: () => ipcRenderer.invoke('desktop:check'),
  download: () => ipcRenderer.invoke('desktop:download'),
  cancel: () => ipcRenderer.invoke('desktop:cancel'),
  setActivity: inMenu => ipcRenderer.invoke('desktop:activity', inMenu === true),
  history: locale => ipcRenderer.invoke('desktop:history', locale),
  apply: () => ipcRenderer.invoke('desktop:apply'),
  setSafeMenu: safe => ipcRenderer.send('desktop:safe-menu', safe === true),
  healthy: () => ipcRenderer.invoke('desktop:healthy'),
  display: () => ipcRenderer.invoke('desktop:display'),
  setDisplay: preferences => ipcRenderer.invoke('desktop:set-display', preferences),
  confirmDisplay: confirm => ipcRenderer.invoke('desktop:confirm-display', confirm === true),
  exit: () => ipcRenderer.invoke('desktop:exit'),
});

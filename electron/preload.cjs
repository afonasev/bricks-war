const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bricksDesktop', {
  updateState: () => ipcRenderer.invoke('desktop:update-state'),
  check: () => ipcRenderer.invoke('desktop:check'),
  apply: () => ipcRenderer.invoke('desktop:apply'),
  setSafeMenu: safe => ipcRenderer.send('desktop:safe-menu', safe === true),
  healthy: () => ipcRenderer.invoke('desktop:healthy'),
  display: () => ipcRenderer.invoke('desktop:display'),
  setDisplay: preferences => ipcRenderer.invoke('desktop:set-display', preferences),
  exit: () => ipcRenderer.invoke('desktop:exit'),
});

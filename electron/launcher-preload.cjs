const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bricksLauncher', Object.freeze({
  state: () => ipcRenderer.invoke('launcher:state'),
  choose: (id, action) => ipcRenderer.invoke('launcher:choose', { id, action }),
  installer: id => ipcRenderer.invoke('launcher:installer', id),
  notes: id => ipcRenderer.invoke('launcher:notes', id),
}));

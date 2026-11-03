const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bricksLauncher', Object.freeze({
  state: () => ipcRenderer.invoke('launcher:state'),
  choose: (id, action) => ipcRenderer.invoke('launcher:choose', { id, action }),
  notes: id => ipcRenderer.invoke('launcher:notes', id),
}));

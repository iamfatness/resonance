const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('resonanceDesktop', {
  platform: process.platform,
  isDesktop: true,
  engine: {
    getState: () => ipcRenderer.invoke('engine:getState'),
    start: () => ipcRenderer.invoke('engine:start'),
    stop: () => ipcRenderer.invoke('engine:stop'),
    updateSettings: (settings) => ipcRenderer.invoke('engine:updateSettings', settings),
    selectDevices: (devices) => ipcRenderer.invoke('engine:selectDevices', devices),
    onState: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('engine:state', listener);
      return () => ipcRenderer.removeListener('engine:state', listener);
    },
  },
});

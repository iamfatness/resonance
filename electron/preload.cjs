const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('resonanceDesktop', {
  platform: process.platform,
  isDesktop: true,
  engine: {
    getState: () => ipcRenderer.invoke('engine:getState'),
    refreshDevices: () => ipcRenderer.invoke('engine:refreshDevices'),
    start: () => ipcRenderer.invoke('engine:start'),
    stop: () => ipcRenderer.invoke('engine:stop'),
    renderSilence: (durationMs) => ipcRenderer.invoke('engine:renderSilence', durationMs),
    updateSettings: (settings) => ipcRenderer.invoke('engine:updateSettings', settings),
    selectDevices: (devices) => ipcRenderer.invoke('engine:selectDevices', devices),
    onState: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('engine:state', listener);
      return () => ipcRenderer.removeListener('engine:state', listener);
    },
    onMeters: (callback) => {
      const listener = (_event, meters) => callback(meters);
      ipcRenderer.on('engine:meters', listener);
      return () => ipcRenderer.removeListener('engine:meters', listener);
    },
  },
});

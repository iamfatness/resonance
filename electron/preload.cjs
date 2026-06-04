const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('resonanceDesktop', {
  platform: process.platform,
  isDesktop: true,
  selectWavFile: () => ipcRenderer.invoke('dialog:selectWav'),
  engine: {
    getState: () => ipcRenderer.invoke('engine:getState'),
    refreshDevices: () => ipcRenderer.invoke('engine:refreshDevices'),
    refreshPlugins: () => ipcRenderer.invoke('engine:refreshPlugins'),
    start: () => ipcRenderer.invoke('engine:start'),
    stop: () => ipcRenderer.invoke('engine:stop'),
    renderSilence: (durationMs) => ipcRenderer.invoke('engine:renderSilence', durationMs),
    renderTone: (durationMs) => ipcRenderer.invoke('engine:renderTone', durationMs),
    renderWav: (payload) => ipcRenderer.invoke('engine:renderWav', payload),
    pushDeckPcm: (payload) => ipcRenderer.invoke('engine:pushDeckPcm', payload),
    captureLoopback: (payload) => ipcRenderer.invoke('engine:captureLoopback', payload),
    startDeckCapture: (payload) => ipcRenderer.invoke('engine:startDeckCapture', payload),
    stopDeckCapture: (payload) => ipcRenderer.invoke('engine:stopDeckCapture', payload),
    loadDeckWav: (payload) => ipcRenderer.invoke('engine:loadDeckWav', payload),
    playDeck: (payload) => ipcRenderer.invoke('engine:playDeck', payload),
    pauseDeck: (payload) => ipcRenderer.invoke('engine:pauseDeck', payload),
    stopDeck: (payload) => ipcRenderer.invoke('engine:stopDeck', payload),
    seekDeck: (payload) => ipcRenderer.invoke('engine:seekDeck', payload),
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

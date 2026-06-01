const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('resonanceDesktop', {
  platform: process.platform,
  isDesktop: true,
});

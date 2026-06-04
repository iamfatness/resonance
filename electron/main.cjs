const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
const { fork } = require('node:child_process');
const path = require('node:path');

const isDev = Boolean(process.env.RESONANCE_DEV_SERVER_URL);
let engineProcess = null;
let engineState = null;
let requestCounter = 0;
const pendingEngineRequests = new Map();

function startAudioEngineProcess() {
  if (engineProcess) return;

  engineProcess = fork(path.join(__dirname, '..', 'engine', 'audio-engine.cjs'), [], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });

  engineProcess.on('message', (message = {}) => {
    if (message.type === 'METERS') {
      BrowserWindow.getAllWindows().forEach((window) => {
        window.webContents.send('engine:meters', message.meters);
      });
      return;
    }

    if (message.type !== 'STATE') return;
    engineState = message.state;
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send('engine:state', engineState);
    });

    const pending = pendingEngineRequests.get(message.requestId);
    if (pending) {
      pending.resolve(engineState);
      pendingEngineRequests.delete(message.requestId);
    }
  });

  engineProcess.on('exit', () => {
    engineProcess = null;
    engineState = { status: 'stopped', mode: 'offline' };
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send('engine:state', engineState);
    });
  });
}

function sendEngineCommand(type, payload = {}) {
  startAudioEngineProcess();
  const requestId = `${Date.now()}-${requestCounter += 1}`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingEngineRequests.delete(requestId);
      reject(new Error(`Audio engine did not respond to ${type}.`));
    }, 5000);

    pendingEngineRequests.set(requestId, {
      resolve: (state) => {
        clearTimeout(timeout);
        resolve(state);
      },
      reject,
    });

    engineProcess.send({ type, requestId, ...payload });
  });
}

function registerIpc() {
  ipcMain.handle('dialog:selectWav', async () => {
    const window = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(window || undefined, {
      title: 'Choose Deck A WAV',
      properties: ['openFile'],
      filters: [
        { name: 'WAV audio', extensions: ['wav'] },
      ],
    });

    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    return {
      path: filePath,
      name: path.basename(filePath),
    };
  });

  ipcMain.handle('engine:getState', () => sendEngineCommand('GET_STATE'));
  ipcMain.handle('engine:refreshDevices', () => sendEngineCommand('REFRESH_DEVICES'));
  ipcMain.handle('engine:refreshPlugins', () => sendEngineCommand('REFRESH_PLUGINS'));
  ipcMain.handle('engine:start', () => sendEngineCommand('START'));
  ipcMain.handle('engine:stop', () => sendEngineCommand('STOP'));
  ipcMain.handle('engine:updateSettings', (_event, settings) => sendEngineCommand('UPDATE_SETTINGS', { settings }));
  ipcMain.handle('engine:selectDevices', (_event, devices) => sendEngineCommand('SELECT_DEVICES', { devices }));
  ipcMain.handle('engine:renderSilence', (_event, durationMs) => sendEngineCommand('RENDER_SILENCE', { durationMs }));
  ipcMain.handle('engine:renderTone', (_event, durationMs) => sendEngineCommand('RENDER_TONE', { durationMs }));
  ipcMain.handle('engine:renderWav', (_event, payload) => sendEngineCommand('RENDER_WAV', { payload }));
  ipcMain.handle('engine:pushDeckPcm', (_event, payload) => sendEngineCommand('PUSH_DECK_PCM', { payload }));
  ipcMain.handle('engine:captureLoopback', (_event, payload) => sendEngineCommand('CAPTURE_LOOPBACK', { payload }));
  ipcMain.handle('engine:startDeckCapture', (_event, payload) => sendEngineCommand('START_DECK_CAPTURE', { payload }));
  ipcMain.handle('engine:stopDeckCapture', (_event, payload) => sendEngineCommand('STOP_DECK_CAPTURE', { payload }));
  ipcMain.handle('engine:loadDeckWav', (_event, payload) => sendEngineCommand('LOAD_DECK_WAV', { payload }));
  ipcMain.handle('engine:playDeck', (_event, payload) => sendEngineCommand('PLAY_DECK', { payload }));
  ipcMain.handle('engine:pauseDeck', (_event, payload) => sendEngineCommand('PAUSE_DECK', { payload }));
  ipcMain.handle('engine:stopDeck', (_event, payload) => sendEngineCommand('STOP_DECK', { payload }));
  ipcMain.handle('engine:seekDeck', (_event, payload) => sendEngineCommand('SEEK_DECK', { payload }));
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: 'Resonance',
    backgroundColor: '#070a0b',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    window.loadURL(`${process.env.RESONANCE_DEV_SERVER_URL}/app`);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
      search: 'view=app',
    });
  }
}

function createMenu() {
  const template = [
    {
      label: 'Resonance',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(() => {
    registerIpc();
    startAudioEngineProcess();
    createMenu();
    createMainWindow();
  });
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (engineProcess) {
    engineProcess.kill();
    engineProcess = null;
  }
});

const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const isDev = Boolean(process.env.RESONANCE_DEV_SERVER_URL);
const desktopApiOrigin = 'https://resonance.iamfatness.us';
let engineProcess = null;
let engineState = null;
let desktopServer = null;
let desktopServerUrl = null;
let requestCounter = 0;
const pendingEngineRequests = new Map();
const deckEffectsWindows = new Map();

if (process.env.RESONANCE_USER_DATA_DIR) {
  app.setPath('userData', process.env.RESONANCE_USER_DATA_DIR);
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function sendText(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'content-type': contentType,
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function proxyYouTubeApi(req, res, requestUrl) {
  const upstream = new URL(requestUrl.pathname + requestUrl.search, desktopApiOrigin);
  try {
    const response = await fetch(upstream);
    const body = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, {
      'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch (error) {
    sendText(res, 502, JSON.stringify({ error: error?.message || 'YouTube API proxy failed.' }), 'application/json; charset=utf-8');
  }
}

function serveDesktopAsset(req, res, requestUrl) {
  const distRoot = path.join(__dirname, '..', 'dist');
  const pathname = decodeURIComponent(requestUrl.pathname);
  const relativePath = pathname === '/' || pathname === '/app'
    ? 'index.html'
    : pathname.replace(/^\/+/, '');
  const assetPath = path.resolve(distRoot, relativePath);
  const resolvedDistRoot = path.resolve(distRoot);

  if (!assetPath.startsWith(resolvedDistRoot)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(assetPath, (error, data) => {
    if (error) {
      fs.readFile(path.join(distRoot, 'index.html'), (indexError, indexData) => {
        if (indexError) {
          sendText(res, 404, 'Not found');
          return;
        }
        res.writeHead(200, {
          'content-type': mimeTypes['.html'],
          'cache-control': 'no-store',
        });
        res.end(indexData);
      });
      return;
    }

    res.writeHead(200, {
      'content-type': mimeTypes[path.extname(assetPath).toLowerCase()] || 'application/octet-stream',
      'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store',
    });
    res.end(data);
  });
}

function startDesktopServer() {
  if (isDev) return Promise.resolve(process.env.RESONANCE_DEV_SERVER_URL);
  if (desktopServerUrl) return Promise.resolve(desktopServerUrl);

  desktopServer = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (requestUrl.pathname === '/api/youtube/search' || requestUrl.pathname === '/api/youtube/playlist') {
      proxyYouTubeApi(req, res, requestUrl);
      return;
    }
    serveDesktopAsset(req, res, requestUrl);
  });

  return new Promise((resolve, reject) => {
    desktopServer.once('error', reject);
    desktopServer.listen(0, '127.0.0.1', () => {
      const address = desktopServer.address();
      desktopServerUrl = `http://127.0.0.1:${address.port}`;
      resolve(desktopServerUrl);
    });
  });
}

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
  ipcMain.handle('engine:exportDiagnostics', () => sendEngineCommand('EXPORT_DIAGNOSTICS'));
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
  ipcMain.handle('window:openDeckEffects', (_event, deck) => openDeckEffectsWindow(deck));
}

async function openDeckEffectsWindow(deck = 'A') {
  const normalizedDeck = deck === 'B' ? 'B' : 'A';
  const existing = deckEffectsWindows.get(normalizedDeck);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return { status: 'focused', deck: normalizedDeck };
  }

  const window = new BrowserWindow({
    width: 760,
    height: 820,
    minWidth: 620,
    minHeight: 620,
    title: `Deck ${normalizedDeck} Effects`,
    backgroundColor: '#070a0b',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  deckEffectsWindows.set(normalizedDeck, window);
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (deckEffectsWindows.get(normalizedDeck) === window) deckEffectsWindows.delete(normalizedDeck);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const serverUrl = await startDesktopServer();
  window.loadURL(`${serverUrl}/?view=effects&deck=${normalizedDeck}`);
  return { status: 'opened', deck: normalizedDeck };
}

async function createMainWindow() {
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
    const serverUrl = await startDesktopServer();
    window.loadURL(`${serverUrl}/app`);
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
  if (desktopServer) {
    desktopServer.close();
    desktopServer = null;
    desktopServerUrl = null;
  }
  deckEffectsWindows.clear();
});

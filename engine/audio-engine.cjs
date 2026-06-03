const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { DesktopAudioRouter } = require('./audio-router.cjs');

const rootDir = path.resolve(__dirname, '..');
const listAudioDevicesScript = path.join(rootDir, 'scripts', 'list-audio-devices.ps1');
const wasapiMeterExe = path.join(rootDir, 'native', 'wasapi-meter', 'build', 'Release', 'resonance-wasapi-meter.exe');
const audioRouterExe = path.join(rootDir, 'native', 'audio-router', 'build', 'Release', 'resonance-audio-router.exe');
const sysvadSolution = path.join(rootDir, 'driver', 'audio', 'sysvad', 'sysvad.sln');
const buildToolsPlatforms = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\MSBuild\\Microsoft\\VC\\v170\\Platforms';
const windowsKitsRoot = 'C:\\Program Files (x86)\\Windows Kits\\10';
const settingsDir = path.join(process.env.APPDATA || rootDir, 'Resonance');
const settingsPath = path.join(settingsDir, 'engine-settings.json');

const defaultSettings = {
  preset: 'Focus',
  eqMode: 'Preset',
  curve: [2, 3.5, 2, 0, -2, -1, 1.5, 2],
  appEqBypassed: false,
  deckProcessing: {
    A: { pan: -12, eqBypassed: false, curve: [0, 0, 0, 0, 0, 0, 0, 0], pluginChain: [] },
    B: { pan: 12, eqBypassed: false, curve: [0, 0, 0, 0, 0, 0, 0, 0], pluginChain: [] },
  },
  deckVolumes: { A: 72, B: 38 },
  outputGain: 0.9,
};

const defaultPlaybackDeck = {
  path: null,
  name: null,
  status: 'empty',
  positionMs: 0,
  durationMs: 0,
  lastStartedAt: null,
};

function readPersistedState() {
  try {
    if (!fs.existsSync(settingsPath)) return {};
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return {};
  }
}

const persistedState = readPersistedState();

const engineState = {
  status: 'idle',
  mode: 'windows-enumeration',
  inputDeviceId: persistedState.inputDeviceId || null,
  outputDeviceId: persistedState.outputDeviceId || 'default-output',
  settings: {
    ...defaultSettings,
    ...(persistedState.settings || {}),
  },
  pluginHost: {
    status: 'planned',
    formats: ['VST3'],
    vendors: ['Waves'],
    note: 'Native plugin hosting is not active until the desktop audio router can process PCM.',
  },
  playbackDecks: {
    A: { ...defaultPlaybackDeck },
    B: { ...defaultPlaybackDeck },
  },
  router: null,
  devices: {
    inputs: [
      {
        id: 'resonance-virtual-input',
        name: 'Resonance Virtual Playback Device',
        kind: 'loopback',
        available: false,
        note: 'Available after the Windows virtual audio driver is installed.',
      },
      {
        id: 'mock-input',
        name: 'Mock Audio Input',
        kind: 'test',
        available: true,
        note: 'Development placeholder until WASAPI capture is wired.',
      },
    ],
    outputs: [
      {
        id: 'default-output',
        name: 'System Default Output',
        kind: 'render',
        available: true,
      },
    ],
  },
  deviceScan: {
    status: 'pending',
    error: null,
    scannedAt: null,
  },
  diagnostics: {
    updatedAt: null,
    checks: [],
  },
  lastStartedAt: null,
  meters: {
    inputPeak: 0,
    outputPeak: 0,
    inputRms: 0,
    outputRms: 0,
    clipping: false,
    decks: {
      A: { inputPeak: 0, outputPeak: 0, leftPeak: 0, rightPeak: 0, pan: -12, pluginCount: 0, eqActivity: 0 },
      B: { inputPeak: 0, outputPeak: 0, leftPeak: 0, rightPeak: 0, pan: 12, pluginCount: 0, eqActivity: 0 },
    },
    updatedAt: null,
  },
};

let meterTimer = null;
let nativeMeterBusy = false;
let nativeRouterBusy = false;
let livePlaybackBusy = false;
let lastRouterStatePublish = 0;
const audioRouter = new DesktopAudioRouter({
  settings: engineState.settings,
  hasNativeMeter,
  hasNativeRouter,
  nativeRouterPath: audioRouterExe,
  onSnapshot: handleNativeRouterSnapshot,
});
engineState.router = audioRouter.getState();

function findDirectoryByName(startDir, targetName, maxDepth = 6) {
  if (!fs.existsSync(startDir) || maxDepth < 0) return false;
  let entries = [];
  try {
    entries = fs.readdirSync(startDir, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === targetName) return true;
    if (findDirectoryByName(path.join(startDir, entry.name), targetName, maxDepth - 1)) return true;
  }
  return false;
}

function findFileByName(startDir, targetName, maxDepth = 6) {
  if (!fs.existsSync(startDir) || maxDepth < 0) return false;
  let entries = [];
  try {
    entries = fs.readdirSync(startDir, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    const entryPath = path.join(startDir, entry.name);
    if (entry.isFile() && entry.name === targetName) return true;
    if (entry.isDirectory() && findFileByName(entryPath, targetName, maxDepth - 1)) return true;
  }
  return false;
}

function buildDiagnostics() {
  const hasKernelToolset = findDirectoryByName(buildToolsPlatforms, 'WindowsKernelModeDriver10.0');
  const hasDriverAppToolset = findDirectoryByName(buildToolsPlatforms, 'WindowsApplicationForDrivers10.0');
  const hasWdkKernelHeader = findFileByName(path.join(windowsKitsRoot, 'Include'), 'portcls.h');
  const hasWdkPortClsLib = findFileByName(path.join(windowsKitsRoot, 'Lib'), 'portcls.lib');
  const hasWdkFiles = hasWdkKernelHeader && hasWdkPortClsLib;
  const hasNativeMeterHelper = hasNativeMeter();
  const hasNativeRouterHelper = hasNativeRouter();
  const hasSysvadSource = fs.existsSync(sysvadSolution);
  const hasPersistedSettings = fs.existsSync(settingsPath);
  const hasWindowsAudioScan = engineState.deviceScan.status === 'ready';
  const hasVirtualDevice = engineState.devices.inputs.some((device) => (
    device.id === 'resonance-virtual-input' && device.available
  ));

  engineState.diagnostics = {
    updatedAt: new Date().toISOString(),
    settingsPath,
    checks: [
      {
        id: 'desktop-engine',
        label: 'Desktop engine process',
        status: 'ready',
        detail: 'Electron can communicate with the audio engine.',
      },
      {
        id: 'settings',
        label: 'Persistent settings',
        status: hasPersistedSettings ? 'ready' : 'pending',
        detail: hasPersistedSettings ? settingsPath : 'Settings file will be created after the next settings or device change.',
      },
      {
        id: 'audio-scan',
        label: 'Windows audio endpoints',
        status: hasWindowsAudioScan ? 'ready' : engineState.deviceScan.status === 'error' ? 'blocked' : 'pending',
        detail: hasWindowsAudioScan ? 'Endpoint scan completed.' : engineState.deviceScan.error || 'Endpoint scan is pending.',
      },
      {
        id: 'audio-router',
        label: 'Deck audio router',
        status: hasNativeRouterHelper ? 'ready' : engineState.router?.status === 'running' ? 'pending' : 'planned',
        detail: hasNativeRouterHelper ? audioRouterExe : 'Run npm run native:audio-router to build the native router skeleton.',
      },
      {
        id: 'wasapi-meter',
        label: 'Native WASAPI meter',
        status: hasNativeMeterHelper ? 'ready' : 'pending',
        detail: hasNativeMeterHelper ? wasapiMeterExe : 'Run npm run native:wasapi-meter to build the helper.',
      },
      {
        id: 'sysvad-source',
        label: 'SysVAD source',
        status: hasSysvadSource ? 'ready' : 'pending',
        detail: hasSysvadSource ? sysvadSolution : 'Clone the Microsoft SysVAD sample into driver/audio/sysvad.',
      },
      {
        id: 'wdk-files',
        label: 'WDK files',
        status: hasWdkFiles ? 'ready' : 'blocked',
        detail: hasWdkFiles ? 'Kernel audio headers and libraries are installed.' : 'Install the Windows Driver Kit files.',
      },
      {
        id: 'wdk-toolsets',
        label: 'VS WDK build tools',
        status: hasKernelToolset && hasDriverAppToolset ? 'ready' : 'blocked',
        detail: hasKernelToolset && hasDriverAppToolset
          ? 'Windows driver build toolsets are installed.'
          : 'Missing Component.Microsoft.Windows.DriverKit.BuildTools.',
      },
      {
        id: 'virtual-device',
        label: 'Resonance virtual device',
        status: hasVirtualDevice ? 'ready' : 'blocked',
        detail: hasVirtualDevice ? 'Virtual playback endpoint is installed.' : 'Blocked until SysVAD builds and installs.',
      },
      {
        id: 'plugin-host',
        label: 'Plugin host',
        status: 'planned',
        detail: 'VST3/Waves hosting starts after PCM capture/render routing is active.',
      },
    ],
  };
}

function persistEngineState() {
  try {
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({
      inputDeviceId: engineState.inputDeviceId,
      outputDeviceId: engineState.outputDeviceId,
      settings: engineState.settings,
      savedAt: new Date().toISOString(),
    }, null, 2));
  } catch {
    // Persistence failure should not take down audio control.
  }
  buildDiagnostics();
}

function hasNativeMeter() {
  return fs.existsSync(wasapiMeterExe);
}

function hasNativeRouter() {
  return fs.existsSync(audioRouterExe);
}

function readWavInfo(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('File is not a WAV file.');
  }

  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataBytes = 0;
  while (offset + 8 <= buffer.length) {
    const tag = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (tag === 'fmt ') {
      channels = buffer.readUInt16LE(chunkStart + 2);
      sampleRate = buffer.readUInt32LE(chunkStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkStart + 14);
    }
    if (tag === 'data') dataBytes = size;
    offset = chunkStart + size + (size % 2);
  }

  if (!channels || !sampleRate || !bitsPerSample || !dataBytes) {
    throw new Error('WAV metadata is incomplete.');
  }

  const bytesPerFrame = channels * (bitsPerSample / 8);
  const frames = Math.floor(dataBytes / Math.max(1, bytesPerFrame));
  return {
    channels,
    sampleRate,
    bitsPerSample,
    frames,
    durationMs: Math.round(frames * 1000 / sampleRate),
  };
}

function currentDeckPosition(deckState) {
  if (deckState.status !== 'playing' || !deckState.lastStartedAt) return deckState.positionMs || 0;
  return Math.min(
    deckState.durationMs || Number.MAX_SAFE_INTEGER,
    (deckState.positionMs || 0) + (Date.now() - Date.parse(deckState.lastStartedAt)),
  );
}

function snapshotDeckPlayback() {
  for (const deck of ['A', 'B']) {
    const deckState = engineState.playbackDecks[deck];
    deckState.positionMs = currentDeckPosition(deckState);
    if (deckState.durationMs && deckState.positionMs >= deckState.durationMs) {
      deckState.positionMs = deckState.durationMs;
      deckState.status = deckState.path ? 'stopped' : 'empty';
      deckState.lastStartedAt = null;
    } else if (deckState.status === 'playing') {
      deckState.lastStartedAt = new Date().toISOString();
    }
  }
}

function hasPlayingDeck() {
  snapshotDeckPlayback();
  return Object.values(engineState.playbackDecks).some((deck) => deck.status === 'playing' && deck.path);
}

function syncEngineMode() {
  engineState.mode = hasNativeRouter() ? 'native-router-persistent' : hasNativeMeter() ? 'wasapi-loopback-meter' : 'windows-enumeration';
  engineState.router = audioRouter.getState();
}

function send(message) {
  if (process.send) process.send(message);
}

function publishState(requestId) {
  buildDiagnostics();
  send({ type: 'STATE', requestId, state: engineState });
}

function publishMeters() {
  send({ type: 'METERS', meters: engineState.meters });
}

function normalizeMeterPayload(payload) {
  const outputPeak = Math.max(0, Math.min(1, Number(payload.peak) || 0));
  const outputRms = Math.max(0, Math.min(1, Number(payload.rms) || 0));
  return {
    inputPeak: outputPeak,
    outputPeak,
    inputRms: outputRms,
    outputRms,
    clipping: Boolean(payload.clipping) || outputPeak >= 0.98,
    decks: engineState.meters.decks,
    updatedAt: new Date().toISOString(),
  };
}

function nextMockMeters() {
  engineState.router = audioRouter.getState();
  engineState.meters = audioRouter.nextMockMeters(engineState.settings.outputGain ?? 0.9);
}

function updateMetersFromNativeRoutes(snapshot) {
  if (!snapshot?.routes?.length) return;
  const decks = { ...engineState.meters.decks };
  let outputPeak = 0;
  for (const route of snapshot.routes) {
    const deck = route.deck;
    if (!deck) continue;
    const leftPeak = Math.max(0, Math.min(1, Number(route.leftPeak) || 0));
    const rightPeak = Math.max(0, Math.min(1, Number(route.rightPeak) || 0));
    const routePeak = Math.max(leftPeak, rightPeak);
    outputPeak = Math.max(outputPeak, routePeak);
    decks[deck] = {
      ...(decks[deck] || {}),
      inputPeak: routePeak,
      outputPeak: routePeak,
      leftPeak,
      rightPeak,
      pan: Number(route.pan) || 0,
      pluginCount: decks[deck]?.pluginCount || 0,
      eqActivity: Math.min(1, Math.abs((Number(route.eqLinear) || 1) - 1)),
    };
  }

  engineState.meters = {
    inputPeak: outputPeak,
    outputPeak,
    inputRms: outputPeak * 0.58,
    outputRms: outputPeak * 0.62,
    clipping: outputPeak >= 0.98,
    decks,
    updatedAt: new Date().toISOString(),
  };
}

function handleNativeRouterSnapshot(snapshot) {
  if (!snapshot) return;
  audioRouter.nativeSnapshot = snapshot;
  engineState.router = audioRouter.getState();
  if (Array.isArray(snapshot.sources)) {
    for (const source of snapshot.sources) {
      const deckId = source.deck === 'B' ? 'B' : 'A';
      const deckState = engineState.playbackDecks[deckId];
      if (!deckState) continue;
      if (source.loaded) {
        deckState.positionMs = Math.max(0, Number(source.positionMs) || 0);
        deckState.durationMs = Math.max(deckState.durationMs || 0, Number(source.durationMs) || 0);
        deckState.status = source.playing ? 'playing' : deckState.path ? deckState.status === 'empty' ? 'loaded' : deckState.status : 'loaded';
        deckState.lastStartedAt = source.playing ? new Date().toISOString() : null;
      }
    }
  }
  updateMetersFromNativeRoutes(snapshot);
  publishMeters();
  publishState();
}

function renderLivePlaybackChunk() {
  if (!hasNativeRouter() || livePlaybackBusy || !hasPlayingDeck()) return false;

  const chunkMs = 450;
  const deckA = engineState.playbackDecks.A;
  const deckB = engineState.playbackDecks.B;
  const deckAPlaying = deckA.status === 'playing' && deckA.path;
  const deckBPlaying = deckB.status === 'playing' && deckB.path;
  const deckAStartMs = deckAPlaying ? currentDeckPosition(deckA) : 0;
  const deckBStartMs = deckBPlaying ? currentDeckPosition(deckB) : 0;
  livePlaybackBusy = true;
  audioRouter.renderWav({
    deckAPath: deckAPlaying ? deckA.path : null,
    deckBPath: deckBPlaying ? deckB.path : null,
    deckAStartMs,
    deckBStartMs,
    durationMs: chunkMs,
  }, (_error, snapshot) => {
    livePlaybackBusy = false;
    if (snapshot?.render) {
      snapshotDeckPlayback();
      updateMetersFromNativeRoutes(snapshot);
      engineState.router = audioRouter.getState();
      publishMeters();
      publishState();
    }
  });
  return true;
}

function startMetering() {
  if (meterTimer) return;
  meterTimer = setInterval(() => {
    if (engineState.status !== 'running') return;
    if (audioRouter.isPersistentServerRunning?.()) return;
    if (renderLivePlaybackChunk()) return;
    if (hasNativeRouter()) {
      syncEngineMode();
      nextMockMeters();
      if (!nativeRouterBusy) {
        nativeRouterBusy = true;
        audioRouter.sampleNativeRouter(() => {
          nativeRouterBusy = false;
          engineState.router = audioRouter.getState();
          const now = Date.now();
          if (now - lastRouterStatePublish > 1500) {
            lastRouterStatePublish = now;
            publishState();
          }
        });
      }
      publishMeters();
      return;
    }

    if (!hasNativeMeter()) {
      syncEngineMode();
      nextMockMeters();
      publishMeters();
      return;
    }

    if (nativeMeterBusy) return;
    nativeMeterBusy = true;
    syncEngineMode();
    execFile(
      wasapiMeterExe,
      ['--duration-ms', '250'],
      { windowsHide: true, timeout: 2000 },
      (error, stdout) => {
        nativeMeterBusy = false;
        if (engineState.status !== 'running') return;
        if (error) {
          nextMockMeters();
          publishMeters();
          return;
        }

        try {
          const parsed = JSON.parse(stdout.trim());
          engineState.meters = normalizeMeterPayload(parsed);
        } catch {
          nextMockMeters();
        }
        publishMeters();
      },
    );
  }, 350);
}

function stopMetering() {
  if (!meterTimer) return;
  clearInterval(meterTimer);
  meterTimer = null;
  nativeMeterBusy = false;
  nativeRouterBusy = false;
  livePlaybackBusy = false;
  lastRouterStatePublish = 0;
}

function normalizeDevice(device, fallbackRole) {
  return {
    id: device.id || device.name,
    name: device.name || 'Unknown audio endpoint',
    kind: device.role === 'input' ? 'capture' : device.role === 'output' ? 'render' : fallbackRole,
    available: Boolean(device.available),
    note: device.status && device.status !== 'OK' ? `Windows status: ${device.status}` : undefined,
    manufacturer: device.manufacturer,
  };
}

function applyEnumeratedDevices(devices) {
  const list = Array.isArray(devices) ? devices : [devices].filter(Boolean);
  const inputs = list.filter((device) => device.role === 'input').map((device) => normalizeDevice(device, 'capture'));
  const outputs = list.filter((device) => device.role === 'output').map((device) => normalizeDevice(device, 'render'));
  const unknown = list.filter((device) => device.role === 'unknown').map((device) => normalizeDevice(device, 'unknown'));

  engineState.devices = {
    inputs: [
      {
        id: 'resonance-virtual-input',
        name: 'Resonance Virtual Playback Device',
        kind: 'loopback',
        available: false,
        note: 'Available after the Windows virtual audio driver is installed.',
      },
      ...inputs,
      ...unknown,
      {
        id: 'mock-input',
        name: 'Mock Audio Input',
        kind: 'test',
        available: true,
        note: 'Development placeholder until WASAPI capture is wired.',
      },
    ],
    outputs: [
      {
        id: 'default-output',
        name: 'System Default Output',
        kind: 'render',
        available: true,
      },
      ...outputs,
    ],
  };

  const selectedInputExists = engineState.devices.inputs.some((device) => device.id === engineState.inputDeviceId && device.available);
  const selectedOutputExists = engineState.devices.outputs.some((device) => device.id === engineState.outputDeviceId && device.available);
  if (!selectedInputExists) engineState.inputDeviceId = engineState.devices.inputs.find((device) => device.available)?.id || null;
  if (!selectedOutputExists) engineState.outputDeviceId = 'default-output';
  persistEngineState();
}

function refreshDevices(requestId) {
  engineState.deviceScan = {
    status: 'scanning',
    error: null,
    scannedAt: engineState.deviceScan.scannedAt,
  };
  publishState();

  execFile(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', listAudioDevicesScript],
    { windowsHide: true, timeout: 10000 },
    (error, stdout, stderr) => {
      if (error) {
        engineState.deviceScan = {
          status: 'error',
          error: stderr || error.message,
          scannedAt: new Date().toISOString(),
        };
        publishState(requestId);
        return;
      }

      try {
        const parsed = stdout.trim() ? JSON.parse(stdout) : [];
        applyEnumeratedDevices(parsed);
        engineState.deviceScan = {
          status: 'ready',
          error: null,
          scannedAt: new Date().toISOString(),
        };
      } catch (parseError) {
        engineState.deviceScan = {
          status: 'error',
          error: parseError.message,
          scannedAt: new Date().toISOString(),
        };
      }

      publishState(requestId);
    },
  );
}

function start(requestId) {
  syncEngineMode();
  engineState.status = 'running';
  engineState.lastStartedAt = new Date().toISOString();
  audioRouter.start();
  if (hasNativeRouter()) {
    audioRouter.startPersistentServer({ onSnapshot: handleNativeRouterSnapshot });
  }
  engineState.router = audioRouter.getState();
  if (!hasNativeMeter()) nextMockMeters();
  startMetering();
  publishState(requestId);
  publishMeters();
}

function stop(requestId) {
  engineState.status = 'idle';
  stopMetering();
  audioRouter.stop();
  snapshotDeckPlayback();
  for (const deck of ['A', 'B']) {
    if (engineState.playbackDecks[deck].status === 'playing') {
      engineState.playbackDecks[deck].status = 'paused';
      engineState.playbackDecks[deck].lastStartedAt = null;
    }
  }
  engineState.router = audioRouter.getState();
  engineState.meters = {
    inputPeak: 0,
    outputPeak: 0,
    inputRms: 0,
    outputRms: 0,
    clipping: false,
    decks: audioRouter.zeroDeckMeters(),
    updatedAt: new Date().toISOString(),
  };
  publishState(requestId);
  publishMeters();
}

function loadDeckWav(requestId, { deck, filePath, name } = {}) {
  const deckId = deck === 'B' ? 'B' : 'A';
  if (!filePath) {
    publishState(requestId);
    return;
  }

  try {
    const info = readWavInfo(filePath);
    engineState.playbackDecks[deckId] = {
      path: filePath,
      name: name || path.basename(filePath),
      status: 'loaded',
      positionMs: 0,
      durationMs: info.durationMs,
      lastStartedAt: null,
      format: info,
    };
    if (hasNativeRouter()) {
      audioRouter.startPersistentServer({ onSnapshot: handleNativeRouterSnapshot });
      audioRouter.loadDeckWav({ deck: deckId, filePath, name: name || path.basename(filePath) });
    }
  } catch (error) {
    engineState.playbackDecks[deckId] = {
      ...defaultPlaybackDeck,
      status: 'error',
      error: error.message,
    };
  }
  publishState(requestId);
}

function playDeck(requestId, { deck } = {}) {
  const deckId = deck === 'B' ? 'B' : 'A';
  const deckState = engineState.playbackDecks[deckId];
  if (!deckState.path) {
    publishState(requestId);
    return;
  }

  if (deckState.durationMs && deckState.positionMs >= deckState.durationMs) {
    deckState.positionMs = 0;
  }
  deckState.status = 'playing';
  deckState.lastStartedAt = new Date().toISOString();
  if (engineState.status !== 'running') start();
  if (hasNativeRouter()) {
    audioRouter.playDeck(deckId);
  }
  publishState(requestId);
}

function pauseDeck(requestId, { deck } = {}) {
  const deckId = deck === 'B' ? 'B' : 'A';
  const deckState = engineState.playbackDecks[deckId];
  deckState.positionMs = currentDeckPosition(deckState);
  deckState.status = deckState.path ? 'paused' : 'empty';
  deckState.lastStartedAt = null;
  if (hasNativeRouter()) {
    audioRouter.pauseDeck(deckId);
  }
  publishState(requestId);
}

function stopDeck(requestId, { deck } = {}) {
  const deckId = deck === 'B' ? 'B' : 'A';
  const deckState = engineState.playbackDecks[deckId];
  deckState.positionMs = 0;
  deckState.status = deckState.path ? 'stopped' : 'empty';
  deckState.lastStartedAt = null;
  if (hasNativeRouter()) {
    audioRouter.stopDeck(deckId);
  }
  publishState(requestId);
}

function seekDeck(requestId, { deck, positionMs } = {}) {
  const deckId = deck === 'B' ? 'B' : 'A';
  const deckState = engineState.playbackDecks[deckId];
  deckState.positionMs = Math.max(0, Math.min(deckState.durationMs || 0, Number(positionMs) || 0));
  if (deckState.status === 'playing') {
    deckState.lastStartedAt = new Date().toISOString();
  }
  if (hasNativeRouter()) {
    audioRouter.seekDeck(deckId, deckState.positionMs);
  }
  publishState(requestId);
}

function updateSettings(requestId, settings = {}) {
  const currentDeckProcessing = engineState.settings.deckProcessing || defaultSettings.deckProcessing;
  engineState.settings = {
    ...engineState.settings,
    ...settings,
    appEqBypassed: Boolean(settings.appEqBypassed ?? engineState.settings.appEqBypassed),
    deckProcessing: settings.deckProcessing || currentDeckProcessing,
    deckVolumes: settings.deckVolumes || engineState.settings.deckVolumes || defaultSettings.deckVolumes,
  };
  audioRouter.updateSettings(engineState.settings);
  engineState.router = audioRouter.getState();
  if (engineState.status === 'running' && !hasNativeMeter()) {
    nextMockMeters();
    publishMeters();
  }
  persistEngineState();
  publishState(requestId);
}

function selectDevices(requestId, devices = {}) {
  if (devices.inputDeviceId) engineState.inputDeviceId = devices.inputDeviceId;
  if (devices.outputDeviceId) engineState.outputDeviceId = devices.outputDeviceId;
  audioRouter.selectDevices({
    inputDeviceId: engineState.inputDeviceId,
    outputDeviceId: engineState.outputDeviceId,
  });
  engineState.router = audioRouter.getState();
  persistEngineState();
  publishState(requestId);
}

function renderSilence(requestId, durationMs = 250) {
  if (!hasNativeRouter()) {
    publishState(requestId);
    return;
  }

  audioRouter.renderSilence(durationMs, () => {
    engineState.router = audioRouter.getState();
    publishState(requestId);
  });
}

function renderTone(requestId, durationMs = 250) {
  if (!hasNativeRouter()) {
    publishState(requestId);
    return;
  }

  audioRouter.renderTone(durationMs, () => {
    engineState.router = audioRouter.getState();
    publishState(requestId);
  });
}

function renderWav(requestId, payload = {}) {
  if (!hasNativeRouter()) {
    publishState(requestId);
    return;
  }

  audioRouter.renderWav(payload, () => {
    engineState.router = audioRouter.getState();
    publishState(requestId);
  });
}

process.on('message', (message = {}) => {
  if (message.type === 'GET_STATE') publishState(message.requestId);
  if (message.type === 'REFRESH_DEVICES') refreshDevices(message.requestId);
  if (message.type === 'START') start(message.requestId);
  if (message.type === 'STOP') stop(message.requestId);
  if (message.type === 'UPDATE_SETTINGS') updateSettings(message.requestId, message.settings);
  if (message.type === 'SELECT_DEVICES') selectDevices(message.requestId, message.devices);
  if (message.type === 'RENDER_SILENCE') renderSilence(message.requestId, message.durationMs);
  if (message.type === 'RENDER_TONE') renderTone(message.requestId, message.durationMs);
  if (message.type === 'RENDER_WAV') renderWav(message.requestId, message.payload);
  if (message.type === 'LOAD_DECK_WAV') loadDeckWav(message.requestId, message.payload);
  if (message.type === 'PLAY_DECK') playDeck(message.requestId, message.payload);
  if (message.type === 'PAUSE_DECK') pauseDeck(message.requestId, message.payload);
  if (message.type === 'STOP_DECK') stopDeck(message.requestId, message.payload);
  if (message.type === 'SEEK_DECK') seekDeck(message.requestId, message.payload);
});

syncEngineMode();
refreshDevices();

process.on('disconnect', () => {
  stopMetering();
});

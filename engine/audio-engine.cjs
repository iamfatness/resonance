const { execFile } = require('node:child_process');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const listAudioDevicesScript = path.join(rootDir, 'scripts', 'list-audio-devices.ps1');

const engineState = {
  status: 'idle',
  mode: 'windows-enumeration',
  inputDeviceId: null,
  outputDeviceId: 'default-output',
  settings: {
    preset: 'Focus',
    eqMode: 'Preset',
    curve: [2, 3.5, 2, 0, -2, -1, 1.5, 2],
    outputGain: 0.9,
  },
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
  lastStartedAt: null,
  meters: {
    inputPeak: 0,
    outputPeak: 0,
    inputRms: 0,
    outputRms: 0,
    clipping: false,
    updatedAt: null,
  },
};

let meterTimer = null;

function send(message) {
  if (process.send) process.send(message);
}

function publishState(requestId) {
  send({ type: 'STATE', requestId, state: engineState });
}

function publishMeters() {
  send({ type: 'METERS', meters: engineState.meters });
}

function nextMockMeters() {
  const now = Date.now();
  const seconds = now / 1000;
  const movement = (Math.sin(seconds * 2.1) + 1) / 2;
  const transient = (Math.sin(seconds * 8.7) + 1) / 2;
  const gain = Math.max(0, Math.min(1.2, engineState.settings.outputGain ?? 0.9));
  const inputPeak = Math.min(0.98, 0.18 + movement * 0.58 + transient * 0.16);
  const inputRms = Math.min(0.86, inputPeak * (0.48 + movement * 0.16));
  const outputPeak = Math.min(1, inputPeak * gain);
  const outputRms = Math.min(1, inputRms * gain);

  engineState.meters = {
    inputPeak: Number(inputPeak.toFixed(3)),
    outputPeak: Number(outputPeak.toFixed(3)),
    inputRms: Number(inputRms.toFixed(3)),
    outputRms: Number(outputRms.toFixed(3)),
    clipping: outputPeak >= 0.98,
    updatedAt: new Date(now).toISOString(),
  };
}

function startMetering() {
  if (meterTimer) return;
  meterTimer = setInterval(() => {
    if (engineState.status !== 'running') return;
    nextMockMeters();
    publishMeters();
  }, 120);
}

function stopMetering() {
  if (!meterTimer) return;
  clearInterval(meterTimer);
  meterTimer = null;
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
  engineState.status = 'running';
  engineState.lastStartedAt = new Date().toISOString();
  nextMockMeters();
  startMetering();
  publishState(requestId);
  publishMeters();
}

function stop(requestId) {
  engineState.status = 'idle';
  stopMetering();
  engineState.meters = {
    inputPeak: 0,
    outputPeak: 0,
    inputRms: 0,
    outputRms: 0,
    clipping: false,
    updatedAt: new Date().toISOString(),
  };
  publishState(requestId);
  publishMeters();
}

function updateSettings(requestId, settings = {}) {
  engineState.settings = {
    ...engineState.settings,
    ...settings,
  };
  if (engineState.status === 'running') {
    nextMockMeters();
    publishMeters();
  }
  publishState(requestId);
}

function selectDevices(requestId, devices = {}) {
  if (devices.inputDeviceId) engineState.inputDeviceId = devices.inputDeviceId;
  if (devices.outputDeviceId) engineState.outputDeviceId = devices.outputDeviceId;
  publishState(requestId);
}

process.on('message', (message = {}) => {
  if (message.type === 'GET_STATE') publishState(message.requestId);
  if (message.type === 'REFRESH_DEVICES') refreshDevices(message.requestId);
  if (message.type === 'START') start(message.requestId);
  if (message.type === 'STOP') stop(message.requestId);
  if (message.type === 'UPDATE_SETTINGS') updateSettings(message.requestId, message.settings);
  if (message.type === 'SELECT_DEVICES') selectDevices(message.requestId, message.devices);
});

refreshDevices();

process.on('disconnect', () => {
  stopMetering();
});

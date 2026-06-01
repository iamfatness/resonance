const engineState = {
  status: 'idle',
  mode: 'mock',
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
  lastStartedAt: null,
};

function send(message) {
  if (process.send) process.send(message);
}

function publishState(requestId) {
  send({ type: 'STATE', requestId, state: engineState });
}

function start(requestId) {
  engineState.status = 'running';
  engineState.lastStartedAt = new Date().toISOString();
  publishState(requestId);
}

function stop(requestId) {
  engineState.status = 'idle';
  publishState(requestId);
}

function updateSettings(requestId, settings = {}) {
  engineState.settings = {
    ...engineState.settings,
    ...settings,
  };
  publishState(requestId);
}

function selectDevices(requestId, devices = {}) {
  if (devices.inputDeviceId) engineState.inputDeviceId = devices.inputDeviceId;
  if (devices.outputDeviceId) engineState.outputDeviceId = devices.outputDeviceId;
  publishState(requestId);
}

process.on('message', (message = {}) => {
  if (message.type === 'GET_STATE') publishState(message.requestId);
  if (message.type === 'START') start(message.requestId);
  if (message.type === 'STOP') stop(message.requestId);
  if (message.type === 'UPDATE_SETTINGS') updateSettings(message.requestId, message.settings);
  if (message.type === 'SELECT_DEVICES') selectDevices(message.requestId, message.devices);
});

publishState();

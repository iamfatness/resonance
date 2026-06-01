const bandFreqs = [31, 62, 125, 250, 500, 1000, 2000, 4000];

const moodPresets = {
  Focus: {
    curve: [2, 3.5, 2, 0, -2, -1, 1.5, 2],
    instruments: { Vocal: 1.5, Bass: 1, Drums: -0.5, Guitar: 0, Synth: 2, Strings: 1 },
  },
  Lift: {
    curve: [0, 1, 1.5, 2, 2.5, 3, 2, 1],
    instruments: { Vocal: 2, Bass: 1, Drums: 2, Guitar: 1, Synth: 2.5, Strings: 1.5 },
  },
  Warmth: {
    curve: [2.5, 3, 2, 1, 0, -1, -0.5, 0],
    instruments: { Vocal: 1, Bass: 3, Drums: 1, Guitar: 1.5, Synth: -0.5, Strings: 2 },
  },
  Drive: {
    curve: [1, 2.5, 2, 1.5, 2, 2.5, 1, 0],
    instruments: { Vocal: 1, Bass: 2.5, Drums: 3, Guitar: 2.5, Synth: 1, Strings: -0.5 },
  },
  Night: {
    curve: [1.5, 2, 1, -1, -2, -2.5, -1, 0.5],
    instruments: { Vocal: -0.5, Bass: 2, Drums: -1, Guitar: 0, Synth: 1.5, Strings: 2 },
  },
};

const instrumentBandWeights = {
  Vocal: [0, 0, 0, 0.15, 0.55, 0.9, 0.8, 0.45],
  Bass: [0.25, 0.9, 0.85, 0.35, 0, 0, 0, 0],
  Drums: [0.1, 0.35, 0.85, 0.75, 0.35, 0.6, 0.35, 0.15],
  Guitar: [0, 0, 0.15, 0.65, 0.75, 0.75, 0.55, 0.35],
  Synth: [0, 0.15, 0.25, 0.45, 0.75, 0.85, 0.85, 0.55],
  Strings: [0, 0, 0.05, 0.25, 0.45, 0.8, 0.9, 0.8],
};

let audioContext;
let sourceNode;
let outputGainNode;
let filters = [];
let stream;
let activeSettings;

function clampGain(value) {
  return Math.max(-12, Math.min(12, Number(value.toFixed(2))));
}

function effectiveCurve(settings) {
  const preset = moodPresets[settings.preset] || moodPresets.Focus;
  const baseCurve = settings.useManual ? settings.manualCurve : preset.curve;
  const instruments = settings.instruments || preset.instruments;

  return baseCurve.map((gain, bandIndex) => {
    const instrumentGain = Object.entries(instruments).reduce((total, [name, boost]) => {
      return total + (instrumentBandWeights[name]?.[bandIndex] || 0) * boost * 0.65;
    }, 0);
    return clampGain(gain + instrumentGain);
  });
}

function applySettings(settings) {
  activeSettings = settings;
  const curve = effectiveCurve(settings);
  filters.forEach((filter, index) => {
    filter.gain.setTargetAtTime(curve[index] || 0, audioContext.currentTime, 0.025);
  });
  if (outputGainNode) {
    outputGainNode.gain.setTargetAtTime(settings.outputGain ?? 0.9, audioContext.currentTime, 0.025);
  }
}

async function startCapture(streamId, settings) {
  await stopCapture();
  audioContext = new AudioContext({ latencyHint: 'interactive' });

  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });

  sourceNode = audioContext.createMediaStreamSource(stream);
  filters = bandFreqs.map((frequency) => {
    const filter = audioContext.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.value = frequency;
    filter.Q.value = 1;
    filter.gain.value = 0;
    return filter;
  });
  outputGainNode = audioContext.createGain();

  sourceNode.connect(filters[0]);
  filters.forEach((filter, index) => filter.connect(filters[index + 1] || outputGainNode));
  outputGainNode.connect(audioContext.destination);
  applySettings(settings);
}

async function stopCapture() {
  if (stream) stream.getTracks().forEach((track) => track.stop());
  if (audioContext) await audioContext.close();
  stream = null;
  audioContext = null;
  sourceNode = null;
  outputGainNode = null;
  filters = [];
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  async function respond() {
    if (message.type === 'START_CAPTURE') {
      await startCapture(message.streamId, message.settings);
      return { ok: true };
    }
    if (message.type === 'STOP_CAPTURE') {
      await stopCapture();
      return { ok: true };
    }
    if (message.type === 'UPDATE_SETTINGS') {
      if (audioContext) applySettings(message.settings);
      else activeSettings = message.settings;
      return { ok: true };
    }
    if (message.type === 'GET_PROCESSOR_STATUS') {
      return { ok: true, active: Boolean(audioContext), settings: activeSettings };
    }
    return { ok: true };
  }

  respond().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

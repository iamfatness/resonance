import { bandFreqs, effectiveCurve } from './lib/presets.js';

let audioContext;
let sourceNode;
let outputGainNode;
let filters = [];
let stream;
let activeSettings;

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

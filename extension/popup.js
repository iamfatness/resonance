const bands = ['31', '62', '125', '250', '500', '1k', '2k', '4k'];
const instruments = ['Vocal', 'Bass', 'Drums', 'Guitar', 'Synth', 'Strings'];

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

let state = {
  active: false,
  settings: {
    preset: 'Focus',
    outputGain: 0.9,
    manualCurve: moodPresets.Focus.curve,
    useManual: false,
    instruments: moodPresets.Focus.instruments,
  },
};

function send(message) {
  return chrome.runtime.sendMessage(message);
}

function showError(message) {
  const errorText = document.getElementById('errorText');
  errorText.textContent = message;
  errorText.hidden = !message;
}

function updateSetting(partial) {
  state.settings = { ...state.settings, ...partial };
  render();
  send({ type: 'UPDATE_SETTINGS', settings: state.settings }).then((response) => {
    if (response?.error) showError(response.error);
  });
}

function setManualBand(index, value) {
  const manualCurve = state.settings.manualCurve.map((gain, bandIndex) => (bandIndex === index ? value : gain));
  updateSetting({ useManual: true, manualCurve });
}

function setInstrument(name, value) {
  updateSetting({
    instruments: { ...state.settings.instruments, [name]: value },
  });
}

function renderEqBands() {
  const container = document.getElementById('eqBands');
  container.textContent = '';
  const baseCurve = state.settings.useManual ? state.settings.manualCurve : moodPresets[state.settings.preset].curve;

  bands.forEach((band, index) => {
    const label = document.createElement('label');
    label.className = 'band';
    label.innerHTML = `
      <span>${band}</span>
      <input class="band-slider" type="range" min="-12" max="12" step="0.5" value="${baseCurve[index]}" />
      <input class="band-number" type="number" min="-12" max="12" step="0.5" value="${baseCurve[index]}" />
    `;
    label.querySelector('.band-slider').addEventListener('input', (event) => setManualBand(index, Number(event.target.value)));
    label.querySelector('.band-number').addEventListener('input', (event) => setManualBand(index, Number(event.target.value)));
    container.appendChild(label);
  });
}

function renderInstruments() {
  const container = document.getElementById('instrumentBands');
  container.textContent = '';

  instruments.forEach((name) => {
    const value = state.settings.instruments[name] ?? 0;
    const label = document.createElement('label');
    label.className = 'instrument';
    label.innerHTML = `
      <span>${name}</span>
      <input type="range" min="-6" max="6" step="0.5" value="${value}" />
      <strong>${value > 0 ? '+' : ''}${value.toFixed(1)}</strong>
    `;
    label.querySelector('input').addEventListener('input', (event) => setInstrument(name, Number(event.target.value)));
    container.appendChild(label);
  });
}

function render() {
  document.getElementById('statusText').textContent = state.active ? 'Capturing current tab' : 'Inactive';
  document.getElementById('toggleCapture').textContent = state.active ? 'Stop' : 'Start';
  document.getElementById('presetSelect').value = state.settings.preset;
  document.getElementById('manualToggle').checked = state.settings.useManual;
  document.getElementById('outputGain').value = state.settings.outputGain;
  renderEqBands();
  renderInstruments();
}

document.getElementById('toggleCapture').addEventListener('click', async () => {
  showError('');
  const response = await send({ type: state.active ? 'STOP_CAPTURE' : 'START_CAPTURE' });
  if (response?.error) {
    showError(response.error);
    return;
  }
  state = { active: response.active, settings: response.settings };
  render();
});

document.getElementById('presetSelect').addEventListener('change', (event) => {
  const preset = event.target.value;
  updateSetting({
    preset,
    useManual: false,
    manualCurve: moodPresets[preset].curve,
    instruments: moodPresets[preset].instruments,
  });
});

document.getElementById('manualToggle').addEventListener('change', (event) => {
  updateSetting({
    useManual: event.target.checked,
    manualCurve: event.target.checked ? [...moodPresets[state.settings.preset].curve] : state.settings.manualCurve,
  });
});

document.getElementById('flatButton').addEventListener('click', () => {
  updateSetting({ useManual: true, manualCurve: Array(bands.length).fill(0) });
});

document.getElementById('outputGain').addEventListener('input', (event) => {
  updateSetting({ outputGain: Number(event.target.value) });
});

send({ type: 'GET_STATUS' }).then((response) => {
  if (response?.error) showError(response.error);
  else state = { active: response.active, settings: response.settings };
  render();
});

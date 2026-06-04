export const bands = ['31', '62', '125', '250', '500', '1k', '2k', '4k'];
export const bandFreqs = [31, 62, 125, 250, 500, 1000, 2000, 4000];
export const flatCurve = Array(bands.length).fill(0);
export const instruments = ['Vocal', 'Bass', 'Drums', 'Guitar', 'Synth', 'Strings'];

export const moodPresets = {
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

export const instrumentBandWeights = {
  Vocal: [0, 0, 0, 0.15, 0.55, 0.9, 0.8, 0.45],
  Bass: [0.25, 0.9, 0.85, 0.35, 0, 0, 0, 0],
  Drums: [0.1, 0.35, 0.85, 0.75, 0.35, 0.6, 0.35, 0.15],
  Guitar: [0, 0, 0.15, 0.65, 0.75, 0.75, 0.55, 0.35],
  Synth: [0, 0.15, 0.25, 0.45, 0.75, 0.85, 0.85, 0.55],
  Strings: [0, 0, 0.05, 0.25, 0.45, 0.8, 0.9, 0.8],
};

export const defaultExtensionSettings = {
  enabled: false,
  preset: 'Focus',
  outputGain: 0.9,
  manualCurve: moodPresets.Focus.curve,
  useManual: false,
  instruments: moodPresets.Focus.instruments,
};

export function clampGain(value) {
  return Math.max(-12, Math.min(12, Number(value.toFixed(2))));
}

export function effectiveCurve(settings) {
  const preset = moodPresets[settings.preset] || moodPresets.Focus;
  const baseCurve = settings.useManual ? settings.manualCurve : preset.curve;
  const activeInstruments = settings.instruments || preset.instruments;

  return baseCurve.map((gain, bandIndex) => {
    const instrumentGain = Object.entries(activeInstruments).reduce((total, [name, boost]) => {
      return total + (instrumentBandWeights[name]?.[bandIndex] || 0) * boost * 0.65;
    }, 0);
    return clampGain(gain + instrumentGain);
  });
}

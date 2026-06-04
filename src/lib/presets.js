/**
 * @typedef {Object} MoodPreset
 * @property {number[]} curve Eight-band EQ curve in dB.
 * @property {Record<string, number>} instruments Instrument boost defaults in dB.
 * @property {{A: number, B: number}} mix Default deck volume mix.
 * @property {string} intent Human-readable preset intent.
 */

/**
 * @typedef {Object} DeckProcessing
 * @property {number} pan Per-deck pan value.
 * @property {boolean} eqBypassed Whether native/app deck EQ is bypassed.
 * @property {number[]} curve Eight-band per-deck EQ curve in dB.
 * @property {Array<Object>} pluginChain Staged plugin chain entries.
 */

/**
 * @typedef {Object} EngineSettings
 * @property {string} preset Active mood preset name.
 * @property {'Preset'|'Manual'} eqMode App EQ mode.
 * @property {number[]} curve Effective app EQ curve.
 * @property {boolean} appEqBypassed Whether global app EQ is bypassed.
 * @property {{A: DeckProcessing, B: DeckProcessing}} deckProcessing Per-deck processing.
 * @property {{A: number, B: number}} deckVolumes Per-deck volume levels.
 * @property {number} outputGain Desktop output gain.
 */

export const bands = [31, 62, 125, 250, 500, '1k', '2k', '4k'];
export const bandFreqs = [31, 62, 125, 250, 500, 1000, 2000, 4000];
export const flatCurve = Array(bands.length).fill(0);

/** @type {Record<string, MoodPreset>} */
export const moodPresets = {
  Focus: {
    curve: [2, 3.5, 2, 0, -2, -1, 1.5, 2],
    instruments: { Vocal: 1.5, Bass: 1, Drums: -0.5, Guitar: 0, Synth: 2, Strings: 1 },
    mix: { A: 72, B: 38 },
    intent: 'Keeps Deck A clear and lowers Deck B into a bed for concentration.',
  },
  Lift: {
    curve: [0, 1, 1.5, 2, 2.5, 3, 2, 1],
    instruments: { Vocal: 2, Bass: 1, Drums: 2, Guitar: 1, Synth: 2.5, Strings: 1.5 },
    mix: { A: 78, B: 58 },
    intent: 'Raises both decks for a brighter, more energetic blend.',
  },
  Warmth: {
    curve: [2.5, 3, 2, 1, 0, -1, -0.5, 0],
    instruments: { Vocal: 1, Bass: 3, Drums: 1, Guitar: 1.5, Synth: -0.5, Strings: 2 },
    mix: { A: 64, B: 62 },
    intent: 'Balances both decks and emphasizes the low-mid mood curve.',
  },
  Drive: {
    curve: [1, 2.5, 2, 1.5, 2, 2.5, 1, 0],
    instruments: { Vocal: 1, Bass: 2.5, Drums: 3, Guitar: 2.5, Synth: 1, Strings: -0.5 },
    mix: { A: 84, B: 72 },
    intent: 'Pushes both decks forward for higher impact and percussion.',
  },
  Night: {
    curve: [1.5, 2, 1, -1, -2, -2.5, -1, 0.5],
    instruments: { Vocal: -0.5, Bass: 2, Drums: -1, Guitar: 0, Synth: 1.5, Strings: 2 },
    mix: { A: 48, B: 28 },
    intent: 'Drops total YouTube volume and softens the second deck.',
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

export const defaultDeckProcessing = {
  A: { pan: -12, eqBypassed: false, curve: [...flatCurve], pluginChain: [] },
  B: { pan: 12, eqBypassed: false, curve: [...flatCurve], pluginChain: [] },
};

export function clampGain(value) {
  return Math.max(-12, Math.min(12, Number(value.toFixed(2))));
}

export function normalizeCurve(curve, fallback = flatCurve) {
  return Array.isArray(curve) && curve.length === bands.length ? curve : fallback;
}

export function getPreset(name) {
  return moodPresets[name] || moodPresets.Focus;
}

export function applyInstrumentBoosts(baseCurve, boosts = {}) {
  return normalizeCurve(baseCurve).map((gain, bandIndex) => {
    const instrumentGain = Object.entries(boosts).reduce((total, [name, boost]) => {
      return total + (instrumentBandWeights[name]?.[bandIndex] || 0) * boost * 0.65;
    }, 0);
    return clampGain(gain + instrumentGain);
  });
}

export function getEffectiveCurve({ presetName = 'Focus', useManual = false, manualCurve, boosts } = {}) {
  const preset = getPreset(presetName);
  const baseCurve = useManual ? normalizeCurve(manualCurve, preset.curve) : preset.curve;
  return applyInstrumentBoosts(baseCurve, boosts || preset.instruments);
}

export function getDefaultDeckProcessing(deck) {
  const cloneDeck = (settings) => ({
    pan: settings.pan,
    eqBypassed: settings.eqBypassed,
    curve: [...settings.curve],
    pluginChain: [...settings.pluginChain],
  });

  if (deck === 'A' || deck === 'B') return cloneDeck(defaultDeckProcessing[deck]);
  return {
    A: cloneDeck(defaultDeckProcessing.A),
    B: cloneDeck(defaultDeckProcessing.B),
  };
}

export function normalizeDeckProcessing(savedDeckProcessing) {
  const normalizeDeck = (deck, fallback) => ({
    pan: Number.isFinite(savedDeckProcessing?.[deck]?.pan) ? savedDeckProcessing[deck].pan : fallback.pan,
    eqBypassed: Boolean(savedDeckProcessing?.[deck]?.eqBypassed),
    curve: normalizeCurve(savedDeckProcessing?.[deck]?.curve, fallback.curve),
    pluginChain: Array.isArray(savedDeckProcessing?.[deck]?.pluginChain)
      ? savedDeckProcessing[deck].pluginChain
      : [],
  });

  return {
    A: normalizeDeck('A', defaultDeckProcessing.A),
    B: normalizeDeck('B', defaultDeckProcessing.B),
  };
}

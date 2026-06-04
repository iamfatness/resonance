import { describe, expect, it } from 'vitest';
import {
  applyInstrumentBoosts,
  flatCurve,
  getDefaultDeckProcessing,
  getEffectiveCurve,
  moodPresets,
  normalizeDeckProcessing,
} from './presets.js';

describe('preset DSP helpers', () => {
  it('keeps existing Focus instrument boost math stable', () => {
    expect(applyInstrumentBoosts(moodPresets.Focus.curve, moodPresets.Focus.instruments)).toEqual([
      2.13, 4.17, 2.63, 0.88, -0.31, 1.31, 3.86, 3.63,
    ]);
  });

  it('clamps boosted curves to 12 dB', () => {
    const boosted = applyInstrumentBoosts(Array(8).fill(11.9), { Vocal: 10, Synth: 10, Strings: 10 });
    expect(boosted.every((gain) => gain <= 12)).toBe(true);
    expect(boosted.at(-1)).toBe(12);
  });

  it('computes effective manual curves with boosts', () => {
    expect(getEffectiveCurve({ useManual: true, manualCurve: flatCurve, boosts: { Bass: 2 } })).toEqual([
      0.33, 1.17, 1.1, 0.45, 0, 0, 0, 0,
    ]);
  });

  it('normalizes invalid deck processing with defaults', () => {
    expect(normalizeDeckProcessing({ A: { pan: 4, curve: [1, 2], pluginChain: [{ id: 'x' }] } })).toEqual({
      A: { pan: 4, eqBypassed: false, curve: flatCurve, pluginChain: [{ id: 'x' }] },
      B: getDefaultDeckProcessing('B'),
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  deletePluginPreset,
  normalizePluginParameters,
  savePluginPreset,
} from './plugins.js';

describe('plugin preset helpers', () => {
  it('saves, overwrites, and deletes named plugin presets', () => {
    const plugin = { id: 'plugin:test', name: 'Test Plugin', vendor: 'Acme', format: 'VST3' };
    const first = savePluginPreset({}, plugin, 'Wide', {
      wetDry: 55,
      inputGainDb: 3,
      outputGainDb: -2,
    });

    expect(first['plugin:test'][0]).toMatchObject({
      name: 'Wide',
      pluginName: 'Test Plugin',
      parameters: {
        ...normalizePluginParameters({ wetDry: 55, inputGainDb: 3, outputGainDb: -2 }),
        presetName: 'Wide',
      },
    });

    const overwritten = savePluginPreset(first, plugin, 'Wide', { wetDry: 25 });
    expect(overwritten['plugin:test']).toHaveLength(1);
    expect(overwritten['plugin:test'][0].parameters).toMatchObject({
      wetDry: 25,
      presetName: 'Wide',
    });

    expect(deletePluginPreset(overwritten, 'plugin:test', 'Wide')['plugin:test']).toEqual([]);
  });
});

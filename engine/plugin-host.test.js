import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  activeDeckPlugins,
  buildDeckPluginPlan,
  buildNativePluginSettings,
  describePluginHostHelper,
  scanPluginCandidates,
} = require('./plugin-host.cjs');

describe('plugin host runtime settings', () => {
  it('ignores bypassed plugins', () => {
    expect(activeDeckPlugins([
      { id: 'waves-vst3', bypassed: true },
      { id: 'vst3-generic', bypassed: false },
    ])).toEqual([{ id: 'vst3-generic', bypassed: false }]);
  });

  it('builds bounded native DSP settings from staged plugin chains', () => {
    expect(buildNativePluginSettings([
      { id: 'waves-vst3', bypassed: false },
      { id: 'vst3-generic', bypassed: false },
      { id: 'ignored', bypassed: true },
    ])).toEqual({
      pluginCount: 2,
      pluginGainDb: 3.75,
      pluginDrive: 1.16,
      activePluginIds: ['waves-vst3', 'vst3-generic'],
    });
  });

  it('reports the built-in runtime plugin during read-only scans', () => {
    const result = scanPluginCandidates({ roots: [] });

    expect(result.runtimePlugins).toContainEqual(expect.objectContaining({
      id: 'resonance-native-drive',
      format: 'NativeDSP',
      loadable: true,
    }));
    expect(result.status).toBe('scan-only');
  });

  it('builds a per-deck helper plan from deck processing', () => {
    expect(buildDeckPluginPlan({
      A: { eqBypassed: true, pluginChain: [{ id: 'waves-vst3', bypassed: false }] },
      B: { eqBypassed: false, pluginChain: [] },
    })).toMatchObject({
      protocolVersion: 1,
      host: 'resonance-plugin-host',
      decks: {
        A: {
          hostMode: 'native-dsp-fallback',
          eqBypassed: true,
          activePluginIds: ['waves-vst3'],
          nativeSettings: { pluginCount: 1, pluginGainDb: 2.25, pluginDrive: 1.16 },
        },
        B: {
          hostMode: 'passthrough',
          eqBypassed: false,
          activePluginIds: [],
          nativeSettings: { pluginCount: 0, pluginGainDb: 0, pluginDrive: 1 },
        },
      },
    });
  });

  it('describes the sandbox helper process', () => {
    expect(describePluginHostHelper()).toMatchObject({
      status: 'ready',
      name: 'resonance-plugin-host',
      protocolVersion: 1,
      capabilities: {
        sandboxProcess: true,
        thirdPartyPluginLoading: false,
      },
    });
  });
});

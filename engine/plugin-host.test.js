import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  activeDeckPlugins,
  blockedThirdPartyPlugins,
  buildDeckPluginPlan,
  buildNativePluginSettings,
  describePluginHostHelper,
  PluginHostClient,
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

  it('adds safe metadata for scanned plugin candidates', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resonance-plugin-scan-'));
    fs.mkdirSync(path.join(root, 'AcmeVerb.vst3'));

    const result = scanPluginCandidates({
      roots: [root],
    });
    const candidate = result.candidates[0];
    expect(candidate).toMatchObject({
      id: expect.stringMatching(/^desktop-plugin:/),
      name: 'AcmeVerb',
      vendor: 'Unknown',
      format: 'VST3',
      architecture: 'unknown',
      shellType: 'vst3-bundle',
      loadStrategy: 'vst3-candidate',
      source: 'desktop-scan',
      stageable: true,
      executable: false,
      status: 'Found',
    });
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
          executablePluginIds: ['waves-vst3'],
          blockedPluginIds: [],
          nativeSettings: { pluginCount: 1, pluginGainDb: 2.25, pluginDrive: 1.16 },
        },
        B: {
          hostMode: 'passthrough',
          eqBypassed: false,
          activePluginIds: [],
          executablePluginIds: [],
          blockedPluginIds: [],
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

  it('keeps the sandbox helper alive for multiple requests', async () => {
    const client = new PluginHostClient();
    try {
      await expect(client.describe()).resolves.toMatchObject({
        status: 'ready',
        name: 'resonance-plugin-host',
        protocolVersion: 1,
      });
      await expect(client.resolveChain({
        A: { pluginChain: [{ id: 'waves-vst3', bypassed: false }] },
        B: { pluginChain: [{ id: 'vst3-generic', bypassed: true }] },
      })).resolves.toMatchObject({
        decks: {
          A: { hostMode: 'native-dsp-fallback', activePluginIds: ['waves-vst3'], blockedPluginIds: [] },
          B: { hostMode: 'passthrough', activePluginIds: [] },
        },
      });
    } finally {
      client.stop();
    }
  });

  it('blocks scanned third-party candidates from NativeDSP execution', () => {
    const scannedPlugin = {
      id: 'desktop-plugin:test',
      executable: false,
      loadStrategy: 'vst3-candidate',
      bypassed: false,
    };

    expect(blockedThirdPartyPlugins([scannedPlugin])).toEqual([scannedPlugin]);
    expect(buildNativePluginSettings([scannedPlugin])).toMatchObject({
      pluginCount: 0,
      activePluginIds: [],
    });
    expect(buildDeckPluginPlan({
      A: { pluginChain: [scannedPlugin] },
    })).toMatchObject({
      decks: {
        A: {
          hostMode: 'blocked-third-party',
          activePluginIds: ['desktop-plugin:test'],
          executablePluginIds: [],
          blockedPluginIds: ['desktop-plugin:test'],
        },
      },
    });
  });
});

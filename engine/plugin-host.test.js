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
  createSandboxPluginInstance,
  describeNativeVst3Bridge,
  describePluginHostHelper,
  PluginHostClient,
  normalizePluginParameters,
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
      { id: 'waves-vst3', bypassed: false, parameters: { inputGainDb: 1, outputGainDb: -2, wetDry: 50 } },
      { id: 'vst3-generic', bypassed: false, parameters: { inputGainDb: -0.5, outputGainDb: 1, wetDry: 75 } },
      { id: 'ignored', bypassed: true },
    ])).toEqual({
      pluginCount: 2,
      pluginGainDb: 4.25,
      pluginOutputGainDb: -1,
      pluginDrive: 1.16,
      pluginWetDry: 62.5,
      activePluginIds: ['waves-vst3', 'vst3-generic'],
      activePluginParameters: {
        'waves-vst3': {
          enabled: true,
          wetDry: 50,
          inputGainDb: 1,
          outputGainDb: -2,
          presetName: 'Default',
        },
        'vst3-generic': {
          enabled: true,
          wetDry: 75,
          inputGainDb: -0.5,
          outputGainDb: 1,
          presetName: 'Default',
        },
      },
    });
  });

  it('normalizes plugin parameters', () => {
    expect(normalizePluginParameters({
      enabled: false,
      wetDry: 400,
      inputGainDb: -48,
      outputGainDb: 96,
      presetName: '  Wide Mix  ',
    })).toEqual({
      enabled: false,
      wetDry: 100,
      inputGainDb: -24,
      outputGainDb: 24,
      presetName: 'Wide Mix',
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
      parameters: {
        enabled: true,
        wetDry: 100,
        inputGainDb: 0,
        outputGainDb: 0,
        presetName: 'Default',
      },
    });
  });

  it('discovers VST2 DLL candidates in VST plugin folders', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resonance-vst2-scan-'));
    const vst2Root = path.join(root, 'VstPlugins');
    fs.mkdirSync(vst2Root, { recursive: true });
    fs.writeFileSync(path.join(vst2Root, 'AcmeComp.dll'), '');

    const result = scanPluginCandidates({
      roots: [vst2Root],
    });

    expect(result.supportedFormats).toEqual(['VST2', 'VST3']);
    expect(result.candidates[0]).toMatchObject({
      name: 'AcmeComp',
      vendor: 'Unknown',
      format: 'VST2',
      shellType: 'vst2-dll',
      loadStrategy: 'vst2-candidate',
      executable: false,
      loaderStatus: 'scan-only',
    });
  });

  it('classifies Waves shells by vendor while preserving the VST format', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resonance-waves-scan-'));
    const wavesRoot = path.join(root, 'Waves');
    fs.mkdirSync(wavesRoot, { recursive: true });
    fs.writeFileSync(path.join(wavesRoot, 'WaveShell1-VST 14.0_x64.dll'), '');
    fs.mkdirSync(path.join(wavesRoot, 'WaveShell1-VST3 14.0_x64.vst3'));

    const result = scanPluginCandidates({
      roots: [wavesRoot],
    });

    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        vendor: 'Waves',
        format: 'VST2',
        shellType: 'vst2-waves-shell',
      }),
      expect.objectContaining({
        vendor: 'Waves',
        format: 'VST3',
        shellType: 'vst3-waves-shell',
      }),
    ]));
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
          parameters: {
            'waves-vst3': {
              enabled: true,
              wetDry: 100,
              inputGainDb: 0,
              outputGainDb: 0,
              presetName: 'Default',
            },
          },
          nativeSettings: { pluginCount: 1, pluginGainDb: 2.25, pluginOutputGainDb: 0, pluginDrive: 1.16, pluginWetDry: 100 },
        },
        B: {
          hostMode: 'passthrough',
          eqBypassed: false,
          activePluginIds: [],
          executablePluginIds: [],
          blockedPluginIds: [],
          parameters: {},
          nativeSettings: { pluginCount: 0, pluginGainDb: 0, pluginOutputGainDb: 0, pluginDrive: 1, pluginWetDry: 100 },
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

  it('reports native VST3 bridge not-built state without failing plugin host startup', () => {
    expect(describeNativeVst3Bridge({ bridgePath: path.join(os.tmpdir(), 'missing-vst3-bridge.exe') })).toMatchObject({
      status: 'not-built',
      capabilities: {
        binaryInstantiation: false,
        pcmProcessing: false,
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

  it('loads VST3 metadata in the sandbox without enabling binary execution', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resonance-vst3-load-'));
    const pluginPath = path.join(root, 'AcmeVerb.vst3');
    fs.mkdirSync(path.join(pluginPath, 'Contents', 'x86_64'), { recursive: true });

    const candidate = scanPluginCandidates({ roots: [root] }).candidates[0];
    const instance = createSandboxPluginInstance(candidate);

    expect(instance).toMatchObject({
      id: candidate.id,
      name: 'AcmeVerb',
      status: 'metadata-loaded',
      loadStrategy: 'sandbox-vst3-metadata',
      executable: false,
      processingEnabled: false,
      degraded: true,
      metadata: {
        exists: true,
        isBundle: true,
        hasContents: true,
        architectureDirs: ['x86_64'],
      },
    });
    expect(instance.parameters.map((parameter) => parameter.id)).toEqual(['bypass', 'inputGainDb', 'wetDry', 'outputGainDb']);
  });

  it('loads, enumerates, and unloads a VST3 metadata handle through the helper process', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resonance-vst3-worker-'));
    fs.mkdirSync(path.join(root, 'WorkerVerb.vst3', 'Contents', 'x86_64'), { recursive: true });
    const candidate = scanPluginCandidates({ roots: [root] }).candidates[0];
    const client = new PluginHostClient();

    try {
      const loaded = await client.loadPlugin(candidate);
      expect(loaded).toMatchObject({
        id: candidate.id,
        status: 'metadata-loaded',
        processingEnabled: false,
      });
      await expect(client.enumerateParameters(candidate.id)).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'wetDry' }),
      ]));
      await expect(client.unloadPlugin(candidate.id)).resolves.toMatchObject({
        status: 'unloaded',
        pluginId: candidate.id,
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

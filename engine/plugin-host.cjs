const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const readline = require('node:readline');

const supportedFormats = ['VST2', 'VST3'];
const plannedVendors = ['Waves'];
const maxCandidates = 120;
const pluginHostProtocolVersion = 1;
const pluginHostWorkerPath = path.join(__dirname, 'plugin-host-worker.cjs');
const nativeVst3BridgePath = path.join(__dirname, '..', 'native', 'vst3-bridge', 'build', 'Release', 'resonance-vst3-bridge.exe');
const pluginHostCapabilities = {
  sandboxProcess: true,
  perDeckChains: true,
  nativeDspFallback: true,
  thirdPartyPluginLoading: false,
  vst3LoaderPrototype: true,
  nativeVst3BridgeClient: true,
  vst3MetadataLoad: true,
  vst3ParameterEnumeration: true,
  vst3BridgePcmTest: true,
  vst3ExternalPcmBlocks: true,
  vst3PcmFileTransport: true,
  vst2Discovery: true,
  pluginBinaryExecution: false,
  vst3Discovery: true,
  wavesDiscovery: true,
};
const builtInRuntimePlugins = [
  {
    id: 'resonance-native-drive',
    name: 'Drive',
    vendor: 'Resonance',
    format: 'NativeDSP',
    loadable: true,
    note: 'Built-in per-deck DSP used to validate the plugin processing lane before VST2/VST3 loading.',
  },
  {
    id: 'resonance-dj-filter',
    name: 'Filter Sweep',
    vendor: 'Resonance',
    format: 'NativeDSP',
    loadable: true,
    note: 'Built-in DJ transition macro routed through the native deck DSP lane.',
  },
  {
    id: 'resonance-dj-punch',
    name: 'Punch',
    vendor: 'Resonance',
    format: 'NativeDSP',
    loadable: true,
    note: 'Built-in DJ punch macro routed through the native deck DSP lane.',
  },
  {
    id: 'resonance-dj-space',
    name: 'Space',
    vendor: 'Resonance',
    format: 'NativeDSP',
    loadable: true,
    note: 'Built-in DJ atmosphere macro routed through the native deck DSP lane.',
  },
  {
    id: 'resonance-dj-limiter',
    name: 'Limiter',
    vendor: 'Resonance',
    format: 'NativeDSP',
    loadable: true,
    note: 'Built-in deck control macro routed through the native deck DSP lane.',
  },
];

const stagedPluginRuntimeProfiles = {
  'resonance-native-drive': { gainDb: 1.5, drive: 1.12 },
  'resonance-dj-filter': { gainDb: -0.5, drive: 1.04 },
  'resonance-dj-punch': { gainDb: 2.5, drive: 1.1 },
  'resonance-dj-space': { gainDb: -1, drive: 1.06 },
  'resonance-dj-limiter': { gainDb: 0, drive: 1.02 },
  'vst3-generic': { gainDb: 1.5, drive: 1.08 },
  'waves-vst3': { gainDb: 2.25, drive: 1.16 },
};
const defaultPluginParameters = {
  enabled: true,
  wetDry: 100,
  inputGainDb: 0,
  outputGainDb: 0,
  presetName: 'Default',
  pluginParameters: {},
};
const vst3PrototypeParameters = [
  { id: 'bypass', name: 'Bypass', kind: 'boolean', defaultValue: 0, minimum: 0, maximum: 1, automatable: true },
  { id: 'inputGainDb', name: 'Input Gain', kind: 'gain-db', defaultValue: 0, minimum: -24, maximum: 24, automatable: true },
  { id: 'wetDry', name: 'Wet/Dry', kind: 'percent', defaultValue: 100, minimum: 0, maximum: 100, automatable: true },
  { id: 'outputGainDb', name: 'Output Gain', kind: 'gain-db', defaultValue: 0, minimum: -24, maximum: 24, automatable: true },
];

function clampNumber(value, min, max, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizePluginParameters(parameters = {}) {
  return {
    enabled: parameters.enabled !== false,
    wetDry: clampNumber(parameters.wetDry, 0, 100, defaultPluginParameters.wetDry),
    inputGainDb: clampNumber(parameters.inputGainDb, -24, 24, defaultPluginParameters.inputGainDb),
    outputGainDb: clampNumber(parameters.outputGainDb, -24, 24, defaultPluginParameters.outputGainDb),
    presetName: typeof parameters.presetName === 'string' && parameters.presetName.trim()
      ? parameters.presetName.trim().slice(0, 80)
      : defaultPluginParameters.presetName,
    pluginParameters: parameters.pluginParameters && typeof parameters.pluginParameters === 'object'
      ? Object.fromEntries(Object.entries(parameters.pluginParameters).map(([key, value]) => [
          key,
          clampNumber(value, 0, 1, 0),
        ]))
      : {},
  };
}

function stablePluginId(filePath) {
  return `desktop-plugin:${Buffer.from(path.resolve(filePath).toLowerCase()).toString('base64url')}`;
}

function inferArchitecture(filePath) {
  const lowerPath = filePath.toLowerCase();
  if (lowerPath.includes('program files (x86)')) return 'x86';
  if (lowerPath.includes('program files')) return 'x64';
  return 'unknown';
}

function cleanPluginName(entryName) {
  return entryName
    .replace(/\.vst3$/i, '')
    .replace(/\.dll$/i, '')
    .trim() || entryName;
}

function uniqueExisting(paths) {
  const seen = new Set();
  const result = [];
  for (const candidate of paths.filter(Boolean)) {
    const resolved = path.resolve(candidate);
    const key = resolved.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (fs.existsSync(resolved)) result.push(resolved);
  }
  return result;
}

function defaultScanRoots(env = process.env) {
  const roots = [
    path.join(env.ProgramFiles || 'C:\\Program Files', 'Common Files', 'VST3'),
    path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Common Files', 'VST3'),
    path.join(env.CommonProgramW6432 || 'C:\\Program Files\\Common Files', 'VST3'),
    path.join(env.ProgramFiles || 'C:\\Program Files', 'Common Files', 'VST2'),
    path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Common Files', 'VST2'),
    path.join(env.CommonProgramW6432 || 'C:\\Program Files\\Common Files', 'VST2'),
    path.join(env.ProgramFiles || 'C:\\Program Files', 'VstPlugins'),
    path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'VstPlugins'),
    path.join(env.ProgramFiles || 'C:\\Program Files', 'Steinberg', 'VstPlugins'),
    path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steinberg', 'VstPlugins'),
    path.join(env.ProgramFiles || 'C:\\Program Files', 'Waves'),
    path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Waves'),
    path.join(env.ProgramData || 'C:\\ProgramData', 'Waves Audio'),
  ];

  if (env.RESONANCE_PLUGIN_SCAN_PATHS) {
    roots.push(...env.RESONANCE_PLUGIN_SCAN_PATHS.split(path.delimiter).map((item) => item.trim()));
  }

  return uniqueExisting(roots);
}

function classifyCandidate(filePath, entryName) {
  const lowerName = entryName.toLowerCase();
  const lowerPath = filePath.toLowerCase();
  const isVst3 = lowerName.endsWith('.vst3');
  const isDll = lowerName.endsWith('.dll');
  const isLikelyVst2Path = lowerPath.includes(`${path.sep.toLowerCase()}vst2${path.sep.toLowerCase()}`)
    || lowerPath.includes(`${path.sep.toLowerCase()}vstplugins${path.sep.toLowerCase()}`)
    || lowerPath.includes(`${path.sep.toLowerCase()}steinberg${path.sep.toLowerCase()}vstplugins${path.sep.toLowerCase()}`);
  const isWaves = lowerName.includes('waves') || lowerPath.includes(`${path.sep.toLowerCase()}waves`);
  const isWavesShell = lowerName.includes('waveshell');
  const isVst2 = isDll && (isLikelyVst2Path || isWavesShell);

  if (!isVst3 && !isVst2) return null;

  const format = isVst3 ? 'VST3' : 'VST2';

  return {
    id: stablePluginId(filePath),
    name: cleanPluginName(entryName),
    vendor: isWaves ? 'Waves' : 'Unknown',
    format,
    architecture: inferArchitecture(filePath),
    shellType: isWavesShell ? `${format.toLowerCase()}-waves-shell` : isVst3 ? 'vst3-bundle' : 'vst2-dll',
    loadStrategy: isWavesShell ? `${format.toLowerCase()}-waves-shell-candidate` : `${format.toLowerCase()}-candidate`,
    source: 'desktop-scan',
    path: filePath,
    stageable: true,
    executable: false,
    parameters: { ...defaultPluginParameters },
    loadable: false,
    sandboxLoadable: isVst3,
    loaderStatus: isVst3 ? 'metadata-ready' : 'scan-only',
    status: 'Found',
    note: isWavesShell
      ? `${format} Waves shell candidate detected; Resonance will attempt native bridge parameter loading for VST3 shells.`
      : `${format} candidate detected; plugin binary execution remains disabled until the native host is connected.`,
  };
}

function normalizePluginCandidate(candidate = {}) {
  if (!candidate.path || !candidate.id) return null;
  const entryName = candidate.name || path.basename(candidate.path);
  return {
    ...classifyCandidate(candidate.path, entryName),
    ...candidate,
    parameters: normalizePluginParameters(candidate.parameters),
  };
}

function vst3BundleMetadata(filePath) {
  const resolvedPath = path.resolve(filePath);
  const stat = fs.existsSync(resolvedPath) ? fs.statSync(resolvedPath) : null;
  const isBundle = stat?.isDirectory() && resolvedPath.toLowerCase().endsWith('.vst3');
  const contentsDir = path.join(resolvedPath, 'Contents');
  const hasContents = isBundle && fs.existsSync(contentsDir);
  const architectureDirs = hasContents
    ? fs.readdirSync(contentsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => /^(x86|x86_64|arm64|Win32|Resources)$/i.test(name))
    : [];

  return {
    path: resolvedPath,
    exists: Boolean(stat),
    kind: stat?.isDirectory() ? 'bundle' : stat?.isFile() ? 'file' : 'missing',
    isBundle,
    hasContents,
    architectureDirs,
  };
}

function createSandboxPluginInstance(candidate = {}, options = {}) {
  const normalized = normalizePluginCandidate(candidate);
  if (!normalized) {
    return {
      status: 'error',
      error: 'Plugin candidate is missing an id or path.',
    };
  }

  const metadata = vst3BundleMetadata(normalized.path);
  if (!metadata.exists) {
    return {
      id: normalized.id,
      name: normalized.name,
      path: normalized.path,
      status: 'degraded',
      loadStrategy: normalized.loadStrategy,
      error: 'Plugin path does not exist.',
      metadata,
    };
  }

  const isVst3 = normalized.format === 'VST3' || String(normalized.path).toLowerCase().endsWith('.vst3');
  const binaryExecutionEnabled = options.allowBinaryExecution === true;
  return {
    id: normalized.id,
    name: normalized.name,
    vendor: normalized.vendor,
    format: normalized.format,
    path: normalized.path,
    status: binaryExecutionEnabled && isVst3 ? 'loaded' : 'metadata-loaded',
    loadStrategy: binaryExecutionEnabled && isVst3 ? 'sandbox-vst3' : 'sandbox-vst3-metadata',
    executable: binaryExecutionEnabled && isVst3,
    processingEnabled: binaryExecutionEnabled && isVst3,
    degraded: !binaryExecutionEnabled,
    blockedReason: binaryExecutionEnabled ? null : 'VST3 binary execution is disabled until the native SDK bridge is connected.',
    parameterCount: vst3PrototypeParameters.length,
    parameters: vst3PrototypeParameters,
    metadata,
    loadedAt: new Date().toISOString(),
  };
}

function scanDirectory(root, options, candidates, errors, depth = 0) {
  if (depth > options.maxDepth || candidates.length >= options.maxCandidates) return;

  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    errors.push({ path: root, error: error.message });
    return;
  }

  for (const entry of entries) {
    if (candidates.length >= options.maxCandidates) return;
    const entryPath = path.join(root, entry.name);
    const candidate = classifyCandidate(entryPath, entry.name);
    if (candidate) candidates.push(candidate);

    if (entry.isDirectory() && !entry.name.toLowerCase().endsWith('.vst3')) {
      scanDirectory(entryPath, options, candidates, errors, depth + 1);
    }
  }
}

function summarizeCandidates(candidates) {
  const byFormat = {};
  const byVendor = {};
  for (const candidate of candidates) {
    byFormat[candidate.format] = (byFormat[candidate.format] || 0) + 1;
    byVendor[candidate.vendor] = (byVendor[candidate.vendor] || 0) + 1;
  }
  return { byFormat, byVendor };
}

function scanPluginCandidates(options = {}) {
  const startedAt = new Date();
  const roots = uniqueExisting(options.roots || defaultScanRoots(options.env || process.env));
  const candidates = [];
  const errors = [];
  const scanOptions = {
    maxDepth: Number.isFinite(options.maxDepth) ? options.maxDepth : 5,
    maxCandidates: Number.isFinite(options.maxCandidates) ? options.maxCandidates : maxCandidates,
  };

  for (const root of roots) {
    scanDirectory(root, scanOptions, candidates, errors);
    if (candidates.length >= scanOptions.maxCandidates) break;
  }

  const endedAt = new Date();
  const summary = summarizeCandidates(candidates);
  return {
    status: 'scan-only',
    protocolVersion: pluginHostProtocolVersion,
    scannedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    supportedFormats,
    plannedVendors,
    roots,
    count: candidates.length,
    runtimePlugins: builtInRuntimePlugins,
    candidates,
    summary,
    errors,
    note: 'VST2/VST3 discovery is read-only. Waves plugins are classified by vendor while keeping their actual VST format. Resonance can execute the built-in NativeDSP test processor for staged deck chains.',
    plannedRouting: 'Deck PCM -> native EQ or EQ bypass -> built-in NativeDSP plugin lane -> future sandboxed VST2/VST3 host -> master bus.',
  };
}

function activeDeckPlugins(pluginChain = []) {
  return Array.isArray(pluginChain)
    ? pluginChain.filter((plugin) => {
      const parameters = normalizePluginParameters(plugin?.parameters);
      return plugin && !plugin.bypassed && parameters.enabled;
    })
    : [];
}

function buildNativePluginSettings(pluginChain = []) {
  const activePlugins = activeDeckPlugins(pluginChain);
  const executablePlugins = activePlugins.filter((plugin) => {
    return plugin.executable === true || stagedPluginRuntimeProfiles[plugin.id];
  });
  const totals = executablePlugins.reduce((settings, plugin) => {
    const profile = stagedPluginRuntimeProfiles[plugin.id] || { gainDb: 1, drive: 1.04 };
    const parameters = normalizePluginParameters(plugin.parameters);
    return {
      pluginCount: settings.pluginCount + 1,
      pluginGainDb: settings.pluginGainDb + profile.gainDb + parameters.inputGainDb,
      pluginOutputGainDb: settings.pluginOutputGainDb + parameters.outputGainDb,
      pluginDrive: Math.max(settings.pluginDrive, profile.drive),
      pluginWetDry: settings.pluginWetDry + parameters.wetDry,
      activePluginIds: [...settings.activePluginIds, plugin.id],
      activePluginParameters: {
        ...settings.activePluginParameters,
        [plugin.id]: parameters,
      },
    };
  }, {
    pluginCount: 0,
    pluginGainDb: 0,
    pluginOutputGainDb: 0,
    pluginDrive: 1,
    pluginWetDry: 0,
    activePluginIds: [],
    activePluginParameters: {},
  });

  const averageWetDry = totals.pluginCount > 0 ? totals.pluginWetDry / totals.pluginCount : defaultPluginParameters.wetDry;

  return {
    pluginCount: totals.pluginCount,
    pluginGainDb: Math.max(-12, Math.min(12, Number(totals.pluginGainDb.toFixed(2)))),
    pluginOutputGainDb: Math.max(-24, Math.min(24, Number(totals.pluginOutputGainDb.toFixed(2)))),
    pluginDrive: Math.max(1, Math.min(3, Number(totals.pluginDrive.toFixed(2)))),
    pluginWetDry: Math.max(0, Math.min(100, Number(averageWetDry.toFixed(2)))),
    activePluginIds: totals.activePluginIds,
    activePluginParameters: totals.activePluginParameters,
  };
}

function blockedThirdPartyPlugins(pluginChain = []) {
  return activeDeckPlugins(pluginChain).filter((plugin) => {
    const isKnownFallback = Boolean(stagedPluginRuntimeProfiles[plugin.id]);
    return plugin.executable === false || (!plugin.executable && !isKnownFallback);
  });
}

function buildDeckPluginPlan(deckProcessing = {}) {
  const buildDeck = (deck) => {
    const processing = deckProcessing?.[deck] || {};
    const nativeSettings = buildNativePluginSettings(processing.pluginChain);
    const blockedPlugins = blockedThirdPartyPlugins(processing.pluginChain);
    return {
      deck,
      hostMode: nativeSettings.pluginCount > 0
        ? 'native-dsp-fallback'
        : blockedPlugins.length > 0
          ? 'blocked-third-party'
          : 'passthrough',
      eqBypassed: Boolean(processing.eqBypassed),
      activePluginIds: activeDeckPlugins(processing.pluginChain).map((plugin) => plugin.id),
      executablePluginIds: nativeSettings.activePluginIds,
      blockedPluginIds: blockedPlugins.map((plugin) => plugin.id),
      parameters: Object.fromEntries(activeDeckPlugins(processing.pluginChain).map((plugin) => [
        plugin.id,
        normalizePluginParameters(plugin.parameters),
      ])),
      nativeSettings,
    };
  };

  return {
    protocolVersion: pluginHostProtocolVersion,
    host: 'resonance-plugin-host',
    decks: {
      A: buildDeck('A'),
      B: buildDeck('B'),
    },
  };
}

function describePluginHostHelper(options = {}) {
  const nodePath = options.nodePath || process.execPath;
  const workerPath = options.workerPath || pluginHostWorkerPath;
  try {
    const stdout = execFileSync(nodePath, [workerPath, '--describe'], {
      encoding: 'utf8',
      timeout: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 1500,
      windowsHide: true,
    });
    return {
      status: 'ready',
      path: workerPath,
      ...JSON.parse(stdout.trim()),
    };
  } catch (error) {
    return {
      status: 'error',
      path: workerPath,
      error: error.message,
    };
  }
}

function describeNativeVst3Bridge(options = {}) {
  const bridgePath = options.bridgePath || nativeVst3BridgePath;
  const bridgeArgs = Array.isArray(options.bridgeArgs) ? options.bridgeArgs : [];
  if (!fs.existsSync(bridgePath)) {
    return {
      status: 'not-built',
      path: bridgePath,
      sdk: {
        path: process.env.RESONANCE_VST3_SDK_DIR || 'third_party\\vst3sdk',
        found: false,
      },
      capabilities: {
        metadataLifecycle: false,
        binaryInstantiation: false,
        pcmProcessing: false,
        bridgePcmProcessing: false,
        pcmFileTransport: false,
      },
      note: 'Native VST3 bridge is not built. Run npm run native:vst3-bridge.',
    };
  }

  try {
    const stdout = execFileSync(bridgePath, [...bridgeArgs, '--describe'], {
      encoding: 'utf8',
      timeout: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 1500,
      windowsHide: true,
    });
    return {
      path: bridgePath,
      ...JSON.parse(stdout.trim()),
    };
  } catch (error) {
    return {
      status: 'error',
      path: bridgePath,
      error: error.message,
    };
  }
}

class NativeVst3BridgeClient {
  constructor({ bridgePath = nativeVst3BridgePath, bridgeArgs = [], onStatus } = {}) {
    this.bridgePath = bridgePath;
    this.bridgeArgs = bridgeArgs;
    this.onStatus = onStatus || null;
    this.process = null;
    this.pending = new Map();
    this.nextRequestId = 1;
    this.status = {
      status: fs.existsSync(this.bridgePath) ? 'idle' : 'not-built',
      path: this.bridgePath,
      protocolVersion: pluginHostProtocolVersion,
    };
  }

  getStatus() {
    return this.status;
  }

  setStatus(update = {}) {
    this.status = {
      ...this.status,
      ...update,
      path: this.bridgePath,
      updatedAt: new Date().toISOString(),
    };
    this.onStatus?.(this.status);
  }

  start() {
    if (this.process) return true;
    if (!fs.existsSync(this.bridgePath)) {
      this.setStatus({ status: 'not-built', error: 'Native VST3 bridge executable was not found.' });
      return false;
    }

    const child = spawn(this.bridgePath, this.bridgeArgs, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process = child;
    this.setStatus({ status: 'starting', error: null });

    const stdout = readline.createInterface({ input: child.stdout });
    stdout.on('line', (line) => this.handleLine(line));

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('exit', (code, signal) => {
      if (this.process !== child) return;
      this.process = null;
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error(`Native VST3 bridge exited before responding (${code ?? signal ?? 'unknown'}).`));
      }
      this.pending.clear();
      this.setStatus({
        status: 'stopped',
        code,
        signal,
        error: stderr.trim() || null,
      });
    });

    child.on('error', (error) => {
      if (this.process !== child) return;
      this.setStatus({ status: 'error', error: error.message });
    });

    return true;
  }

  stop() {
    if (!this.process) {
      this.setStatus({ status: fs.existsSync(this.bridgePath) ? 'idle' : 'not-built' });
      return;
    }
    const child = this.process;
    this.request('exit', {}, { timeoutMs: 500 }).catch(() => {});
    setTimeout(() => {
      if (!child.killed) child.kill();
    }, 800).unref?.();
    this.setStatus({ status: 'stopping' });
  }

  handleLine(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.setStatus({ status: 'error', error: error.message, raw: line });
      return;
    }

    if (message.type === 'describe') {
      this.setStatus({
        status: message.status || 'ready',
        name: message.name,
        protocolVersion: message.protocolVersion,
        capabilities: message.capabilities,
        sdk: message.sdk,
        note: message.note,
      });
    }

    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.requestId);
    if (message.status === 'error' || message.type === 'error') {
      pending.reject(new Error(message.error || 'Native VST3 bridge command failed.'));
      return;
    }
    pending.resolve(message);
  }

  request(type, payload = {}, { timeoutMs = 2500 } = {}) {
    if (!this.start() || !this.process?.stdin?.writable) {
      return Promise.reject(new Error('Native VST3 bridge process is not writable.'));
    }

    const requestId = `vst3-${this.nextRequestId++}`;
    const message = { ...payload, type, requestId };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Native VST3 bridge ${type} timed out.`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.process.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  async describe() {
    const response = await this.request('describe', {}, { timeoutMs: 1500 });
    return {
      status: response.status || 'ready',
      path: this.bridgePath,
      ...response,
    };
  }

  async loadPlugin(candidate = {}, options = {}) {
    return this.request('loadPlugin', {
      id: candidate.id,
      path: candidate.path,
      name: candidate.name,
      vendor: candidate.vendor,
      format: candidate.format,
    }, {
      timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 2500,
    });
  }

  async unloadPlugin(pluginId, options = {}) {
    return this.request('unloadPlugin', { id: pluginId, pluginId }, {
      timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 1000,
    });
  }

  async enumerateParameters(pluginId, options = {}) {
    const response = await this.request('enumerateParameters', { id: pluginId, pluginId }, {
      timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 1500,
    });
    return response.parameters || [];
  }

  async processTone(pluginId, options = {}) {
    return this.request('processTone', {
      id: pluginId,
      pluginId,
      frames: Number.isFinite(options.frames) ? options.frames : 512,
      sampleRate: Number.isFinite(options.sampleRate) ? options.sampleRate : 48000,
      frequency: Number.isFinite(options.frequency) ? options.frequency : 440,
      amplitude: Number.isFinite(options.amplitude) ? options.amplitude : 0.2,
    }, {
      timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 2500,
    });
  }

  async processPcm(pluginId, options = {}) {
    const payload = {
      id: pluginId,
      pluginId,
      frames: Number.isFinite(options.frames) ? options.frames : 512,
      channels: Number.isFinite(options.channels) ? options.channels : 2,
      sampleRate: Number.isFinite(options.sampleRate) ? options.sampleRate : 48000,
      parameterValues: options.parameterValues || '',
      pcm16Base64: options.pcm16Base64 || '',
    };
    if (options.pcm16File) payload.pcm16File = options.pcm16File;
    if (options.outputPcm16File) payload.outputPcm16File = options.outputPcm16File;
    return this.request('processPcm', payload, {
      timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 3000,
    });
  }
}

class PluginHostClient {
  constructor({ nodePath = process.execPath, workerPath = pluginHostWorkerPath, onStatus } = {}) {
    this.nodePath = nodePath;
    this.workerPath = workerPath;
    this.onStatus = onStatus || null;
    this.process = null;
    this.pending = new Map();
    this.nextRequestId = 1;
    this.status = {
      status: 'idle',
      path: this.workerPath,
      protocolVersion: pluginHostProtocolVersion,
    };
  }

  getStatus() {
    return this.status;
  }

  setStatus(update = {}) {
    this.status = {
      ...this.status,
      ...update,
      path: this.workerPath,
      updatedAt: new Date().toISOString(),
    };
    this.onStatus?.(this.status);
  }

  start() {
    if (this.process) return true;

    const child = spawn(this.nodePath, [this.workerPath], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process = child;
    this.setStatus({ status: 'starting', error: null });

    const stdout = readline.createInterface({ input: child.stdout });
    stdout.on('line', (line) => this.handleLine(line));

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('exit', (code, signal) => {
      if (this.process !== child) return;
      this.process = null;
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error(`Plugin host exited before responding (${code ?? signal ?? 'unknown'}).`));
      }
      this.pending.clear();
      this.setStatus({
        status: 'stopped',
        code,
        signal,
        error: stderr.trim() || null,
      });
    });

    child.on('error', (error) => {
      if (this.process !== child) return;
      this.setStatus({ status: 'error', error: error.message });
    });

    return true;
  }

  stop() {
    if (!this.process) {
      this.setStatus({ status: 'idle' });
      return;
    }
    const child = this.process;
    this.request('exit', {}, { timeoutMs: 500 }).catch(() => {});
    setTimeout(() => {
      if (!child.killed) child.kill();
    }, 800).unref?.();
    this.setStatus({ status: 'stopping' });
  }

  handleLine(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.setStatus({ status: 'error', error: error.message, raw: line });
      return;
    }

    if (message.type === 'describe' && message.status === 'ready') {
      this.setStatus({
        status: 'ready',
        name: message.name,
        mode: message.mode,
        protocolVersion: message.protocolVersion,
        capabilities: message.capabilities,
        runtimePlugins: message.runtimePlugins,
        note: message.note,
      });
    }

    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.requestId);
    if (message.status === 'error' || message.type === 'error') {
      pending.reject(new Error(message.error || 'Plugin host command failed.'));
      return;
    }
    pending.resolve(message);
  }

  request(type, payload = {}, { timeoutMs = 1500 } = {}) {
    this.start();
    if (!this.process?.stdin?.writable) {
      return Promise.reject(new Error('Plugin host process is not writable.'));
    }

    const requestId = `plugin-${this.nextRequestId++}`;
    const message = { ...payload, type, requestId };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Plugin host ${type} timed out.`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.process.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  async describe() {
    const response = await this.request('describe');
    return {
      status: 'ready',
      path: this.workerPath,
      ...response,
    };
  }

  async resolveChain(deckProcessing = {}) {
    const response = await this.request('resolveChain', { deckProcessing });
    return response.plan;
  }

  async loadPlugin(candidate = {}, options = {}) {
    const response = await this.request('loadPlugin', { candidate }, {
      timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 2000,
    });
    return response.plugin;
  }

  async unloadPlugin(pluginId, options = {}) {
    return this.request('unloadPlugin', { pluginId }, {
      timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 1000,
    });
  }

  async enumerateParameters(pluginId, options = {}) {
    const response = await this.request('enumerateParameters', { pluginId }, {
      timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 1000,
    });
    return response.parameters || [];
  }
}

module.exports = {
  activeDeckPlugins,
  blockedThirdPartyPlugins,
  buildDeckPluginPlan,
  buildNativePluginSettings,
  builtInRuntimePlugins,
  createSandboxPluginInstance,
  defaultScanRoots,
  defaultPluginParameters,
  describeNativeVst3Bridge,
  describePluginHostHelper,
  NativeVst3BridgeClient,
  PluginHostClient,
  normalizePluginParameters,
  normalizePluginCandidate,
  pluginHostCapabilities,
  pluginHostProtocolVersion,
  pluginHostWorkerPath,
  nativeVst3BridgePath,
  scanPluginCandidates,
  supportedFormats,
  vst3PrototypeParameters,
  plannedVendors,
};

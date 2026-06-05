const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const readline = require('node:readline');

const supportedFormats = ['VST3'];
const plannedVendors = ['Waves'];
const maxCandidates = 120;
const pluginHostProtocolVersion = 1;
const pluginHostWorkerPath = path.join(__dirname, 'plugin-host-worker.cjs');
const pluginHostCapabilities = {
  sandboxProcess: true,
  perDeckChains: true,
  nativeDspFallback: true,
  thirdPartyPluginLoading: false,
  vst3Discovery: true,
  wavesDiscovery: true,
};
const builtInRuntimePlugins = [
  {
    id: 'resonance-native-drive',
    name: 'Resonance Native Drive',
    vendor: 'Resonance',
    format: 'NativeDSP',
    loadable: true,
    note: 'Built-in per-deck DSP used to validate the plugin processing lane before VST3/Waves loading.',
  },
];

const stagedPluginRuntimeProfiles = {
  'vst3-generic': { gainDb: 1.5, drive: 1.08 },
  'waves-vst3': { gainDb: 2.25, drive: 1.16 },
};

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
  const isWaves = lowerName.includes('waves') || lowerPath.includes(`${path.sep.toLowerCase()}waves`);
  const isWavesShell = lowerName.includes('wavesshell');

  if (!isVst3 && !isWavesShell) return null;

  return {
    id: stablePluginId(filePath),
    name: cleanPluginName(entryName),
    vendor: isWaves ? 'Waves' : 'Unknown',
    format: isVst3 ? 'VST3' : 'WavesShell',
    architecture: inferArchitecture(filePath),
    shellType: isWavesShell ? 'waves-shell' : 'vst3-bundle',
    loadStrategy: isWavesShell ? 'waves-shell-candidate' : 'vst3-candidate',
    source: 'desktop-scan',
    path: filePath,
    stageable: true,
    executable: false,
    loadable: false,
    status: 'Found',
    note: isWavesShell
      ? 'Waves shell candidate detected; Resonance does not load plugin binaries yet.'
      : 'VST3 candidate detected; Resonance scan mode is read-only.',
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
    note: 'VST3/Waves discovery is read-only. Resonance can execute the built-in NativeDSP test processor for staged deck chains.',
    plannedRouting: 'Deck PCM -> native EQ or EQ bypass -> built-in NativeDSP plugin lane -> future sandboxed VST3/Waves host -> master bus.',
  };
}

function activeDeckPlugins(pluginChain = []) {
  return Array.isArray(pluginChain)
    ? pluginChain.filter((plugin) => plugin && !plugin.bypassed)
    : [];
}

function buildNativePluginSettings(pluginChain = []) {
  const activePlugins = activeDeckPlugins(pluginChain);
  const executablePlugins = activePlugins.filter((plugin) => {
    return plugin.executable === true || stagedPluginRuntimeProfiles[plugin.id];
  });
  const totals = executablePlugins.reduce((settings, plugin) => {
    const profile = stagedPluginRuntimeProfiles[plugin.id] || { gainDb: 1, drive: 1.04 };
    return {
      pluginCount: settings.pluginCount + 1,
      pluginGainDb: settings.pluginGainDb + profile.gainDb,
      pluginDrive: Math.max(settings.pluginDrive, profile.drive),
      activePluginIds: [...settings.activePluginIds, plugin.id],
    };
  }, {
    pluginCount: 0,
    pluginGainDb: 0,
    pluginDrive: 1,
    activePluginIds: [],
  });

  return {
    pluginCount: totals.pluginCount,
    pluginGainDb: Math.max(-12, Math.min(12, Number(totals.pluginGainDb.toFixed(2)))),
    pluginDrive: Math.max(1, Math.min(3, Number(totals.pluginDrive.toFixed(2)))),
    activePluginIds: totals.activePluginIds,
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
}

module.exports = {
  activeDeckPlugins,
  blockedThirdPartyPlugins,
  buildDeckPluginPlan,
  buildNativePluginSettings,
  builtInRuntimePlugins,
  defaultScanRoots,
  describePluginHostHelper,
  PluginHostClient,
  pluginHostCapabilities,
  pluginHostProtocolVersion,
  pluginHostWorkerPath,
  scanPluginCandidates,
  supportedFormats,
  plannedVendors,
};

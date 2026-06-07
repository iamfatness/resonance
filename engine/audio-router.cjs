const { execFile, spawn } = require('node:child_process');
const readline = require('node:readline');
const { buildNativePluginSettings } = require('./plugin-host.cjs');

const DEFAULT_DECKS = ['A', 'B'];
const LATENCY_PROFILES = {
  low: { label: 'Low', bufferMs: 30 },
  balanced: { label: 'Balanced', bufferMs: 80 },
  stable: { label: 'Stable', bufferMs: 160 },
};
const SAFE_LATENCY_PROFILE_NAMES = Object.keys(LATENCY_PROFILES);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function normalizeLatencySettings(settings = {}) {
  const rawProfile = settings.latencyProfile || settings.audioLatencyProfile || 'balanced';
  const profile = rawProfile === 'custom'
    ? 'custom'
    : Object.prototype.hasOwnProperty.call(LATENCY_PROFILES, rawProfile)
      ? rawProfile
      : 'balanced';
  const customBufferMs = Number(settings.audioBufferMs ?? settings.bufferMs);
  return {
    profile,
    bufferMs: profile === 'custom' && Number.isFinite(customBufferMs)
      ? clamp(customBufferMs, 20, 500)
      : (LATENCY_PROFILES[profile]?.bufferMs || LATENCY_PROFILES.balanced.bufferMs),
  };
}

function defaultRoute(deck) {
  return {
    deck,
    source: `deck-${deck.toLowerCase()}-playback`,
    processing: 'app-eq-plugin-chain',
    destination: 'master-output',
    status: 'simulated',
  };
}

function averageBand(curve = [], indexes = []) {
  if (!Array.isArray(curve) || indexes.length === 0) return 0;
  const values = indexes.map((index) => Number(curve[index]) || 0);
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function eqBands(processing = {}) {
  if (processing.eqBypassed) return { low: 0, mid: 0, high: 0 };
  const curve = processing.curve || [];
  return {
    low: clamp(averageBand(curve, [0, 1]), -18, 18),
    mid: clamp(averageBand(curve, [2, 3, 4, 5]), -18, 18),
    high: clamp(averageBand(curve, [6, 7]), -18, 18),
  };
}

function eqBandGains(processing = {}) {
  const curve = processing.eqBypassed ? [] : processing.curve || [];
  return [0, 1, 2, 3, 4, 5, 6, 7].map((index) => clamp(curve[index], -18, 18));
}

function selectedVst3Plugin(pluginChain = []) {
  return (Array.isArray(pluginChain) ? pluginChain : []).find((plugin) => (
    plugin
    && !plugin.bypassed
    && plugin.format === 'VST3'
    && plugin.path
    && plugin.nativeLoad?.bridgePcmProcessing
    && plugin.parameters?.enabled !== false
  )) || null;
}

function vst3ParameterValues(plugin) {
  const parameters = plugin?.parameters?.pluginParameters;
  if (!parameters || typeof parameters !== 'object') return '';
  return Object.entries(parameters)
    .map(([id, value]) => {
      const number = Number(value);
      if (!Number.isFinite(number)) return null;
      return `${id}=${clamp(number, 0, 1)}`;
    })
    .filter(Boolean)
    .join(';');
}

function buildRouterState({
  backend = 'mock',
  status = 'idle',
  routes = DEFAULT_DECKS.map(defaultRoute),
  nativeSnapshot = null,
  latency = normalizeLatencySettings(),
} = {}) {
  const isNativeSkeleton = backend === 'native-router';
  return {
    backend,
    status,
    routes,
    nativeSnapshot,
    latency: {
      ...latency,
      profiles: SAFE_LATENCY_PROFILE_NAMES,
      native: nativeSnapshot?.latency || null,
    },
    capabilities: {
      perDeckCapture: backend === 'native-router',
      perDeckPan: true,
      perDeckEq: true,
      perDeckPlugins: backend === 'native-router',
      nativePcmRouting: backend === 'native-router',
      latencyProfiles: backend === 'native-router' ? SAFE_LATENCY_PROFILE_NAMES : [],
    },
    note: isNativeSkeleton
      ? 'Native router helper is built. Local WAV, pushed PCM, bounded WASAPI capture, and continuous per-deck capture streams can use the persistent mixer with per-deck EQ, pan, and built-in plugin-lane DSP.'
      : backend === 'mock'
        ? 'Deck routing is simulated until native per-source PCM capture is connected.'
        : 'WASAPI metering is active; per-deck PCM routing is still simulated.',
  };
}

class DesktopAudioRouter {
  constructor({ settings, hasNativeMeter, hasNativeRouter, nativeRouterPath, onSnapshot }) {
    this.settings = settings;
    this.hasNativeMeter = hasNativeMeter;
    this.hasNativeRouter = hasNativeRouter;
    this.nativeRouterPath = nativeRouterPath;
    this.nativeSnapshot = null;
    this.serverProcess = null;
    this.serverReady = false;
    this.serverOutputDeviceId = null;
    this.onServerSnapshot = onSnapshot || null;
    this.startedAt = null;
    this.state = this.buildState();
  }

  getState() {
    return this.state;
  }

  updateSettings(settings = {}) {
    this.settings = settings;
    this.updatePersistentSettings();
    this.state = this.buildState(this.state.status);
  }

  selectDevices({ inputDeviceId, outputDeviceId } = {}) {
    this.inputDeviceId = inputDeviceId || this.inputDeviceId;
    this.outputDeviceId = outputDeviceId || this.outputDeviceId;
    if (this.serverProcess && outputDeviceId && outputDeviceId !== this.serverOutputDeviceId) {
      this.stopPersistentServer();
    }
    this.state = this.buildState(this.state.status);
  }

  start() {
    this.startedAt = Date.now();
    this.state = this.buildState('running');
  }

  stop() {
    this.stopPersistentServer();
    this.state = this.buildState('idle');
  }

  buildState(status = 'idle') {
    const backend = this.hasNativeRouter?.()
      ? 'native-router'
      : this.hasNativeMeter?.()
        ? 'wasapi-meter'
        : 'mock';
    const routes = DEFAULT_DECKS.map((deck) => {
      const processing = this.settings?.deckProcessing?.[deck] || {};
      const pluginCount = processing.pluginChain?.filter((plugin) => !plugin.bypassed).length || 0;
      return {
        ...defaultRoute(deck),
        status: backend === 'native-router' ? (this.serverReady ? 'persistent' : 'ready') : backend === 'mock' ? 'simulated' : 'metered',
        source: this.inputDeviceId || `deck-${deck.toLowerCase()}-playback`,
        destination: this.outputDeviceId || 'default-output',
        pan: clamp(processing.pan, -50, 50),
        eqBypassed: Boolean(processing.eqBypassed),
        pluginCount,
      };
    });

    return buildRouterState({
      backend,
      status,
      routes,
      nativeSnapshot: this.nativeSnapshot,
      latency: normalizeLatencySettings(this.settings),
    });
  }

  startPersistentServer({ onSnapshot, outputDeviceId } = {}) {
    if (!this.hasNativeRouter?.() || !this.nativeRouterPath) return false;
    this.onServerSnapshot = onSnapshot || this.onServerSnapshot;
    if (outputDeviceId) this.outputDeviceId = outputDeviceId;
    if (this.serverProcess) return true;

    const args = ['--server'];
    const selectedOutput = this.outputDeviceId || 'default-output';
    if (selectedOutput && selectedOutput !== 'default-output') {
      args.push('--output-id', selectedOutput);
    }
    const latency = normalizeLatencySettings(this.settings);
    args.push('--latency-profile', latency.profile, '--buffer-ms', String(latency.bufferMs));
    this.serverOutputDeviceId = selectedOutput;
    const launchedProcess = spawn(this.nativeRouterPath, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.serverProcess = launchedProcess;
    this.serverReady = false;

    const stdout = readline.createInterface({ input: launchedProcess.stdout });
    stdout.on('line', (line) => {
      if (this.serverProcess !== launchedProcess) return;
      if (!line.trim()) return;
      try {
        this.nativeSnapshot = {
          ...JSON.parse(line),
          updatedAt: new Date().toISOString(),
        };
        this.serverReady = this.nativeSnapshot.backend === 'wasapi-persistent-router';
        this.state = this.buildState(this.state.status);
        this.onServerSnapshot?.(this.nativeSnapshot);
      } catch (error) {
        this.nativeSnapshot = {
          status: 'error',
          error: error.message,
          raw: line,
          updatedAt: new Date().toISOString(),
        };
        this.state = this.buildState(this.state.status);
        this.onServerSnapshot?.(this.nativeSnapshot);
      }
    });

    let stderr = '';
    launchedProcess.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    launchedProcess.on('exit', () => {
      if (this.serverProcess !== launchedProcess) return;
      this.serverProcess = null;
      this.serverReady = false;
      this.serverOutputDeviceId = null;
      if (stderr.trim()) {
        this.nativeSnapshot = {
          status: 'error',
          error: stderr.trim(),
          updatedAt: new Date().toISOString(),
        };
      }
      this.state = this.buildState(this.state.status === 'running' ? 'degraded' : this.state.status);
      this.onServerSnapshot?.(this.nativeSnapshot);
    });

    this.updatePersistentSettings();
    return true;
  }

  stopPersistentServer() {
    if (!this.serverProcess) return;
    this.sendServerCommand({ type: 'exit' });
    const processToStop = this.serverProcess;
    this.serverProcess = null;
    this.serverReady = false;
    this.serverOutputDeviceId = null;
    setTimeout(() => {
      if (!processToStop.killed) processToStop.kill();
    }, 1000).unref?.();
  }

  isPersistentServerRunning() {
    return Boolean(this.serverProcess);
  }

  sendServerCommand(command) {
    if (!this.serverProcess?.stdin?.writable) return false;
    this.serverProcess.stdin.write(`${JSON.stringify(command)}\n`);
    return true;
  }

  deckCommandSettings(deck) {
    const processing = this.settings?.deckProcessing?.[deck] || {};
    const volumes = this.settings?.deckVolumes || {};
    const eq = eqBands(processing);
    const eqGains = eqBandGains(processing);
    const pluginSettings = buildNativePluginSettings(processing.pluginChain);
    const vst3Plugin = selectedVst3Plugin(processing.pluginChain);
    const latency = normalizeLatencySettings(this.settings);
    return {
      type: 'settings',
      deck,
      latencyProfile: latency.profile,
      bufferMs: latency.bufferMs,
      gain: clamp((volumes[deck] || 0) / 100 * 0.2, 0, 0.35),
      pan: clamp(processing.pan, -50, 50),
      pluginCount: pluginSettings.pluginCount,
      pluginGainDb: pluginSettings.pluginGainDb,
      pluginOutputGainDb: pluginSettings.pluginOutputGainDb,
      pluginDrive: pluginSettings.pluginDrive,
      pluginWetDry: pluginSettings.pluginWetDry,
      vst3PluginId: vst3Plugin?.id || '',
      vst3PluginPath: vst3Plugin?.path || '',
      vst3ParameterValues: vst3Plugin?.nativeLoad?.parameterForwarding ? vst3ParameterValues(vst3Plugin) : '',
      eqLowDb: eq.low,
      eqMidDb: eq.mid,
      eqHighDb: eq.high,
      eq31Db: eqGains[0],
      eq62Db: eqGains[1],
      eq125Db: eqGains[2],
      eq250Db: eqGains[3],
      eq500Db: eqGains[4],
      eq1000Db: eqGains[5],
      eq2000Db: eqGains[6],
      eq4000Db: eqGains[7],
    };
  }

  updatePersistentSettings() {
    if (!this.serverProcess) return;
    const latency = normalizeLatencySettings(this.settings);
    this.sendServerCommand({
      type: 'latency',
      latencyProfile: latency.profile,
      bufferMs: latency.bufferMs,
    });
    for (const deck of DEFAULT_DECKS) {
      this.sendServerCommand(this.deckCommandSettings(deck));
    }
  }

  loadDeckWav({ deck = 'A', filePath, name } = {}) {
    if (!filePath || !this.startPersistentServer()) return false;
    const deckId = deck === 'B' ? 'B' : 'A';
    this.sendServerCommand({ type: 'load', deck: deckId, path: filePath, name });
    this.sendServerCommand(this.deckCommandSettings(deckId));
    return true;
  }

  pushDeckPcm({ deck = 'A', pcm16Base64, channels = 2, sampleRate = 48000 } = {}) {
    if (!pcm16Base64 || !this.startPersistentServer()) return false;
    const deckId = deck === 'B' ? 'B' : 'A';
    this.sendServerCommand({
      type: 'pcm',
      deck: deckId,
      channels,
      sampleRate,
      pcm16Base64,
    });
    this.sendServerCommand(this.deckCommandSettings(deckId));
    return true;
  }

  captureLoopback({ deck = 'A', deviceId, durationMs = 500 } = {}) {
    if (!this.startPersistentServer()) return false;
    const deckId = deck === 'B' ? 'B' : 'A';
    this.sendServerCommand({
      type: 'captureLoopback',
      deck: deckId,
      deviceId: deviceId || this.outputDeviceId || 'default-output',
      durationMs: clamp(durationMs, 50, 5000),
    });
    this.sendServerCommand(this.deckCommandSettings(deckId));
    return true;
  }

  startDeckCapture({ deck = 'A', deviceId } = {}) {
    if (!this.startPersistentServer()) return false;
    const deckId = deck === 'B' ? 'B' : 'A';
    this.sendServerCommand({
      type: 'startCapture',
      deck: deckId,
      deviceId: deviceId || this.inputDeviceId || this.outputDeviceId || 'default-output',
    });
    this.sendServerCommand(this.deckCommandSettings(deckId));
    return true;
  }

  stopDeckCapture({ deck = 'A' } = {}) {
    return this.sendServerCommand({
      type: 'stopCapture',
      deck: deck === 'B' ? 'B' : 'A',
    });
  }

  playDeck(deck = 'A') {
    if (!this.startPersistentServer()) return false;
    this.sendServerCommand({ type: 'play', deck: deck === 'B' ? 'B' : 'A' });
    return true;
  }

  pauseDeck(deck = 'A') {
    return this.sendServerCommand({ type: 'pause', deck: deck === 'B' ? 'B' : 'A' });
  }

  stopDeck(deck = 'A') {
    return this.sendServerCommand({ type: 'stop', deck: deck === 'B' ? 'B' : 'A' });
  }

  seekDeck(deck = 'A', positionMs = 0) {
    return this.sendServerCommand({
      type: 'seek',
      deck: deck === 'B' ? 'B' : 'A',
      positionMs: Math.max(0, Number(positionMs) || 0),
    });
  }

  sampleNativeRouter(callback) {
    if (!this.hasNativeRouter?.() || !this.nativeRouterPath) {
      callback?.(null, null);
      return;
    }

    execFile(
      this.nativeRouterPath,
      ['--run-once'],
      { windowsHide: true, timeout: 2000 },
      (error, stdout, stderr) => {
        if (error) {
          const snapshot = {
            status: 'error',
            error: stderr?.trim() || error.message,
            updatedAt: new Date().toISOString(),
          };
          this.nativeSnapshot = snapshot;
          this.state = this.buildState(this.state.status);
          callback?.(error, snapshot);
          return;
        }

        try {
          this.nativeSnapshot = {
            ...JSON.parse(stdout.trim()),
            updatedAt: new Date().toISOString(),
          };
        } catch (parseError) {
          this.nativeSnapshot = {
            status: 'error',
            error: parseError.message,
            updatedAt: new Date().toISOString(),
          };
          this.state = this.buildState(this.state.status);
          callback?.(parseError, this.nativeSnapshot);
          return;
        }

        this.state = this.buildState(this.state.status);
        callback?.(null, this.nativeSnapshot);
      },
    );
  }

  renderSilence(durationMs = 250, callback) {
    if (!this.hasNativeRouter?.() || !this.nativeRouterPath) {
      callback?.(null, null);
      return;
    }

    execFile(
      this.nativeRouterPath,
      ['--render-silence', '--duration-ms', String(durationMs)],
      { windowsHide: true, timeout: Math.max(2000, durationMs + 1500) },
      (error, stdout, stderr) => {
        if (error) {
          const snapshot = {
            status: 'error',
            error: stderr?.trim() || error.message,
            updatedAt: new Date().toISOString(),
          };
          this.nativeSnapshot = snapshot;
          this.state = this.buildState(this.state.status);
          callback?.(error, snapshot);
          return;
        }

        try {
          this.nativeSnapshot = {
            ...JSON.parse(stdout.trim()),
            updatedAt: new Date().toISOString(),
          };
        } catch (parseError) {
          this.nativeSnapshot = {
            status: 'error',
            error: parseError.message,
            updatedAt: new Date().toISOString(),
          };
          this.state = this.buildState(this.state.status);
          callback?.(parseError, this.nativeSnapshot);
          return;
        }

        this.state = this.buildState(this.state.status);
        callback?.(null, this.nativeSnapshot);
      },
    );
  }

  renderTone(durationMs = 250, callback) {
    if (!this.hasNativeRouter?.() || !this.nativeRouterPath) {
      callback?.(null, null);
      return;
    }

    const deckA = this.settings?.deckProcessing?.A || {};
    const deckB = this.settings?.deckProcessing?.B || {};
    const volumes = this.settings?.deckVolumes || {};
    const deckAEq = eqBands(deckA);
    const deckBEq = eqBands(deckB);
    const args = [
      '--render-tone',
      '--duration-ms',
      String(durationMs),
      '--deck-a-gain',
      String(clamp((volumes.A || 0) / 100 * 0.12, 0, 0.2)),
      '--deck-b-gain',
      String(clamp((volumes.B || 0) / 100 * 0.12, 0, 0.2)),
      '--deck-a-pan',
      String(clamp(deckA.pan, -50, 50)),
      '--deck-b-pan',
      String(clamp(deckB.pan, -50, 50)),
      '--deck-a-eq-low',
      String(deckAEq.low),
      '--deck-a-eq-mid',
      String(deckAEq.mid),
      '--deck-a-eq-high',
      String(deckAEq.high),
      '--deck-b-eq-low',
      String(deckBEq.low),
      '--deck-b-eq-mid',
      String(deckBEq.mid),
      '--deck-b-eq-high',
      String(deckBEq.high),
    ];

    execFile(
      this.nativeRouterPath,
      args,
      { windowsHide: true, timeout: Math.max(2000, durationMs + 1500) },
      (error, stdout, stderr) => {
        if (error) {
          const snapshot = {
            status: 'error',
            error: stderr?.trim() || error.message,
            updatedAt: new Date().toISOString(),
          };
          this.nativeSnapshot = snapshot;
          this.state = this.buildState(this.state.status);
          callback?.(error, snapshot);
          return;
        }

        try {
          this.nativeSnapshot = {
            ...JSON.parse(stdout.trim()),
            updatedAt: new Date().toISOString(),
          };
        } catch (parseError) {
          this.nativeSnapshot = {
            status: 'error',
            error: parseError.message,
            updatedAt: new Date().toISOString(),
          };
          this.state = this.buildState(this.state.status);
          callback?.(parseError, this.nativeSnapshot);
          return;
        }

        this.state = this.buildState(this.state.status);
        callback?.(null, this.nativeSnapshot);
      },
    );
  }

  renderWav({ deckAPath, deckBPath, deckAStartMs = 0, deckBStartMs = 0, durationMs = 1000 } = {}, callback) {
    if (!this.hasNativeRouter?.() || !this.nativeRouterPath || (!deckAPath && !deckBPath)) {
      callback?.(null, null);
      return;
    }

    const deckA = this.settings?.deckProcessing?.A || {};
    const deckB = this.settings?.deckProcessing?.B || {};
    const volumes = this.settings?.deckVolumes || {};
    const deckAEq = eqBands(deckA);
    const deckBEq = eqBands(deckB);
    const args = [
      '--render-wav',
      '--duration-ms',
      String(durationMs),
      '--deck-a-start-ms',
      String(Math.max(0, Number(deckAStartMs) || 0)),
      '--deck-b-start-ms',
      String(Math.max(0, Number(deckBStartMs) || 0)),
      '--deck-a-gain',
      String(clamp((volumes.A || 0) / 100 * 0.2, 0, 0.35)),
      '--deck-b-gain',
      String(clamp((volumes.B || 0) / 100 * 0.2, 0, 0.35)),
      '--deck-a-pan',
      String(clamp(deckA.pan, -50, 50)),
      '--deck-b-pan',
      String(clamp(deckB.pan, -50, 50)),
      '--deck-a-eq-low',
      String(deckAEq.low),
      '--deck-a-eq-mid',
      String(deckAEq.mid),
      '--deck-a-eq-high',
      String(deckAEq.high),
      '--deck-b-eq-low',
      String(deckBEq.low),
      '--deck-b-eq-mid',
      String(deckBEq.mid),
      '--deck-b-eq-high',
      String(deckBEq.high),
    ];
    if (deckAPath) {
      args.push('--deck-a', String(deckAPath));
    }
    if (deckBPath) {
      args.push('--deck-b', String(deckBPath));
    }

    execFile(
      this.nativeRouterPath,
      args,
      { windowsHide: true, timeout: Math.max(3000, durationMs + 2000) },
      (error, stdout, stderr) => {
        if (error) {
          const snapshot = {
            status: 'error',
            error: stderr?.trim() || error.message,
            updatedAt: new Date().toISOString(),
          };
          this.nativeSnapshot = snapshot;
          this.state = this.buildState(this.state.status);
          callback?.(error, snapshot);
          return;
        }

        try {
          this.nativeSnapshot = {
            ...JSON.parse(stdout.trim()),
            updatedAt: new Date().toISOString(),
          };
        } catch (parseError) {
          this.nativeSnapshot = {
            status: 'error',
            error: parseError.message,
            updatedAt: new Date().toISOString(),
          };
          this.state = this.buildState(this.state.status);
          callback?.(parseError, this.nativeSnapshot);
          return;
        }

        this.state = this.buildState(this.state.status);
        callback?.(null, this.nativeSnapshot);
      },
    );
  }

  zeroDeckMeters() {
    return Object.fromEntries(DEFAULT_DECKS.map((deck) => {
      const route = this.state.routes.find((candidate) => candidate.deck === deck) || defaultRoute(deck);
      return [deck, {
        inputPeak: 0,
        outputPeak: 0,
        leftPeak: 0,
        rightPeak: 0,
        pan: route.pan || 0,
        pluginCount: route.pluginCount || 0,
        eqActivity: 0,
      }];
    }));
  }

  deckBusMeter(deck, seconds, phaseOffset = 0) {
    const processing = this.settings?.deckProcessing?.[deck] || {};
    const volumes = this.settings?.deckVolumes || {};
    const deckGain = clamp((volumes[deck] || 0) / 100, 0, 1.2);
    const pluginCount = processing.pluginChain?.filter((plugin) => !plugin.bypassed).length || 0;
    const eqActivity = processing.eqBypassed
      ? 0
      : Math.min(1, (processing.curve || []).reduce((total, gain) => total + Math.abs(Number(gain) || 0), 0) / 48);
    const movement = (Math.sin((seconds + phaseOffset) * 2.1) + 1) / 2;
    const transient = (Math.sin((seconds + phaseOffset) * 8.7) + 1) / 2;
    const inputPeak = Math.min(0.98, 0.14 + movement * 0.58 + transient * 0.18);
    const processingLift = 1 + (eqActivity * 0.18) + (pluginCount * 0.04);
    const outputPeak = Math.min(1, inputPeak * deckGain * processingLift);
    const pan = clamp(processing.pan, -50, 50);
    const panNormalized = pan / 50;
    const leftScale = panNormalized <= 0 ? 1 : 1 - panNormalized;
    const rightScale = panNormalized >= 0 ? 1 : 1 + panNormalized;

    return {
      inputPeak: Number(inputPeak.toFixed(3)),
      outputPeak: Number(outputPeak.toFixed(3)),
      leftPeak: Number((outputPeak * leftScale).toFixed(3)),
      rightPeak: Number((outputPeak * rightScale).toFixed(3)),
      pan,
      pluginCount,
      eqActivity: Number(eqActivity.toFixed(3)),
    };
  }

  nextMockMeters(outputGain = 0.9) {
    const now = Date.now();
    const seconds = now / 1000;
    const gain = clamp(outputGain, 0, 1.2);
    const deckA = this.deckBusMeter('A', seconds, 0);
    const deckB = this.deckBusMeter('B', seconds, 0.41);
    const inputPeak = Math.min(1, Math.max(deckA.inputPeak, deckB.inputPeak));
    const outputPeak = Math.min(1, (deckA.leftPeak + deckA.rightPeak + deckB.leftPeak + deckB.rightPeak) * 0.5 * gain);
    const inputRms = Math.min(0.86, inputPeak * 0.58);
    const outputRms = Math.min(1, outputPeak * 0.62);

    return {
      inputPeak: Number(inputPeak.toFixed(3)),
      outputPeak: Number(outputPeak.toFixed(3)),
      inputRms: Number(inputRms.toFixed(3)),
      outputRms: Number(outputRms.toFixed(3)),
      clipping: outputPeak >= 0.98,
      decks: { A: deckA, B: deckB },
      updatedAt: new Date(now).toISOString(),
    };
  }
}

module.exports = {
  DesktopAudioRouter,
  buildRouterState,
  normalizeLatencySettings,
};

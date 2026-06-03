const { execFile } = require('node:child_process');

const DEFAULT_DECKS = ['A', 'B'];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
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

function buildRouterState({ backend = 'mock', status = 'idle', routes = DEFAULT_DECKS.map(defaultRoute), nativeSnapshot = null } = {}) {
  const isNativeSkeleton = backend === 'native-router';
  return {
    backend,
    status,
    routes,
    nativeSnapshot,
    capabilities: {
      perDeckCapture: false,
      perDeckPan: true,
      perDeckEq: true,
      perDeckPlugins: false,
      nativePcmRouting: false,
    },
    note: isNativeSkeleton
      ? 'Native router helper is built, but PCM capture/render is still stubbed.'
      : backend === 'mock'
        ? 'Deck routing is simulated until native per-source PCM capture is connected.'
        : 'WASAPI metering is active; per-deck PCM routing is still simulated.',
  };
}

class DesktopAudioRouter {
  constructor({ settings, hasNativeMeter, hasNativeRouter, nativeRouterPath }) {
    this.settings = settings;
    this.hasNativeMeter = hasNativeMeter;
    this.hasNativeRouter = hasNativeRouter;
    this.nativeRouterPath = nativeRouterPath;
    this.nativeSnapshot = null;
    this.startedAt = null;
    this.state = this.buildState();
  }

  getState() {
    return this.state;
  }

  updateSettings(settings = {}) {
    this.settings = settings;
    this.state = this.buildState(this.state.status);
  }

  selectDevices({ inputDeviceId, outputDeviceId } = {}) {
    this.inputDeviceId = inputDeviceId || this.inputDeviceId;
    this.outputDeviceId = outputDeviceId || this.outputDeviceId;
    this.state = this.buildState(this.state.status);
  }

  start() {
    this.startedAt = Date.now();
    this.state = this.buildState('running');
  }

  stop() {
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
        status: backend === 'native-router' ? 'stubbed' : backend === 'mock' ? 'simulated' : 'metered',
        source: this.inputDeviceId || `deck-${deck.toLowerCase()}-playback`,
        destination: this.outputDeviceId || 'default-output',
        pan: clamp(processing.pan, -50, 50),
        eqBypassed: Boolean(processing.eqBypassed),
        pluginCount,
      };
    });

    return buildRouterState({ backend, status, routes, nativeSnapshot: this.nativeSnapshot });
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
};

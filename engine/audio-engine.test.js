import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildDeckSourceState,
  deckSourceTypeForDevice,
  defaultPlaybackDeck,
  isStoppedContinuousCapture,
  normalizeDeckSource,
  normalizeSnapshotSourceType,
  withDeckSource,
} = require('./audio-engine.cjs');

describe('audio engine deck source state', () => {
  it('normalizes WAV, PCM, loopback, and virtual-device sources', () => {
    expect(normalizeDeckSource({ type: 'wav', mode: 'file', label: 'Intro.wav' })).toMatchObject({
      type: 'wav',
      mode: 'file',
      label: 'Intro.wav',
      streaming: false,
    });

    expect(normalizeDeckSource({
      type: 'pcm',
      mode: 'pushed-pcm',
      metadata: { sampleRate: 48000, channels: 2 },
    })).toMatchObject({
      type: 'pcm',
      mode: 'pushed-pcm',
      metadata: { sampleRate: 48000, channels: 2 },
    });

    expect(deckSourceTypeForDevice('resonance-virtual-input')).toBe('virtual-device');
    expect(deckSourceTypeForDevice('{0.0.1.00000000}.default-render')).toBe('loopback');
  });

  it('mirrors normalized source state to legacy deck fields for IPC compatibility', () => {
    const startedAt = '2026-06-06T12:00:00.000Z';
    const deck = buildDeckSourceState(defaultPlaybackDeck, {
      type: 'virtual-device',
      mode: 'continuous-capture',
      label: 'Continuous virtual-device capture',
      deviceId: 'resonance-virtual-input',
      streaming: true,
      startedAt,
    }, {
      name: 'Continuous virtual-device capture',
      status: 'playing',
      lastStartedAt: startedAt,
    });

    expect(deck).toMatchObject({
      path: null,
      name: 'Continuous virtual-device capture',
      status: 'playing',
      sourceType: 'virtual-device',
      captureStreaming: true,
      source: {
        type: 'virtual-device',
        mode: 'continuous-capture',
        deviceId: 'resonance-virtual-input',
        streaming: true,
        startedAt,
      },
    });
  });

  it('marks stopped continuous capture so stale streaming snapshots can be ignored', () => {
    const stoppedAt = '2026-06-06T12:00:02.000Z';
    const stoppedDeck = withDeckSource({
      ...defaultPlaybackDeck,
      name: 'Continuous capture',
      status: 'stopped',
      lastStartedAt: null,
    }, normalizeDeckSource({
      type: 'loopback',
      mode: 'continuous-capture',
      label: 'Continuous capture',
      streaming: false,
      stoppedAt,
    }));

    expect(stoppedDeck.captureStreaming).toBe(false);
    expect(isStoppedContinuousCapture(stoppedDeck)).toBe(true);

    const restartedDeck = withDeckSource({
      ...stoppedDeck,
      status: 'playing',
      lastStartedAt: '2026-06-06T12:00:04.000Z',
    }, normalizeDeckSource({
      ...stoppedDeck.source,
      streaming: true,
      stoppedAt: null,
    }));

    expect(restartedDeck.captureStreaming).toBe(true);
    expect(isStoppedContinuousCapture(restartedDeck)).toBe(false);
  });

  it('preserves virtual-device classification when native snapshots report loopback', () => {
    const deck = buildDeckSourceState(defaultPlaybackDeck, {
      type: 'virtual-device',
      mode: 'continuous-capture',
      label: 'Continuous virtual-device capture',
      deviceId: 'resonance-virtual-input',
      streaming: true,
    });

    expect(normalizeSnapshotSourceType('loopback', deck)).toBe('virtual-device');
    expect(normalizeSnapshotSourceType('pcm', deck)).toBe('pcm');
  });
});

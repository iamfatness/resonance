import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { buildRouterState, normalizeLatencySettings } = require('./audio-router.cjs');

describe('desktop audio router latency settings', () => {
  it('normalizes safe latency profiles to native buffer targets', () => {
    expect(normalizeLatencySettings({ audioLatencyProfile: 'low' })).toMatchObject({ profile: 'low', bufferMs: 30 });
    expect(normalizeLatencySettings({ audioLatencyProfile: 'balanced' })).toMatchObject({ profile: 'balanced', bufferMs: 80 });
    expect(normalizeLatencySettings({ audioLatencyProfile: 'stable' })).toMatchObject({ profile: 'stable', bufferMs: 160 });
  });

  it('clamps custom buffer settings to the native safe range', () => {
    expect(normalizeLatencySettings({ audioLatencyProfile: 'custom', audioBufferMs: 10 })).toMatchObject({ profile: 'custom', bufferMs: 20 });
    expect(normalizeLatencySettings({ audioLatencyProfile: 'custom', audioBufferMs: 320 })).toMatchObject({ profile: 'custom', bufferMs: 320 });
    expect(normalizeLatencySettings({ audioLatencyProfile: 'custom', audioBufferMs: 900 })).toMatchObject({ profile: 'custom', bufferMs: 500 });
  });

  it('exposes latency capabilities and native snapshot state', () => {
    const state = buildRouterState({
      backend: 'native-router',
      latency: normalizeLatencySettings({ audioLatencyProfile: 'custom', audioBufferMs: 120 }),
      nativeSnapshot: {
        latency: {
          profile: 'custom',
          requestedBufferMs: 120,
          actualBufferMs: 128,
          restartRequired: false,
        },
      },
    });

    expect(state.capabilities.latencyProfiles).toEqual(['low', 'balanced', 'stable']);
    expect(state.latency).toMatchObject({
      profile: 'custom',
      bufferMs: 120,
      native: {
        actualBufferMs: 128,
      },
    });
  });
});

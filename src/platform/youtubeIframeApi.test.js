import { afterEach, describe, expect, it, vi } from 'vitest';

function installBrowserStubs() {
  const scripts = [];
  const documentStub = {
    head: {
      appendChild: vi.fn((script) => scripts.push(script)),
    },
    createElement: vi.fn(() => ({
      async: false,
      src: '',
      addEventListener: vi.fn(),
    })),
    querySelector: vi.fn(() => null),
  };

  vi.stubGlobal('window', {});
  vi.stubGlobal('document', documentStub);

  return { documentStub, scripts };
}

describe('loadYouTubeIframeApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('resolves immediately when the YouTube player API already exists', async () => {
    vi.stubGlobal('window', { YT: { Player: vi.fn() } });

    const { loadYouTubeIframeApi } = await import('./youtubeIframeApi.js');

    await expect(loadYouTubeIframeApi()).resolves.toBe(window.YT);
  });

  it('injects the iframe API script only once for concurrent callers', async () => {
    const { documentStub, scripts } = installBrowserStubs();
    const { loadYouTubeIframeApi } = await import('./youtubeIframeApi.js');

    const first = loadYouTubeIframeApi();
    const second = loadYouTubeIframeApi();

    expect(documentStub.head.appendChild).toHaveBeenCalledTimes(1);
    expect(scripts[0].src).toBe('https://www.youtube.com/iframe_api');

    window.YT = { Player: vi.fn() };
    window.onYouTubeIframeAPIReady();

    await expect(first).resolves.toBe(window.YT);
    await expect(second).resolves.toBe(window.YT);
  });
});

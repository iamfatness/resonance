import { useEffect, useState } from 'react';

export function useDesktopEngine(settings) {
  const desktopApi = typeof window !== 'undefined' ? window.resonanceDesktop : null;
  const [engineState, setEngineState] = useState(null);
  const [meters, setMeters] = useState(null);
  const [deckAWav, setDeckAWav] = useState(null);
  const [deckBWav, setDeckBWav] = useState(null);

  useEffect(() => {
    if (!desktopApi?.engine) return undefined;
    let cancelled = false;

    desktopApi.engine
      .getState()
      .then((state) => {
        if (!cancelled) setEngineState(state);
      })
      .catch(() => {
        if (!cancelled) setEngineState({ status: 'offline', mode: 'unavailable' });
      });

    return desktopApi.engine.onState((state) => {
      if (!cancelled) setEngineState(state);
    });
  }, [desktopApi]);

  useEffect(() => {
    if (!desktopApi?.engine?.onMeters) return undefined;
    let cancelled = false;
    return desktopApi.engine.onMeters((nextMeters) => {
      if (!cancelled) setMeters(nextMeters);
    });
  }, [desktopApi]);

  useEffect(() => {
    if (!desktopApi?.engine) return;
    desktopApi.engine.updateSettings(settings).catch(() => {});
  }, [desktopApi, settings]);

  return {
    isDesktop: Boolean(desktopApi?.isDesktop),
    state: engineState,
    meters: meters || engineState?.meters || null,
    start: () => desktopApi?.engine?.start?.(),
    stop: () => desktopApi?.engine?.stop?.(),
    renderSilence: (durationMs) => desktopApi?.engine?.renderSilence?.(durationMs),
    renderTone: (durationMs) => desktopApi?.engine?.renderTone?.(durationMs),
    renderWav: (payload) => desktopApi?.engine?.renderWav?.(payload),
    pushDeckPcm: (payload) => desktopApi?.engine?.pushDeckPcm?.(payload),
    captureLoopback: (payload) => desktopApi?.engine?.captureLoopback?.(payload),
    startDeckCapture: (payload) => desktopApi?.engine?.startDeckCapture?.(payload),
    stopDeckCapture: (payload) => desktopApi?.engine?.stopDeckCapture?.(payload),
    selectDeckAWav: async () => {
      const selection = await desktopApi?.selectWavFile?.();
      if (selection) {
        setDeckAWav(selection);
        await desktopApi?.engine?.loadDeckWav?.({
          deck: 'A',
          filePath: selection.path,
          name: selection.name,
        });
      }
      return selection;
    },
    selectDeckBWav: async () => {
      const selection = await desktopApi?.selectWavFile?.();
      if (selection) {
        setDeckBWav(selection);
        await desktopApi?.engine?.loadDeckWav?.({
          deck: 'B',
          filePath: selection.path,
          name: selection.name,
        });
      }
      return selection;
    },
    playDeck: (deck) => desktopApi?.engine?.playDeck?.({ deck }),
    pauseDeck: (deck) => desktopApi?.engine?.pauseDeck?.({ deck }),
    stopDeck: (deck) => desktopApi?.engine?.stopDeck?.({ deck }),
    seekDeck: (deck, positionMs) => desktopApi?.engine?.seekDeck?.({ deck, positionMs }),
    deckAWav,
    deckBWav,
    refreshDevices: () => desktopApi?.engine?.refreshDevices?.(),
    refreshPlugins: () => desktopApi?.engine?.refreshPlugins?.(),
    selectDevices: (devices) => desktopApi?.engine?.selectDevices?.(devices),
  };
}

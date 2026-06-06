import { useEffect, useMemo, useState } from 'react';
import { AudioLines, SlidersHorizontal } from 'lucide-react';
import { flatCurve, moodPresets, normalizeDeckProcessing } from '../lib/presets.js';
import { readSavedAppState, writeSavedAppState } from '../lib/storage.js';
import {
  buildPluginCatalog,
  filterPluginCatalog,
  normalizePluginParameters,
  pluginChainKey,
} from '../lib/plugins.js';
import { useDesktopEngine } from '../hooks/useDesktopEngine.js';
import { PluginChainPanel } from './PluginChainPanel.jsx';

function updatePluginChain(deckProcessing, deck, updater) {
  return {
    ...deckProcessing,
    [deck]: updater(deckProcessing[deck]),
  };
}

export function DeckEffectsWindow({ deck = 'A' }) {
  const activeDeck = deck === 'B' ? 'B' : 'A';
  const savedAppState = useMemo(() => readSavedAppState() || {}, []);
  const [deckProcessing, setDeckProcessing] = useState(() => normalizeDeckProcessing(savedAppState.deckProcessing));
  const [pluginFilter, setPluginFilter] = useState('all');
  const [pluginSort, setPluginSort] = useState('status');
  const activeDeckProcessing = deckProcessing[activeDeck];
  const desktopEngineSettings = useMemo(() => ({
    preset: savedAppState.activePreset || 'Focus',
    eqMode: savedAppState.eqMode || 'Preset',
    curve: savedAppState.processedCurve || moodPresets[savedAppState.activePreset]?.curve || moodPresets.Focus.curve,
    appEqBypassed: Boolean(savedAppState.appEqBypassed),
    deckProcessing,
    deckVolumes: savedAppState.deckVolumes || { A: 72, B: 38 },
    outputGain: (savedAppState.deckVolumes?.A || 72) / 100,
    audioLatencyProfile: savedAppState.audioLatencyProfile || 'balanced',
    audioBufferMs: savedAppState.audioBufferMs || 80,
  }), [deckProcessing, savedAppState]);
  const desktopEngine = useDesktopEngine(desktopEngineSettings);
  const pluginCatalog = useMemo(() => {
    return buildPluginCatalog(desktopEngine.state?.pluginHost?.candidates || []);
  }, [desktopEngine.state?.pluginHost?.candidates]);
  const filteredPlugins = useMemo(() => {
    return filterPluginCatalog(pluginCatalog, activeDeckProcessing.pluginChain, pluginFilter, pluginSort);
  }, [activeDeckProcessing.pluginChain, pluginCatalog, pluginFilter, pluginSort]);
  const pluginScan = {
    status: desktopEngine.state?.pluginHost?.scanStatus || desktopEngine.state?.pluginHost?.status || 'pending',
    count: desktopEngine.state?.pluginHost?.pluginCount || 0,
    formats: (desktopEngine.state?.pluginHost?.supportedFormats || []).join(', ') || 'VST2, VST3',
    onRefresh: desktopEngine.refreshPlugins,
  };

  function persistDeckProcessing(nextDeckProcessing) {
    const current = readSavedAppState() || savedAppState;
    const nextState = {
      ...current,
      deckProcessing: nextDeckProcessing,
    };
    writeSavedAppState(nextState);
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('resonance-deck-effects');
      channel.postMessage({ type: 'deck-processing-updated', deckProcessing: nextDeckProcessing });
      channel.close();
    }
  }

  function updateDeck(updater) {
    setDeckProcessing((current) => {
      const next = updatePluginChain(current, activeDeck, updater);
      persistDeckProcessing(next);
      return next;
    });
  }

  function addDeckPlugin(targetDeck, pluginId) {
    updateDeck((settings) => {
      const plugin = pluginCatalog.find((item) => item.id === pluginId);
      return plugin
        ? {
            ...settings,
            pluginChain: [
              ...settings.pluginChain,
              { ...plugin, instanceId: `${plugin.id}:${Date.now()}`, parameters: normalizePluginParameters(plugin.parameters), bypassed: false },
            ],
          }
        : settings;
    });
  }

  function removeDeckPlugin(targetDeck, pluginKey) {
    updateDeck((settings) => ({
      ...settings,
      pluginChain: settings.pluginChain.filter((plugin) => pluginChainKey(plugin) !== pluginKey),
    }));
  }

  function moveDeckPlugin(targetDeck, pluginKey, direction) {
    updateDeck((settings) => {
      const index = settings.pluginChain.findIndex((plugin) => pluginChainKey(plugin) === pluginKey);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= settings.pluginChain.length) return settings;
      const pluginChain = [...settings.pluginChain];
      const [plugin] = pluginChain.splice(index, 1);
      pluginChain.splice(nextIndex, 0, plugin);
      return { ...settings, pluginChain };
    });
  }

  function duplicateDeckPlugin(targetDeck, pluginKey) {
    updateDeck((settings) => {
      const plugin = settings.pluginChain.find((item) => pluginChainKey(item) === pluginKey);
      return plugin
        ? {
            ...settings,
            pluginChain: [
              ...settings.pluginChain,
              { ...plugin, instanceId: `${plugin.id}:copy-${Date.now()}`, parameters: normalizePluginParameters(plugin.parameters) },
            ],
          }
        : settings;
    });
  }

  function resetDeckPluginParameters(targetDeck, pluginKey) {
    updateDeck((settings) => ({
      ...settings,
      pluginChain: settings.pluginChain.map((plugin) => (
        pluginChainKey(plugin) === pluginKey ? { ...plugin, parameters: normalizePluginParameters({}) } : plugin
      )),
    }));
  }

  function toggleDeckPluginBypass(targetDeck, pluginKey) {
    updateDeck((settings) => ({
      ...settings,
      pluginChain: settings.pluginChain.map((plugin) => (
        pluginChainKey(plugin) === pluginKey ? { ...plugin, bypassed: !plugin.bypassed } : plugin
      )),
    }));
  }

  function setDeckPluginParameter(targetDeck, pluginKey, parameter, value) {
    updateDeck((settings) => ({
      ...settings,
      pluginChain: settings.pluginChain.map((plugin) => (
        pluginChainKey(plugin) === pluginKey
          ? { ...plugin, parameters: normalizePluginParameters({ ...plugin.parameters, [parameter]: value }) }
          : plugin
      )),
    }));
  }

  useEffect(() => {
    window.resonanceDesktop?.engine?.refreshPlugins?.();
  }, []);

  return (
    <main className="effects-window">
      <header className="effects-window-header">
        <div>
          <AudioLines aria-hidden="true" />
          <span>Resonance</span>
        </div>
        <strong>Deck {activeDeck} Effects</strong>
      </header>
      <section className="effects-window-summary">
        <SlidersHorizontal size={18} />
        <p>
          Scan this computer for VST2/VST3 plugins, then stage effects into Deck {activeDeck}'s chain.
          Scanned third-party plugins are scan-only until the native plugin host is connected.
        </p>
      </section>
      <PluginChainPanel
        activeInputDeck={activeDeck}
        activeDeckProcessing={activeDeckProcessing || { pan: 0, eqBypassed: false, curve: flatCurve, pluginChain: [] }}
        pluginCatalog={pluginCatalog}
        pluginFilter={pluginFilter}
        setPluginFilter={setPluginFilter}
        pluginSort={pluginSort}
        setPluginSort={setPluginSort}
        filteredPlugins={filteredPlugins}
        pluginScan={pluginScan}
        addDeckPlugin={addDeckPlugin}
        removeDeckPlugin={removeDeckPlugin}
        moveDeckPlugin={moveDeckPlugin}
        duplicateDeckPlugin={duplicateDeckPlugin}
        resetDeckPluginParameters={resetDeckPluginParameters}
        toggleDeckPluginBypass={toggleDeckPluginBypass}
        setDeckPluginParameter={setDeckPluginParameter}
      />
    </main>
  );
}

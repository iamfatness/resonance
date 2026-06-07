import { useEffect, useMemo, useState } from 'react';
import { AudioLines, SlidersHorizontal } from 'lucide-react';
import { flatCurve, moodPresets, normalizeDeckProcessing } from '../lib/presets.js';
import { readSavedAppState, writeSavedAppState } from '../lib/storage.js';
import {
  buildPluginCatalog,
  deletePluginPreset,
  djEffectPresets,
  filterPluginCatalog,
  normalizePluginParameters,
  pluginChainKey,
  readPluginPresets,
  savePluginPreset,
  writePluginPresets,
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
  const [pluginPresets, setPluginPresets] = useState(() => readPluginPresets());
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
  const djEffects = useMemo(() => {
    return djEffectPresets
      .map((effect) => ({
        ...effect,
        plugin: pluginCatalog.find((plugin) => plugin.id === effect.id),
      }))
      .filter((effect) => effect.plugin);
  }, [pluginCatalog]);
  const filteredPlugins = useMemo(() => {
    return filterPluginCatalog(pluginCatalog, activeDeckProcessing.pluginChain, pluginFilter, pluginSort);
  }, [activeDeckProcessing.pluginChain, pluginCatalog, pluginFilter, pluginSort]);
  const pluginScan = {
    status: desktopEngine.state?.pluginHost?.scanStatus || desktopEngine.state?.pluginHost?.status || 'pending',
    count: desktopEngine.state?.pluginHost?.pluginCount || 0,
    formats: (desktopEngine.state?.pluginHost?.supportedFormats || []).join(', ') || 'VST2, VST3',
    bridgeStatus: desktopEngine.state?.pluginHost?.nativeBridgeClient?.status || desktopEngine.state?.pluginHost?.nativeBridge?.status,
    bridgeLoadedCount: desktopEngine.state?.pluginHost?.nativeBridgeClient?.loadedCount || 0,
    bridgeParameterLoadedCount: desktopEngine.state?.pluginHost?.nativeBridgeClient?.parameterLoadedCount || 0,
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

  function addDjEffect(pluginId) {
    addDeckPlugin(activeDeck, pluginId);
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

  function saveDeckPluginPreset(targetDeck, pluginKey) {
    const plugin = activeDeckProcessing.pluginChain.find((item) => pluginChainKey(item) === pluginKey);
    if (!plugin) return;
    setPluginPresets((current) => {
      const next = savePluginPreset(current, plugin, plugin.parameters?.presetName, plugin.parameters);
      writePluginPresets(next);
      return next;
    });
  }

  function applyDeckPluginPreset(targetDeck, pluginKey, presetName) {
    const plugin = activeDeckProcessing.pluginChain.find((item) => pluginChainKey(item) === pluginKey);
    const preset = pluginPresets[plugin?.id]?.find((candidate) => candidate.name === presetName);
    if (!preset) return;
    updateDeck((settings) => ({
      ...settings,
      pluginChain: settings.pluginChain.map((item) => (
        pluginChainKey(item) === pluginKey
          ? { ...item, parameters: normalizePluginParameters(preset.parameters) }
          : item
      )),
    }));
  }

  function deleteDeckPluginPreset(targetDeck, pluginKey, presetName) {
    const plugin = activeDeckProcessing.pluginChain.find((item) => pluginChainKey(item) === pluginKey);
    if (!plugin) return;
    setPluginPresets((current) => {
      const next = deletePluginPreset(current, plugin.id, presetName);
      writePluginPresets(next);
      return next;
    });
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
          Treat Deck {activeDeck} like a DJ channel: add fast built-in effects first, then use advanced
          plugin hosting only when you need local VST2/VST3 experiments.
        </p>
      </section>
      <section className="dj-effects-panel">
        <div className="panel-heading">
          <h2>Deck {activeDeck} DJ Effects</h2>
          <span>{activeDeckProcessing.pluginChain.length} active</span>
        </div>
        <div className="dj-effect-grid">
          {djEffects.map((effect) => (
            <button type="button" key={effect.id} onClick={() => addDjEffect(effect.id)}>
              <strong>{effect.label}</strong>
              <span>{effect.description}</span>
            </button>
          ))}
        </div>
        <div className="dj-active-chain">
          <div className="plugin-rack-header">
            <span>Live Deck Chain</span>
            <strong>{activeDeckProcessing.pluginChain.length}</strong>
          </div>
          {activeDeckProcessing.pluginChain.length === 0 && (
            <small className="plugin-empty">Add a DJ effect to shape Deck {activeDeck} before the master mix.</small>
          )}
          {activeDeckProcessing.pluginChain.map((plugin) => {
            const key = pluginChainKey(plugin);
            const parameters = normalizePluginParameters(plugin.parameters);
            return (
              <article className={`dj-chain-item ${plugin.bypassed ? 'bypassed' : ''}`} key={key}>
                <span>
                  <strong>{plugin.name}</strong>
                  <small>{plugin.format || 'Effect'} | {parameters.presetName}</small>
                </span>
                <label>
                  <small>Mix</small>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={parameters.wetDry}
                    onChange={(event) => setDeckPluginParameter(activeDeck, key, 'wetDry', Number(event.target.value))}
                  />
                  <strong>{parameters.wetDry}%</strong>
                </label>
                <div>
                  <button type="button" onClick={() => toggleDeckPluginBypass(activeDeck, key)}>
                    {plugin.bypassed ? 'Enable' : 'Bypass'}
                  </button>
                  <button type="button" onClick={() => removeDeckPlugin(activeDeck, key)}>Remove</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <details className="advanced-plugin-hosting">
        <summary>
          <span>
            <strong>Advanced Plugin Hosting</strong>
            <small>Scan and stage local VST2/VST3 plugins after the DJ effects rack.</small>
          </span>
          <SlidersHorizontal size={16} />
        </summary>
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
          pluginPresets={pluginPresets}
          savePluginPreset={saveDeckPluginPreset}
          applyPluginPreset={applyDeckPluginPreset}
          deletePluginPreset={deleteDeckPluginPreset}
        />
      </details>
    </main>
  );
}

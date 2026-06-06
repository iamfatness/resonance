import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BadgeInfo,
  Copy,
  Disc3,
  Drum,
  Gauge,
  Guitar,
  KeyboardMusic,
  Mic2,
  Moon,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  SunMedium,
  Trash2,
  WandSparkles,
  Zap,
} from 'lucide-react';
import { bands, moodPresets } from '../lib/presets.js';

const moodPresetIcons = {
  Focus: Gauge,
  Lift: SunMedium,
  Warmth: Sparkles,
  Drive: Zap,
  Night: Moon,
};

const instrumentMeta = {
  Vocal: { icon: Mic2, band: '1k-4k' },
  Bass: { icon: Disc3, band: '62-125' },
  Drums: { icon: Drum, band: '125-2k' },
  Guitar: { icon: Guitar, band: '250-4k' },
  Synth: { icon: KeyboardMusic, band: '500-4k' },
  Strings: { icon: WandSparkles, band: '1k-8k' },
};

export function EqPanel({
  panelRef,
  activePreset,
  preset,
  deckVolumes,
  isSingleDeck,
  appEqBypassed,
  setAppEqBypassed,
  eqMode,
  changeEqMode,
  applyMoodPreset,
  activeInputDeck,
  activeDeckProcessing,
  resetDeckEq,
  toggleDeckEqBypass,
  setDeckEqBand,
  pluginCatalog,
  addDeckPlugin,
  removeDeckPlugin,
  moveDeckPlugin,
  duplicateDeckPlugin,
  resetDeckPluginParameters,
  toggleDeckPlugin,
  toggleDeckPluginBypass,
  setDeckPluginParameter,
  instrumentBoosts,
  setInstrumentBoost,
  eqPath,
  processedCurve,
  manualCurve,
  resetManualCurve,
  setManualBand,
}) {
  const [pluginFilter, setPluginFilter] = useState('all');
  const [pluginSort, setPluginSort] = useState('status');
  const pluginChain = useMemo(() => activeDeckProcessing.pluginChain || [], [activeDeckProcessing.pluginChain]);
  const pluginStatus = (plugin) => {
    if (plugin.executable === true || plugin.format === 'NativeDSP') return 'ready';
    if (plugin.sandboxLoad?.status || plugin.loaderStatus === 'metadata-loaded') return 'sandbox';
    if (plugin.executable === false) return 'blocked';
    return 'ready';
  };
  const filteredPlugins = useMemo(() => {
    const selectedIds = new Set(pluginChain.map((plugin) => plugin.id));
    const statusWeight = { ready: 0, sandbox: 1, blocked: 2 };
    return pluginCatalog
      .filter((plugin) => {
        if (pluginFilter === 'active') return selectedIds.has(plugin.id);
        if (pluginFilter === 'built-in') return plugin.format === 'NativeDSP';
        if (pluginFilter === 'vst3') return plugin.format === 'VST3';
        if (pluginFilter === 'waves') return plugin.vendor === 'Waves' || plugin.format === 'WavesShell';
        if (pluginFilter === 'blocked') return plugin.executable === false;
        return true;
      })
      .sort((a, b) => {
        if (pluginSort === 'name') return a.name.localeCompare(b.name);
        if (pluginSort === 'vendor') return `${a.vendor} ${a.name}`.localeCompare(`${b.vendor} ${b.name}`);
        return (statusWeight[pluginStatus(a)] ?? 3) - (statusWeight[pluginStatus(b)] ?? 3) || a.name.localeCompare(b.name);
      });
  }, [pluginCatalog, pluginChain, pluginFilter, pluginSort]);
  const pluginKey = (plugin) => plugin.instanceId || plugin.id;

  return (
    <aside className="eq-panel" ref={panelRef}>
      <section>
        <div className="panel-heading">
          <h2>Mood Presets</h2>
          <BadgeInfo size={16} />
        </div>
        <div className="preset-grid">
          {Object.keys(moodPresets).map((name) => {
            const Icon = moodPresetIcons[name];
            return (
              <button
                className={`preset-button ${activePreset === name ? 'active' : ''}`}
                key={name}
                onClick={() => applyMoodPreset(name)}
              >
                <Icon size={21} />
                <span>{name}</span>
              </button>
            );
          })}
        </div>
        <div className="preset-effect">
          <strong>{activePreset}</strong>
          <span>Deck A {deckVolumes.A}%</span>
          {!isSingleDeck && <span>Deck B {deckVolumes.B}%</span>}
          <span>EQ {appEqBypassed ? 'Bypassed' : eqMode}</span>
        </div>
      </section>

      <section>
        <div className="panel-heading">
          <h2>Deck {activeInputDeck} Processing</h2>
          <SlidersHorizontal size={16} />
        </div>
        <label className="eq-bypass-toggle">
          <input
            type="checkbox"
            checked={appEqBypassed}
            onChange={(event) => setAppEqBypassed(event.target.checked)}
          />
          <span>Bypass all app EQ</span>
          <strong>{appEqBypassed ? 'On' : 'Off'}</strong>
        </label>
        <div className="deck-processing-summary">
          <span>
            Pan{' '}
            {activeDeckProcessing.pan === 0
              ? 'Center'
              : activeDeckProcessing.pan < 0
                ? `L${Math.abs(activeDeckProcessing.pan)}`
                : `R${activeDeckProcessing.pan}`}
          </span>
          <span>EQ {activeDeckProcessing.eqBypassed ? 'Bypassed' : 'Active'}</span>
          <span>{activeDeckProcessing.pluginChain.length} plugins</span>
        </div>
        <div className="deck-eq-actions">
          <button type="button" onClick={() => resetDeckEq(activeInputDeck, preset.curve)}>
            Use preset EQ
          </button>
          <button type="button" onClick={() => resetDeckEq(activeInputDeck)}>
            Flat deck EQ
          </button>
          <button type="button" onClick={() => toggleDeckEqBypass(activeInputDeck)}>
            {activeDeckProcessing.eqBypassed ? 'Enable deck EQ' : 'Bypass deck EQ'}
          </button>
        </div>
        <div className="deck-eq-grid">
          {bands.map((band, index) => (
            <label className="deck-eq-band" key={band}>
              <span>{band} Hz</span>
              <input
                type="range"
                min="-12"
                max="12"
                step="0.5"
                value={activeDeckProcessing.curve[index]}
                onChange={(event) => setDeckEqBand(activeInputDeck, index, Number(event.target.value))}
                aria-label={`Deck ${activeInputDeck} ${band} Hz EQ`}
              />
              <strong>
                {activeDeckProcessing.curve[index] > 0 ? '+' : ''}
                {activeDeckProcessing.curve[index].toFixed(1)}
              </strong>
            </label>
          ))}
        </div>
      </section>

      <section>
        <div className="panel-heading">
          <h2>Deck {activeInputDeck} Plugins</h2>
          <SlidersHorizontal size={16} />
        </div>
        <div className="plugin-rack">
          <div className="plugin-rack-header">
            <span>Active Chain</span>
            <strong>{pluginChain.length}</strong>
          </div>
          {pluginChain.length === 0 && <small className="plugin-empty">No plugins staged on Deck {activeInputDeck}.</small>}
          {pluginChain.map((plugin, index) => {
            const key = pluginKey(plugin);
            const parameters = plugin.parameters || {
              enabled: true,
              wetDry: 100,
              inputGainDb: 0,
              outputGainDb: 0,
              presetName: 'Default',
            };
            return (
              <article className={`plugin-item active ${plugin.executable === false ? 'blocked-plugin' : ''}`} key={key}>
                <div className="plugin-item-header">
                  <span>
                    <strong>{index + 1}. {plugin.name}</strong>
                    <small>
                      {plugin.vendor} | {plugin.format || 'Plugin'} | {plugin.executable === false ? 'staged only' : 'active DSP'} | {parameters.presetName}
                    </small>
                  </span>
                  <button type="button" onClick={() => toggleDeckPluginBypass(activeInputDeck, key)}>
                    {plugin.bypassed ? 'Bypassed' : plugin.executable === false ? 'Staged' : 'Active'}
                  </button>
                </div>
                <div className="plugin-chain-actions">
                  <button type="button" onClick={() => moveDeckPlugin(activeInputDeck, key, -1)} disabled={index === 0} aria-label={`Move ${plugin.name} up`}><ArrowUp size={15} /></button>
                  <button type="button" onClick={() => moveDeckPlugin(activeInputDeck, key, 1)} disabled={index === pluginChain.length - 1} aria-label={`Move ${plugin.name} down`}><ArrowDown size={15} /></button>
                  <button type="button" onClick={() => duplicateDeckPlugin(activeInputDeck, key)} aria-label={`Duplicate ${plugin.name}`}><Copy size={15} /></button>
                  <button type="button" onClick={() => resetDeckPluginParameters(activeInputDeck, key)} aria-label={`Reset ${plugin.name} parameters`}><RotateCcw size={15} /></button>
                  <button type="button" onClick={() => removeDeckPlugin(activeInputDeck, key)} aria-label={`Remove ${plugin.name}`}><Trash2 size={15} /></button>
                </div>
                <div className="plugin-parameter-grid">
                  <label className="plugin-enable-toggle">
                    <input
                      type="checkbox"
                      checked={parameters.enabled !== false}
                      onChange={(event) => setDeckPluginParameter(activeInputDeck, key, 'enabled', event.target.checked)}
                    />
                    <span>Enabled</span>
                  </label>
                  <label>
                    <span>Wet/Dry</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={parameters.wetDry}
                      onChange={(event) => setDeckPluginParameter(activeInputDeck, key, 'wetDry', Number(event.target.value))}
                    />
                    <strong>{parameters.wetDry}%</strong>
                  </label>
                  <label>
                    <span>Input</span>
                    <input
                      type="range"
                      min="-24"
                      max="24"
                      step="0.5"
                      value={parameters.inputGainDb}
                      onChange={(event) => setDeckPluginParameter(activeInputDeck, key, 'inputGainDb', Number(event.target.value))}
                    />
                    <strong>{parameters.inputGainDb > 0 ? '+' : ''}{parameters.inputGainDb.toFixed(1)} dB</strong>
                  </label>
                  <label>
                    <span>Output</span>
                    <input
                      type="range"
                      min="-24"
                      max="24"
                      step="0.5"
                      value={parameters.outputGainDb}
                      onChange={(event) => setDeckPluginParameter(activeInputDeck, key, 'outputGainDb', Number(event.target.value))}
                    />
                    <strong>{parameters.outputGainDb > 0 ? '+' : ''}{parameters.outputGainDb.toFixed(1)} dB</strong>
                  </label>
                  <label className="plugin-preset-name">
                    <span>Preset</span>
                    <input
                      type="text"
                      value={parameters.presetName}
                      onChange={(event) => setDeckPluginParameter(activeInputDeck, key, 'presetName', event.target.value)}
                    />
                  </label>
                </div>
              </article>
            );
          })}
        </div>
        <div className="plugin-catalog-controls">
          <label>
            <span>Show</span>
            <select value={pluginFilter} onChange={(event) => setPluginFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="built-in">Built-in</option>
              <option value="vst3">VST3</option>
              <option value="waves">Waves</option>
              <option value="blocked">Blocked</option>
            </select>
          </label>
          <label>
            <span>Sort</span>
            <select value={pluginSort} onChange={(event) => setPluginSort(event.target.value)}>
              <option value="status">Status</option>
              <option value="name">Name</option>
              <option value="vendor">Vendor</option>
            </select>
          </label>
        </div>
        <div className="plugin-list">
          {filteredPlugins.map((plugin) => {
            const stagedCount = pluginChain.filter((item) => item.id === plugin.id).length;
            return (
              <article className={`plugin-item ${stagedCount ? 'active' : ''} ${plugin.executable === false ? 'blocked-plugin' : ''}`} key={plugin.id}>
                <div className="plugin-item-header">
                  <span>
                    <strong>{plugin.name}</strong>
                    <small>
                      {plugin.vendor} | {plugin.format || 'Plugin'}
                      {plugin.architecture ? ` | ${plugin.architecture}` : ''}
                      {plugin.executable === false ? ' | staged only' : ''}
                      {stagedCount ? ` | ${stagedCount} staged` : ''}
                    </small>
                  </span>
                  <button type="button" onClick={() => (addDeckPlugin ? addDeckPlugin(activeInputDeck, plugin.id) : toggleDeckPlugin(activeInputDeck, plugin.id))}>
                    Add
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section>
        <div className="panel-heading">
          <h2>Instrument Boost</h2>
          <BadgeInfo size={16} />
        </div>
        <div className="instrument-grid">
          {Object.entries(instrumentMeta).map(([name, meta]) => {
            const Icon = meta.icon;
            return (
              <label className="instrument" key={name}>
                <Icon size={20} />
                <span>{name}</span>
                <input
                  type="range"
                  min="-6"
                  max="6"
                  step="0.5"
                  value={instrumentBoosts[name]}
                  onInput={(event) => setInstrumentBoost(name, Number(event.currentTarget.value))}
                  onChange={(event) => setInstrumentBoost(name, Number(event.target.value))}
                  aria-label={`${name} instrument boost`}
                />
                <strong>
                  {instrumentBoosts[name] > 0 ? '+' : ''}
                  {instrumentBoosts[name].toFixed(1)} dB
                </strong>
                <small>{meta.band}</small>
              </label>
            );
          })}
        </div>
      </section>

      <section>
        <div className="panel-heading">
          <h2>8-Band Equalizer</h2>
          <select value={eqMode} onChange={(event) => changeEqMode(event.target.value)}>
            <option>Preset</option>
            <option>Manual</option>
          </select>
        </div>
        <div className="eq-graph">
          <svg viewBox="0 0 400 130" role="img" aria-label={`${eqMode} EQ curve with instrument boosts`}>
            <g className="grid-lines">
              {[20, 49, 78, 107].map((y) => (
                <line key={y} x1="0" x2="400" y1={y} y2={y} />
              ))}
              {[20, 71, 122, 173, 224, 275, 326, 377].map((x) => (
                <line key={x} x1={x} x2={x} y1="8" y2="118" />
              ))}
            </g>
            <path d={eqPath} className="eq-line" />
            {processedCurve.map((gain, index) => (
              <circle key={bands[index]} cx={20 + index * 51} cy={78 - (gain / 12) * 46} r="6" />
            ))}
          </svg>
          <div className="band-labels">
            {bands.map((band) => (
              <span key={band}>{band}</span>
            ))}
          </div>
        </div>
        <div className="manual-eq">
          <div className="manual-eq-header">
            <span>{eqMode === 'Manual' ? 'Manual base curve' : `${activePreset} base curve`}</span>
            <button type="button" onClick={resetManualCurve}>
              Flat manual
            </button>
          </div>
          <div className="manual-band-grid">
            {bands.map((band, index) => {
              const baseGain = eqMode === 'Manual' ? manualCurve[index] : preset.curve[index];
              return (
                <label className="manual-band" key={band}>
                  <span>{band}</span>
                  <input
                    className="manual-band-slider"
                    type="range"
                    min="-12"
                    max="12"
                    step="0.5"
                    value={baseGain}
                    onPointerDown={() => changeEqMode('Manual')}
                    onFocus={() => changeEqMode('Manual')}
                    onInput={(event) => setManualBand(index, Number(event.currentTarget.value))}
                    onChange={(event) => setManualBand(index, Number(event.target.value))}
                    aria-label={`${band} Hz manual EQ band`}
                  />
                  <div className="manual-band-values">
                    <input
                      className="manual-band-number"
                      type="number"
                      min="-12"
                      max="12"
                      step="0.5"
                      value={baseGain}
                      onFocus={() => changeEqMode('Manual')}
                      onInput={(event) => setManualBand(index, Number(event.currentTarget.value))}
                      onChange={(event) => setManualBand(index, Number(event.target.value))}
                      aria-label={`${band} Hz manual EQ dB value`}
                    />
                    <strong>
                      {processedCurve[index] > 0 ? '+' : ''}
                      {processedCurve[index].toFixed(1)} dB
                    </strong>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      </section>

      <div className="compat-note">
        <BadgeInfo size={18} />
        <p>
          EQ and instrument boosts process direct audio sources. YouTube iframe audio is isolated by the browser, so
          mood presets apply YouTube deck volumes plus preset guidance, while direct audio receives the real EQ curve.
        </p>
      </div>
    </aside>
  );
}

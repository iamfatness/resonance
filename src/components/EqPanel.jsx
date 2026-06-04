import {
  BadgeInfo,
  Disc3,
  Drum,
  Gauge,
  Guitar,
  KeyboardMusic,
  Mic2,
  Moon,
  SlidersHorizontal,
  Sparkles,
  SunMedium,
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
  toggleDeckPlugin,
  toggleDeckPluginBypass,
  instrumentBoosts,
  setInstrumentBoost,
  eqPath,
  processedCurve,
  manualCurve,
  resetManualCurve,
  setManualBand,
}) {
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
        <div className="plugin-list">
          {pluginCatalog.map((plugin) => {
            const selectedPlugin = activeDeckProcessing.pluginChain.find((item) => item.id === plugin.id);
            return (
              <article className={`plugin-item ${selectedPlugin ? 'active' : ''}`} key={plugin.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(selectedPlugin)}
                    onChange={() => toggleDeckPlugin(activeInputDeck, plugin.id)}
                  />
                  <span>
                    <strong>{plugin.name}</strong>
                    <small>{plugin.vendor}</small>
                  </span>
                </label>
                <button
                  type="button"
                  disabled={!selectedPlugin}
                  onClick={() => toggleDeckPluginBypass(activeInputDeck, plugin.id)}
                >
                  {selectedPlugin?.bypassed ? 'Bypassed' : selectedPlugin ? 'Active' : plugin.status}
                </button>
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

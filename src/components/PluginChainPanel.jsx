import { ArrowDown, ArrowUp, Copy, RotateCcw, SlidersHorizontal, Trash2 } from 'lucide-react';

export function PluginChainPanel({
  activeInputDeck,
  activeDeckProcessing,
  pluginCatalog,
  pluginFilter,
  setPluginFilter,
  pluginSort,
  setPluginSort,
  filteredPlugins,
  pluginScan,
  addDeckPlugin,
  removeDeckPlugin,
  moveDeckPlugin,
  duplicateDeckPlugin,
  resetDeckPluginParameters,
  toggleDeckPlugin,
  toggleDeckPluginBypass,
  setDeckPluginParameter,
  pluginPresets = {},
  savePluginPreset,
  applyPluginPreset,
  deletePluginPreset,
}) {
  const pluginChain = activeDeckProcessing.pluginChain || [];
  const pluginKey = (plugin) => plugin.instanceId || plugin.id;
  const parameterValue = (parameters, parameter) => {
    const current = parameters.pluginParameters?.[parameter.id];
    if (Number.isFinite(Number(current))) return Number(current);
    if (Number.isFinite(Number(parameter.defaultValue))) return Number(parameter.defaultValue);
    return Number.isFinite(Number(parameter.minimum)) ? Number(parameter.minimum) : 0;
  };
  const parameterBounds = (parameter) => {
    const min = Number.isFinite(Number(parameter.minimum)) ? Number(parameter.minimum) : 0;
    const max = Number.isFinite(Number(parameter.maximum)) ? Number(parameter.maximum) : 1;
    return { min, max: max > min ? max : min + 1 };
  };
  const setPluginExposedParameter = (deck, key, parameters, parameter, value) => {
    setDeckPluginParameter(deck, key, 'pluginParameters', {
      ...(parameters.pluginParameters || {}),
      [parameter.id]: value,
    });
  };

  return (
    <section>
      <div className="panel-heading">
        <h2>Deck {activeInputDeck} Effects Chain</h2>
        {pluginScan?.onRefresh ? (
          <button className="panel-action-button" type="button" onClick={pluginScan.onRefresh} disabled={pluginScan.status === 'scanning'}>
            {pluginScan.status === 'scanning' ? 'Scanning' : 'Scan this computer'}
          </button>
        ) : (
          <SlidersHorizontal size={16} />
        )}
      </div>
      {pluginScan && (
        <div className="plugin-scan-summary">
          <span>{pluginScan.count || 0} local VST plugins</span>
          <small>
            {pluginScan.formats || 'VST2, VST3'} | scan {pluginScan.status || 'idle'}
            {pluginScan.bridgeStatus ? ` | bridge ${pluginScan.bridgeStatus}` : ''}
            {pluginScan.bridgeParameterLoadedCount ? ` | ${pluginScan.bridgeParameterLoadedCount} parameter loaded` : ''}
            {pluginScan.bridgeLoadedCount ? ` | ${pluginScan.bridgeLoadedCount} loaded` : ''}
          </small>
        </div>
      )}
      <div className="plugin-rack">
        <div className="plugin-rack-header">
          <span>Active Chain</span>
          <strong>{pluginChain.length}</strong>
        </div>
        {pluginChain.length === 0 && <small className="plugin-empty">No effects staged on Deck {activeInputDeck}.</small>}
        {pluginChain.map((plugin, index) => {
          const key = pluginKey(plugin);
          const savedPresets = Array.isArray(pluginPresets[plugin.id]) ? pluginPresets[plugin.id] : [];
          const parameters = plugin.parameters || {
            enabled: true,
            wetDry: 100,
            inputGainDb: 0,
            outputGainDb: 0,
            presetName: 'Default',
            pluginParameters: {},
          };
          const nativeLoad = plugin.nativeLoad || {};
          const exposedParameters = Array.isArray(plugin.exposedParameters) ? plugin.exposedParameters : [];
          return (
            <article className={`plugin-item active ${plugin.executable === false ? 'blocked-plugin' : ''}`} key={key}>
              <div className="plugin-item-header">
                <span>
                  <strong>{index + 1}. {plugin.name}</strong>
                  <small>
                    {plugin.vendor} | {plugin.format || 'Plugin'} | {nativeLoad.processingEnabled ? 'native loaded' : plugin.executable === false ? 'scan only' : 'active DSP'} | {parameters.presetName}
                  </small>
                  {nativeLoad.status && (
                    <small>
                      Bridge status: {nativeLoad.status}
                      {Number.isFinite(nativeLoad.parameterCount) ? ` | ${nativeLoad.parameterCount} params` : ''}
                      {nativeLoad.error ? ` | ${nativeLoad.error}` : ''}
                    </small>
                  )}
                  {plugin.executable === false && !nativeLoad.status && (
                    <small>Host status: staged only. Native VST loading is pending.</small>
                  )}
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
              {exposedParameters.length > 0 && (
                <div className="plugin-exposed-parameters">
                  <span>Plugin controls</span>
                  {exposedParameters.map((parameter) => {
                    const bounds = parameterBounds(parameter);
                    const value = parameterValue(parameters, parameter);
                    return (
                      <label key={parameter.id}>
                        <small>{parameter.name || parameter.id}</small>
                        <input
                          type="range"
                          min={bounds.min}
                          max={bounds.max}
                          step={parameter.kind === 'boolean' ? 1 : 0.001}
                          value={Math.max(bounds.min, Math.min(bounds.max, value))}
                          onChange={(event) => setPluginExposedParameter(activeInputDeck, key, parameters, parameter, Number(event.target.value))}
                        />
                        <strong>{parameter.kind === 'boolean' ? (value >= 0.5 ? 'On' : 'Off') : value.toFixed(3)}</strong>
                      </label>
                    );
                  })}
                </div>
              )}
              <div className="plugin-preset-actions">
                <button type="button" onClick={() => savePluginPreset?.(activeInputDeck, key)}>
                  Save preset
                </button>
                <select
                  value=""
                  onChange={(event) => {
                    if (event.target.value) applyPluginPreset?.(activeInputDeck, key, event.target.value);
                  }}
                  aria-label={`Recall preset for ${plugin.name}`}
                >
                  <option value="">Recall preset</option>
                  {savedPresets.map((preset) => (
                    <option value={preset.name} key={preset.name}>{preset.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => deletePluginPreset?.(activeInputDeck, key, parameters.presetName)}
                  disabled={!savedPresets.some((preset) => preset.name === parameters.presetName)}
                >
                  Delete
                </button>
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
            <option value="vst2">VST2</option>
            <option value="vst3">VST3</option>
            <option value="waves">Waves vendor</option>
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
                    {plugin.nativeLoad?.processingEnabled ? ' | native loaded' : plugin.executable === false ? ' | scan only' : ''}
                    {plugin.nativeLoad?.status && !plugin.nativeLoad?.processingEnabled ? ` | ${plugin.nativeLoad.status}` : ''}
                    {stagedCount ? ` | ${stagedCount} staged` : ''}
                  </small>
                  {plugin.nativeLoad?.error && <small>{plugin.nativeLoad.error}</small>}
                </span>
                <button type="button" onClick={() => (addDeckPlugin ? addDeckPlugin(activeInputDeck, plugin.id) : toggleDeckPlugin(activeInputDeck, plugin.id))}>
                  {plugin.executable === false ? 'Stage' : 'Add'}
                </button>
              </div>
            </article>
          );
        })}
        {pluginCatalog.length === 0 && <small className="plugin-empty">No plugins are available. Scan this computer to find VST2/VST3 plugins.</small>}
      </div>
    </section>
  );
}

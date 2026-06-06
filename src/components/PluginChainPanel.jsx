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
}) {
  const pluginChain = activeDeckProcessing.pluginChain || [];
  const pluginKey = (plugin) => plugin.instanceId || plugin.id;

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
          <small>{pluginScan.formats || 'VST2, VST3'} | {pluginScan.status || 'idle'}</small>
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
                    {plugin.vendor} | {plugin.format || 'Plugin'} | {plugin.executable === false ? 'scan only' : 'active DSP'} | {parameters.presetName}
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
                    {plugin.executable === false ? ' | scan only' : ''}
                    {stagedCount ? ` | ${stagedCount} staged` : ''}
                  </small>
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

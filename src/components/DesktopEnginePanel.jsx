function formatPlaybackTime(ms = 0) {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function sourceLabel(sourceType) {
  if (sourceType === 'wav') return 'Native processing active';
  if (sourceType === 'pcm') return 'Native PCM active';
  if (sourceType === 'loopback') return 'Capture processing active';
  if (sourceType === 'virtual-device') return 'Virtual capture active';
  return 'No native source';
}

function sourceTone(sourceType) {
  if (sourceType === 'wav' || sourceType === 'pcm' || sourceType === 'loopback' || sourceType === 'virtual-device') return 'ready';
  return 'idle';
}

function vst3Label(route) {
  const status = route?.vst3Status || 'disabled';
  if (status === 'processing') return 'VST3 bridge active';
  if (status === 'pending') return 'VST3 bridge pending';
  if (status === 'disabled') return 'NativeDSP fallback';
  if (status.includes('fallback')) return 'VST3 fallback';
  if (status.includes('failed') || status.includes('empty')) return 'VST3 degraded';
  return `VST3 ${status}`;
}

function vst3Tone(route) {
  const status = route?.vst3Status || 'disabled';
  if (status === 'processing') return 'ready';
  if (status === 'pending') return 'manual';
  if (status === 'disabled') return 'idle';
  return 'blocked';
}

export function DesktopEnginePanel({
  engine,
  latencyProfile = 'balanced',
  bufferMs = 80,
  onLatencyProfileChange,
  onBufferMsChange,
}) {
  if (!engine.isDesktop) return null;

  const state = engine.state || { status: 'starting', devices: { inputs: [], outputs: [] } };
  const meters = engine.meters || { inputPeak: 0, outputPeak: 0, inputRms: 0, outputRms: 0, clipping: false };
  const inputs = state.devices?.inputs || [];
  const outputs = state.devices?.outputs || [];
  const diagnostics = state.diagnostics?.checks || [];
  const routes = state.router?.routes || [];
  const playbackDecks = state.playbackDecks || {};
  const latency = state.router?.latency || {};
  const nativeLatency = latency.native || state.router?.nativeSnapshot?.latency;

  return (
    <section className="desktop-engine-panel">
      <div className="panel-heading">
        <h2>Desktop Audio Engine</h2>
        <span>{state.status}</span>
      </div>
      <div className="engine-scan">
        <span>Devices: {state.deviceScan?.status || 'pending'}</span>
        <div>
          <button type="button" onClick={engine.refreshDevices}>Rescan</button>
          <button type="button" onClick={() => engine.exportDiagnostics?.()}>Export Diagnostics</button>
        </div>
      </div>
      {state.lastDiagnosticsExport && (
        <small className={`engine-export-status ${state.lastDiagnosticsExport.status}`}>
          Diagnostics {state.lastDiagnosticsExport.status}
          {state.lastDiagnosticsExport.path ? `: ${state.lastDiagnosticsExport.path}` : ''}
          {state.lastDiagnosticsExport.error ? `: ${state.lastDiagnosticsExport.error}` : ''}
        </small>
      )}
      <div className="engine-grid">
        <label>
          <span>Input</span>
          <select
            value={state.inputDeviceId || ''}
            onChange={(event) => engine.selectDevices({ inputDeviceId: event.target.value })}
          >
            <option value="">Select input</option>
            {inputs.map((device) => (
              <option value={device.id} key={device.id} disabled={!device.available}>
                {device.name}{device.available ? '' : ' (not installed)'}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Output</span>
          <select
            value={state.outputDeviceId || 'default-output'}
            onChange={(event) => engine.selectDevices({ outputDeviceId: event.target.value })}
          >
            {outputs.map((device) => (
              <option value={device.id} key={device.id}>{device.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Latency</span>
          <select
            value={latencyProfile}
            onChange={(event) => onLatencyProfileChange?.(event.target.value)}
          >
            <option value="low">Low - 30 ms</option>
            <option value="balanced">Balanced - 80 ms</option>
            <option value="stable">Stable - 160 ms</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label>
          <span>Buffer ms</span>
          <input
            type="number"
            min="20"
            max="500"
            step="5"
            value={bufferMs}
            disabled={latencyProfile !== 'custom'}
            onChange={(event) => onBufferMsChange?.(Math.max(20, Math.min(500, Number(event.target.value) || 80)))}
          />
        </label>
      </div>
      <div className="engine-actions">
        <button type="button" onClick={engine.start} disabled={state.status === 'running'}>Start Engine</button>
        <button type="button" onClick={engine.stop} disabled={state.status !== 'running'}>Stop</button>
        <button type="button" onClick={() => engine.renderSilence?.(250)}>Render Silence</button>
        <button type="button" onClick={() => engine.renderTone?.(250)}>Render Tone</button>
      </div>
      <div className="wav-render-panel">
        <div className="wav-render-list">
          {['A', 'B'].map((deck) => {
            const deckState = playbackDecks[deck] || {};
            const durationMs = deckState.durationMs || 0;
            const positionMs = deckState.positionMs || 0;
            const isPlaying = deckState.status === 'playing';
            const isCapturing = Boolean(deckState.captureStreaming);
            const hasDeckSource = Boolean(deckState.path || deckState.source || deckState.sourceType === 'pcm' || deckState.sourceType === 'loopback' || deckState.sourceType === 'virtual-device' || isCapturing);
            const captureDeviceId = state.inputDeviceId && state.inputDeviceId !== 'mock-input' ? state.inputDeviceId : state.outputDeviceId;
            return (
              <div className="wav-playback-row" key={deck}>
                <span>Deck {deck} WAV</span>
                <strong>{deckState.name || (deck === 'A' ? engine.deckAWav?.name : engine.deckBWav?.name) || 'No file selected'}</strong>
                <div className="wav-playback-controls">
                  <button type="button" onClick={deck === 'A' ? engine.selectDeckAWav : engine.selectDeckBWav}>Choose {deck}</button>
                  <button type="button" onClick={() => (isPlaying ? engine.pauseDeck(deck) : engine.playDeck(deck))} disabled={!hasDeckSource}>
                    {isPlaying ? 'Pause' : 'Play'}
                  </button>
                  <button type="button" onClick={() => engine.stopDeck(deck)} disabled={!hasDeckSource}>Stop</button>
                  <button
                    type="button"
                    onClick={() => (isCapturing
                      ? engine.stopDeckCapture?.({ deck })
                      : engine.startDeckCapture?.({ deck, deviceId: captureDeviceId }))}
                    disabled={state.status !== 'running'}
                  >
                    {isCapturing ? 'Stop Capture' : 'Start Capture'}
                  </button>
                </div>
                <label className="wav-playback-seek">
                  <small>{formatPlaybackTime(positionMs)} / {durationMs ? formatPlaybackTime(durationMs) : '--:--'}</small>
                  <input
                    type="range"
                    min="0"
                    max={Math.max(1, durationMs)}
                    value={Math.min(positionMs, Math.max(1, durationMs))}
                    disabled={!deckState.path}
                    onChange={(event) => engine.seekDeck(deck, Number(event.target.value))}
                    aria-label={`Deck ${deck} WAV position`}
                  />
                </label>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => engine.renderWav?.({ deckAPath: engine.deckAWav?.path, deckBPath: engine.deckBWav?.path, durationMs: 1000 })}
          disabled={!engine.deckAWav?.path}
        >
          Render WAV Mix
        </button>
      </div>
      <div className="engine-meter-grid">
        <div className="engine-meter">
          <span>Input</span>
          <div><i style={{ width: `${Math.round((meters.inputPeak || 0) * 100)}%` }} /></div>
          <strong>{Math.round((meters.inputPeak || 0) * 100)}%</strong>
        </div>
        <div className={`engine-meter ${meters.clipping ? 'clipping' : ''}`}>
          <span>Output</span>
          <div><i style={{ width: `${Math.round((meters.outputPeak || 0) * 100)}%` }} /></div>
          <strong>{Math.round((meters.outputPeak || 0) * 100)}%</strong>
        </div>
      </div>
      <div className="deck-bus-grid">
        {['A', 'B'].map((deck) => {
          const deckMeter = meters.decks?.[deck] || { inputPeak: 0, outputPeak: 0, leftPeak: 0, rightPeak: 0, pan: 0, pluginCount: 0, eqActivity: 0 };
          const nativeRoute = state.router?.nativeSnapshot?.routes?.find((candidate) => candidate.deck === deck);
          const route = nativeRoute || routes.find((candidate) => candidate.deck === deck);
          const source = state.router?.nativeSnapshot?.sources?.find((candidate) => candidate.deck === deck);
          const sourceType = source?.sourceType || playbackDecks[deck]?.sourceType || 'empty';
          return (
            <div className="deck-bus-meter" key={deck}>
              <div>
                <strong>Deck {deck} Bus</strong>
                <div className="route-chip-row">
                  <span className={`route-chip ${sourceTone(sourceType)}`}>{sourceLabel(sourceType)}</span>
                  <span className={`route-chip ${vst3Tone(route)}`}>{vst3Label(route)}</span>
                </div>
                <span>Pan {deckMeter.pan === 0 ? 'C' : deckMeter.pan < 0 ? `L${Math.abs(deckMeter.pan)}` : `R${deckMeter.pan}`} | EQ {Math.round((deckMeter.eqActivity || 0) * 100)}% | {deckMeter.pluginCount || 0} plugins</span>
                {route && <small>{route.status} route: {route.source} to {route.destination}</small>}
                {route?.vst3Status && (
                  <small>
                    VST3 {route.vst3Status}
                    {Number.isFinite(route.vst3BlocksProcessed) ? ` | blocks ${route.vst3BlocksProcessed}` : ''}
                    {route.vst3Failures ? ` | failures ${route.vst3Failures}` : ''}
                  </small>
                )}
                {source && (
                  <small>
                    Source {source.sourceType || 'empty'}
                    {source.captureStreaming ? ' | capturing' : ''}
                    {Number.isFinite(source.pcmQueuedFrames) ? ` | queue ${source.pcmQueuedFrames}` : ''}
                    {source.pcmUnderruns ? ` | underruns ${source.pcmUnderruns}` : ''}
                  </small>
                )}
              </div>
              <label>
                <span>In</span>
                <i><b style={{ width: `${Math.round((deckMeter.inputPeak || 0) * 100)}%` }} /></i>
              </label>
              <label>
                <span>L</span>
                <i><b style={{ width: `${Math.round((deckMeter.leftPeak || 0) * 100)}%` }} /></i>
              </label>
              <label>
                <span>R</span>
                <i><b style={{ width: `${Math.round((deckMeter.rightPeak || 0) * 100)}%` }} /></i>
              </label>
            </div>
          );
        })}
      </div>
      {state.router && (
        <div className="router-status">
          <div>
            <span>Router</span>
            <strong>{state.router.backend}</strong>
          </div>
          <small>{state.router.note}</small>
          {state.router.nativeSnapshot?.buffer && (
            <small>
              Native buffer: {state.router.nativeSnapshot.buffer.frames} frames, {Math.round(state.router.nativeSnapshot.buffer.durationMs)} ms at {state.router.nativeSnapshot.format?.sampleRate || 'unknown'} Hz
            </small>
          )}
          {(latency.profile || nativeLatency) && (
            <small>
              Latency: {latency.profile || nativeLatency?.profile || 'balanced'} {latency.bufferMs || nativeLatency?.requestedBufferMs || 80} ms
              {nativeLatency?.actualBufferMs ? ` | actual ${Math.round(nativeLatency.actualBufferMs)} ms` : ''}
              {nativeLatency?.restartRequired ? ' | restart required' : ''}
            </small>
          )}
          {state.router.nativeSnapshot?.render && (
            <small>
              {state.router.nativeSnapshot.render.type === 'tone' ? 'Tone' : state.router.nativeSnapshot.render.type === 'wav' ? 'WAV' : 'Silence'} render: {state.router.nativeSnapshot.render.framesWritten} frames in {state.router.nativeSnapshot.render.elapsedMs} ms, {state.router.nativeSnapshot.render.underruns} underruns
            </small>
          )}
          {state.router.nativeSnapshot?.render?.type === 'tone' && (
            <small>
              Master peak L {Math.round((state.router.nativeSnapshot.render.masterPeakLeft || 0) * 100)}% / R {Math.round((state.router.nativeSnapshot.render.masterPeakRight || 0) * 100)}%
            </small>
          )}
          {state.router.nativeSnapshot?.render?.type === 'wav' && state.router.nativeSnapshot?.source && (
            <small>
              WAV source: {state.router.nativeSnapshot.source.sampleRate} Hz, {state.router.nativeSnapshot.source.channels} ch, {state.router.nativeSnapshot.source.frames} frames
            </small>
          )}
          {state.router.nativeSnapshot?.render?.type === 'wav' && state.router.nativeSnapshot?.sources?.length > 1 && (
            <small>
              WAV mix: {state.router.nativeSnapshot.sources.map((source) => `Deck ${source.deck} ${source.sampleRate} Hz/${source.channels} ch`).join(' | ')}
            </small>
          )}
          {state.router.nativeSnapshot?.routes?.some((route) => route.eqLinear) && (
            <small>
              Native EQ A {Math.round(((state.router.nativeSnapshot.routes.find((route) => route.deck === 'A')?.eqLinear || 1) - 1) * 100)}% / B {Math.round(((state.router.nativeSnapshot.routes.find((route) => route.deck === 'B')?.eqLinear || 1) - 1) * 100)}%
            </small>
          )}
          {state.router.nativeSnapshot?.routes?.some((route) => Array.isArray(route.eqBandsDb)) && (
            <small>
              Native 8-band EQ A {Math.max(...(state.router.nativeSnapshot.routes.find((route) => route.deck === 'A')?.eqBandsDb || [0])).toFixed(1)} dB / B {Math.max(...(state.router.nativeSnapshot.routes.find((route) => route.deck === 'B')?.eqBandsDb || [0])).toFixed(1)} dB
            </small>
          )}
        </div>
      )}
      <p>
        The engine is running in {state.mode || 'mock'} mode. Local WAV, pushed PCM, and capture streams are routed through native Deck A/B processing; browser YouTube iframes remain mix-only unless captured through another path.
      </p>
      {state.pluginHost && (
        <div className="plugin-host-status">
          <span>Plugin host</span>
          <strong>{state.pluginHost.status}</strong>
          <button type="button" onClick={() => engine.refreshPlugins?.()} disabled={state.pluginHost.scanStatus === 'scanning'}>
            {state.pluginHost.scanStatus === 'scanning' ? 'Scanning' : 'Rescan'}
          </button>
          <small>
            {state.pluginHost.pluginCount || 0} candidates | NativeDSP active, {(state.pluginHost.supportedFormats || []).join(', ') || 'VST2, VST3'} bridge checked | {state.settings?.appEqBypassed ? 'App EQ bypassed' : `${Object.values(state.settings?.deckProcessing || {}).reduce((count, deck) => count + (deck.pluginChain?.length || 0), 0)} deck plugins staged`}
          </small>
          {state.pluginHost.helper && (
            <small>
              Helper {state.pluginHost.helper.status}
              {state.pluginHost.helper.protocolVersion ? ` | protocol v${state.pluginHost.helper.protocolVersion}` : ''}
              {state.pluginHost.chainPlan?.decks ? ` | A ${state.pluginHost.chainPlan.decks.A.hostMode}, B ${state.pluginHost.chainPlan.decks.B.hostMode}` : ''}
            </small>
          )}
          {state.pluginHost.loaderPrototype && (
            <small>
              VST3 loader {state.pluginHost.loaderPrototype.status}
              {state.pluginHost.loaderPrototype.loadedPlugin?.name ? ` | ${state.pluginHost.loaderPrototype.loadedPlugin.name}` : ''}
              {Number.isFinite(state.pluginHost.loaderPrototype.parameterCount) ? ` | ${state.pluginHost.loaderPrototype.parameterCount} params` : ''}
            </small>
          )}
          {state.pluginHost.nativeBridge && (
            <small>
              Native VST3 bridge {state.pluginHost.nativeBridge.status}
              {state.pluginHost.nativeBridge.sdk?.found ? ' | SDK ready' : ' | SDK missing'}
            </small>
          )}
          {state.pluginHost.nativeBridgeClient && (
            <small>
              Bridge probe {state.pluginHost.nativeBridgeClient.status}
              {Number.isFinite(state.pluginHost.nativeBridgeClient.probedCount) ? ` | ${state.pluginHost.nativeBridgeClient.probedCount} probed` : ''}
              {Number.isFinite(state.pluginHost.nativeBridgeClient.parameterLoadedCount) ? ` | ${state.pluginHost.nativeBridgeClient.parameterLoadedCount} parameter loaded` : ''}
              {Number.isFinite(state.pluginHost.nativeBridgeClient.loadedCount) ? ` | ${state.pluginHost.nativeBridgeClient.loadedCount} loaded` : ''}
            </small>
          )}
          {state.pluginHost.candidates?.length > 0 && (
            <small>
              Found: {state.pluginHost.candidates.slice(0, 3).map((plugin) => plugin.name).join(', ')}
              {state.pluginHost.pluginCount > 3 ? ` +${state.pluginHost.pluginCount - 3} more` : ''}
            </small>
          )}
          {state.pluginHost.note && <small>{state.pluginHost.note}</small>}
        </div>
      )}
      {diagnostics.length > 0 && (
        <div className="engine-diagnostics">
          <div className="engine-diagnostics-header">
            <span>Desktop readiness</span>
            <small>{state.diagnostics?.updatedAt ? new Date(state.diagnostics.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'pending'}</small>
          </div>
          <div className="engine-diagnostic-list">
            {diagnostics.map((check) => (
              <article className={`engine-diagnostic ${check.status}`} key={check.id}>
                <strong>{check.label}</strong>
                <span>{check.status}</span>
                <small>{check.detail}</small>
                {check.nextAction && <small>Next: {check.nextAction}</small>}
              </article>
            ))}
          </div>
        </div>
      )}
      {state.deviceScan?.error && <p className="engine-error">{state.deviceScan.error}</p>}
    </section>
  );
}



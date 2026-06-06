export const basePluginCatalog = [
  {
    id: 'resonance-native-drive',
    name: 'Resonance Native Drive',
    vendor: 'Resonance',
    format: 'NativeDSP',
    loadStrategy: 'native-dsp',
    executable: true,
    status: 'NativeDSP',
    parameters: {
      enabled: true,
      wetDry: 100,
      inputGainDb: 0,
      outputGainDb: 0,
      presetName: 'Default',
    },
  },
];

export const defaultPluginParameters = {
  enabled: true,
  wetDry: 100,
  inputGainDb: 0,
  outputGainDb: 0,
  presetName: 'Default',
};

export function normalizePluginParameters(parameters = {}) {
  const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  };

  return {
    enabled: parameters.enabled !== false,
    wetDry: clamp(parameters.wetDry, 0, 100, defaultPluginParameters.wetDry),
    inputGainDb: clamp(parameters.inputGainDb, -24, 24, defaultPluginParameters.inputGainDb),
    outputGainDb: clamp(parameters.outputGainDb, -24, 24, defaultPluginParameters.outputGainDb),
    presetName: typeof parameters.presetName === 'string' && parameters.presetName.trim()
      ? parameters.presetName.trim().slice(0, 80)
      : defaultPluginParameters.presetName,
  };
}

export function pluginChainKey(plugin) {
  return plugin.instanceId || plugin.id;
}

export function normalizeDesktopPluginCandidate(candidate) {
  return {
    id: candidate.id,
    name: candidate.name || 'Unknown plugin',
    vendor: candidate.vendor || 'Unknown',
    format: candidate.format || 'Unknown',
    architecture: candidate.architecture || 'unknown',
    shellType: candidate.shellType || 'unknown',
    loadStrategy: candidate.loadStrategy || 'third-party-candidate',
    path: candidate.path,
    executable: Boolean(candidate.executable),
    stageable: candidate.stageable !== false,
    status: candidate.executable ? 'Ready' : 'Scan only',
    note: candidate.note,
    parameters: normalizePluginParameters(candidate.parameters),
  };
}

export function buildPluginCatalog(candidates = []) {
  const discoveredPlugins = candidates
    .map(normalizeDesktopPluginCandidate)
    .filter((plugin) => plugin.id);
  const seen = new Set();
  return [...basePluginCatalog, ...discoveredPlugins].filter((plugin) => {
    if (seen.has(plugin.id)) return false;
    seen.add(plugin.id);
    return true;
  });
}

export function pluginStatus(plugin) {
  if (plugin.executable === true || plugin.format === 'NativeDSP') return 'ready';
  if (plugin.sandboxLoad?.status || plugin.loaderStatus === 'metadata-loaded' || plugin.loaderStatus === 'metadata-ready') return 'sandbox';
  if (plugin.executable === false) return 'blocked';
  return 'ready';
}

export function filterPluginCatalog(pluginCatalog = [], pluginChain = [], pluginFilter = 'all', pluginSort = 'status') {
  const selectedIds = new Set(pluginChain.map((plugin) => plugin.id));
  const statusWeight = { ready: 0, sandbox: 1, blocked: 2 };
  return pluginCatalog
    .filter((plugin) => {
      if (pluginFilter === 'active') return selectedIds.has(plugin.id);
      if (pluginFilter === 'built-in') return plugin.format === 'NativeDSP';
      if (pluginFilter === 'vst2') return plugin.format === 'VST2';
      if (pluginFilter === 'vst3') return plugin.format === 'VST3';
      if (pluginFilter === 'waves') return plugin.vendor === 'Waves';
      if (pluginFilter === 'blocked') return plugin.executable === false;
      return true;
    })
    .sort((a, b) => {
      if (pluginSort === 'name') return a.name.localeCompare(b.name);
      if (pluginSort === 'vendor') return `${a.vendor} ${a.name}`.localeCompare(`${b.vendor} ${b.name}`);
      return (statusWeight[pluginStatus(a)] ?? 3) - (statusWeight[pluginStatus(b)] ?? 3) || a.name.localeCompare(b.name);
    });
}

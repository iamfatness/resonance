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
  pluginParameters: {},
};

export const PLUGIN_PRESET_STORAGE_KEY = 'resonance.pluginPresets.v1';

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
    pluginParameters: parameters.pluginParameters && typeof parameters.pluginParameters === 'object'
      ? Object.fromEntries(Object.entries(parameters.pluginParameters).map(([key, value]) => {
          const number = Number(value);
          return [key, Number.isFinite(number) ? number : 0];
        }))
      : {},
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
    status: candidate.nativeLoad?.status || (candidate.executable ? 'Ready' : 'Scan only'),
    note: candidate.note,
    nativeLoad: candidate.nativeLoad || null,
    exposedParameters: Array.isArray(candidate.nativeLoad?.parameters) ? candidate.nativeLoad.parameters : [],
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
  if (plugin.nativeLoad?.processingEnabled) return 'ready';
  if (plugin.nativeLoad?.status === 'probing') return 'probing';
  if (plugin.executable === true || plugin.format === 'NativeDSP') return 'ready';
  if (plugin.sandboxLoad?.status || plugin.loaderStatus === 'metadata-loaded' || plugin.loaderStatus === 'metadata-ready') return 'sandbox';
  if (plugin.executable === false) return 'blocked';
  return 'ready';
}

export function filterPluginCatalog(pluginCatalog = [], pluginChain = [], pluginFilter = 'all', pluginSort = 'status') {
  const selectedIds = new Set(pluginChain.map((plugin) => plugin.id));
  const statusWeight = { ready: 0, probing: 1, sandbox: 2, blocked: 3 };
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

function getBrowserStorage() {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function readPluginPresets(storage = getBrowserStorage()) {
  if (!storage) return {};
  try {
    const raw = storage.getItem(PLUGIN_PRESET_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writePluginPresets(presets, storage = getBrowserStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(PLUGIN_PRESET_STORAGE_KEY, JSON.stringify(presets || {}));
    return true;
  } catch {
    return false;
  }
}

export function presetsForPlugin(pluginPresets = {}, pluginId) {
  return Array.isArray(pluginPresets?.[pluginId]) ? pluginPresets[pluginId] : [];
}

export function savePluginPreset(pluginPresets = {}, plugin = {}, presetName, parameters = {}) {
  const name = typeof presetName === 'string' && presetName.trim() ? presetName.trim().slice(0, 80) : 'Default';
  const pluginId = plugin.id;
  if (!pluginId) return pluginPresets;
  const existing = presetsForPlugin(pluginPresets, pluginId).filter((preset) => preset.name !== name);
  return {
    ...pluginPresets,
    [pluginId]: [
      {
        name,
        pluginId,
        pluginName: plugin.name || 'Unknown plugin',
        vendor: plugin.vendor || 'Unknown',
        format: plugin.format || 'Unknown',
        parameters: normalizePluginParameters({ ...parameters, presetName: name }),
        savedAt: new Date().toISOString(),
      },
      ...existing,
    ].slice(0, 24),
  };
}

export function deletePluginPreset(pluginPresets = {}, pluginId, presetName) {
  if (!pluginId || !presetName) return pluginPresets;
  const nextPresets = presetsForPlugin(pluginPresets, pluginId).filter((preset) => preset.name !== presetName);
  return {
    ...pluginPresets,
    [pluginId]: nextPresets,
  };
}

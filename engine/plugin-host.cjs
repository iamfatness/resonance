const fs = require('node:fs');
const path = require('node:path');

const supportedFormats = ['VST3'];
const plannedVendors = ['Waves'];
const maxCandidates = 120;
const builtInRuntimePlugins = [
  {
    id: 'resonance-native-drive',
    name: 'Resonance Native Drive',
    vendor: 'Resonance',
    format: 'NativeDSP',
    loadable: true,
    note: 'Built-in per-deck DSP used to validate the plugin processing lane before VST3/Waves loading.',
  },
];

const stagedPluginRuntimeProfiles = {
  'vst3-generic': { gainDb: 1.5, drive: 1.08 },
  'waves-vst3': { gainDb: 2.25, drive: 1.16 },
};

function uniqueExisting(paths) {
  const seen = new Set();
  const result = [];
  for (const candidate of paths.filter(Boolean)) {
    const resolved = path.resolve(candidate);
    const key = resolved.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (fs.existsSync(resolved)) result.push(resolved);
  }
  return result;
}

function defaultScanRoots(env = process.env) {
  const roots = [
    path.join(env.ProgramFiles || 'C:\\Program Files', 'Common Files', 'VST3'),
    path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Common Files', 'VST3'),
    path.join(env.CommonProgramW6432 || 'C:\\Program Files\\Common Files', 'VST3'),
    path.join(env.ProgramFiles || 'C:\\Program Files', 'Waves'),
    path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Waves'),
    path.join(env.ProgramData || 'C:\\ProgramData', 'Waves Audio'),
  ];

  if (env.RESONANCE_PLUGIN_SCAN_PATHS) {
    roots.push(...env.RESONANCE_PLUGIN_SCAN_PATHS.split(path.delimiter).map((item) => item.trim()));
  }

  return uniqueExisting(roots);
}

function classifyCandidate(filePath, entryName) {
  const lowerName = entryName.toLowerCase();
  const lowerPath = filePath.toLowerCase();
  const isVst3 = lowerName.endsWith('.vst3');
  const isWaves = lowerName.includes('waves') || lowerPath.includes(`${path.sep.toLowerCase()}waves`);
  const isWavesShell = lowerName.includes('wavesshell');

  if (!isVst3 && !isWavesShell) return null;

  return {
    id: Buffer.from(filePath.toLowerCase()).toString('base64url'),
    name: entryName,
    vendor: isWaves ? 'Waves' : 'Unknown',
    format: isVst3 ? 'VST3' : 'WavesShell',
    path: filePath,
    loadable: false,
    note: isWavesShell
      ? 'Waves shell candidate detected; Resonance does not load plugin binaries yet.'
      : 'VST3 candidate detected; Resonance scan mode is read-only.',
  };
}

function scanDirectory(root, options, candidates, errors, depth = 0) {
  if (depth > options.maxDepth || candidates.length >= options.maxCandidates) return;

  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    errors.push({ path: root, error: error.message });
    return;
  }

  for (const entry of entries) {
    if (candidates.length >= options.maxCandidates) return;
    const entryPath = path.join(root, entry.name);
    const candidate = classifyCandidate(entryPath, entry.name);
    if (candidate) candidates.push(candidate);

    if (entry.isDirectory() && !entry.name.toLowerCase().endsWith('.vst3')) {
      scanDirectory(entryPath, options, candidates, errors, depth + 1);
    }
  }
}

function summarizeCandidates(candidates) {
  const byFormat = {};
  const byVendor = {};
  for (const candidate of candidates) {
    byFormat[candidate.format] = (byFormat[candidate.format] || 0) + 1;
    byVendor[candidate.vendor] = (byVendor[candidate.vendor] || 0) + 1;
  }
  return { byFormat, byVendor };
}

function scanPluginCandidates(options = {}) {
  const startedAt = new Date();
  const roots = uniqueExisting(options.roots || defaultScanRoots(options.env || process.env));
  const candidates = [];
  const errors = [];
  const scanOptions = {
    maxDepth: Number.isFinite(options.maxDepth) ? options.maxDepth : 5,
    maxCandidates: Number.isFinite(options.maxCandidates) ? options.maxCandidates : maxCandidates,
  };

  for (const root of roots) {
    scanDirectory(root, scanOptions, candidates, errors);
    if (candidates.length >= scanOptions.maxCandidates) break;
  }

  const endedAt = new Date();
  const summary = summarizeCandidates(candidates);
  return {
    status: 'scan-only',
    scannedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    supportedFormats,
    plannedVendors,
    roots,
    count: candidates.length,
    runtimePlugins: builtInRuntimePlugins,
    candidates,
    summary,
    errors,
    note: 'VST3/Waves discovery is read-only. Resonance can execute the built-in NativeDSP test processor for staged deck chains.',
    plannedRouting: 'Deck PCM -> native EQ or EQ bypass -> built-in NativeDSP plugin lane -> future sandboxed VST3/Waves host -> master bus.',
  };
}

function activeDeckPlugins(pluginChain = []) {
  return Array.isArray(pluginChain)
    ? pluginChain.filter((plugin) => plugin && !plugin.bypassed)
    : [];
}

function buildNativePluginSettings(pluginChain = []) {
  const activePlugins = activeDeckPlugins(pluginChain);
  const totals = activePlugins.reduce((settings, plugin) => {
    const profile = stagedPluginRuntimeProfiles[plugin.id] || { gainDb: 1, drive: 1.04 };
    return {
      pluginCount: settings.pluginCount + 1,
      pluginGainDb: settings.pluginGainDb + profile.gainDb,
      pluginDrive: Math.max(settings.pluginDrive, profile.drive),
      activePluginIds: [...settings.activePluginIds, plugin.id],
    };
  }, {
    pluginCount: 0,
    pluginGainDb: 0,
    pluginDrive: 1,
    activePluginIds: [],
  });

  return {
    pluginCount: totals.pluginCount,
    pluginGainDb: Math.max(-12, Math.min(12, Number(totals.pluginGainDb.toFixed(2)))),
    pluginDrive: Math.max(1, Math.min(3, Number(totals.pluginDrive.toFixed(2)))),
    activePluginIds: totals.activePluginIds,
  };
}

module.exports = {
  activeDeckPlugins,
  buildNativePluginSettings,
  builtInRuntimePlugins,
  defaultScanRoots,
  scanPluginCandidates,
  supportedFormats,
  plannedVendors,
};

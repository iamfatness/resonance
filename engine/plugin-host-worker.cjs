const readline = require('node:readline');
const {
  buildDeckPluginPlan,
  builtInRuntimePlugins,
  createSandboxPluginInstance,
  pluginHostCapabilities,
  pluginHostProtocolVersion,
  supportedFormats,
  plannedVendors,
} = require('./plugin-host.cjs');

const loadedPlugins = new Map();

function describe() {
  return {
    name: 'resonance-plugin-host',
    protocolVersion: pluginHostProtocolVersion,
    status: 'ready',
    mode: 'native-dsp-fallback',
    capabilities: pluginHostCapabilities,
    runtimePlugins: builtInRuntimePlugins,
    supportedFormats,
    plannedVendors,
    note: 'Helper process is ready for chain planning. Third-party VST2/VST3 binaries are not loaded yet.',
    loadedPluginCount: loadedPlugins.size,
  };
}

function respond(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function handleMessage(message = {}) {
  if (message.type === 'describe') {
    respond({ type: 'describe', requestId: message.requestId, ...describe() });
    return;
  }

  if (message.type === 'resolveChain') {
    respond({
      type: 'resolveChain',
      requestId: message.requestId,
      status: 'ready',
      plan: buildDeckPluginPlan(message.deckProcessing || {}),
    });
    return;
  }

  if (message.type === 'loadPlugin') {
    const instance = createSandboxPluginInstance(message.candidate || message.plugin || {}, {
      allowBinaryExecution: false,
    });
    if (instance.status === 'error') {
      respond({
        type: 'loadPlugin',
        requestId: message.requestId,
        status: 'error',
        error: instance.error,
      });
      return;
    }
    loadedPlugins.set(instance.id, instance);
    respond({
      type: 'loadPlugin',
      requestId: message.requestId,
      status: instance.status,
      plugin: instance,
    });
    return;
  }

  if (message.type === 'unloadPlugin') {
    const pluginId = message.pluginId || message.id;
    const existed = loadedPlugins.delete(pluginId);
    respond({
      type: 'unloadPlugin',
      requestId: message.requestId,
      status: existed ? 'unloaded' : 'not-loaded',
      pluginId,
    });
    return;
  }

  if (message.type === 'enumerateParameters') {
    const pluginId = message.pluginId || message.id;
    const plugin = loadedPlugins.get(pluginId);
    if (!plugin) {
      respond({
        type: 'enumerateParameters',
        requestId: message.requestId,
        status: 'error',
        error: `Plugin is not loaded: ${pluginId || 'unknown'}`,
      });
      return;
    }
    respond({
      type: 'enumerateParameters',
      requestId: message.requestId,
      status: 'ready',
      pluginId,
      parameters: plugin.parameters,
    });
    return;
  }

  if (message.type === 'exit') {
    respond({ type: 'exit', requestId: message.requestId, status: 'ok' });
    process.exit(0);
  }

  respond({
    type: 'error',
    requestId: message.requestId,
    status: 'error',
    error: `Unsupported plugin host command: ${message.type || 'unknown'}`,
  });
}

if (process.argv.includes('--describe')) {
  process.stdout.write(`${JSON.stringify(describe())}\n`);
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    handleMessage(JSON.parse(line));
  } catch (error) {
    respond({ type: 'error', status: 'error', error: error.message });
  }
});

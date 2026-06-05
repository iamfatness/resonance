const readline = require('node:readline');
const {
  buildDeckPluginPlan,
  builtInRuntimePlugins,
  pluginHostCapabilities,
  pluginHostProtocolVersion,
  supportedFormats,
  plannedVendors,
} = require('./plugin-host.cjs');

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
    note: 'Helper process is ready for chain planning. Third-party VST3/Waves binaries are not loaded yet.',
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

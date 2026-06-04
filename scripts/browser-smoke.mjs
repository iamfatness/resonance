import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const DEFAULT_URL = 'http://127.0.0.1:4174/app';

function getArgValue(name) {
  const prefix = `${name}=`;
  const inlineValue = process.argv.find((arg) => arg.startsWith(prefix));
  if (inlineValue) return inlineValue.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function tinyWavBuffer() {
  const sampleRate = 8000;
  const samples = 800;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    const sample = Math.sin((index / sampleRate) * 440 * Math.PI * 2) * 0.2;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
  }
  return buffer;
}

async function waitForServer(url, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite preview is still starting.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for preview server at ${url}`);
}

async function startPreviewServer(url) {
  const parsedUrl = new URL(url);
  const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const child = spawn(
    process.execPath,
    [
      viteBin,
      'preview',
      '--host',
      parsedUrl.hostname,
      '--port',
      parsedUrl.port || '4174',
      '--strictPort',
    ],
    {
      cwd: repoRoot,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

  await waitForServer(url);
  return child;
}

async function runSmoke(url) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('text=RESONANCE', { timeout: 15000 });
  await page.waitForSelector('text=DECK A', { timeout: 15000 });
  await page.waitForSelector('text=UPLOAD / PASTE AUDIO', { timeout: 15000 });

  const bodyText = await page.locator('body').innerText();
  for (const expectedText of ['RESONANCE', 'Deck A', 'Upload / Paste Audio', 'Mood Presets']) {
    if (!bodyText.toLowerCase().includes(expectedText.toLowerCase())) {
      throw new Error(`Rendered page did not include expected text: ${expectedText}`);
    }
  }

  await page.locator('input[type=file]').setInputFiles({
    name: 'smoke.wav',
    mimeType: 'audio/wav',
    buffer: tinyWavBuffer(),
  });
  await page.waitForFunction(() => Boolean(document.querySelector('audio')?.src), null, {
    timeout: 10000,
  });

  if (pageErrors.length) {
    throw new Error(`Browser page errors:\n${pageErrors.join('\n')}`);
  }

  await browser.close();
}

const explicitUrl = getArgValue('--url');
const url = explicitUrl || DEFAULT_URL;
let previewServer;

try {
  if (!explicitUrl) {
    previewServer = await startPreviewServer(url);
  }
  await runSmoke(url);
  console.log(`Browser smoke passed: ${url}`);
} finally {
  if (previewServer) {
    previewServer.kill();
  }
}

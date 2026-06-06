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
  const context = await browser.newContext();
  await context.addInitScript(() => window.localStorage.clear());
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
  await page.route('**/api/youtube/playlist?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        title: 'Smoke Imported Playlist',
        items: [
          {
            id: 'playlist-one',
            title: 'Playlist One',
            channel: 'Smoke Channel',
            duration: '3:11',
            thumbnail: 'https://i.ytimg.com/vi/playlist-one/mqdefault.jpg',
          },
          {
            id: 'playlist-two',
            title: 'Playlist Two',
            channel: 'Smoke Channel',
            duration: '4:22',
            thumbnail: 'https://i.ytimg.com/vi/playlist-two/mqdefault.jpg',
          },
          {
            id: 'playlist-two',
            title: 'Playlist Two Duplicate',
            channel: 'Smoke Channel',
            duration: '4:22',
            thumbnail: 'https://i.ytimg.com/vi/playlist-two/mqdefault.jpg',
          },
        ],
      }),
    });
  });

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

  await page.evaluate(() => {
    window.__resonanceSetSearchResults = () => {
      window.dispatchEvent(new CustomEvent('resonance-smoke-search-results', {
        detail: {
          message: 'Smoke search results',
          results: [
            {
              id: 'JD-kMIpDfnY',
              title: 'Smoke Result One',
              channel: 'Smoke Channel',
              duration: '3:21',
              thumbnail: 'https://i.ytimg.com/vi/JD-kMIpDfnY/mqdefault.jpg',
            },
            {
              id: 'wH2Nd8oHixo',
              title: 'Smoke Result Two',
              channel: 'Smoke Channel',
              duration: '4:56',
              thumbnail: 'https://i.ytimg.com/vi/wH2Nd8oHixo/mqdefault.jpg',
            },
          ],
        },
      }));
    };
  });
  await page.evaluate(() => window.__resonanceSetSearchResults());
  await page.waitForSelector('.youtube-search-panel.ready', { timeout: 10000 });
  const searchLayout = await page.evaluate(() => {
    const panel = document.querySelector('.youtube-search-panel');
    const upload = document.querySelector('.direct-source');
    const panelRect = panel.getBoundingClientRect();
    const uploadRect = upload.getBoundingClientRect();
    return {
      panelBottom: panelRect.bottom,
      uploadTop: uploadRect.top,
      overlap: panelRect.bottom > uploadRect.top,
    };
  });
  if (searchLayout.overlap) {
    throw new Error(`Search results overlap direct upload panel: ${JSON.stringify(searchLayout)}`);
  }

  const firstQueueButton = page.locator('.youtube-result').filter({ hasText: 'Smoke Result One' }).getByRole('button', { name: 'Queue' });
  await firstQueueButton.click();
  await firstQueueButton.click();
  await page.waitForSelector('.user-queue .queue-item.managed', { timeout: 10000 });
  const queuedSearchItems = await page.locator('.user-queue .queue-item.managed').count();
  if (queuedSearchItems !== 1) {
    throw new Error(`Expected search queue dedupe to leave 1 item, found ${queuedSearchItems}.`);
  }
  await page.getByRole('button', { name: 'Clear queue' }).click();

  const searchInput = page.locator('.searchbar input');
  await searchInput.fill('https://www.youtube.com/playlist?list=PLSMOKE');
  await page.locator('.searchbar button').click();
  await page.waitForSelector('text=skipped 1 duplicate', { timeout: 10000 });
  const importedQueueItems = await page.locator('.user-queue .queue-item.managed').count();
  if (importedQueueItems !== 1) {
    throw new Error(`Expected playlist import to queue 1 unique remaining item, found ${importedQueueItems}.`);
  }

  const mobilePage = await context.newPage();
  await mobilePage.setViewportSize({ width: 390, height: 844 });
  await mobilePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await mobilePage.waitForSelector('.mobile-playlists', { timeout: 10000 });
  const mobileDeckControls = await mobilePage.locator('.deck-count-control').boundingBox();
  const mobilePlaylistStrip = await mobilePage.locator('.mobile-playlist-strip').boundingBox();
  if (!mobileDeckControls || !mobilePlaylistStrip) {
    throw new Error('Mobile playlist or deck controls did not render.');
  }

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

import { defaultExtensionSettings } from './lib/presets.js';

const OFFSCREEN_DOCUMENT = 'offscreen.html';

let activeCapture = {
  tabId: null,
  active: false,
};

async function getSettings() {
  const stored = await chrome.storage.local.get('settings');
  return { ...defaultExtensionSettings, ...(stored.settings || {}) };
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

async function hasOffscreenDocument() {
  if (!chrome.runtime.getContexts) return false;
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT)],
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT,
    reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
    justification: 'Capture the current tab audio and route it through Web Audio EQ.',
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found.');
  return tab;
}

async function startCapture() {
  const tab = await getActiveTab();
  await ensureOffscreenDocument();

  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  const settings = { ...(await getSettings()), enabled: true };
  await saveSettings(settings);

  await chrome.runtime.sendMessage({
    type: 'START_CAPTURE',
    streamId,
    tabId: tab.id,
    settings,
  });

  activeCapture = { tabId: tab.id, active: true };
  await chrome.action.setBadgeText({ text: 'EQ', tabId: tab.id });
  await chrome.action.setBadgeBackgroundColor({ color: '#38d5c8', tabId: tab.id });
  return { active: true, tabId: tab.id, settings };
}

async function stopCapture() {
  await chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' }).catch(() => {});
  if (activeCapture.tabId) await chrome.action.setBadgeText({ text: '', tabId: activeCapture.tabId });
  activeCapture = { tabId: null, active: false };
  const settings = { ...(await getSettings()), enabled: false };
  await saveSettings(settings);
  return { active: false, settings };
}

async function updateSettings(partial) {
  const settings = { ...(await getSettings()), ...partial };
  await saveSettings(settings);
  await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings }).catch(() => {});
  return { active: activeCapture.active, tabId: activeCapture.tabId, settings };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  async function respond() {
    if (message.type === 'GET_STATUS') {
      return { active: activeCapture.active, tabId: activeCapture.tabId, settings: await getSettings() };
    }
    if (message.type === 'START_CAPTURE') return startCapture();
    if (message.type === 'STOP_CAPTURE') return stopCapture();
    if (message.type === 'UPDATE_SETTINGS') return updateSettings(message.settings || {});
    return { active: activeCapture.active, tabId: activeCapture.tabId, settings: await getSettings() };
  }

  respond().then(sendResponse).catch((error) => sendResponse({ error: error.message }));
  return true;
});

chrome.tabCapture.onStatusChanged.addListener((info) => {
  if (info.tabId === activeCapture.tabId && (info.status === 'stopped' || info.status === 'error')) {
    activeCapture = { tabId: null, active: false };
  }
});

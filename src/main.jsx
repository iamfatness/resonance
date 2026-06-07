import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AudioLines,
  BadgeInfo,
  Check,
  FastForward,
  Globe,
  Link,
  Music2,
  Pause,
  Play,
  Repeat2,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
} from 'lucide-react';
import './styles.css';
import {
  applyInstrumentBoosts,
  bands,
  defaultDeckProcessing,
  flatCurve,
  moodPresets,
  normalizeDeckProcessing,
} from './lib/presets.js';
import {
  isYoutubeLoadInput,
  parseYoutubeId,
  parseYoutubePlaylistId,
  parseYoutubeTimestamp,
  youtubeUrlForVideo,
} from './lib/youtube.js';
import { readSavedAppState, writeSavedAppState } from './lib/storage.js';
import { buildPluginCatalog, normalizePluginParameters, pluginChainKey } from './lib/plugins.js';
import { VideoDeck } from './components/VideoDeck.jsx';
import { LandingPage } from './components/LandingPage.jsx';
import { DirectSourcePanel } from './components/DirectSourcePanel.jsx';
import { DeckEffectsWindow } from './components/DeckEffectsWindow.jsx';
import { DesktopEnginePanel } from './components/DesktopEnginePanel.jsx';
import { EqPanel } from './components/EqPanel.jsx';
import { QueuePanel } from './components/QueuePanel.jsx';
import { SearchResultsPanel } from './components/SearchResultsPanel.jsx';
import { SidebarPanels } from './components/SidebarPanels.jsx';
import { useDesktopEngine } from './hooks/useDesktopEngine.js';
import { useLocalEq } from './hooks/useLocalEq.js';
import { useYouTubePlayer } from './hooks/useYouTubePlayer.js';

const demoVideoA = {
  id: 'wH2Nd8oHixo',
  title: 'Joe Rogan Experience #2493 - Protect Our Parks 16',
  channel: 'PowerfulJRE',
  duration: '--:--',
  startSeconds: 7284,
};

const demoVideoB = {
  id: 'JD-kMIpDfnY',
  title: 'lofi hip hop radio - beats to sleep/chill to',
  channel: 'Lofi Girl',
  duration: '--:--',
};

const queueSeed = [
  demoVideoA,
  demoVideoB,
  { id: 'DWcJFNfaw9c', title: 'Jazz Cafe Music - Relaxing Instrumental', channel: 'Cafe Music BGM', duration: '3:02:10' },
  { id: 'hHW1oY26kxQ', title: 'Deep Focus Music - Ambient Study Mix', channel: 'Quiet Quest', duration: '2:58:44' },
];

const playlistCatalog = [
  {
    name: 'Focus Mix',
    mood: 'Focus',
    tracks: [demoVideoA, queueSeed[3], queueSeed[2], demoVideoB],
  },
  {
    name: 'Late Night',
    mood: 'Night',
    tracks: [queueSeed[3], queueSeed[2], demoVideoB, demoVideoA],
  },
  {
    name: 'Studio Sessions',
    mood: 'Warmth',
    tracks: [queueSeed[2], demoVideoA, queueSeed[3], demoVideoB],
  },
  {
    name: 'Drum Drives',
    mood: 'Drive',
    tracks: [demoVideoA, demoVideoB, queueSeed[2], queueSeed[3]],
  },
];

async function searchYoutubeVideos(query) {
  const response = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}&limit=8`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'YouTube search failed.');
  }
  return data.items || [];
}

async function importYoutubePlaylist(playlistId) {
  const response = await fetch(`/api/youtube/playlist?list=${encodeURIComponent(playlistId)}&limit=25`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'YouTube playlist import failed.');
  }
  return {
    title: data.title || 'Imported Playlist',
    items: data.items || [],
  };
}

function uniqueVideos(videos = []) {
  const seen = new Set();
  return videos.filter((video) => {
    if (!video?.id || seen.has(video.id)) return false;
    seen.add(video.id);
    return true;
  });
}

function isIOSDevice() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function deckSourceStatus(sourceType) {
  if (sourceType === 'wav') return { label: 'WAV active', tone: 'ready' };
  if (sourceType === 'pcm') return { label: 'PCM active', tone: 'ready' };
  if (sourceType === 'loopback') return { label: 'Capture active', tone: 'ready' };
  if (sourceType === 'virtual-device') return { label: 'Virtual capture', tone: 'ready' };
  return { label: 'No source', tone: 'idle' };
}

function deckVst3Status(route) {
  const status = route?.vst3Status || 'disabled';
  if (status === 'processing') return { label: 'Active', tone: 'ready' };
  if (status === 'pending') return { label: 'Pending', tone: 'manual' };
  if (status === 'disabled') return { label: 'Fallback', tone: 'idle' };
  if (status.includes('fallback')) return { label: 'Fallback', tone: 'blocked' };
  if (status.includes('failed') || status.includes('empty')) return { label: 'Degraded', tone: 'blocked' };
  return { label: status, tone: 'blocked' };
}

function buildDeckNativeRouting(engineState, deck) {
  const routes = engineState?.router?.routes || [];
  const nativeRoutes = engineState?.router?.nativeSnapshot?.routes || [];
  const route = nativeRoutes.find((candidate) => candidate.deck === deck) || routes.find((candidate) => candidate.deck === deck);
  const source = engineState?.router?.nativeSnapshot?.sources?.find((candidate) => candidate.deck === deck);
  const sourceType = source?.sourceType || engineState?.playbackDecks?.[deck]?.sourceType || 'empty';
  const sourceStatus = deckSourceStatus(sourceType);
  const vst3Status = deckVst3Status(route);
  return {
    sourceLabel: sourceStatus.label,
    sourceTone: sourceStatus.tone,
    vst3Label: vst3Status.label,
    vst3Tone: vst3Status.tone,
  };
}

function PlayerApp() {
  const isIOS = useMemo(() => isIOSDevice(), []);
  const savedAppState = useMemo(() => readSavedAppState(), []);
  const savedPresetName = moodPresets[savedAppState?.activePreset] ? savedAppState.activePreset : 'Focus';
  const savedDeckA = savedAppState?.deckA?.id ? savedAppState.deckA : demoVideoA;
  const savedDeckB = savedAppState?.deckB?.id ? savedAppState.deckB : demoVideoB;
  const savedDeckProcessing = normalizeDeckProcessing(savedAppState?.deckProcessing);
  const savedDeckVolumes = Number.isFinite(savedAppState?.deckVolumes?.A) && Number.isFinite(savedAppState?.deckVolumes?.B)
    ? savedAppState.deckVolumes
    : moodPresets[savedPresetName].mix;
  const [deckA, setDeckA] = useState(savedDeckA);
  const [deckB, setDeckB] = useState(savedDeckB);
  const [queryA, setQueryA] = useState(savedAppState?.queryA || youtubeUrlForVideo(savedDeckA));
  const [queryB, setQueryB] = useState(savedAppState?.queryB || youtubeUrlForVideo(savedDeckB));
  const [youtubeResults, setYoutubeResults] = useState([]);
  const [youtubeSearchDeck, setYoutubeSearchDeck] = useState('A');
  const [youtubeSearchState, setYoutubeSearchState] = useState({ status: 'idle', message: '' });
  const [activeDeck, setActiveDeck] = useState(savedAppState?.activeDeck === 'B' ? 'B' : 'A');
  const [deckCount, setDeckCount] = useState(isIOS ? 1 : (savedAppState?.deckCount === 1 ? 1 : 2));
  const [selectedPlaylistName, setSelectedPlaylistName] = useState(savedAppState?.selectedPlaylistName || playlistCatalog[0].name);
  const [importedPlaylist, setImportedPlaylist] = useState(savedAppState?.importedPlaylist?.tracks?.length ? savedAppState.importedPlaylist : null);
  const [activeSidePanel, setActiveSidePanel] = useState(savedAppState?.activeSidePanel || 'playlists');
  const [activePreset, setActivePreset] = useState(savedPresetName);
  const [deckVolumes, setDeckVolumes] = useState(savedDeckVolumes);
  const [directUrl, setDirectUrl] = useState(savedAppState?.directUrl || '');
  const [eqMode, setEqMode] = useState(savedAppState?.eqMode === 'Manual' ? 'Manual' : 'Preset');
  const [appEqBypassed, setAppEqBypassed] = useState(Boolean(savedAppState?.appEqBypassed));
  const [deckProcessing, setDeckProcessing] = useState(savedDeckProcessing);
  const [audioLatencyProfile, setAudioLatencyProfile] = useState(['low', 'balanced', 'stable', 'custom'].includes(savedAppState?.audioLatencyProfile) ? savedAppState.audioLatencyProfile : 'balanced');
  const [audioBufferMs, setAudioBufferMs] = useState(Number.isFinite(savedAppState?.audioBufferMs) ? Math.max(20, Math.min(500, savedAppState.audioBufferMs)) : 80);
  const [likedVideos, setLikedVideos] = useState(Array.isArray(savedAppState?.likedVideos) ? savedAppState.likedVideos : [demoVideoA.id]);
  const [playHistory, setPlayHistory] = useState(Array.isArray(savedAppState?.playHistory) && savedAppState.playHistory.length ? savedAppState.playHistory : [demoVideoA]);
  const [playbackQueue, setPlaybackQueue] = useState(Array.isArray(savedAppState?.playbackQueue) ? savedAppState.playbackQueue : []);
  const [repeatMode, setRepeatMode] = useState(Boolean(savedAppState?.repeatMode));
  const [desktopSettingsOpen, setDesktopSettingsOpen] = useState(false);
  const [manualCurve, setManualCurve] = useState(Array.isArray(savedAppState?.manualCurve) ? savedAppState.manualCurve : flatCurve);
  const preset = moodPresets[activePreset] || moodPresets.Focus;
  const [instrumentBoosts, setInstrumentBoosts] = useState(savedAppState?.instrumentBoosts || preset.instruments);
  const playerA = useYouTubePlayer(deckA.id, deckVolumes.A, deckA.startSeconds);
  const playerB = useYouTubePlayer(deckB.id, deckVolumes.B, deckB.startSeconds);
  const availablePlaylists = useMemo(() => (
    importedPlaylist ? [importedPlaylist, ...playlistCatalog] : playlistCatalog
  ), [importedPlaylist]);
  const selectedPlaylist = availablePlaylists.find((playlist) => playlist.name === selectedPlaylistName) || availablePlaylists[0];
  const effectiveDeckCount = isIOS ? 1 : deckCount;
  const isSingleDeck = effectiveDeckCount === 1;
  const activeInputDeck = isSingleDeck ? 'A' : activeDeck;
  const activeVideo = activeDeck === 'A' ? deckA : deckB;
  const activeVideoLiked = likedVideos.includes(activeVideo.id);
  const activeDeckProcessing = deckProcessing[activeInputDeck] || defaultDeckProcessing[activeInputDeck];
  const baseCurve = eqMode === 'Manual' ? manualCurve : preset.curve;
  const effectiveCurve = useMemo(
    () => applyInstrumentBoosts(baseCurve, instrumentBoosts),
    [baseCurve, instrumentBoosts],
  );
  const processedCurve = appEqBypassed ? flatCurve : effectiveCurve;
  const desktopEngineSettings = useMemo(() => ({
    preset: activePreset,
    eqMode,
    curve: processedCurve,
    appEqBypassed,
    deckProcessing,
    deckVolumes,
    outputGain: deckVolumes.A / 100,
    audioLatencyProfile,
    audioBufferMs,
  }), [activePreset, appEqBypassed, audioBufferMs, audioLatencyProfile, deckProcessing, deckVolumes, eqMode, processedCurve]);
  const desktopEngine = useDesktopEngine(desktopEngineSettings);
  const deckNativeRouting = useMemo(() => ({
    A: buildDeckNativeRouting(desktopEngine.state, 'A'),
    B: buildDeckNativeRouting(desktopEngine.state, 'B'),
  }), [desktopEngine.state]);
  const desktopSettings = useMemo(() => {
    if (!desktopEngine.isDesktop) return null;
    return {
      status: desktopEngine.state?.status || 'Starting',
      content: (
        <DesktopEnginePanel
          engine={desktopEngine}
          latencyProfile={audioLatencyProfile}
          bufferMs={audioBufferMs}
          onLatencyProfileChange={setAudioLatencyProfile}
          onBufferMsChange={setAudioBufferMs}
        />
      ),
    };
  }, [audioBufferMs, audioLatencyProfile, desktopEngine]);
  const desktopPluginCatalog = useMemo(() => {
    return buildPluginCatalog(desktopEngine.state?.pluginHost?.candidates || []);
  }, [desktopEngine.state?.pluginHost?.candidates]);
  const localEq = useLocalEq(activePreset, processedCurve, directUrl);
  const eqPanelRef = useRef(null);

  useEffect(() => {
    writeSavedAppState({
      deckA,
      deckB,
      queryA,
      queryB,
      activeDeck,
      deckCount,
      selectedPlaylistName,
      importedPlaylist,
      activeSidePanel,
      activePreset,
      deckVolumes,
      directUrl,
      eqMode,
      appEqBypassed,
      deckProcessing,
      audioLatencyProfile,
      audioBufferMs,
      likedVideos,
      playHistory,
      playbackQueue,
      repeatMode,
      manualCurve,
      instrumentBoosts,
    });
  }, [
    activeDeck,
    activePreset,
    activeSidePanel,
    appEqBypassed,
    audioBufferMs,
    audioLatencyProfile,
    deckA,
    deckB,
    deckCount,
    deckVolumes,
    deckProcessing,
    directUrl,
    eqMode,
    importedPlaylist,
    instrumentBoosts,
    likedVideos,
    manualCurve,
    playbackQueue,
    playHistory,
    queryA,
    queryB,
    repeatMode,
    selectedPlaylistName,
  ]);

  const eqPath = useMemo(() => {
    const max = Math.max(...processedCurve.map((point) => Math.abs(point)), 12);
    return processedCurve
      .map((gain, index) => {
        const x = 20 + index * 51;
        const y = 78 - (gain / max) * 46;
        return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
      })
      .join(' ');
  }, [processedCurve]);

  function applyMoodPreset(name) {
    const nextPreset = moodPresets[name];
    setActivePreset(name);
    setInstrumentBoosts(nextPreset.instruments);
    setDeckVolumes(nextPreset.mix);
    setEqMode('Preset');
  }

  useEffect(() => {
    if (!isIOS || activeDeck === 'A') return;
    setActiveDeck('A');
  }, [activeDeck, isIOS]);

  useEffect(() => {
    if (activeDeck === 'A' || !isSingleDeck) return;
    setActiveDeck('A');
  }, [activeDeck, isSingleDeck]);

  useEffect(() => {
    function handleSmokeSearchResults(event) {
      const results = Array.isArray(event.detail?.results) ? event.detail.results : [];
      setYoutubeSearchDeck(activeInputDeck);
      setYoutubeResults(results);
      setYoutubeSearchState({
        status: results.length ? 'ready' : 'empty',
        message: event.detail?.message || 'Smoke search results',
      });
    }

    window.addEventListener('resonance-smoke-search-results', handleSmokeSearchResults);
    return () => window.removeEventListener('resonance-smoke-search-results', handleSmokeSearchResults);
  }, [activeInputDeck]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const channel = new BroadcastChannel('resonance-deck-effects');
    channel.onmessage = (event) => {
      if (event.data?.type !== 'deck-processing-updated') return;
      setDeckProcessing(normalizeDeckProcessing(event.data.deckProcessing));
    };
    return () => channel.close();
  }, []);

  function setInstrumentBoost(name, value) {
    setInstrumentBoosts((current) => ({ ...current, [name]: value }));
  }

  function setManualBand(index, value) {
    setEqMode('Manual');
    setManualCurve((current) => {
      const startingCurve = eqMode === 'Manual' ? current : preset.curve;
      return startingCurve.map((gain, bandIndex) => (bandIndex === index ? value : gain));
    });
  }

  function resetManualCurve() {
    setManualCurve(flatCurve);
    setEqMode('Manual');
  }

  function changeEqMode(mode) {
    if (mode === 'Manual' && eqMode !== 'Manual') setManualCurve(preset.curve);
    setEqMode(mode);
  }

  function setDeckVolume(deck, value) {
    setDeckVolumes((current) => ({ ...current, [deck]: value }));
  }

  function selectPlaylist(playlist) {
    setActiveSidePanel('playlists');
    setSelectedPlaylistName(playlist.name);
    applyMoodPreset(playlist.mood);
    loadVideo(playlist.tracks[0], 'A');
  }

  function selectReferenceTracks() {
    const referencePlaylist = {
      name: 'Reference Tracks',
      mood: 'Focus',
      tracks: queueSeed,
    };
    setImportedPlaylist(referencePlaylist);
    setSelectedPlaylistName(referencePlaylist.name);
    setActiveSidePanel('playlists');
    applyMoodPreset(referencePlaylist.mood);
    loadVideo(referencePlaylist.tracks[0], 'A');
  }

  function changeDeckCount(value) {
    const nextDeckCount = Number(value);
    setDeckCount(nextDeckCount);
    if (nextDeckCount === 1) setActiveDeck('A');
  }

  function updateDeckProcessing(deck, updater) {
    setDeckProcessing((current) => ({
      ...current,
      [deck]: updater(current[deck] || defaultDeckProcessing[deck]),
    }));
  }

  function setDeckPan(deck, value) {
    updateDeckProcessing(deck, (settings) => ({ ...settings, pan: value }));
  }

  function setDeckEqBand(deck, index, value) {
    updateDeckProcessing(deck, (settings) => ({
      ...settings,
      curve: settings.curve.map((gain, bandIndex) => (bandIndex === index ? value : gain)),
    }));
  }

  function resetDeckEq(deck, curve = flatCurve) {
    updateDeckProcessing(deck, (settings) => ({ ...settings, curve: [...curve], eqBypassed: false }));
  }

  function toggleDeckEqBypass(deck) {
    updateDeckProcessing(deck, (settings) => ({ ...settings, eqBypassed: !settings.eqBypassed }));
  }

  function toggleDeckPlugin(deck, pluginId) {
    updateDeckProcessing(deck, (settings) => {
      if (settings.pluginChain.some((plugin) => plugin.id === pluginId)) {
        return { ...settings, pluginChain: settings.pluginChain.filter((plugin) => plugin.id !== pluginId) };
      }
      const plugin = desktopPluginCatalog.find((item) => item.id === pluginId);
      return plugin
        ? {
            ...settings,
            pluginChain: [
              ...settings.pluginChain,
              { ...plugin, instanceId: `${plugin.id}:${Date.now()}`, parameters: normalizePluginParameters(plugin.parameters), bypassed: false },
            ],
          }
        : settings;
    });
  }

  function addDeckPlugin(deck, pluginId) {
    updateDeckProcessing(deck, (settings) => {
      const plugin = desktopPluginCatalog.find((item) => item.id === pluginId);
      return plugin
        ? {
            ...settings,
            pluginChain: [
              ...settings.pluginChain,
              { ...plugin, instanceId: `${plugin.id}:${Date.now()}`, parameters: normalizePluginParameters(plugin.parameters), bypassed: false },
            ],
          }
        : settings;
    });
  }

  function removeDeckPlugin(deck, pluginKey) {
    updateDeckProcessing(deck, (settings) => ({
      ...settings,
      pluginChain: settings.pluginChain.filter((plugin) => pluginChainKey(plugin) !== pluginKey),
    }));
  }

  function moveDeckPlugin(deck, pluginKey, direction) {
    updateDeckProcessing(deck, (settings) => {
      const index = settings.pluginChain.findIndex((plugin) => pluginChainKey(plugin) === pluginKey);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= settings.pluginChain.length) return settings;
      const pluginChain = [...settings.pluginChain];
      const [plugin] = pluginChain.splice(index, 1);
      pluginChain.splice(nextIndex, 0, plugin);
      return { ...settings, pluginChain };
    });
  }

  function duplicateDeckPlugin(deck, pluginKey) {
    updateDeckProcessing(deck, (settings) => {
      const plugin = settings.pluginChain.find((item) => pluginChainKey(item) === pluginKey);
      return plugin
        ? {
            ...settings,
            pluginChain: [
              ...settings.pluginChain,
              {
                ...plugin,
                instanceId: `${plugin.id}:copy-${Date.now()}`,
                parameters: normalizePluginParameters(plugin.parameters),
              },
            ],
          }
        : settings;
    });
  }

  function resetDeckPluginParameters(deck, pluginKey) {
    updateDeckProcessing(deck, (settings) => ({
      ...settings,
      pluginChain: settings.pluginChain.map((plugin) => (
        pluginChainKey(plugin) === pluginKey
          ? { ...plugin, parameters: normalizePluginParameters({}) }
          : plugin
      )),
    }));
  }

  function toggleDeckPluginBypass(deck, pluginKey) {
    updateDeckProcessing(deck, (settings) => ({
      ...settings,
      pluginChain: settings.pluginChain.map((plugin) => (
        pluginChainKey(plugin) === pluginKey ? { ...plugin, bypassed: !plugin.bypassed } : plugin
      )),
    }));
  }

  function setDeckPluginParameter(deck, pluginKey, parameter, value) {
    updateDeckProcessing(deck, (settings) => ({
      ...settings,
      pluginChain: settings.pluginChain.map((plugin) => (
        pluginChainKey(plugin) === pluginKey
          ? {
              ...plugin,
              parameters: normalizePluginParameters({
                ...plugin.parameters,
                [parameter]: value,
              }),
            }
          : plugin
      )),
    }));
  }

  function loadVideo(nextVideo, targetDeck = activeInputDeck) {
    const safeTargetDeck = isSingleDeck ? 'A' : targetDeck;
    if (safeTargetDeck === 'A') {
      setDeckA(nextVideo);
      setQueryA(youtubeUrlForVideo(nextVideo));
    } else {
      setDeckB(nextVideo);
      setQueryB(youtubeUrlForVideo(nextVideo));
    }
    setYoutubeResults([]);
    setYoutubeSearchState({ status: 'idle', message: '' });
    setPlayHistory((current) => [nextVideo, ...current.filter((item) => item.id !== nextVideo.id)].slice(0, 12));
  }

  function toggleLikedVideo(video = activeDeck === 'A' ? deckA : deckB) {
    setLikedVideos((current) => (
      current.includes(video.id) ? current.filter((id) => id !== video.id) : [video.id, ...current]
    ));
  }

  function startRadio() {
    const pool = availablePlaylists.flatMap((playlist) => playlist.tracks);
    const nextVideo = pool[Math.floor(Math.random() * pool.length)] || demoVideoA;
    setActiveSidePanel('radio');
    loadVideo(nextVideo, activeInputDeck);
  }

  function queueVideo(video, placement = 'end') {
    setPlaybackQueue((current) => {
      const withoutDuplicate = current.filter((item) => item.id !== video.id);
      return placement === 'next' ? [video, ...withoutDuplicate] : [...withoutDuplicate, video];
    });
  }

  function removeQueuedVideo(videoId) {
    setPlaybackQueue((current) => current.filter((video) => video.id !== videoId));
  }

  function moveQueuedVideo(videoId, direction) {
    setPlaybackQueue((current) => {
      const index = current.findIndex((video) => video.id === videoId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const nextQueue = [...current];
      [nextQueue[index], nextQueue[nextIndex]] = [nextQueue[nextIndex], nextQueue[index]];
      return nextQueue;
    });
  }

  function loadNextVideo(direction = 1) {
    if (repeatMode) {
      loadVideo(activeVideo, activeInputDeck);
      return;
    }

    if (direction > 0 && playbackQueue.length > 0) {
      const [nextVideo, ...remainingQueue] = playbackQueue;
      setPlaybackQueue(remainingQueue);
      loadVideo(nextVideo, activeInputDeck);
      return;
    }

    const tracks = selectedPlaylist.tracks;
    const activeIndex = tracks.findIndex((track) => track.id === activeVideo.id);
    const currentIndex = activeIndex >= 0 ? activeIndex : 0;
    const nextIndex = (currentIndex + direction + tracks.length) % tracks.length;
    loadVideo(tracks[nextIndex], activeInputDeck);
  }

  function shuffleFromPlaylist() {
    const tracks = selectedPlaylist.tracks.filter((track) => track.id !== activeVideo.id);
    const pool = tracks.length ? tracks : selectedPlaylist.tracks;
    const nextVideo = pool[Math.floor(Math.random() * pool.length)] || activeVideo;
    loadVideo(nextVideo, activeInputDeck);
  }

  function clearQueue() {
    setPlaybackQueue([]);
  }

  function openSettingsPanel() {
    if (desktopEngine.isDesktop) setDesktopSettingsOpen(true);
    window.requestAnimationFrame(() => {
      eqPanelRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      eqPanelRef.current?.focus?.({ preventScroll: true });
    });
  }

  function openDeckEffects(deck) {
    if (desktopEngine.isDesktop && window.resonanceDesktop?.openDeckEffectsWindow) {
      window.resonanceDesktop.openDeckEffectsWindow(deck);
      return;
    }
    setActiveDeck(deck);
    openSettingsPanel();
  }

  function sidebarLoad(video) {
    loadVideo(video, activeInputDeck);
  }

  async function submitVideo(event, targetDeck) {
    event.preventDefault();
    const safeTargetDeck = isSingleDeck ? 'A' : targetDeck;
    const query = (safeTargetDeck === 'A' ? queryA : queryB).trim();
    const playlistId = parseYoutubePlaylistId(query);
    if (playlistId) {
      setYoutubeSearchDeck(safeTargetDeck);
      setYoutubeSearchState({ status: 'loading', message: 'Importing YouTube playlist...' });
      setYoutubeResults([]);

      try {
        const imported = await importYoutubePlaylist(playlistId);
        const importedItems = uniqueVideos(imported.items);
        if (!importedItems.length) {
          setYoutubeSearchState({ status: 'empty', message: 'No public videos were found in that playlist.' });
          return;
        }

        const nextPlaylist = {
          name: imported.title || 'Imported Playlist',
          mood: activePreset,
          tracks: importedItems,
        };
        setImportedPlaylist(nextPlaylist);
        setSelectedPlaylistName(nextPlaylist.name);
        setActiveSidePanel('playlists');
        setPlaybackQueue(importedItems.slice(1));
        loadVideo(importedItems[0], safeTargetDeck);
        setYoutubeSearchState({
          status: 'ready',
          message: `Imported ${importedItems.length} public videos${imported.items.length !== importedItems.length ? ` and skipped ${imported.items.length - importedItems.length} duplicate.` : ''} The first video is loaded and the rest are queued.`,
        });
      } catch (error) {
        setYoutubeSearchState({ status: 'error', message: error.message });
      }
      return;
    }

    const id = parseYoutubeId(query);
    if (id) {
      loadVideo({ id, title: `Custom Deck ${safeTargetDeck} video`, channel: 'YouTube', duration: '--:--', startSeconds: parseYoutubeTimestamp(query) }, safeTargetDeck);
      return;
    }

    if (!query) return;

    setYoutubeSearchDeck(safeTargetDeck);
    setYoutubeSearchState({ status: 'loading', message: `Searching YouTube for "${query}"` });
    setYoutubeResults([]);

    try {
      const items = await searchYoutubeVideos(query);
      setYoutubeResults(items);
      setYoutubeSearchState({
        status: items.length ? 'ready' : 'empty',
        message: items.length ? `Select a result to load Deck ${safeTargetDeck}.` : 'No YouTube videos matched that search.',
      });
    } catch (error) {
      setYoutubeSearchState({ status: 'error', message: error.message });
    }
  }

  function toggleBothDecks() {
    if (isSingleDeck) {
      playerA.toggle();
      return;
    }
    if (playerA.playing || playerB.playing) {
      playerA.pause();
      playerB.pause();
      return;
    }
    playerA.play();
    playerB.play();
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <AudioLines aria-hidden="true" />
          <span>Resonance</span>
        </div>
        <div className="search-shell">
          <form className="searchbar" onSubmit={(event) => submitVideo(event, activeInputDeck)}>
            <Search size={18} />
            <input
              aria-label="Paste YouTube link or search for video"
              value={activeInputDeck === 'A' ? queryA : queryB}
              onChange={(event) => (activeInputDeck === 'A' ? setQueryA(event.target.value) : setQueryB(event.target.value))}
              placeholder={isSingleDeck ? 'Paste YouTube link or search for video' : `Paste YouTube link or search Deck ${activeInputDeck}`}
            />
            <button type="submit">
              {parseYoutubePlaylistId(activeInputDeck === 'A' ? queryA : queryB) ? 'Import' : (isYoutubeLoadInput(activeInputDeck === 'A' ? queryA : queryB) ? 'Load' : 'Search')}
            </button>
          </form>
        </div>
        <div className="deck-count-control" aria-label="Deck count">
          <button
            className={effectiveDeckCount === 1 ? 'active' : ''}
            type="button"
            onClick={() => changeDeckCount(1)}
          >
            1 Deck
          </button>
          <button
            className={effectiveDeckCount === 2 ? 'active' : ''}
            type="button"
            onClick={() => changeDeckCount(2)}
            disabled={isIOS}
            title={isIOS ? 'iOS browsers only support one YouTube video stream at a time.' : 'Use two decks'}
          >
            2 Decks
          </button>
        </div>
        <div className="source-pill">
          <Link size={16} />
          <span>{isIOS ? 'iOS' : effectiveDeckCount === 1 ? 'Mode' : 'Active'}</span>
          <strong>{effectiveDeckCount === 1 ? 'Single Deck' : `Deck ${activeDeck}`}</strong>
        </div>
        <button
          className={`icon-button ${desktopSettingsOpen ? 'active' : ''}`}
          aria-label="Open settings"
          onClick={openSettingsPanel}
          type="button"
        >
          <Settings size={18} />
        </button>
      </header>

      <SearchResultsPanel
        searchState={youtubeSearchState}
        results={youtubeResults}
        targetDeck={youtubeSearchDeck}
        onClear={() => {
          setYoutubeResults([]);
          setYoutubeSearchState({ status: 'idle', message: '' });
        }}
        onLoadVideo={loadVideo}
        onQueueVideo={queueVideo}
      />

      <SidebarPanels
        activeSidePanel={activeSidePanel}
        setActiveSidePanel={setActiveSidePanel}
        activeVideoLiked={activeVideoLiked}
        toggleLikedVideo={toggleLikedVideo}
        deckA={deckA}
        deckB={deckB}
        isSingleDeck={isSingleDeck}
        activeDeck={activeDeck}
        setActiveDeck={setActiveDeck}
        availablePlaylists={availablePlaylists}
        likedVideos={likedVideos}
        selectedPlaylistName={selectedPlaylistName}
        selectPlaylist={selectPlaylist}
        selectReferenceTracks={selectReferenceTracks}
        queueSeed={queueSeed}
        playHistory={playHistory}
        setPlayHistory={setPlayHistory}
        sidebarLoad={sidebarLoad}
        startRadio={startRadio}
      />

      <section className="player-panel" id="now">
        <section className="mobile-playlists" aria-label="Mobile playlists">
          <div className="panel-heading">
            <h2>Playlists</h2>
            <span>{selectedPlaylist.tracks.length} tracks</span>
          </div>
          <div className="mobile-playlist-strip">
            {availablePlaylists.map((playlist) => (
              <button
                className={`mobile-playlist-card ${selectedPlaylistName === playlist.name ? 'active' : ''}`}
                key={playlist.name}
                onClick={() => selectPlaylist(playlist)}
                type="button"
              >
                <strong>{playlist.name}</strong>
                <span>{playlist.mood}</span>
              </button>
            ))}
          </div>
        </section>

        {isIOS && (
          <section className="ios-limits">
            <BadgeInfo size={18} />
            <div>
              <strong>iOS YouTube mode</strong>
              <p>iPhone and iPad browsers only allow one YouTube video stream at a time. Playlists load into Deck A for reliable mobile playback.</p>
            </div>
          </section>
        )}

        <DirectSourcePanel directUrl={directUrl} setDirectUrl={setDirectUrl} localEq={localEq} />

        <div className={`deck-grid ${isSingleDeck ? 'single-deck' : ''}`}>
          <VideoDeck
            label="A"
            video={deckA}
            query={queryA}
            setQuery={setQueryA}
            onSubmit={(event) => submitVideo(event, 'A')}
            player={playerA}
            volume={deckVolumes.A}
            setVolume={(value) => setDeckVolume('A', value)}
            pan={deckProcessing.A.pan}
            setPan={(value) => setDeckPan('A', value)}
            active={activeDeck === 'A'}
            onActivate={() => setActiveDeck('A')}
            onOpenEffects={desktopEngine.isDesktop ? () => openDeckEffects('A') : null}
            isDesktop={desktopEngine.isDesktop}
            nativeRouting={deckNativeRouting.A}
          />
          {!isSingleDeck && (
            <VideoDeck
              label="B"
              video={deckB}
              query={queryB}
              setQuery={setQueryB}
              onSubmit={(event) => submitVideo(event, 'B')}
              player={playerB}
              volume={deckVolumes.B}
              setVolume={(value) => setDeckVolume('B', value)}
              pan={deckProcessing.B.pan}
              setPan={(value) => setDeckPan('B', value)}
              active={activeDeck === 'B'}
              onActivate={() => setActiveDeck('B')}
              onOpenEffects={desktopEngine.isDesktop ? () => openDeckEffects('B') : null}
              isDesktop={desktopEngine.isDesktop}
              nativeRouting={deckNativeRouting.B}
            />
          )}
        </div>

        <QueuePanel
          activePreset={activePreset}
          isSingleDeck={isSingleDeck}
          selectedPlaylist={selectedPlaylist}
          preset={preset}
          activeVideoLiked={activeVideoLiked}
          activeVideo={activeVideo}
          toggleLikedVideo={toggleLikedVideo}
          setLikedVideos={setLikedVideos}
          loadNextVideo={loadNextVideo}
          queueVideo={queueVideo}
          playbackQueue={playbackQueue}
          clearQueue={clearQueue}
          activeDeck={activeDeck}
          removeQueuedVideo={removeQueuedVideo}
          loadVideo={loadVideo}
          moveQueuedVideo={moveQueuedVideo}
          deckA={deckA}
          deckB={deckB}
        />
      </section>
      <EqPanel
        panelRef={eqPanelRef}
        activePreset={activePreset}
        preset={preset}
        deckVolumes={deckVolumes}
        isSingleDeck={isSingleDeck}
        appEqBypassed={appEqBypassed}
        setAppEqBypassed={setAppEqBypassed}
        eqMode={eqMode}
        changeEqMode={changeEqMode}
        applyMoodPreset={applyMoodPreset}
        activeInputDeck={activeInputDeck}
        activeDeckProcessing={activeDeckProcessing}
        resetDeckEq={resetDeckEq}
        toggleDeckEqBypass={toggleDeckEqBypass}
        setDeckEqBand={setDeckEqBand}
        pluginCatalog={desktopPluginCatalog}
        pluginScan={desktopEngine.isDesktop ? {
          status: desktopEngine.state?.pluginHost?.scanStatus || desktopEngine.state?.pluginHost?.status || 'pending',
          count: desktopEngine.state?.pluginHost?.pluginCount || 0,
          formats: (desktopEngine.state?.pluginHost?.supportedFormats || []).join(', ') || 'VST2, VST3',
          bridgeStatus: desktopEngine.state?.pluginHost?.nativeBridgeClient?.status || desktopEngine.state?.pluginHost?.nativeBridge?.status,
          bridgeLoadedCount: desktopEngine.state?.pluginHost?.nativeBridgeClient?.loadedCount || 0,
          bridgeParameterLoadedCount: desktopEngine.state?.pluginHost?.nativeBridgeClient?.parameterLoadedCount || 0,
          onRefresh: desktopEngine.refreshPlugins,
        } : null}
        addDeckPlugin={addDeckPlugin}
        removeDeckPlugin={removeDeckPlugin}
        moveDeckPlugin={moveDeckPlugin}
        duplicateDeckPlugin={duplicateDeckPlugin}
        resetDeckPluginParameters={resetDeckPluginParameters}
        toggleDeckPlugin={toggleDeckPlugin}
        toggleDeckPluginBypass={toggleDeckPluginBypass}
        setDeckPluginParameter={setDeckPluginParameter}
        instrumentBoosts={instrumentBoosts}
        setInstrumentBoost={setInstrumentBoost}
        eqPath={eqPath}
        processedCurve={processedCurve}
        manualCurve={manualCurve}
        resetManualCurve={resetManualCurve}
        setManualBand={setManualBand}
        desktopSettings={desktopSettings}
        desktopSettingsOpen={desktopSettingsOpen}
        onDesktopSettingsToggle={setDesktopSettingsOpen}
      />

      <footer className="transport">
        <button className="icon-button" aria-label="Shuffle playlist" onClick={shuffleFromPlaylist} type="button"><Shuffle size={19} /></button>
        <button className="icon-button" aria-label="Previous playlist video" onClick={() => loadNextVideo(-1)} type="button"><SkipBack size={21} /></button>
        <button className="play-button" onClick={toggleBothDecks} aria-label={playerA.playing || (!isSingleDeck && playerB.playing) ? 'Pause playback' : 'Play playback'}>
          {playerA.playing || playerB.playing ? <Pause size={27} /> : <Play size={27} />}
        </button>
        <button className="icon-button" aria-label="Next playlist video" onClick={() => loadNextVideo(1)} type="button"><SkipForward size={21} /></button>
        <button className={`icon-button ${repeatMode ? 'active' : ''}`} aria-label={repeatMode ? 'Turn repeat off' : 'Repeat active video'} onClick={() => setRepeatMode((current) => !current)} type="button"><Repeat2 size={19} /></button>
        <div className="mini-track">
          <img alt="" src={`https://i.ytimg.com/vi/${activeVideo.id}/mqdefault.jpg`} />
          <div>
            <strong>{activeVideo.title}</strong>
            <span>Deck {activeDeck} selected</span>
          </div>
        </div>
        <div className="progress">
          <span>Preset: {activePreset}</span>
          <div><i style={{ width: `${Math.max(8, Math.min(96, isSingleDeck ? deckVolumes.A : (deckVolumes.A + deckVolumes.B) / 2))}%` }} /></div>
          <span>{isSingleDeck ? `Deck A ${deckVolumes.A}%` : `A ${deckVolumes.A}% / B ${deckVolumes.B}%`}</span>
        </div>
        <Volume2 size={19} />
        <input
          className="volume"
          type="range"
          min="0"
          max="100"
          value={deckVolumes[activeInputDeck]}
          onChange={(event) => setDeckVolume(activeInputDeck, Number(event.target.value))}
          aria-label={`Deck ${activeInputDeck} volume`}
        />
        <button className="icon-button" aria-label="Skip forward" onClick={() => loadNextVideo(1)} type="button"><FastForward size={18} /></button>
      </footer>
    </main>
  );
}

function App() {
  function currentRoute() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'effects') return '/effects';
    if (params.get('view') === 'app') return '/app';
    if (params.get('view') === 'landing') return '/';
    return window.location.pathname;
  }

  const [path, setPath] = useState(currentRoute);

  useEffect(() => {
    const onPopState = () => setPath(currentRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    function handleClick(event) {
      const anchor = event.target.closest?.('a[href="/"], a[href="/app"]');
      if (!anchor) return;
      event.preventDefault();
      const href = anchor.getAttribute('href');
      if (window.location.protocol === 'file:') {
        window.history.pushState({}, '', href === '/app' ? '?view=app' : '?view=landing');
      } else {
        window.history.pushState({}, '', href);
      }
      setPath(currentRoute());
      window.scrollTo({ top: 0, behavior: 'auto' });
    }

    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  if (path === '/effects') {
    const params = new URLSearchParams(window.location.search);
    return <DeckEffectsWindow deck={params.get('deck') === 'B' ? 'B' : 'A'} />;
  }

  return path === '/app' ? <PlayerApp /> : <LandingPage />;
}

createRoot(document.getElementById('root')).render(<App />);

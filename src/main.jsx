import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AudioLines,
  BadgeInfo,
  CirclePlay,
  ArrowRight,
  Check,
  Disc3,
  Drum,
  FastForward,
  Gauge,
  Guitar,
  Globe,
  Heart,
  History,
  KeyboardMusic,
  Library,
  Link,
  ListMusic,
  Mic2,
  Moon,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  Repeat2,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  SunMedium,
  ThumbsDown,
  ThumbsUp,
  Upload,
  Volume2,
  WandSparkles,
  Zap,
} from 'lucide-react';
import './styles.css';

const demoVideoA = {
  id: 'TW9d8vYrVFQ',
  title: 'Elektronomia - Sky High [NCS Release]',
  channel: 'NoCopyrightSounds',
  duration: '4:01',
};

const demoVideoB = {
  id: 'M7lc1UVf-VE',
  title: 'YouTube embedded playback demo',
  channel: 'YouTube Developers',
  duration: '0:30',
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

const moodPresets = {
  Focus: {
    icon: Gauge,
    curve: [2, 3.5, 2, 0, -2, -1, 1.5, 2],
    instruments: { Vocal: 1.5, Bass: 1, Drums: -0.5, Guitar: 0, Synth: 2, Strings: 1 },
    mix: { A: 72, B: 38 },
    intent: 'Keeps Deck A clear and lowers Deck B into a bed for concentration.',
  },
  Lift: {
    icon: SunMedium,
    curve: [0, 1, 1.5, 2, 2.5, 3, 2, 1],
    instruments: { Vocal: 2, Bass: 1, Drums: 2, Guitar: 1, Synth: 2.5, Strings: 1.5 },
    mix: { A: 78, B: 58 },
    intent: 'Raises both decks for a brighter, more energetic blend.',
  },
  Warmth: {
    icon: Sparkles,
    curve: [2.5, 3, 2, 1, 0, -1, -0.5, 0],
    instruments: { Vocal: 1, Bass: 3, Drums: 1, Guitar: 1.5, Synth: -0.5, Strings: 2 },
    mix: { A: 64, B: 62 },
    intent: 'Balances both decks and emphasizes the low-mid mood curve.',
  },
  Drive: {
    icon: Zap,
    curve: [1, 2.5, 2, 1.5, 2, 2.5, 1, 0],
    instruments: { Vocal: 1, Bass: 2.5, Drums: 3, Guitar: 2.5, Synth: 1, Strings: -0.5 },
    mix: { A: 84, B: 72 },
    intent: 'Pushes both decks forward for higher impact and percussion.',
  },
  Night: {
    icon: Moon,
    curve: [1.5, 2, 1, -1, -2, -2.5, -1, 0.5],
    instruments: { Vocal: -0.5, Bass: 2, Drums: -1, Guitar: 0, Synth: 1.5, Strings: 2 },
    mix: { A: 48, B: 28 },
    intent: 'Drops total YouTube volume and softens the second deck.',
  },
};

const bands = [31, 62, 125, 250, 500, '1k', '2k', '4k'];
const bandFreqs = [31, 62, 125, 250, 500, 1000, 2000, 4000];
const flatCurve = Array(bands.length).fill(0);

const pluginCatalog = [
  { id: 'waves-vst3', name: 'Waves VST3', vendor: 'Waves', status: 'Planned' },
  { id: 'vst3-generic', name: 'VST3 Plugin', vendor: 'Desktop host', status: 'Planned' },
];
const instrumentMeta = {
  Vocal: { icon: Mic2, band: '1k-4k' },
  Bass: { icon: Disc3, band: '62-125' },
  Drums: { icon: Drum, band: '125-2k' },
  Guitar: { icon: Guitar, band: '250-4k' },
  Synth: { icon: KeyboardMusic, band: '500-4k' },
  Strings: { icon: WandSparkles, band: '1k-8k' },
};

const instrumentBandWeights = {
  Vocal: [0, 0, 0, 0.15, 0.55, 0.9, 0.8, 0.45],
  Bass: [0.25, 0.9, 0.85, 0.35, 0, 0, 0, 0],
  Drums: [0.1, 0.35, 0.85, 0.75, 0.35, 0.6, 0.35, 0.15],
  Guitar: [0, 0, 0.15, 0.65, 0.75, 0.75, 0.55, 0.35],
  Synth: [0, 0.15, 0.25, 0.45, 0.75, 0.85, 0.85, 0.55],
  Strings: [0, 0, 0.05, 0.25, 0.45, 0.8, 0.9, 0.8],
};

function clampGain(value) {
  return Math.max(-12, Math.min(12, Number(value.toFixed(2))));
}

function applyInstrumentBoosts(baseCurve, boosts) {
  return baseCurve.map((gain, bandIndex) => {
    const instrumentGain = Object.entries(boosts).reduce((total, [name, boost]) => {
      return total + (instrumentBandWeights[name]?.[bandIndex] || 0) * boost * 0.65;
    }, 0);
    return clampGain(gain + instrumentGain);
  });
}

function parseYoutubeId(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1).split('/')[0] || null;
    if (url.hostname.includes('youtube.com')) {
      if (url.searchParams.get('v')) return url.searchParams.get('v');
      const shorts = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shorts) return shorts[1];
      const embed = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
      if (embed) return embed[1];
    }
  } catch {
    return null;
  }
  return null;
}

function isYoutubeLoadInput(value) {
  return Boolean(parseYoutubeId(value));
}

async function searchYoutubeVideos(query) {
  const response = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}&limit=8`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'YouTube search failed.');
  }
  return data.items || [];
}

function isIOSDevice() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function useYouTubePlayer(videoId, volume) {
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;

    function loadPlayer() {
      if (cancelled || !containerRef.current || !window.YT?.Player) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        playerVars: {
          autoplay: 0,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
        },
        events: {
          onReady: () => {
            playerRef.current?.setVolume?.(volume);
            setReady(true);
          },
          onStateChange: (event) => setPlaying(event.data === window.YT.PlayerState.PLAYING),
        },
      });
    }

    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }

    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      loadPlayer();
    };

    if (window.YT?.Player) loadPlayer();

    return () => {
      cancelled = true;
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    playerRef.current?.loadVideoById?.(videoId);
    playerRef.current?.setVolume?.(volume);
  }, [ready, videoId]);

  useEffect(() => {
    if (!ready) return;
    playerRef.current?.setVolume?.(volume);
    if (volume === 0) playerRef.current?.mute?.();
    else playerRef.current?.unMute?.();
  }, [ready, volume]);

  return {
    containerRef,
    ready,
    playing,
    toggle: () => {
      if (!ready) return;
      if (playing) playerRef.current.pauseVideo();
      else playerRef.current.playVideo();
    },
    play: () => ready && playerRef.current?.playVideo?.(),
    pause: () => ready && playerRef.current?.pauseVideo?.(),
  };
}

function useLocalEq(activePreset, curve, sourceUrl) {
  const audioRef = useRef(null);
  const graphRef = useRef(null);
  const contextRef = useRef(null);
  const filtersRef = useRef([]);
  const analyserRef = useRef(null);
  const [localFileUrl, setLocalFileUrl] = useState('');
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    return () => {
      if (localFileUrl) URL.revokeObjectURL(localFileUrl);
    };
  }, [localFileUrl]);

  useEffect(() => {
    filtersRef.current.forEach((filter, index) => {
      filter.gain.setTargetAtTime(curve[index] ?? 0, contextRef.current?.currentTime ?? 0, 0.02);
    });
  }, [curve, activePreset]);

  useEffect(() => {
    const canvas = graphRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return undefined;

    const ctx = canvas.getContext('2d');
    const data = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;

    function draw() {
      frame = requestAnimationFrame(draw);
      const { width, height } = canvas;
      analyser.getByteFrequencyData(data);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#091012';
      ctx.fillRect(0, 0, width, height);
      const count = 42;
      const gap = 3;
      const barWidth = (width - gap * (count - 1)) / count;
      for (let i = 0; i < count; i += 1) {
        const value = data[Math.floor((i / count) * data.length)] / 255;
        const barHeight = Math.max(5, value * (height - 12));
        const x = i * (barWidth + gap);
        const gradient = ctx.createLinearGradient(0, height - barHeight, 0, height);
        gradient.addColorStop(0, '#f6b44a');
        gradient.addColorStop(0.35, '#35d0c4');
        gradient.addColorStop(1, '#147b77');
        ctx.fillStyle = gradient;
        ctx.fillRect(x, height - barHeight, barWidth, barHeight);
      }
    }

    draw();
    return () => cancelAnimationFrame(frame);
  }, [enabled]);

  const activate = async () => {
    const audio = audioRef.current;
    if (!audio || enabled) return;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext();
    const source = context.createMediaElementSource(audio);
    const filters = bandFreqs.map((frequency) => {
      const filter = context.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = frequency;
      filter.Q.value = 1;
      filter.gain.value = 0;
      return filter;
    });
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;

    source.connect(filters[0]);
    filters.forEach((filter, index) => {
      filter.connect(filters[index + 1] || analyser);
    });
    analyser.connect(context.destination);

    contextRef.current = context;
    filtersRef.current = filters;
    analyserRef.current = analyser;
    setEnabled(true);
  };

  const audioSource = localFileUrl || sourceUrl;

  return {
    audioRef,
    graphRef,
    audioSource,
    enabled,
    setFile(file) {
      if (!file) return;
      if (localFileUrl) URL.revokeObjectURL(localFileUrl);
      setLocalFileUrl(URL.createObjectURL(file));
    },
    activate,
  };
}

function VideoDeck({ label, video, query, setQuery, onSubmit, player, volume, setVolume, active, onActivate }) {
  const actionLabel = isYoutubeLoadInput(query) ? 'Load' : 'Search';

  return (
    <article className={`deck ${active ? 'active' : ''}`}>
      <div className="deck-topline">
        <button className="deck-label" onClick={onActivate} type="button">
          <Music2 size={17} />
          <span>Deck {label}</span>
        </button>
        <span className="deck-state">{player.ready ? 'YouTube ready' : 'Loading'}</span>
      </div>
      <form className="deck-search" onSubmit={onSubmit}>
        <Search size={16} />
        <input
          aria-label={`Deck ${label} paste YouTube link or search for video`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Paste YouTube link or search Deck ${label}`}
        />
        <button type="submit">{actionLabel}</button>
      </form>
      <div className="video-frame">
        <div ref={player.containerRef} className="youtube-target" />
      </div>
      <div className="deck-meta">
        <div>
          <h1>{video.title}</h1>
          <p>{video.channel} - YouTube playback - {video.duration}</p>
        </div>
        <button className="icon-button" onClick={player.toggle} aria-label={player.playing ? `Pause Deck ${label}` : `Play Deck ${label}`}>
          {player.playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
      </div>
      <label className="deck-volume">
        <span><Volume2 size={16} />Deck {label}</span>
        <input
          type="range"
          min="0"
          max="100"
          value={volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          aria-label={`Deck ${label} volume`}
        />
        <strong>{volume}%</strong>
      </label>
    </article>
  );
}

function useDesktopEngine(settings) {
  const desktopApi = typeof window !== 'undefined' ? window.resonanceDesktop : null;
  const [engineState, setEngineState] = useState(null);
  const [meters, setMeters] = useState(null);

  useEffect(() => {
    if (!desktopApi?.engine) return undefined;
    let cancelled = false;

    desktopApi.engine.getState()
      .then((state) => {
        if (!cancelled) setEngineState(state);
      })
      .catch(() => {
        if (!cancelled) setEngineState({ status: 'offline', mode: 'unavailable' });
      });

    return desktopApi.engine.onState((state) => {
      if (!cancelled) setEngineState(state);
    });
  }, [desktopApi]);

  useEffect(() => {
    if (!desktopApi?.engine?.onMeters) return undefined;
    let cancelled = false;
    return desktopApi.engine.onMeters((nextMeters) => {
      if (!cancelled) setMeters(nextMeters);
    });
  }, [desktopApi]);

  useEffect(() => {
    if (!desktopApi?.engine) return;
    desktopApi.engine.updateSettings(settings).catch(() => {});
  }, [desktopApi, settings]);

  return {
    isDesktop: Boolean(desktopApi?.isDesktop),
    state: engineState,
    meters: meters || engineState?.meters || null,
    start: () => desktopApi?.engine?.start?.(),
    stop: () => desktopApi?.engine?.stop?.(),
    refreshDevices: () => desktopApi?.engine?.refreshDevices?.(),
    selectDevices: (devices) => desktopApi?.engine?.selectDevices?.(devices),
  };
}

function DesktopEnginePanel({ engine }) {
  if (!engine.isDesktop) return null;

  const state = engine.state || { status: 'starting', devices: { inputs: [], outputs: [] } };
  const meters = engine.meters || { inputPeak: 0, outputPeak: 0, inputRms: 0, outputRms: 0, clipping: false };
  const inputs = state.devices?.inputs || [];
  const outputs = state.devices?.outputs || [];
  const diagnostics = state.diagnostics?.checks || [];

  return (
    <section className="desktop-engine-panel">
      <div className="panel-heading">
        <h2>Desktop Audio Engine</h2>
        <span>{state.status}</span>
      </div>
      <div className="engine-scan">
        <span>Devices: {state.deviceScan?.status || 'pending'}</span>
        <button type="button" onClick={engine.refreshDevices}>Rescan</button>
      </div>
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
      </div>
      <div className="engine-actions">
        <button type="button" onClick={engine.start} disabled={state.status === 'running'}>Start Engine</button>
        <button type="button" onClick={engine.stop} disabled={state.status !== 'running'}>Stop</button>
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
      <p>
        The engine is running in {state.mode || 'mock'} mode. Build the native helper to show real WASAPI loopback meters; routing remains the next backend step.
      </p>
      {state.pluginHost && (
        <div className="plugin-host-status">
          <span>Plugin host</span>
          <strong>{state.pluginHost.status}</strong>
          <small>{state.settings?.appEqBypassed ? 'App EQ bypassed' : `${state.settings?.pluginChain?.length || 0} plugins staged`}</small>
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
              </article>
            ))}
          </div>
        </div>
      )}
      {state.deviceScan?.error && <p className="engine-error">{state.deviceScan.error}</p>}
    </section>
  );
}

const docsColumns = [
  {
    icon: Radio,
    title: 'Web prototype',
    tone: 'teal',
    body: 'Resonance runs in the browser with modern web playback controls.',
    items: [
      'Mix two YouTube videos',
      'Independent deck volume',
      'Queue into either deck',
      'Mood presets for instant tone',
      'No installation required',
    ],
    note: 'YouTube iframe audio is browser-isolated, so presets adjust mix levels and EQ guidance.',
  },
  {
    icon: SlidersHorizontal,
    title: 'Direct audio EQ',
    tone: 'amber',
    body: 'Files and direct audio URLs can use real browser-side EQ processing.',
    items: [
      '8-band parametric curve',
      'Gain, Q, and frequency control',
      'Instrument-focused boosts',
      'Real-time spectrum analyzer',
      'Preset-driven profiles',
    ],
    note: 'Upload a file or use a direct audio URL to hear real EQ in the browser.',
  },
  {
    icon: Settings,
    title: 'Virtual audio roadmap',
    tone: 'teal',
    body: 'The long-term target is a desktop app with a virtual playback device.',
    items: [
      'Windows virtual playback device',
      'System-wide routing',
      'Per-source EQ and processing',
      'Crossfades and gain staging',
      'Output device selection',
    ],
    note: 'The driver plan is documented in the repository roadmap.',
  },
  {
    icon: Upload,
    title: 'Chrome EQ beta',
    tone: 'amber',
    body: 'Beta testers can install the Chrome extension package and process the current YouTube tab.',
    items: [
      'Download hosted beta zip',
      'Load unpacked in Chrome',
      'Capture active YouTube tab',
      'Apply real Web Audio EQ',
      'Test presets and manual bands',
    ],
    note: 'Use the beta package below for tester installs while Chrome Web Store review is pending.',
  },
];

const architectureSteps = [
  { icon: Globe, title: 'Chrome / YouTube', text: 'Browser or system audio plays into Resonance.' },
  { icon: AudioLines, title: 'Virtual Device', text: 'A playback endpoint receives the stream.' },
  { icon: SlidersHorizontal, title: 'Resonance Engine', text: 'EQ, dynamics, crossfades, and effects are applied.' },
  { icon: Volume2, title: 'Speakers / Headphones', text: 'Processed audio reaches the selected output.' },
];

function LandingPage() {
  return (
    <main className="landing-shell">
      <section className="landing-hero">
        <div className="landing-nav">
          <a className="landing-brand" href="/">
            <AudioLines aria-hidden="true" />
            <span>Resonance</span>
          </a>
          <nav>
            <a href="#documentation">Docs</a>
            <a href="https://github.com/iamfatness/resonance">GitHub</a>
            <a className="nav-cta" href="/app">Enter app</a>
          </nav>
        </div>

        <div className="hero-content">
          <div className="hero-copy">
            <h1>Resonance</h1>
            <h2><span>Route</span> the mood. <span>Mix</span> the signal.</h2>
            <p>
              Mix two YouTube decks, shape the feel with mood-driven EQ guidance, and follow the roadmap toward
              real virtual-audio processing.
            </p>
            <div className="hero-actions">
              <a className="primary-link" href="/app">
                Enter app
                <ArrowRight size={20} />
              </a>
              <a className="secondary-link" href="#documentation">
                Read docs
                <ArrowRight size={17} />
              </a>
            </div>
          </div>

          <div className="hero-visual" aria-label="Resonance product preview">
            <div className="visual-window">
              <div className="visual-toolbar">
                <span>Resonance</span>
                <div><i /><i /><i /></div>
              </div>
              <div className="visual-decks">
                <div>
                  <span>Deck A</span>
                  <div className="visual-video teal-video" />
                  <small>68%</small>
                </div>
                <div>
                  <span>Deck B</span>
                  <div className="visual-video amber-video" />
                  <small>72%</small>
                </div>
              </div>
              <div className="visual-eq">
                <svg viewBox="0 0 420 130" role="img" aria-label="EQ curve preview">
                  <path d="M0 94 C44 86 56 34 103 51 S162 79 204 42 S270 110 320 78 S378 58 420 84" />
                  {[42, 102, 164, 226, 310, 376].map((x, index) => (
                    <circle key={x} cx={x} cy={[78, 51, 72, 45, 82, 68][index]} r="6" />
                  ))}
                </svg>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="documentation" id="documentation">
        <div className="section-copy">
          <h2>Documentation</h2>
          <p>Everything needed to understand how Resonance works today and where it is headed.</p>
        </div>

        <div className="docs-grid">
          {docsColumns.map((column) => {
            const Icon = column.icon;
            return (
              <article className={`docs-panel ${column.tone}`} key={column.title}>
                <Icon size={28} />
                <h3>{column.title}</h3>
                <p>{column.body}</p>
                <ul>
                  {column.items.map((item) => (
                    <li key={item}><Check size={16} />{item}</li>
                  ))}
                </ul>
                <div className="docs-note">{column.note}</div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="extension-beta" id="extension-beta">
        <div className="section-copy">
          <h2>Chrome Extension Beta</h2>
          <p>Use the beta package to test real EQ on the current YouTube tab through Chrome tab capture.</p>
        </div>
        <div className="beta-layout">
          <div className="beta-actions">
            <a className="primary-link" href="/downloads/resonance-eq-0.1.0.zip" download>
              Download beta zip
              <ArrowRight size={20} />
            </a>
            <a className="secondary-link" href="https://github.com/iamfatness/resonance/blob/main/docs/extension-beta.md">
              Tester guide
              <ArrowRight size={17} />
            </a>
          </div>
          <ol>
            <li>Download and extract the zip.</li>
            <li>Open <code>chrome://extensions</code> and enable Developer mode.</li>
            <li>Choose Load unpacked and select the extracted folder.</li>
            <li>Open YouTube, click Resonance EQ, then press Start.</li>
          </ol>
        </div>
      </section>

      <section className="architecture">
        <div className="section-copy">
          <h2>Architecture</h2>
          <p>The future Resonance audio path.</p>
        </div>
        <div className="architecture-flow">
          {architectureSteps.map((step, index) => {
            const Icon = step.icon;
            return (
              <React.Fragment key={step.title}>
                <article>
                  <Icon size={34} />
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </article>
                {index < architectureSteps.length - 1 && <ArrowRight className="flow-arrow" size={34} />}
              </React.Fragment>
            );
          })}
        </div>
      </section>

      <footer className="landing-footer">
        <span>Resonance is in active development.</span>
        <a href="https://github.com/iamfatness/resonance">GitHub <ArrowRight size={14} /></a>
        <a href="/app">Enter app <ArrowRight size={14} /></a>
      </footer>
    </main>
  );
}

function PlayerApp() {
  const isIOS = useMemo(() => isIOSDevice(), []);
  const [deckA, setDeckA] = useState(demoVideoA);
  const [deckB, setDeckB] = useState(demoVideoB);
  const [queryA, setQueryA] = useState('https://www.youtube.com/watch?v=TW9d8vYrVFQ');
  const [queryB, setQueryB] = useState('https://www.youtube.com/watch?v=M7lc1UVf-VE');
  const [youtubeResults, setYoutubeResults] = useState([]);
  const [youtubeSearchDeck, setYoutubeSearchDeck] = useState('A');
  const [youtubeSearchState, setYoutubeSearchState] = useState({ status: 'idle', message: '' });
  const [activeDeck, setActiveDeck] = useState('A');
  const [deckCount, setDeckCount] = useState(isIOS ? 1 : 2);
  const [selectedPlaylistName, setSelectedPlaylistName] = useState(playlistCatalog[0].name);
  const [activeSidePanel, setActiveSidePanel] = useState('playlists');
  const [activePreset, setActivePreset] = useState('Focus');
  const [deckVolumes, setDeckVolumes] = useState(moodPresets.Focus.mix);
  const [directUrl, setDirectUrl] = useState('');
  const [eqMode, setEqMode] = useState('Preset');
  const [appEqBypassed, setAppEqBypassed] = useState(false);
  const [pluginChain, setPluginChain] = useState([]);
  const [likedVideos, setLikedVideos] = useState([demoVideoA.id]);
  const [playHistory, setPlayHistory] = useState([demoVideoA]);
  const [manualCurve, setManualCurve] = useState(flatCurve);
  const preset = moodPresets[activePreset];
  const [instrumentBoosts, setInstrumentBoosts] = useState(preset.instruments);
  const playerA = useYouTubePlayer(deckA.id, deckVolumes.A);
  const playerB = useYouTubePlayer(deckB.id, deckVolumes.B);
  const selectedPlaylist = playlistCatalog.find((playlist) => playlist.name === selectedPlaylistName) || playlistCatalog[0];
  const effectiveDeckCount = isIOS ? 1 : deckCount;
  const isSingleDeck = effectiveDeckCount === 1;
  const activeInputDeck = isSingleDeck ? 'A' : activeDeck;
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
    pluginChain,
    outputGain: deckVolumes.A / 100,
  }), [activePreset, appEqBypassed, deckVolumes.A, eqMode, pluginChain, processedCurve]);
  const desktopEngine = useDesktopEngine(desktopEngineSettings);
  const localEq = useLocalEq(activePreset, processedCurve, directUrl);

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

  function changeDeckCount(value) {
    const nextDeckCount = Number(value);
    setDeckCount(nextDeckCount);
    if (nextDeckCount === 1) setActiveDeck('A');
  }

  function togglePlugin(pluginId) {
    setPluginChain((current) => {
      if (current.some((plugin) => plugin.id === pluginId)) {
        return current.filter((plugin) => plugin.id !== pluginId);
      }
      const plugin = pluginCatalog.find((item) => item.id === pluginId);
      return plugin ? [...current, { ...plugin, bypassed: false }] : current;
    });
  }

  function togglePluginBypass(pluginId) {
    setPluginChain((current) => current.map((plugin) => (
      plugin.id === pluginId ? { ...plugin, bypassed: !plugin.bypassed } : plugin
    )));
  }

  function loadVideo(nextVideo, targetDeck = activeInputDeck) {
    const safeTargetDeck = isSingleDeck ? 'A' : targetDeck;
    if (safeTargetDeck === 'A') {
      setDeckA(nextVideo);
      setQueryA(`https://www.youtube.com/watch?v=${nextVideo.id}`);
    } else {
      setDeckB(nextVideo);
      setQueryB(`https://www.youtube.com/watch?v=${nextVideo.id}`);
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
    const pool = playlistCatalog.flatMap((playlist) => playlist.tracks);
    const nextVideo = pool[Math.floor(Math.random() * pool.length)] || demoVideoA;
    setActiveSidePanel('radio');
    loadVideo(nextVideo, activeInputDeck);
  }

  function sidebarLoad(video) {
    loadVideo(video, activeInputDeck);
  }

  async function submitVideo(event, targetDeck) {
    event.preventDefault();
    const safeTargetDeck = isSingleDeck ? 'A' : targetDeck;
    const query = (safeTargetDeck === 'A' ? queryA : queryB).trim();
    const id = parseYoutubeId(query);
    if (id) {
      loadVideo({ id, title: `Custom Deck ${safeTargetDeck} video`, channel: 'YouTube', duration: '--:--' }, safeTargetDeck);
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
              {isYoutubeLoadInput(activeInputDeck === 'A' ? queryA : queryB) ? 'Load' : 'Search'}
            </button>
          </form>
          {youtubeSearchState.status !== 'idle' && (
            <section className={`youtube-search-panel ${youtubeSearchState.status}`} aria-live="polite">
              <div className="youtube-search-status">
                <span>{youtubeSearchState.message}</span>
                {youtubeSearchState.status !== 'loading' && (
                  <button
                    type="button"
                    onClick={() => {
                      setYoutubeResults([]);
                      setYoutubeSearchState({ status: 'idle', message: '' });
                    }}
                    aria-label="Clear YouTube search results"
                  >
                    Clear
                  </button>
                )}
              </div>
              {youtubeResults.length > 0 && (
                <div className="youtube-result-list">
                  {youtubeResults.map((video) => (
                    <button
                      className="youtube-result"
                      key={video.id}
                      onClick={() => loadVideo(video, youtubeSearchDeck)}
                      type="button"
                    >
                      <img alt="" src={video.thumbnail || `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`} />
                      <span>
                        <strong>{video.title}</strong>
                        <small>{video.channel}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
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
        <button className="icon-button" aria-label="Settings"><Settings size={18} /></button>
      </header>

      <aside className="sidebar">
        <nav>
          {[
            ['now', CirclePlay, 'Now Playing'],
            ['library', Library, 'Library'],
            ['playlists', ListMusic, 'Playlists'],
            ['history', History, 'History'],
            ['liked', Heart, 'Liked Videos'],
            ['radio', Radio, 'Radio'],
          ].map(([panel, Icon, label]) => (
            <button
              className={activeSidePanel === panel ? 'active' : ''}
              key={panel}
              type="button"
              onClick={() => setActiveSidePanel(panel)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        {activeSidePanel === 'now' && (
          <section className="sidebar-panel">
            <div className="section-title">
              <span>Now Playing</span>
              <button type="button" onClick={() => toggleLikedVideo()}>
                {likedVideos.includes((activeDeck === 'A' ? deckA : deckB).id) ? <ThumbsUp size={15} /> : <Heart size={15} />}
              </button>
            </div>
            {[['A', deckA], ...(isSingleDeck ? [] : [['B', deckB]])].map(([label, video]) => (
              <button
                className={`side-track ${activeDeck === label ? 'active' : ''}`}
                key={label}
                type="button"
                onClick={() => setActiveDeck(label)}
              >
                <img alt="" src={`https://i.ytimg.com/vi/${video.id}/default.jpg`} />
                <span>
                  <strong>Deck {label}</strong>
                  <small>{video.title}</small>
                </span>
              </button>
            ))}
          </section>
        )}
        {activeSidePanel === 'library' && (
          <section className="sidebar-panel">
            <div className="section-title">
              <span>Library</span>
              <Library size={16} />
            </div>
            <div className="library-stat"><strong>{playlistCatalog.length}</strong><span>Playlists</span></div>
            <div className="library-stat"><strong>{new Set(playlistCatalog.flatMap((playlist) => playlist.tracks.map((track) => track.id))).size}</strong><span>Tracks</span></div>
            <div className="library-stat"><strong>{likedVideos.length}</strong><span>Liked</span></div>
          </section>
        )}
        {activeSidePanel === 'playlists' && (
          <section className="sidebar-panel">
            <div className="section-title">
              <span>Playlists</span>
              <Plus size={16} />
            </div>
            {playlistCatalog.map((playlist, index) => (
              <button
                className={`playlist-row ${selectedPlaylistName === playlist.name ? 'active' : ''}`}
                key={playlist.name}
                onClick={() => selectPlaylist(playlist)}
                type="button"
              >
                <span>{playlist.name}</span>
                <span>{playlist.tracks.length || [24, 31, 18, 27][index]}</span>
              </button>
            ))}
            <button className="playlist-row" type="button" onClick={() => setActivePreset('Focus')}>
              <span>Reference Tracks</span>
              <span>{queueSeed.length}</span>
            </button>
          </section>
        )}
        {activeSidePanel === 'history' && (
          <section className="sidebar-panel">
            <div className="section-title">
              <span>History</span>
              <button type="button" onClick={() => setPlayHistory([])}>Clear</button>
            </div>
            {playHistory.length === 0 && <p className="side-empty">No recent playback.</p>}
            {playHistory.map((video) => (
              <button className="side-track" key={video.id} type="button" onClick={() => sidebarLoad(video)}>
                <img alt="" src={`https://i.ytimg.com/vi/${video.id}/default.jpg`} />
                <span>
                  <strong>{video.title}</strong>
                  <small>{video.channel}</small>
                </span>
              </button>
            ))}
          </section>
        )}
        {activeSidePanel === 'liked' && (
          <section className="sidebar-panel">
            <div className="section-title">
              <span>Liked Videos</span>
              <Heart size={16} />
            </div>
            {queueSeed.filter((video) => likedVideos.includes(video.id)).length === 0 && <p className="side-empty">Like a deck to pin it here.</p>}
            {queueSeed.filter((video) => likedVideos.includes(video.id)).map((video) => (
              <button className="side-track" key={video.id} type="button" onClick={() => sidebarLoad(video)}>
                <img alt="" src={`https://i.ytimg.com/vi/${video.id}/default.jpg`} />
                <span>
                  <strong>{video.title}</strong>
                  <small>{video.channel}</small>
                </span>
              </button>
            ))}
          </section>
        )}
        {activeSidePanel === 'radio' && (
          <section className="sidebar-panel">
            <div className="section-title">
              <span>Radio</span>
              <Radio size={16} />
            </div>
            <button className="side-action" type="button" onClick={startRadio}>
              <Shuffle size={16} />
              Start from library
            </button>
            <p className="side-empty">Radio picks a track from the current library and loads it into the active deck.</p>
          </section>
        )}
      </aside>

      <section className="player-panel" id="now">
        <section className="mobile-playlists" aria-label="Mobile playlists">
          <div className="panel-heading">
            <h2>Playlists</h2>
            <span>{selectedPlaylist.tracks.length} tracks</span>
          </div>
          <div className="mobile-playlist-strip">
            {playlistCatalog.map((playlist) => (
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

        <section className="direct-source priority-source player-source">
          <div className="panel-heading">
            <h2>Upload / Paste Audio</h2>
            <BadgeInfo size={16} />
          </div>
          <div className="direct-controls">
            <label className="file-button">
              <Upload size={16} />
              <span>Audio File</span>
              <input
                type="file"
                accept="audio/*"
                onChange={(event) => localEq.setFile(event.target.files?.[0])}
              />
            </label>
            <input
              value={directUrl}
              onChange={(event) => setDirectUrl(event.target.value)}
              placeholder="Paste direct audio URL"
            />
          </div>
          <audio
            ref={localEq.audioRef}
            src={localEq.audioSource || undefined}
            controls
            crossOrigin="anonymous"
            onPlay={localEq.activate}
          />
          <canvas ref={localEq.graphRef} width="460" height="120" />
        </section>

        <DesktopEnginePanel engine={desktopEngine} />

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
            active={activeDeck === 'A'}
            onActivate={() => setActiveDeck('A')}
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
              active={activeDeck === 'B'}
              onActivate={() => setActiveDeck('B')}
            />
          )}
        </div>

        <div className="mix-status">
          <div>
            <h2>{activePreset} {isSingleDeck ? 'single-deck mode' : 'mix is active'}</h2>
            <p>{isSingleDeck ? `${selectedPlaylist.name} is ready for focused playback on Deck A.` : preset.intent}</p>
          </div>
          <div className="track-actions">
            <button className="icon-button" aria-label="Like"><ThumbsUp size={18} /></button>
            <button className="icon-button" aria-label="Dislike"><ThumbsDown size={18} /></button>
            <button className="icon-button" aria-label="Queue"><ListMusic size={18} /></button>
          </div>
        </div>

        <div className="queue-header">
          <h2>{isSingleDeck ? selectedPlaylist.name : `Load Into Deck ${activeDeck}`}</h2>
          <label className="toggle">
            <input type="checkbox" checked readOnly />
            <span>{isSingleDeck ? 'Single deck' : 'Use selected deck'}</span>
          </label>
        </div>
        <div className="queue">
          {selectedPlaylist.tracks.map((item) => (
            <button
              className={`queue-item ${item.id === deckA.id || (!isSingleDeck && item.id === deckB.id) ? 'selected' : ''}`}
              key={item.id}
              onClick={() => loadVideo(item)}
            >
              <div className="thumb">
                <img alt="" src={`https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`} />
              </div>
              <div>
                <strong>{item.title}</strong>
                <span>{item.channel}</span>
              </div>
              <small>{item.duration}</small>
              <SlidersHorizontal size={16} />
            </button>
          ))}
        </div>
      </section>

      <aside className="eq-panel">
        <section>
          <div className="panel-heading">
            <h2>Mood Presets</h2>
            <BadgeInfo size={16} />
          </div>
          <div className="preset-grid">
            {Object.entries(moodPresets).map(([name, data]) => {
              const Icon = data.icon;
              return (
                <button
                  className={`preset-button ${activePreset === name ? 'active' : ''}`}
                  key={name}
                  onClick={() => applyMoodPreset(name)}
                >
                  <Icon size={21} />
                  <span>{name}</span>
                </button>
              );
            })}
          </div>
          <div className="preset-effect">
            <strong>{activePreset}</strong>
            <span>Deck A {deckVolumes.A}%</span>
            {!isSingleDeck && <span>Deck B {deckVolumes.B}%</span>}
            <span>EQ {appEqBypassed ? 'Bypassed' : eqMode}</span>
          </div>
        </section>

        <section>
          <div className="panel-heading">
            <h2>Plugin Rack</h2>
            <SlidersHorizontal size={16} />
          </div>
          <label className="eq-bypass-toggle">
            <input
              type="checkbox"
              checked={appEqBypassed}
              onChange={(event) => setAppEqBypassed(event.target.checked)}
            />
            <span>Bypass app EQ</span>
            <strong>{appEqBypassed ? 'On' : 'Off'}</strong>
          </label>
          <div className="plugin-list">
            {pluginCatalog.map((plugin) => {
              const selectedPlugin = pluginChain.find((item) => item.id === plugin.id);
              return (
                <article className={`plugin-item ${selectedPlugin ? 'active' : ''}`} key={plugin.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(selectedPlugin)}
                      onChange={() => togglePlugin(plugin.id)}
                    />
                    <span>
                      <strong>{plugin.name}</strong>
                      <small>{plugin.vendor}</small>
                    </span>
                  </label>
                  <button
                    type="button"
                    disabled={!selectedPlugin}
                    onClick={() => togglePluginBypass(plugin.id)}
                  >
                    {selectedPlugin?.bypassed ? 'Bypassed' : plugin.status}
                  </button>
                </article>
              );
            })}
          </div>
        </section>

        <section>
          <div className="panel-heading">
            <h2>Instrument Boost</h2>
            <BadgeInfo size={16} />
          </div>
          <div className="instrument-grid">
            {Object.entries(instrumentMeta).map(([name, meta]) => {
              const Icon = meta.icon;
              return (
                <label className="instrument" key={name}>
                  <Icon size={20} />
                  <span>{name}</span>
                  <input
                    type="range"
                    min="-6"
                    max="6"
                    step="0.5"
                    value={instrumentBoosts[name]}
                    onInput={(event) => setInstrumentBoost(name, Number(event.currentTarget.value))}
                    onChange={(event) => setInstrumentBoost(name, Number(event.target.value))}
                    aria-label={`${name} instrument boost`}
                  />
                  <strong>{instrumentBoosts[name] > 0 ? '+' : ''}{instrumentBoosts[name].toFixed(1)} dB</strong>
                  <small>{meta.band}</small>
                </label>
              );
            })}
          </div>
        </section>

        <section>
          <div className="panel-heading">
            <h2>8-Band Equalizer</h2>
            <select value={eqMode} onChange={(event) => changeEqMode(event.target.value)}>
              <option>Preset</option>
              <option>Manual</option>
            </select>
          </div>
          <div className="eq-graph">
            <svg viewBox="0 0 400 130" role="img" aria-label={`${eqMode} EQ curve with instrument boosts`}>
              <g className="grid-lines">
                {[20, 49, 78, 107].map((y) => <line key={y} x1="0" x2="400" y1={y} y2={y} />)}
                {[20, 71, 122, 173, 224, 275, 326, 377].map((x) => <line key={x} x1={x} x2={x} y1="8" y2="118" />)}
              </g>
              <path d={eqPath} className="eq-line" />
              {processedCurve.map((gain, index) => (
                <circle key={bands[index]} cx={20 + index * 51} cy={78 - (gain / 12) * 46} r="6" />
              ))}
            </svg>
            <div className="band-labels">
              {bands.map((band) => <span key={band}>{band}</span>)}
            </div>
          </div>
          <div className="manual-eq">
            <div className="manual-eq-header">
              <span>{eqMode === 'Manual' ? 'Manual base curve' : `${activePreset} base curve`}</span>
              <button type="button" onClick={resetManualCurve}>Flat manual</button>
            </div>
            <div className="manual-band-grid">
              {bands.map((band, index) => {
                const baseGain = eqMode === 'Manual' ? manualCurve[index] : preset.curve[index];
                return (
                  <label className="manual-band" key={band}>
                    <span>{band}</span>
                    <input
                      className="manual-band-slider"
                      type="range"
                      min="-12"
                      max="12"
                      step="0.5"
                      value={baseGain}
                      onPointerDown={() => changeEqMode('Manual')}
                      onFocus={() => changeEqMode('Manual')}
                      onInput={(event) => setManualBand(index, Number(event.currentTarget.value))}
                      onChange={(event) => setManualBand(index, Number(event.target.value))}
                      aria-label={`${band} Hz manual EQ band`}
                    />
                    <div className="manual-band-values">
                      <input
                        className="manual-band-number"
                        type="number"
                        min="-12"
                        max="12"
                        step="0.5"
                        value={baseGain}
                        onFocus={() => changeEqMode('Manual')}
                        onInput={(event) => setManualBand(index, Number(event.currentTarget.value))}
                        onChange={(event) => setManualBand(index, Number(event.target.value))}
                        aria-label={`${band} Hz manual EQ dB value`}
                      />
                      <strong>{processedCurve[index] > 0 ? '+' : ''}{processedCurve[index].toFixed(1)} dB</strong>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </section>

        <div className="compat-note">
          <BadgeInfo size={18} />
          <p>
            EQ and instrument boosts process direct audio sources. YouTube iframe audio is isolated by the browser,
            so mood presets apply YouTube deck volumes plus preset guidance, while direct audio receives the real EQ curve.
          </p>
        </div>
      </aside>

      <footer className="transport">
        <button className="icon-button" aria-label="Shuffle"><Shuffle size={19} /></button>
        <button className="icon-button" aria-label="Previous"><SkipBack size={21} /></button>
        <button className="play-button" onClick={toggleBothDecks} aria-label={playerA.playing || (!isSingleDeck && playerB.playing) ? 'Pause playback' : 'Play playback'}>
          {playerA.playing || playerB.playing ? <Pause size={27} /> : <Play size={27} />}
        </button>
        <button className="icon-button" aria-label="Next"><SkipForward size={21} /></button>
        <button className="icon-button" aria-label="Repeat"><Repeat2 size={19} /></button>
        <div className="mini-track">
          <img alt="" src={`https://i.ytimg.com/vi/${activeDeck === 'A' ? deckA.id : deckB.id}/mqdefault.jpg`} />
          <div>
            <strong>{activeDeck === 'A' ? deckA.title : deckB.title}</strong>
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
        <FastForward size={18} />
      </footer>
    </main>
  );
}

function App() {
  function currentRoute() {
    const params = new URLSearchParams(window.location.search);
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

  return path === '/app' ? <PlayerApp /> : <LandingPage />;
}

createRoot(document.getElementById('root')).render(<App />);

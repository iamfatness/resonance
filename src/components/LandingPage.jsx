import React from 'react';
import {
  ArrowRight,
  AudioLines,
  Check,
  Globe,
  Radio,
  Settings,
  SlidersHorizontal,
  Upload,
  Volume2,
} from 'lucide-react';

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
  {
    icon: SlidersHorizontal,
    title: 'Resonance Engine',
    text: 'EQ, dynamics, crossfades, and effects are applied.',
  },
  { icon: Volume2, title: 'Speakers / Headphones', text: 'Processed audio reaches the selected output.' },
];

export function LandingPage() {
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
            <a href="https://github.com/iamfatness/resonance/blob/main/docs/known-limitations.md">Limits</a>
            <a className="nav-cta" href="/app">Enter app</a>
          </nav>
        </div>

        <div className="hero-content">
          <div className="hero-copy">
            <h1>Resonance</h1>
            <h2>
              <span>Route</span> the mood. <span>Mix</span> the signal.
            </h2>
            <p>
              Mix two YouTube decks, shape the feel with mood-driven EQ guidance, and follow the
              roadmap toward real virtual-audio processing.
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
                <div>
                  <i />
                  <i />
                  <i />
                </div>
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
                    <li key={item}>
                      <Check size={16} />
                      {item}
                    </li>
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
            <a
              className="secondary-link"
              href="https://github.com/iamfatness/resonance/blob/main/docs/extension-beta.md"
            >
              Tester guide
              <ArrowRight size={17} />
            </a>
            <a
              className="secondary-link"
              href="https://github.com/iamfatness/resonance/blob/main/docs/known-limitations.md"
            >
              Known limits
              <ArrowRight size={17} />
            </a>
          </div>
          <ol>
            <li>Download and extract the zip.</li>
            <li>
              Open <code>chrome://extensions</code> and enable Developer mode.
            </li>
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
                {index < architectureSteps.length - 1 && (
                  <ArrowRight className="flow-arrow" size={34} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </section>

      <footer className="landing-footer">
        <span>Resonance is in active development.</span>
        <a href="https://github.com/iamfatness/resonance">
          GitHub <ArrowRight size={14} />
        </a>
        <a href="/app">
          Enter app <ArrowRight size={14} />
        </a>
      </footer>
    </main>
  );
}

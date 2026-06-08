# Known Limitations and Safety Notes

## YouTube Playback

- Browser YouTube iframe audio cannot be routed through the web app EQ graph.
- Web mood presets affect YouTube deck volume, mix balance, and EQ guidance.
- Real browser EQ works for direct audio files, direct audio URLs, and the Chrome tab-capture extension.
- iOS browsers allow only one YouTube video stream at a time, so Resonance defaults to one-deck playlist playback on iPhone and iPad.

## YouTube Data

- Search and playlist import use public YouTube Data API responses.
- Resonance does not require Google login for public playlist import.
- Private playlists, account libraries, subscriptions, and Premium status are not read.
- `YOUTUBE_API_KEY` must be stored as a local environment variable or Cloudflare Worker secret, never committed.

## Desktop Audio

- The main desktop path does not require a virtual driver; app-owned sources such as WAV, pushed PCM, and capture streams can be routed through the native engine.
- YouTube iframe audio remains browser-isolated in the web app. The desktop app now has an experimental driverless process-loopback capture path for the app renderer process, plus endpoint loopback/capture and Chrome extension options.
- The local SysVAD package is test-signed and cannot be installed on Secure Boot machines.
- Secure Boot beta machines require a Microsoft-signed production or attestation driver package.
- The virtual audio endpoint is now an optional system-wide routing track and still needs target-machine install validation and a sustained Deck A/B capture pass.

## Plugin Hosting

- Built-in NativeDSP processing is active for staged deck plugin chains.
- VST3 metadata can be loaded in the sandbox helper, and the native bridge can process internal test blocks plus external interleaved PCM16 blocks through a loaded VST3 processor.
- The native router can route continuous live Deck A/B PCM blocks through the first staged bridge-capable VST3 plugin per deck and forwards normalized exposed parameter values only for plugins that pass the parameter-forwarding probe. Rich plugin-specific display/unit conversion is not implemented yet.
- Waves candidates are detected as VST2/VST3 vendor shells for planning. If a Waves shell returns silence for non-silent input, Resonance falls back to the built-in NativeDSP lane instead of muting the deck.
- Plugin failures must stay contained in the helper process before third-party execution is enabled.

## Chrome Extension

- The extension processes the active captured tab only, not system-wide audio.
- Chrome shows a capture indicator while tab capture is active.
- Captured audio and EQ settings stay local in Chrome.
- Chrome Web Store distribution is not ready until beta tab-capture behavior and listing disclosures are validated.

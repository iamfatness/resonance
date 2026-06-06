# Resonance Release Checklist

Use this checklist before publishing a beta update.

## Local Verification

```powershell
npm run lint
npm test
npm run build
npm run smoke:browser
npm run native:audio-router
npm run desktop:package
npm run package:extension
```

## Cloudflare Deploy

Required production secret:

```powershell
npx wrangler secret put YOUTUBE_API_KEY --config wrangler.worker.jsonc
```

Deploy:

```powershell
npm run deploy:worker
```

Smoke the live route:

```powershell
npm run smoke:deploy
```

Record the Worker version ID printed by Wrangler in `docs/roadmap.md` or the release notes for the beta build.

## Beta Artifacts

- Desktop package: `release/Resonance-local/Resonance.exe`
- Desktop package manifest: `release/Resonance-local/resonance-package.json`
- Extension zip: `public/downloads/resonance-eq-0.1.0.zip`
- Extension package metadata: `public/downloads/resonance-eq-0.1.0.json`

## Manual Checks

- Search by keyword and load a result.
- Import a public YouTube playlist and confirm duplicates are skipped.
- Queue, move, load, and remove videos.
- Toggle one-deck and two-deck modes on desktop.
- Check iOS-sized layout with playlist controls visible.
- In Electron, export a diagnostics bundle and confirm no secrets are present.
- In Chrome, load the extension unpacked and verify Start/Stop restores tab playback.

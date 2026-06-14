# Native builds, SysVAD driver, packaging & deploy

All native/driver/packaging scripts are PowerShell under `scripts/`, each exposed
as an npm alias. They are Windows-only (CMake + MSVC for natives; WDK + MSBuild
for the driver). Run them on Windows with the right toolchain installed.

## Native binaries (CMake + MSVC → `native/<tool>/build/Release/*.exe`)

| npm alias | Script | Output / purpose |
|---|---|---|
| `native:audio-router` | `build-audio-router.ps1` | `resonance-audio-router.exe` — persistent WASAPI mixer for Deck A/B PCM, EQ, pan, NativeDSP, output selection |
| `native:vst3-bridge` | `build-vst3-bridge.ps1` | `resonance-vst3-bridge.exe` — VST3 host bridge; **links `third_party/vst3sdk`** |
| `native:wasapi-meter` | `build-wasapi-meter.ps1` | `resonance-wasapi-meter.exe` — device enumeration + level metering |

Each script calls `vcvars64.bat`, then
`cmake -S <src> -B <build> -A x64 && cmake --build <build> --config Release`.
Requires Visual Studio Build Tools (MSVC), CMake, and the Windows SDK.

**Submodule first:** `git submodule update --init --recursive third_party/vst3sdk`
before building the VST3 bridge — it links Steinberg SDK headers
(`pluginterfaces/...`, `public.sdk/source/vst/hosting/module.h`).

## SysVAD virtual-audio driver (optional, future system-wide routing)

The driver is **not** required for the main app — app-owned user-mode routing is
the product direction (see `docs/virtual-audio-device.md`). The kernel driver is a
baseline experiment; EQ logic stays in user mode. Run these in order, and start
with preflight (non-destructive):

| Order | npm alias | Script | Purpose |
|---|---|---|---|
| setup | `driver:install:wdk-buildtools` | `install-wdk-buildtools.ps1` | Add the Windows Driver Kit component via the VS installer (once per machine) |
| 0 | `driver:preflight` | `driver-preflight.ps1` | Read-only readiness: WDK, MSBuild, toolsets, Secure Boot, test-signing, package presence |
| 1 | `driver:customize:resonance` | `customize-sysvad-resonance.ps1` | Patch the (git-ignored) SysVAD checkout: endpoint name, device strings, hardware id |
| 2 | `driver:build` | `build-sysvad.ps1` | MSBuild → `.inf` / `.cat` / `.sys` componentized package |
| 3 | `driver:package-signing` | `package-driver-signing.ps1` | Zip the package + manifest → `release/driver-signing/...zip` for Microsoft Hardware Dev Center submission |
| 4 | `driver:verify-signing` | `verify-driver-signing.ps1` | Check INF/CAT/SYS, Authenticode signature, SignTool verify, SHA256 |
| 5 | `driver:capture-readiness` | `driver-capture-readiness.ps1` | Read-only: built package, Secure Boot, test-signing, active endpoint, router binary, sustained-capture requirement |
| 6 | `driver:install:sysvad` | `install-sysvad.ps1` | `pnputil /add-driver` — installs the test-signed package |

**Signing reality:** a locally test-signed package installs **only** with Secure
Boot **off** and test-signing **on** (VM/test machines). Production distribution
needs a Microsoft-signed package (attestation/HLK). `verify-driver-signing` works
for either path.

## Packaging & distribution

| npm alias | Script | Output |
|---|---|---|
| `desktop:package` | `package-desktop-local.ps1` | `release/Resonance-local/Resonance.exe` — portable build incl. engine + natives |
| `desktop:installer` | `build-desktop-installer.ps1` | `release/installer/Resonance-Setup-<version>-x64.exe` — NSIS installer |
| `package:extension` | `package-extension.ps1` | `public/downloads/resonance-eq-<version>.zip` — Chrome extension bundle |

## Deploy (Cloudflare, `resonance.iamfatness.us`)

| npm alias | Command | Notes |
|---|---|---|
| `deploy` | `npm run build && wrangler pages deploy dist --project-name resonance --branch main --commit-dirty=true` | Static React app, config `wrangler.jsonc` |
| `deploy:worker` | `npm run build && wrangler deploy --config wrangler.worker.jsonc` | API worker, `src/worker.js`, SPA fallback; needs the `YOUTUBE_API_KEY` secret (`npx wrangler secret put YOUTUBE_API_KEY --config wrangler.worker.jsonc`) |

## Release checklist (from `docs/release-checklist.md`)

1. `npm run lint && npm test && npm run build`
2. `npm run smoke:browser` (local Playwright)
3. Native: `npm run native:audio-router && npm run native:vst3-bridge`
4. Driver (if shipping it): `npm run driver:package-signing && npm run driver:verify-signing`
5. Desktop: `npm run desktop:package && npm run desktop:installer`
6. Deploy: `npm run deploy:worker` (set `YOUTUBE_API_KEY` first), then `npm run deploy`
7. `npm run smoke:deploy` (Playwright against the live URL)

## Known limitations to keep in mind (from `docs/known-limitations.md`)

- YouTube iframe audio is isolated by the browser — web mood presets affect
  volume/pan only, never EQ.
- iOS allows a single YouTube stream → mobile defaults to 1-deck playlist mode.
- Desktop audio is app-owned, not system-wide; no virtual device required for
  WAV/PCM/capture.
- VST3 is probe-only until a plugin passes metadata load + PCM test; Waves is a
  vendor/shell classification (VST2 or VST3), not a separate format.
- Exposed plugin parameters are normalized to [0,1]; unit conversion isn't
  implemented yet.

# Resonance Virtual Audio Device

## Goal

Build a Windows virtual audio endpoint that lets users route system or browser audio into Resonance, process it with the Resonance engine, and send the processed stream to the real output device.

```text
Chrome / YouTube / system audio
  -> Resonance Virtual Playback Device
  -> Resonance processing engine
  -> physical speakers or headphones
```

## Recommended Windows Architecture

Use Microsoft's SysVAD sample as the driver baseline. Keep the kernel driver small and treat it primarily as a routing endpoint. Put EQ, gain, crossfade, limiter, and mood logic in a user-mode Resonance engine/service where it can be updated and debugged without shipping a new kernel driver.

Initial components:

- `Resonance Virtual Playback Device`: Windows audio render endpoint based on SysVAD.
- `Resonance Engine`: user-mode process that captures the endpoint stream, applies DSP, and renders to the selected physical output.
- `Resonance UI`: existing React interface, later hosted in Electron or Tauri.

Avoid putting the main DSP engine inside the kernel driver at first. Driver DSP increases signing, stability, and debugging risk.

## Local Driver Workspace

The Microsoft Windows driver sample can be checked out locally with sparse checkout:

```powershell
git clone --filter=blob:none --sparse https://github.com/microsoft/Windows-driver-samples.git driver
git -C driver sparse-checkout set audio/sysvad
```

The local `driver/` directory is intentionally ignored by this repo. It should be treated as a Microsoft sample dependency until Resonance has its own minimal driver project.

Source:

- Microsoft Learn: https://learn.microsoft.com/en-us/samples/microsoft/windows-driver-samples/sysvad-virtual-audio-device-driver-sample/
- Microsoft sample repo: https://github.com/microsoft/Windows-driver-samples/tree/main/audio/sysvad
- APO architecture: https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/audio-processing-object-architecture

## Current Status

The machine can build the unmodified Microsoft SysVAD sample. The working local toolchain is:

- Visual Studio Community 2026 with the Windows Driver Kit component.
- Windows SDK/WDK 10.0.28000.
- Microsoft WIL populated through the `driver/wil` submodule.

```powershell
npm run driver:preflight
npm run driver:build
```

Customize the ignored SysVAD checkout into the current Resonance prototype before building:

```powershell
npm run driver:customize:resonance
npm run driver:build
```

The customization keeps the Microsoft sample project structure, but changes the local driver workspace to:

- expose a single virtual playback endpoint,
- use Resonance-facing device/provider strings,
- use a Resonance root hardware ID for the componentized package.

If the WDK files are installed but the Visual Studio platform toolsets are missing, add the Visual Studio WDK component:

```powershell
npm run driver:install:wdk-buildtools
```

This wraps Visual Studio Installer with Microsoft's component ID:

```text
Component.Microsoft.Windows.DriverKit
```

Check the local driver readiness state without installing anything:

```powershell
npm run driver:preflight
```

Check the driver/capture production readiness state after building or installing the package:

```powershell
npm run driver:capture-readiness
```

This check does not install or remove anything. It reports:

- whether the built SysVAD package exists,
- whether the current machine is on the Secure Boot production-signing path or the VM/test-signing path,
- whether Windows exposes an active Resonance audio endpoint,
- whether that endpoint appears usable as a capture input,
- whether the native Deck A/B audio router helper is built,
- the remaining manual sustained-capture validation step.

## Required Local Setup

Install the Windows Driver Kit integration for Visual Studio. The required pieces are:

- Windows Driver Kit
- WDK Visual Studio extension / driver build tools
- MSVC x64/x86 C++ build tools
- Spectre-mitigated libraries if the projects request them

After installation, rerun:

```powershell
npm run driver:build
```

Install the built SysVAD driver package from an elevated PowerShell window only after the build succeeds and only on a VM/test machine that does not require Secure Boot:

```powershell
npm run driver:install:sysvad
```

The install script intentionally refuses to continue unless:

- PowerShell is elevated.
- Secure Boot is disabled.
- Windows test signing is enabled.
- the built componentized SysVAD package exists under `driver/audio/sysvad/x64/Debug/package`.

Enable test signing from an elevated PowerShell window on a VM/test machine, then reboot:

```powershell
bcdedit /set testsigning on
```

Do not turn off Secure Boot on a primary machine that must keep it enabled. For that environment, the Resonance driver needs to move from local WDK test signing to Microsoft driver signing:

1. Create a Hardware Dev Center account.
2. Sign the package with the required organization certificate.
3. Submit the driver package for Microsoft attestation or HLK signing.
4. Install the Microsoft-signed package on Secure Boot systems.

After any install path, rerun:

```powershell
npm run driver:capture-readiness
```

The Secure Boot-compatible path is production or attestation signing. A Secure Boot beta machine should only receive a Microsoft-signed package; the local test-signed SysVAD package is for non-critical VMs or dedicated test machines with Secure Boot disabled.

## Capture Test Checklist

Use this checklist before marking the virtual audio path beta-ready:

1. Build the native router helper:

   ```powershell
   npm run native:audio-router
   ```

2. Build and sign the driver package for the target path:

   ```powershell
   npm run driver:customize:resonance
   npm run driver:build
   npm run driver:capture-readiness
   ```

3. Install only the package type allowed for the target machine:
   - Secure Boot enabled: install the Microsoft-signed Resonance package.
   - Secure Boot disabled VM/test machine: use `npm run driver:install:sysvad` from elevated PowerShell after enabling test signing and rebooting.

4. Open the desktop app:

   ```powershell
   npm run desktop:dev
   ```

5. In the desktop engine panel, confirm the Resonance capture endpoint is selected, then start continuous capture for Deck A and Deck B.
6. Run a sustained session for at least 20 minutes. Pass only if both decks show live meters, no stale capture state remains after stop/start, and underruns/capture failures are visible in diagnostics.

## Rollback

For VM/test-machine installs, remove the test package from an elevated PowerShell window:

```powershell
pnputil /enum-drivers
pnputil /delete-driver <published-oem-inf> /uninstall /force
```

Use the `Published Name` that corresponds to the Resonance/SysVAD package. Reboot if Windows keeps the endpoint until the next device refresh.

If test signing was enabled only for driver validation, disable it and reboot:

```powershell
bcdedit /set testsigning off
```

For Secure Boot machines, uninstall through Windows Settings or `pnputil` using the Microsoft-signed package's published INF. Keep the signed package and install log with the beta report so endpoint, signing, and rollback issues can be traced.

## First Milestones

1. Build the unmodified SysVAD sample.
2. Rename and reduce the endpoint set to the minimum Resonance virtual playback device.
3. Install the test-signed driver on a dedicated test machine or VM, or prepare Microsoft signing for Secure Boot machines.
4. Confirm Windows exposes the virtual playback endpoint.
5. Add a user-mode Resonance engine that captures from the virtual endpoint and outputs to the selected physical endpoint.
6. Wire the existing mood presets into the engine as real DSP parameters.

## Safety Notes

Driver development can make audio unstable or require reboot/recovery. Use a VM or non-critical test machine first. Do not install unsigned or test-signed kernel drivers on a primary machine unless test signing and recovery steps are understood.

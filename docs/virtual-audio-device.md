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

## Current Blocker

The machine has Visual Studio Build Tools and Windows Kit headers, but it does not currently have the WDK Visual Studio driver toolsets required by SysVAD.

The attempted build was:

```powershell
& 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\amd64\MSBuild.exe' `
  driver\audio\sysvad\sysvad.sln `
  /p:Configuration=Debug `
  /p:Platform=x64 `
  /m
```

It failed because these platform toolsets are missing:

- `WindowsKernelModeDriver10.0`
- `WindowsApplicationForDrivers10.0`

## Required Local Setup

Install the Windows Driver Kit integration for Visual Studio 2022 Build Tools. The required pieces are:

- Windows Driver Kit
- WDK Visual Studio extension / driver build tools
- MSVC x64/x86 C++ build tools
- Spectre-mitigated libraries if the projects request them

After installation, rerun:

```powershell
& 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\amd64\MSBuild.exe' `
  driver\audio\sysvad\sysvad.sln `
  /p:Configuration=Debug `
  /p:Platform=x64 `
  /m
```

## First Milestones

1. Build the unmodified SysVAD sample.
2. Install the test-signed driver on a dedicated test machine or VM.
3. Confirm Windows exposes the virtual playback endpoint.
4. Rename and reduce the endpoint set to the minimum Resonance device.
5. Add a user-mode Resonance engine that captures from the virtual endpoint and outputs to the selected physical endpoint.
6. Wire the existing mood presets into the engine as real DSP parameters.

## Safety Notes

Driver development can make audio unstable or require reboot/recovery. Use a VM or non-critical test machine first. Do not install unsigned or test-signed kernel drivers on a primary machine unless test signing and recovery steps are understood.

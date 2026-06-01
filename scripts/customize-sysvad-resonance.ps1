$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$sysvadRoot = Join-Path $root 'driver\audio\sysvad'
$tabletRoot = Join-Path $sysvadRoot 'TabletAudioSample'
$miniPairs = Join-Path $tabletRoot 'minipairs.h'
$audioInf = Join-Path $tabletRoot 'ComponentizedAudioSample.inx'
$extensionInf = Join-Path $tabletRoot 'ComponentizedAudioSampleExtension.inx'
$apoInf = Join-Path $tabletRoot 'ComponentizedApoSample.inx'

foreach ($path in @($miniPairs, $audioInf, $extensionInf, $apoInf)) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Expected SysVAD file not found: $path"
  }
}

function Set-ContentIfChanged($Path, $Content) {
  $current = Get-Content -LiteralPath $Path -Raw
  if ($current -ne $Content) {
    Set-Content -LiteralPath $Path -Value $Content -NoNewline
    Write-Host "Updated $Path"
  } else {
    Write-Host "Already current $Path"
  }
}

function Replace-Required($Text, $Pattern, $Replacement, $Description) {
  if ($Text -match [regex]::Escape($Replacement)) {
    return $Text
  }

  $updated = [regex]::Replace($Text, $Pattern, $Replacement, 'Singleline')
  if ($updated -eq $Text) {
    throw "Failed to update $Description"
  }
  return $updated
}

function Remove-Optional($Text, $Pattern, $Description) {
  $updated = [regex]::Replace($Text, $Pattern, '', 'Singleline')
  if ($updated -ne $Text) {
    Write-Host "Removed $Description"
  }
  return $updated
}

$miniPairsContent = Get-Content -LiteralPath $miniPairs -Raw
$renderBlock = @'
PENDPOINT_MINIPAIR  g_RenderEndpoints[] = 
{
    &SpeakerMiniports,
};

#define g_cRenderEndpoints  (SIZEOF_ARRAY(g_RenderEndpoints))
'@
$captureBlock = @'
PENDPOINT_MINIPAIR  g_CaptureEndpoints[1] = 
{
    NULL,
};

static ULONG g_cCaptureEndpoints = 0;
'@
$miniPairsContent = Replace-Required `
  $miniPairsContent `
  'PENDPOINT_MINIPAIR\s+g_RenderEndpoints\[\]\s*=\s*\{.*?\};\s*#define\s+g_cRenderEndpoints\s+\(SIZEOF_ARRAY\(g_RenderEndpoints\)\)' `
  $renderBlock `
  'render endpoint list'
$miniPairsContent = Replace-Required `
  $miniPairsContent `
  'PENDPOINT_MINIPAIR\s+g_CaptureEndpoints(?:\[\]|\[1\])\s*=\s*\{.*?\};\s*(?:#define\s+g_cCaptureEndpoints\s+\((?:SIZEOF_ARRAY\(g_CaptureEndpoints\)|0)\)|static\s+ULONG\s+g_cCaptureEndpoints\s*=\s*0;)' `
  $captureBlock `
  'capture endpoint list'
Set-ContentIfChanged $miniPairs $miniPairsContent

$audioInfContent = Get-Content -LiteralPath $audioInf -Raw
$interfacesBlock = @'
[SYSVAD_SA.NT.Interfaces]
;
; Resonance virtual playback endpoint.
;
AddInterface=%KSCATEGORY_AUDIO%, %KSNAME_WaveSpeaker%, SYSVAD.I.WaveSpeaker
AddInterface=%KSCATEGORY_RENDER%, %KSNAME_WaveSpeaker%, SYSVAD.I.WaveSpeaker
AddInterface=%KSCATEGORY_REALTIME%, %KSNAME_WaveSpeaker%, SYSVAD.I.WaveSpeaker
AddInterface=%KSCATEGORY_AUDIO%, %KSNAME_TopologySpeaker%, SYSVAD.I.TopologySpeaker
AddInterface=%KSCATEGORY_TOPOLOGY%, %KSNAME_TopologySpeaker%, SYSVAD.I.TopologySpeaker

'@
$audioInfContent = Replace-Required `
  $audioInfContent `
  '\[SYSVAD_SA\.NT\.Interfaces\].*?(?=\[SYSVAD_SA\.NT\.Services\])' `
  $interfacesBlock `
  'INF interface list'
$audioInfContent = Remove-Optional `
  $audioInfContent `
  ';======================================================\s*;\s*render interfaces: HDMI \(external\).*?(?=;======================================================\s*;\s*SYSVAD_SA\s*;======================================================\s*\[SYSVAD_SA\.NT\])' `
  'unused non-Resonance endpoint INF sections'

$stringReplacements = @{
  'Root\\sysvad_ComponentizedAudioSample' = 'Root\resonance_virtual_audio'
  'ProviderName = "TODO-Set-Provider"' = 'ProviderName = "Resonance"'
  'MfgName      = "TODO-Set-Manufacturer"' = 'MfgName      = "Resonance"'
  'MsCopyRight  = "TODO-Set-Copyright"' = 'MsCopyRight  = "Copyright Resonance"'
  'SYSVAD_SA.DeviceDesc="Virtual Audio Device \(WDM\) - Tablet Sample"' = 'SYSVAD_SA.DeviceDesc="Resonance Virtual Audio Device"'
  'SYSVAD_ComponentizedAudioSample.SvcDesc="Virtual Audio Device \(WDM\) - Tablet Sample Driver"' = 'SYSVAD_ComponentizedAudioSample.SvcDesc="Resonance Virtual Audio Driver"'
  'SYSVAD_MIDI="Virtual Audio Device \(WDM\) - Midi Device"' = 'SYSVAD_MIDI="Resonance Virtual MIDI Device"'
  'SYSVAD\.WaveSpeaker\.szPname="SYSVAD Wave Speaker"' = 'SYSVAD.WaveSpeaker.szPname="Resonance Virtual Playback"'
  'SYSVAD\.TopologySpeaker\.szPname="SYSVAD Topology Speaker"' = 'SYSVAD.TopologySpeaker.szPname="Resonance Virtual Playback Topology"'
}

foreach ($entry in $stringReplacements.GetEnumerator()) {
  $audioInfContent = Replace-Required $audioInfContent $entry.Key $entry.Value $entry.Key
}
Set-ContentIfChanged $audioInf $audioInfContent

$extensionInfContent = Get-Content -LiteralPath $extensionInf -Raw
$extensionInfContent = Replace-Required $extensionInfContent 'Root\\sysvad_ComponentizedAudioSample' 'Root\resonance_virtual_audio' 'extension hardware ID'
$extensionInfContent = Replace-Required $extensionInfContent 'ExtendedFriendlyName = "SYSVAD \(with APO Extensions\)"' 'ExtendedFriendlyName = "Resonance Virtual Playback Extensions"' 'extension friendly name'
Set-ContentIfChanged $extensionInf $extensionInfContent

$apoInfContent = Get-Content -LiteralPath $apoInf -Raw
$apoInfContent = Replace-Required $apoInfContent 'ProviderName\s*=\s*"TODO-Set-Provider"' 'ProviderName      = "Resonance"' 'APO provider'
$apoInfContent = Replace-Required $apoInfContent 'MfgName\s*=\s*"TODO-Set-Manufacturer"' 'MfgName           = "Resonance"' 'APO manufacturer'
$apoInfContent = Replace-Required $apoInfContent 'Apo\.ComponentDesc\s*=\s*"Audio Proxy APO Sample"' 'Apo.ComponentDesc = "Resonance APO Components"' 'APO component description'
Set-ContentIfChanged $apoInf $apoInfContent

Write-Host ''
Write-Host 'Resonance SysVAD customization complete.'
Write-Host 'Next: npm run driver:build'

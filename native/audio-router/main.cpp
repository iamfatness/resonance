#include <Windows.h>
#include <Audioclient.h>
#include <Propkeydef.h>
#include <Functiondiscoverykeys_devpkey.h>
#include <Mmdeviceapi.h>
#include <Propvarutil.h>
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <sstream>
#include <string>
#include <wrl/client.h>

using Microsoft::WRL::ComPtr;

struct ComInit {
  HRESULT hr;
  ComInit() : hr(CoInitializeEx(nullptr, COINIT_MULTITHREADED)) {}
  ~ComInit() {
    if (SUCCEEDED(hr)) CoUninitialize();
  }
};

std::string EscapeJson(const std::wstring& value) {
  std::ostringstream out;
  for (wchar_t ch : value) {
    if (ch == L'\\') out << "\\\\";
    else if (ch == L'"') out << "\\\"";
    else if (ch >= 32 && ch < 127) out << static_cast<char>(ch);
    else out << "?";
  }
  return out.str();
}

std::wstring GetDeviceName(IMMDevice* device) {
  ComPtr<IPropertyStore> props;
  if (FAILED(device->OpenPropertyStore(STGM_READ, &props))) return L"Unknown";

  PROPVARIANT value;
  PropVariantInit(&value);
  std::wstring name = L"Unknown";
  if (SUCCEEDED(props->GetValue(PKEY_Device_FriendlyName, &value)) && value.vt == VT_LPWSTR) {
    name = value.pwszVal;
  }
  PropVariantClear(&value);
  return name;
}

bool GetDefaultEndpoint(EDataFlow flow, ComPtr<IMMDevice>& device) {
  ComPtr<IMMDeviceEnumerator> enumerator;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
  if (FAILED(hr)) return false;
  return SUCCEEDED(enumerator->GetDefaultAudioEndpoint(flow, eConsole, &device));
}

bool GetMixFormat(IMMDevice* device, WAVEFORMATEX** mixFormat) {
  ComPtr<IAudioClient> audioClient;
  HRESULT hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &audioClient);
  if (FAILED(hr)) return false;
  return SUCCEEDED(audioClient->GetMixFormat(mixFormat)) && *mixFormat != nullptr;
}

void PrintDescribe() {
  std::cout
    << "{"
    << "\"name\":\"resonance-audio-router\","
    << "\"version\":\"0.1.0\","
    << "\"backend\":\"wasapi-skeleton\","
    << "\"deckCount\":2,"
    << "\"commands\":[\"--describe\",\"--probe\",\"--run-once\",\"--render-silence\"],"
    << "\"capabilities\":{"
    << "\"perDeckCapture\":false,"
    << "\"perDeckPan\":true,"
    << "\"perDeckEq\":false,"
    << "\"perDeckPlugins\":false,"
    << "\"nativePcmRouting\":false"
    << "}"
    << "}\n";
}

int PrintProbe() {
  ComPtr<IMMDevice> renderDevice;
  ComPtr<IMMDevice> captureDevice;
  const bool hasRender = GetDefaultEndpoint(eRender, renderDevice);
  const bool hasCapture = GetDefaultEndpoint(eCapture, captureDevice);

  WAVEFORMATEX* renderFormat = nullptr;
  const bool hasRenderFormat = hasRender && GetMixFormat(renderDevice.Get(), &renderFormat);

  std::cout
    << "{"
    << "\"status\":\"ready\","
    << "\"backend\":\"wasapi-skeleton\","
    << "\"routes\":["
    << "{\"deck\":\"A\",\"source\":\"deck-a-pcm\",\"destination\":\"master-output\",\"status\":\"stubbed\"},"
    << "{\"deck\":\"B\",\"source\":\"deck-b-pcm\",\"destination\":\"master-output\",\"status\":\"stubbed\"}"
    << "],"
    << "\"devices\":{"
    << "\"defaultRender\":";
  if (hasRender) {
    std::cout << "{\"available\":true,\"name\":\"" << EscapeJson(GetDeviceName(renderDevice.Get())) << "\"}";
  } else {
    std::cout << "{\"available\":false}";
  }
  std::cout << ",\"defaultCapture\":";
  if (hasCapture) {
    std::cout << "{\"available\":true,\"name\":\"" << EscapeJson(GetDeviceName(captureDevice.Get())) << "\"}";
  } else {
    std::cout << "{\"available\":false}";
  }
  std::cout << "},";

  std::cout << "\"format\":";
  if (hasRenderFormat) {
    std::cout
      << "{"
      << "\"sampleRate\":" << renderFormat->nSamplesPerSec << ","
      << "\"channels\":" << renderFormat->nChannels << ","
      << "\"bitsPerSample\":" << renderFormat->wBitsPerSample << ","
      << "\"blockAlign\":" << renderFormat->nBlockAlign
      << "}";
  } else {
    std::cout << "null";
  }
  std::cout << "}\n";

  if (renderFormat) CoTaskMemFree(renderFormat);
  return hasRender ? 0 : 2;
}

int RunOnce() {
  ComPtr<IMMDevice> renderDevice;
  if (!GetDefaultEndpoint(eRender, renderDevice)) {
    std::cerr << "{\"error\":\"Default render endpoint unavailable\"}\n";
    return 2;
  }

  WAVEFORMATEX* mixFormat = nullptr;
  if (!GetMixFormat(renderDevice.Get(), &mixFormat)) {
    std::cerr << "{\"error\":\"Render mix format unavailable\"}\n";
    return 3;
  }

  ComPtr<IAudioClient> audioClient;
  HRESULT hr = renderDevice->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &audioClient);
  if (FAILED(hr)) {
    CoTaskMemFree(mixFormat);
    std::cerr << "{\"error\":\"IAudioClient activation failed\"}\n";
    return 4;
  }

  const REFERENCE_TIME requestedDuration = 1000000; // 100 ms
  hr = audioClient->Initialize(
    AUDCLNT_SHAREMODE_SHARED,
    0,
    requestedDuration,
    0,
    mixFormat,
    nullptr);
  if (FAILED(hr)) {
    CoTaskMemFree(mixFormat);
    std::cerr << "{\"error\":\"IAudioClient Initialize render failed\",\"hresult\":" << static_cast<int32_t>(hr) << "}\n";
    return 5;
  }

  UINT32 bufferFrames = 0;
  audioClient->GetBufferSize(&bufferFrames);
  REFERENCE_TIME defaultPeriod = 0;
  REFERENCE_TIME minimumPeriod = 0;
  audioClient->GetDevicePeriod(&defaultPeriod, &minimumPeriod);

  std::cout
    << "{"
    << "\"status\":\"ready\","
    << "\"backend\":\"wasapi-skeleton\","
    << "\"deviceName\":\"" << EscapeJson(GetDeviceName(renderDevice.Get())) << "\","
    << "\"format\":{"
    << "\"sampleRate\":" << mixFormat->nSamplesPerSec << ","
    << "\"channels\":" << mixFormat->nChannels << ","
    << "\"bitsPerSample\":" << mixFormat->wBitsPerSample << ","
    << "\"blockAlign\":" << mixFormat->nBlockAlign
    << "},"
    << "\"buffer\":{"
    << "\"frames\":" << bufferFrames << ","
    << "\"durationMs\":" << (bufferFrames * 1000.0 / std::max<DWORD>(1, mixFormat->nSamplesPerSec)) << ","
    << "\"defaultPeriodMs\":" << (defaultPeriod / 10000.0) << ","
    << "\"minimumPeriodMs\":" << (minimumPeriod / 10000.0)
    << "},"
    << "\"routes\":["
    << "{\"deck\":\"A\",\"status\":\"stubbed\",\"bufferFrames\":" << bufferFrames << "},"
    << "{\"deck\":\"B\",\"status\":\"stubbed\",\"bufferFrames\":" << bufferFrames << "}"
    << "]"
    << "}\n";

  CoTaskMemFree(mixFormat);
  return 0;
}

int RenderSilence(int durationMs) {
  ComPtr<IMMDevice> renderDevice;
  if (!GetDefaultEndpoint(eRender, renderDevice)) {
    std::cerr << "{\"error\":\"Default render endpoint unavailable\"}\n";
    return 2;
  }

  WAVEFORMATEX* mixFormat = nullptr;
  if (!GetMixFormat(renderDevice.Get(), &mixFormat)) {
    std::cerr << "{\"error\":\"Render mix format unavailable\"}\n";
    return 3;
  }

  ComPtr<IAudioClient> audioClient;
  HRESULT hr = renderDevice->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &audioClient);
  if (FAILED(hr)) {
    CoTaskMemFree(mixFormat);
    std::cerr << "{\"error\":\"IAudioClient activation failed\"}\n";
    return 4;
  }

  const REFERENCE_TIME requestedDuration = 1000000; // 100 ms
  hr = audioClient->Initialize(
    AUDCLNT_SHAREMODE_SHARED,
    0,
    requestedDuration,
    0,
    mixFormat,
    nullptr);
  if (FAILED(hr)) {
    CoTaskMemFree(mixFormat);
    std::cerr << "{\"error\":\"IAudioClient Initialize render failed\",\"hresult\":" << static_cast<int32_t>(hr) << "}\n";
    return 5;
  }

  ComPtr<IAudioRenderClient> renderClient;
  hr = audioClient->GetService(IID_PPV_ARGS(&renderClient));
  if (FAILED(hr)) {
    CoTaskMemFree(mixFormat);
    std::cerr << "{\"error\":\"GetService IAudioRenderClient failed\",\"hresult\":" << static_cast<int32_t>(hr) << "}\n";
    return 6;
  }

  UINT32 bufferFrames = 0;
  audioClient->GetBufferSize(&bufferFrames);
  REFERENCE_TIME defaultPeriod = 0;
  REFERENCE_TIME minimumPeriod = 0;
  audioClient->GetDevicePeriod(&defaultPeriod, &minimumPeriod);

  const DWORD startTick = GetTickCount();
  uint64_t framesWritten = 0;
  uint32_t renderPasses = 0;
  uint32_t underruns = 0;

  hr = audioClient->Start();
  if (FAILED(hr)) {
    CoTaskMemFree(mixFormat);
    std::cerr << "{\"error\":\"IAudioClient Start failed\",\"hresult\":" << static_cast<int32_t>(hr) << "}\n";
    return 7;
  }

  const DWORD targetMs = static_cast<DWORD>(std::max(50, std::min(5000, durationMs)));
  while (GetTickCount() - startTick < targetMs) {
    UINT32 paddingFrames = 0;
    hr = audioClient->GetCurrentPadding(&paddingFrames);
    if (FAILED(hr)) {
      underruns += 1;
      Sleep(1);
      continue;
    }

    const UINT32 availableFrames = bufferFrames > paddingFrames ? bufferFrames - paddingFrames : 0;
    if (availableFrames == 0) {
      Sleep(static_cast<DWORD>(std::max<REFERENCE_TIME>(1, defaultPeriod / 20000)));
      continue;
    }

    BYTE* buffer = nullptr;
    hr = renderClient->GetBuffer(availableFrames, &buffer);
    if (FAILED(hr) || buffer == nullptr) {
      underruns += 1;
      Sleep(1);
      continue;
    }

    std::memset(buffer, 0, availableFrames * mixFormat->nBlockAlign);
    hr = renderClient->ReleaseBuffer(availableFrames, AUDCLNT_BUFFERFLAGS_SILENT);
    if (FAILED(hr)) {
      underruns += 1;
      continue;
    }

    framesWritten += availableFrames;
    renderPasses += 1;
  }

  audioClient->Stop();
  const DWORD elapsedMs = std::max<DWORD>(1, GetTickCount() - startTick);

  std::cout
    << "{"
    << "\"status\":\"ready\","
    << "\"backend\":\"wasapi-silence-render\","
    << "\"deviceName\":\"" << EscapeJson(GetDeviceName(renderDevice.Get())) << "\","
    << "\"format\":{"
    << "\"sampleRate\":" << mixFormat->nSamplesPerSec << ","
    << "\"channels\":" << mixFormat->nChannels << ","
    << "\"bitsPerSample\":" << mixFormat->wBitsPerSample << ","
    << "\"blockAlign\":" << mixFormat->nBlockAlign
    << "},"
    << "\"buffer\":{"
    << "\"frames\":" << bufferFrames << ","
    << "\"durationMs\":" << (bufferFrames * 1000.0 / std::max<DWORD>(1, mixFormat->nSamplesPerSec)) << ","
    << "\"defaultPeriodMs\":" << (defaultPeriod / 10000.0) << ","
    << "\"minimumPeriodMs\":" << (minimumPeriod / 10000.0)
    << "},"
    << "\"render\":{"
    << "\"requestedMs\":" << targetMs << ","
    << "\"elapsedMs\":" << elapsedMs << ","
    << "\"framesWritten\":" << framesWritten << ","
    << "\"passes\":" << renderPasses << ","
    << "\"underruns\":" << underruns
    << "},"
    << "\"routes\":["
    << "{\"deck\":\"A\",\"status\":\"silent\",\"framesWritten\":" << framesWritten / 2 << "},"
    << "{\"deck\":\"B\",\"status\":\"silent\",\"framesWritten\":" << framesWritten / 2 << "}"
    << "]"
    << "}\n";

  CoTaskMemFree(mixFormat);
  return 0;
}

int wmain(int argc, wchar_t** argv) {
  ComInit com;
  if (FAILED(com.hr)) {
    std::cerr << "{\"error\":\"COM initialization failed\"}\n";
    return 1;
  }

  const std::wstring command = argc >= 2 ? argv[1] : L"--describe";
  if (command == L"--describe") {
    PrintDescribe();
    return 0;
  }
  if (command == L"--probe") {
    return PrintProbe();
  }
  if (command == L"--run-once") {
    return RunOnce();
  }
  if (command == L"--render-silence") {
    int durationMs = 500;
    for (int i = 2; i < argc - 1; ++i) {
      if (std::wstring(argv[i]) == L"--duration-ms") {
        durationMs = _wtoi(argv[i + 1]);
      }
    }
    return RenderSilence(durationMs);
  }

  std::cerr << "{\"error\":\"Unknown command\"}\n";
  return 64;
}

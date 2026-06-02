#include <Windows.h>
#include <Audioclient.h>
#include <Propkeydef.h>
#include <Functiondiscoverykeys_devpkey.h>
#include <Mmdeviceapi.h>
#include <Propvarutil.h>
#include <algorithm>
#include <cstdint>
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
    << "\"commands\":[\"--describe\",\"--probe\",\"--run-once\"],"
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

  std::cerr << "{\"error\":\"Unknown command\"}\n";
  return 64;
}

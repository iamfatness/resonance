#include <Windows.h>
#include <Audioclient.h>
#include <Propkeydef.h>
#include <Functiondiscoverykeys_devpkey.h>
#include <Mmdeviceapi.h>
#include <Propvarutil.h>
#include <ksmedia.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
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

void ListDevices(EDataFlow flow) {
  ComPtr<IMMDeviceEnumerator> enumerator;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
  if (FAILED(hr)) {
    std::cerr << "{\"error\":\"CoCreateInstance MMDeviceEnumerator failed\"}\n";
    return;
  }

  ComPtr<IMMDeviceCollection> collection;
  hr = enumerator->EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE, &collection);
  if (FAILED(hr)) {
    std::cerr << "{\"error\":\"EnumAudioEndpoints failed\"}\n";
    return;
  }

  UINT count = 0;
  collection->GetCount(&count);
  std::cout << "[";
  for (UINT i = 0; i < count; ++i) {
    ComPtr<IMMDevice> device;
    if (FAILED(collection->Item(i, &device))) continue;

    LPWSTR id = nullptr;
    device->GetId(&id);
    std::wstring name = GetDeviceName(device.Get());
    if (i > 0) std::cout << ",";
    std::cout << "{\"id\":\"" << EscapeJson(id ? id : L"") << "\","
              << "\"name\":\"" << EscapeJson(name) << "\","
              << "\"role\":\"" << (flow == eRender ? "output" : "input") << "\"}";
    if (id) CoTaskMemFree(id);
  }
  std::cout << "]\n";
}

float SampleAsFloat(const BYTE* bytes, WORD bitsPerSample, WORD blockAlign, WORD channels, UINT32 frame, WORD channel, bool isFloat) {
  const BYTE* sample = bytes + (frame * blockAlign) + (channel * (bitsPerSample / 8));
  if (isFloat && bitsPerSample == 32) return *reinterpret_cast<const float*>(sample);
  if (bitsPerSample == 16) return static_cast<float>(*reinterpret_cast<const int16_t*>(sample)) / 32768.0f;
  if (bitsPerSample == 24) {
    int32_t value = (sample[0] | (sample[1] << 8) | (sample[2] << 16));
    if (value & 0x800000) value |= ~0xFFFFFF;
    return static_cast<float>(value) / 8388608.0f;
  }
  if (bitsPerSample == 32) return static_cast<float>(*reinterpret_cast<const int32_t*>(sample)) / 2147483648.0f;
  return 0.0f;
}

int MeterDefaultRender(int durationMs) {
  ComPtr<IMMDeviceEnumerator> enumerator;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
  if (FAILED(hr)) {
    std::cerr << "{\"error\":\"CoCreateInstance MMDeviceEnumerator failed\"}\n";
    return 2;
  }

  ComPtr<IMMDevice> device;
  hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
  if (FAILED(hr)) {
    std::cerr << "{\"error\":\"GetDefaultAudioEndpoint failed\"}\n";
    return 3;
  }

  const std::wstring deviceName = GetDeviceName(device.Get());
  ComPtr<IAudioClient> audioClient;
  hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &audioClient);
  if (FAILED(hr)) {
    std::cerr << "{\"error\":\"IAudioClient activation failed\"}\n";
    return 4;
  }

  WAVEFORMATEX* mixFormat = nullptr;
  hr = audioClient->GetMixFormat(&mixFormat);
  if (FAILED(hr) || !mixFormat) {
    std::cerr << "{\"error\":\"GetMixFormat failed\"}\n";
    return 5;
  }

  const REFERENCE_TIME bufferDuration = 10000000;
  hr = audioClient->Initialize(
    AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_LOOPBACK,
    bufferDuration,
    0,
    mixFormat,
    nullptr);
  if (FAILED(hr)) {
    CoTaskMemFree(mixFormat);
    std::cerr << "{\"error\":\"IAudioClient Initialize loopback failed\"}\n";
    return 6;
  }

  ComPtr<IAudioCaptureClient> captureClient;
  hr = audioClient->GetService(IID_PPV_ARGS(&captureClient));
  if (FAILED(hr)) {
    CoTaskMemFree(mixFormat);
    std::cerr << "{\"error\":\"GetService IAudioCaptureClient failed\"}\n";
    return 7;
  }

  audioClient->Start();

  const DWORD start = GetTickCount();
  double squareSum = 0.0;
  uint64_t sampleCount = 0;
  float peak = 0.0f;
  const WORD channels = std::max<WORD>(1, mixFormat->nChannels);
  const WORD bits = mixFormat->wBitsPerSample;
  const bool isFloat = mixFormat->wFormatTag == WAVE_FORMAT_IEEE_FLOAT ||
    (mixFormat->wFormatTag == WAVE_FORMAT_EXTENSIBLE &&
     IsEqualGUID(reinterpret_cast<WAVEFORMATEXTENSIBLE*>(mixFormat)->SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT));

  while (GetTickCount() - start < static_cast<DWORD>(durationMs)) {
    UINT32 packetFrames = 0;
    captureClient->GetNextPacketSize(&packetFrames);
    while (packetFrames > 0) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      hr = captureClient->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
      if (SUCCEEDED(hr)) {
        if (!(flags & AUDCLNT_BUFFERFLAGS_SILENT) && data) {
          for (UINT32 frame = 0; frame < frames; ++frame) {
            for (WORD channel = 0; channel < channels; ++channel) {
              const float sample = SampleAsFloat(data, bits, mixFormat->nBlockAlign, channels, frame, channel, isFloat);
              const float magnitude = std::abs(sample);
              peak = std::max(peak, magnitude);
              squareSum += static_cast<double>(sample) * sample;
              sampleCount += 1;
            }
          }
        } else {
          sampleCount += static_cast<uint64_t>(frames) * channels;
        }
        captureClient->ReleaseBuffer(frames);
      }
      captureClient->GetNextPacketSize(&packetFrames);
    }
    Sleep(10);
  }

  audioClient->Stop();
  CoTaskMemFree(mixFormat);

  const double rms = sampleCount > 0 ? std::sqrt(squareSum / static_cast<double>(sampleCount)) : 0.0;
  std::cout << "{\"deviceName\":\"" << EscapeJson(deviceName) << "\","
            << "\"peak\":" << std::min(1.0f, peak) << ","
            << "\"rms\":" << std::min(1.0, rms) << ","
            << "\"clipping\":" << (peak >= 0.98f ? "true" : "false") << "}\n";
  return 0;
}

int wmain(int argc, wchar_t** argv) {
  ComInit com;
  if (FAILED(com.hr)) {
    std::cerr << "{\"error\":\"COM initialization failed\"}\n";
    return 1;
  }

  if (argc >= 2 && std::wstring(argv[1]) == L"--list-render") {
    ListDevices(eRender);
    return 0;
  }

  if (argc >= 2 && std::wstring(argv[1]) == L"--list-capture") {
    ListDevices(eCapture);
    return 0;
  }

  int durationMs = 350;
  for (int i = 1; i < argc - 1; ++i) {
    if (std::wstring(argv[i]) == L"--duration-ms") {
      durationMs = std::max(50, std::min(5000, _wtoi(argv[i + 1])));
    }
  }

  return MeterDefaultRender(durationMs);
}

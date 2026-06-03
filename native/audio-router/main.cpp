#include <Windows.h>
#include <Audioclient.h>
#include <Propkeydef.h>
#include <Functiondiscoverykeys_devpkey.h>
#include <ksmedia.h>
#include <Mmdeviceapi.h>
#include <Propvarutil.h>
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <cmath>
#include <fstream>
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

double ClampDouble(double value, double minValue, double maxValue) {
  return std::max(minValue, std::min(maxValue, value));
}

bool IsFloatFormat(const WAVEFORMATEX* mixFormat) {
  if (!mixFormat) return false;
  if (mixFormat->wFormatTag == WAVE_FORMAT_IEEE_FLOAT) return true;
  if (mixFormat->wFormatTag == WAVE_FORMAT_EXTENSIBLE && mixFormat->cbSize >= 22) {
    const WAVEFORMATEXTENSIBLE* extensible = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(mixFormat);
    return IsEqualGUID(extensible->SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT);
  }
  return false;
}

void WriteSample(BYTE* sample, WORD bitsPerSample, bool isFloat, double value) {
  const double clamped = ClampDouble(value, -1.0, 1.0);
  if (isFloat && bitsPerSample == 32) {
    *reinterpret_cast<float*>(sample) = static_cast<float>(clamped);
    return;
  }
  if (bitsPerSample == 16) {
    *reinterpret_cast<int16_t*>(sample) = static_cast<int16_t>(clamped * 32767.0);
    return;
  }
  if (bitsPerSample == 24) {
    const int32_t packed = static_cast<int32_t>(clamped * 8388607.0);
    sample[0] = static_cast<BYTE>(packed & 0xff);
    sample[1] = static_cast<BYTE>((packed >> 8) & 0xff);
    sample[2] = static_cast<BYTE>((packed >> 16) & 0xff);
    return;
  }
  if (bitsPerSample == 32) {
    *reinterpret_cast<int32_t*>(sample) = static_cast<int32_t>(clamped * 2147483647.0);
  }
}

void WriteInterleavedFrame(BYTE* buffer, const WAVEFORMATEX* mixFormat, UINT32 frame, double left, double right) {
  const WORD channels = std::max<WORD>(1, mixFormat->nChannels);
  const WORD bitsPerSample = mixFormat->wBitsPerSample;
  const WORD bytesPerSample = std::max<WORD>(1, bitsPerSample / 8);
  const bool isFloat = IsFloatFormat(mixFormat);
  BYTE* frameStart = buffer + (frame * mixFormat->nBlockAlign);

  for (WORD channel = 0; channel < channels; ++channel) {
    const double value = channel == 0 ? left : channel == 1 ? right : 0.0;
    WriteSample(frameStart + (channel * bytesPerSample), bitsPerSample, isFloat, value);
  }
}

void PanScales(double pan, double& leftScale, double& rightScale) {
  const double normalized = ClampDouble(pan, -50.0, 50.0) / 50.0;
  leftScale = normalized <= 0.0 ? 1.0 : 1.0 - normalized;
  rightScale = normalized >= 0.0 ? 1.0 : 1.0 + normalized;
}

struct DeckState {
  const char* id;
  double frequency;
  double gain;
  double pan;
  double eqLowDb;
  double eqMidDb;
  double eqHighDb;
  double leftScale;
  double rightScale;
};

struct DeckStats {
  uint64_t framesWritten = 0;
  double leftPeak = 0.0;
  double rightPeak = 0.0;
};

struct RenderStats {
  uint64_t framesWritten = 0;
  uint32_t passes = 0;
  uint32_t underruns = 0;
  double masterPeakLeft = 0.0;
  double masterPeakRight = 0.0;
};

struct WavData {
  uint16_t formatTag = 0;
  uint16_t channels = 0;
  uint32_t sampleRate = 0;
  uint16_t bitsPerSample = 0;
  std::vector<double> samples;
};

uint16_t ReadU16(std::ifstream& file) {
  uint8_t bytes[2] = {};
  file.read(reinterpret_cast<char*>(bytes), 2);
  return static_cast<uint16_t>(bytes[0] | (bytes[1] << 8));
}

uint32_t ReadU32(std::ifstream& file) {
  uint8_t bytes[4] = {};
  file.read(reinterpret_cast<char*>(bytes), 4);
  return static_cast<uint32_t>(bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24));
}

std::string ReadTag(std::ifstream& file) {
  char tag[4] = {};
  file.read(tag, 4);
  return std::string(tag, 4);
}

bool LoadWavFile(const std::wstring& path, WavData& wav, std::string& error) {
  std::ifstream file(path, std::ios::binary);
  if (!file) {
    error = "WAV file could not be opened";
    return false;
  }

  if (ReadTag(file) != "RIFF") {
    error = "WAV file is missing RIFF header";
    return false;
  }
  ReadU32(file);
  if (ReadTag(file) != "WAVE") {
    error = "WAV file is missing WAVE header";
    return false;
  }

  std::vector<uint8_t> dataBytes;
  bool hasFormat = false;
  bool hasData = false;

  while (file && (!hasFormat || !hasData)) {
    const std::string tag = ReadTag(file);
    if (!file) break;
    const uint32_t chunkSize = ReadU32(file);
    const std::streampos chunkStart = file.tellg();

    if (tag == "fmt ") {
      wav.formatTag = ReadU16(file);
      wav.channels = ReadU16(file);
      wav.sampleRate = ReadU32(file);
      ReadU32(file);
      ReadU16(file);
      wav.bitsPerSample = ReadU16(file);
      hasFormat = true;
    } else if (tag == "data") {
      dataBytes.resize(chunkSize);
      file.read(reinterpret_cast<char*>(dataBytes.data()), chunkSize);
      hasData = true;
    }

    file.seekg(chunkStart + static_cast<std::streamoff>(chunkSize + (chunkSize % 2)));
  }

  if (!hasFormat || !hasData) {
    error = "WAV file is missing fmt or data chunk";
    return false;
  }
  if (wav.channels == 0 || wav.sampleRate == 0) {
    error = "WAV file format is invalid";
    return false;
  }
  if (wav.formatTag != WAVE_FORMAT_PCM && wav.formatTag != WAVE_FORMAT_IEEE_FLOAT) {
    error = "Only PCM and IEEE float WAV files are supported";
    return false;
  }

  const uint16_t bytesPerSample = wav.bitsPerSample / 8;
  if (bytesPerSample == 0) {
    error = "Unsupported WAV sample width";
    return false;
  }

  const size_t sampleCount = dataBytes.size() / bytesPerSample;
  wav.samples.reserve(sampleCount);
  for (size_t index = 0; index < sampleCount; ++index) {
    const uint8_t* sample = dataBytes.data() + (index * bytesPerSample);
    double value = 0.0;
    if (wav.formatTag == WAVE_FORMAT_IEEE_FLOAT && wav.bitsPerSample == 32) {
      float floatValue = 0.0f;
      std::memcpy(&floatValue, sample, sizeof(float));
      value = floatValue;
    } else if (wav.bitsPerSample == 16) {
      int16_t packed = 0;
      std::memcpy(&packed, sample, sizeof(int16_t));
      value = static_cast<double>(packed) / 32768.0;
    } else if (wav.bitsPerSample == 24) {
      int32_t packed = sample[0] | (sample[1] << 8) | (sample[2] << 16);
      if (packed & 0x800000) packed |= ~0xffffff;
      value = static_cast<double>(packed) / 8388608.0;
    } else if (wav.bitsPerSample == 32) {
      int32_t packed = 0;
      std::memcpy(&packed, sample, sizeof(int32_t));
      value = static_cast<double>(packed) / 2147483648.0;
    } else {
      error = "Unsupported WAV sample width";
      return false;
    }
    wav.samples.push_back(ClampDouble(value, -1.0, 1.0));
  }

  return !wav.samples.empty();
}

double DbToLinear(double db) {
  return std::pow(10.0, ClampDouble(db, -18.0, 18.0) / 20.0);
}

double EqGainForFrequency(const DeckState& deck) {
  if (deck.frequency < 260.0) return DbToLinear(deck.eqLowDb);
  if (deck.frequency < 2500.0) return DbToLinear(deck.eqMidDb);
  return DbToLinear(deck.eqHighDb);
}

DeckState MakeDeck(const char* id, double frequency, double gain, double pan, double eqLowDb, double eqMidDb, double eqHighDb) {
  DeckState deck = {
    id,
    frequency,
    ClampDouble(gain, 0.0, 0.25),
    ClampDouble(pan, -50.0, 50.0),
    ClampDouble(eqLowDb, -18.0, 18.0),
    ClampDouble(eqMidDb, -18.0, 18.0),
    ClampDouble(eqHighDb, -18.0, 18.0),
    1.0,
    1.0,
  };
  PanScales(deck.pan, deck.leftScale, deck.rightScale);
  return deck;
}

double DeckSample(const DeckState& deck, double absoluteFrame, double sampleRate) {
  const double twoPi = 6.28318530717958647692;
  return std::sin(twoPi * deck.frequency * absoluteFrame / sampleRate) * deck.gain * EqGainForFrequency(deck);
}

double WavSample(const WavData& wav, double renderFrame, double renderSampleRate, uint16_t channel) {
  if (wav.samples.empty() || wav.channels == 0 || renderSampleRate <= 0.0) return 0.0;
  const double sourceFrame = renderFrame * static_cast<double>(wav.sampleRate) / renderSampleRate;
  const size_t frameIndex = static_cast<size_t>(sourceFrame);
  const size_t frameCount = wav.samples.size() / wav.channels;
  if (frameIndex >= frameCount) return 0.0;
  const uint16_t sourceChannel = wav.channels == 1 ? 0 : std::min<uint16_t>(channel, wav.channels - 1);
  return wav.samples[(frameIndex * wav.channels) + sourceChannel];
}

double WavDurationMs(const WavData& wav) {
  if (wav.sampleRate == 0 || wav.channels == 0) return 0.0;
  const double frames = static_cast<double>(wav.samples.size() / wav.channels);
  return frames * 1000.0 / static_cast<double>(wav.sampleRate);
}

void MixDeckFrame(const DeckState& deck, DeckStats& stats, double sample, double& left, double& right) {
  const double deckLeft = sample * deck.leftScale;
  const double deckRight = sample * deck.rightScale;
  left += deckLeft;
  right += deckRight;
  stats.leftPeak = std::max(stats.leftPeak, std::abs(deckLeft));
  stats.rightPeak = std::max(stats.rightPeak, std::abs(deckRight));
}

void MixDeckStereoFrame(const DeckState& deck, DeckStats& stats, double sourceLeft, double sourceRight, double& left, double& right) {
  const double eqGain = EqGainForFrequency(deck);
  const double deckLeft = sourceLeft * deck.gain * eqGain * deck.leftScale;
  const double deckRight = sourceRight * deck.gain * eqGain * deck.rightScale;
  left += deckLeft;
  right += deckRight;
  stats.leftPeak = std::max(stats.leftPeak, std::abs(deckLeft));
  stats.rightPeak = std::max(stats.rightPeak, std::abs(deckRight));
}

void PrintDescribe() {
  std::cout
    << "{"
    << "\"name\":\"resonance-audio-router\","
    << "\"version\":\"0.1.0\","
    << "\"backend\":\"wasapi-skeleton\","
    << "\"deckCount\":2,"
    << "\"commands\":[\"--describe\",\"--probe\",\"--run-once\",\"--render-silence\",\"--render-tone\",\"--render-wav\"],"
    << "\"capabilities\":{"
    << "\"perDeckCapture\":false,"
    << "\"perDeckPan\":true,"
    << "\"perDeckEq\":true,"
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

int RenderTone(
  int durationMs,
  double deckAGain,
  double deckBGain,
  double deckAPan,
  double deckBPan,
  double deckAEqLowDb,
  double deckAEqMidDb,
  double deckAEqHighDb,
  double deckBEqLowDb,
  double deckBEqMidDb,
  double deckBEqHighDb) {
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
  const DWORD targetMs = static_cast<DWORD>(std::max(50, std::min(5000, durationMs)));
  const double sampleRate = std::max<DWORD>(1, mixFormat->nSamplesPerSec);
  const DeckState deckA = MakeDeck("A", 220.0, deckAGain, deckAPan, deckAEqLowDb, deckAEqMidDb, deckAEqHighDb);
  const DeckState deckB = MakeDeck("B", 330.0, deckBGain, deckBPan, deckBEqLowDb, deckBEqMidDb, deckBEqHighDb);
  DeckStats deckAStats;
  DeckStats deckBStats;
  RenderStats renderStats;

  hr = audioClient->Start();
  if (FAILED(hr)) {
    CoTaskMemFree(mixFormat);
    std::cerr << "{\"error\":\"IAudioClient Start failed\",\"hresult\":" << static_cast<int32_t>(hr) << "}\n";
    return 7;
  }

  while (GetTickCount() - startTick < targetMs) {
    UINT32 paddingFrames = 0;
    hr = audioClient->GetCurrentPadding(&paddingFrames);
    if (FAILED(hr)) {
      renderStats.underruns += 1;
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
      renderStats.underruns += 1;
      Sleep(1);
      continue;
    }

    for (UINT32 frame = 0; frame < availableFrames; ++frame) {
      const double absoluteFrame = static_cast<double>(renderStats.framesWritten + frame);
      double left = 0.0;
      double right = 0.0;
      MixDeckFrame(deckA, deckAStats, DeckSample(deckA, absoluteFrame, sampleRate), left, right);
      MixDeckFrame(deckB, deckBStats, DeckSample(deckB, absoluteFrame, sampleRate), left, right);
      left = ClampDouble(left, -0.95, 0.95);
      right = ClampDouble(right, -0.95, 0.95);

      renderStats.masterPeakLeft = std::max(renderStats.masterPeakLeft, std::abs(left));
      renderStats.masterPeakRight = std::max(renderStats.masterPeakRight, std::abs(right));
      WriteInterleavedFrame(buffer, mixFormat, frame, left, right);
    }

    hr = renderClient->ReleaseBuffer(availableFrames, 0);
    if (FAILED(hr)) {
      renderStats.underruns += 1;
      continue;
    }

    renderStats.framesWritten += availableFrames;
    deckAStats.framesWritten += availableFrames;
    deckBStats.framesWritten += availableFrames;
    renderStats.passes += 1;
  }

  audioClient->Stop();
  const DWORD elapsedMs = std::max<DWORD>(1, GetTickCount() - startTick);

  std::cout
    << "{"
    << "\"status\":\"ready\","
    << "\"backend\":\"wasapi-tone-render\","
    << "\"deviceName\":\"" << EscapeJson(GetDeviceName(renderDevice.Get())) << "\","
    << "\"format\":{"
    << "\"sampleRate\":" << mixFormat->nSamplesPerSec << ","
    << "\"channels\":" << mixFormat->nChannels << ","
    << "\"bitsPerSample\":" << mixFormat->wBitsPerSample << ","
    << "\"blockAlign\":" << mixFormat->nBlockAlign
    << "},"
    << "\"buffer\":{"
    << "\"frames\":" << bufferFrames << ","
    << "\"durationMs\":" << (bufferFrames * 1000.0 / sampleRate) << ","
    << "\"defaultPeriodMs\":" << (defaultPeriod / 10000.0) << ","
    << "\"minimumPeriodMs\":" << (minimumPeriod / 10000.0)
    << "},"
    << "\"render\":{"
    << "\"type\":\"tone\","
    << "\"requestedMs\":" << targetMs << ","
    << "\"elapsedMs\":" << elapsedMs << ","
    << "\"framesWritten\":" << renderStats.framesWritten << ","
    << "\"passes\":" << renderStats.passes << ","
    << "\"underruns\":" << renderStats.underruns << ","
    << "\"masterPeakLeft\":" << renderStats.masterPeakLeft << ","
    << "\"masterPeakRight\":" << renderStats.masterPeakRight
    << "},"
    << "\"routes\":["
    << "{\"deck\":\"A\",\"status\":\"tone\",\"frequency\":" << deckA.frequency << ",\"gain\":" << deckA.gain << ",\"pan\":" << deckA.pan << ",\"eqLowDb\":" << deckA.eqLowDb << ",\"eqMidDb\":" << deckA.eqMidDb << ",\"eqHighDb\":" << deckA.eqHighDb << ",\"eqLinear\":" << EqGainForFrequency(deckA) << ",\"framesWritten\":" << deckAStats.framesWritten << ",\"leftPeak\":" << deckAStats.leftPeak << ",\"rightPeak\":" << deckAStats.rightPeak << "},"
    << "{\"deck\":\"B\",\"status\":\"tone\",\"frequency\":" << deckB.frequency << ",\"gain\":" << deckB.gain << ",\"pan\":" << deckB.pan << ",\"eqLowDb\":" << deckB.eqLowDb << ",\"eqMidDb\":" << deckB.eqMidDb << ",\"eqHighDb\":" << deckB.eqHighDb << ",\"eqLinear\":" << EqGainForFrequency(deckB) << ",\"framesWritten\":" << deckBStats.framesWritten << ",\"leftPeak\":" << deckBStats.leftPeak << ",\"rightPeak\":" << deckBStats.rightPeak << "}"
    << "]"
    << "}\n";

  CoTaskMemFree(mixFormat);
  return 0;
}

int RenderWav(
  int durationMs,
  const std::wstring& deckAPath,
  const std::wstring& deckBPath,
  double deckAStartMs,
  double deckBStartMs,
  double deckAGain,
  double deckBGain,
  double deckAPan,
  double deckBPan,
  double deckAEqLowDb,
  double deckAEqMidDb,
  double deckAEqHighDb,
  double deckBEqLowDb,
  double deckBEqMidDb,
  double deckBEqHighDb) {
  WavData deckAWav;
  std::string wavError;
  const bool hasDeckA = !deckAPath.empty();
  const bool hasDeckB = !deckBPath.empty();
  if (!hasDeckA && !hasDeckB) {
    std::cerr << "{\"error\":\"At least one deck WAV path is required\"}\n";
    return 65;
  }
  if (hasDeckA && !LoadWavFile(deckAPath, deckAWav, wavError)) {
    std::cerr << "{\"error\":\"" << wavError << "\"}\n";
    return 10;
  }
  WavData deckBWav;
  if (hasDeckB && !LoadWavFile(deckBPath, deckBWav, wavError)) {
    std::cerr << "{\"error\":\"" << wavError << "\"}\n";
    return 11;
  }

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
  const DWORD targetMs = static_cast<DWORD>(std::max(50, std::min(10000, durationMs)));
  const double sampleRate = std::max<DWORD>(1, mixFormat->nSamplesPerSec);
  DeckState deckA = MakeDeck("A", 1000.0, deckAGain, deckAPan, deckAEqLowDb, deckAEqMidDb, deckAEqHighDb);
  DeckState deckB = MakeDeck("B", 1000.0, deckBGain, deckBPan, deckBEqLowDb, deckBEqMidDb, deckBEqHighDb);
  DeckStats deckAStats;
  DeckStats deckBStats;
  RenderStats renderStats;
  const uint64_t sourceFrames = hasDeckA ? deckAWav.samples.size() / std::max<uint16_t>(1, deckAWav.channels) : 0;
  const uint64_t sourceBFrames = hasDeckB ? deckBWav.samples.size() / std::max<uint16_t>(1, deckBWav.channels) : 0;
  const double deckAStartFrame = ClampDouble(deckAStartMs, 0.0, WavDurationMs(deckAWav)) * sampleRate / 1000.0;
  const double deckBStartFrame = ClampDouble(deckBStartMs, 0.0, WavDurationMs(deckBWav)) * sampleRate / 1000.0;

  hr = audioClient->Start();
  if (FAILED(hr)) {
    CoTaskMemFree(mixFormat);
    std::cerr << "{\"error\":\"IAudioClient Start failed\",\"hresult\":" << static_cast<int32_t>(hr) << "}\n";
    return 7;
  }

  while (GetTickCount() - startTick < targetMs) {
    UINT32 paddingFrames = 0;
    hr = audioClient->GetCurrentPadding(&paddingFrames);
    if (FAILED(hr)) {
      renderStats.underruns += 1;
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
      renderStats.underruns += 1;
      Sleep(1);
      continue;
    }

    for (UINT32 frame = 0; frame < availableFrames; ++frame) {
      const double absoluteFrame = static_cast<double>(renderStats.framesWritten + frame);
      double left = 0.0;
      double right = 0.0;
      if (hasDeckA) {
        const double sourceLeft = WavSample(deckAWav, deckAStartFrame + absoluteFrame, sampleRate, 0);
        const double sourceRight = WavSample(deckAWav, deckAStartFrame + absoluteFrame, sampleRate, 1);
        MixDeckStereoFrame(deckA, deckAStats, sourceLeft, sourceRight, left, right);
      }
      if (hasDeckB) {
        const double sourceBLeft = WavSample(deckBWav, deckBStartFrame + absoluteFrame, sampleRate, 0);
        const double sourceBRight = WavSample(deckBWav, deckBStartFrame + absoluteFrame, sampleRate, 1);
        MixDeckStereoFrame(deckB, deckBStats, sourceBLeft, sourceBRight, left, right);
      }
      left = ClampDouble(left, -0.95, 0.95);
      right = ClampDouble(right, -0.95, 0.95);

      renderStats.masterPeakLeft = std::max(renderStats.masterPeakLeft, std::abs(left));
      renderStats.masterPeakRight = std::max(renderStats.masterPeakRight, std::abs(right));
      WriteInterleavedFrame(buffer, mixFormat, frame, left, right);
    }

    hr = renderClient->ReleaseBuffer(availableFrames, 0);
    if (FAILED(hr)) {
      renderStats.underruns += 1;
      continue;
    }

    renderStats.framesWritten += availableFrames;
    if (hasDeckA) deckAStats.framesWritten += availableFrames;
    if (hasDeckB) deckBStats.framesWritten += availableFrames;
    renderStats.passes += 1;
  }

  audioClient->Stop();
  const DWORD elapsedMs = std::max<DWORD>(1, GetTickCount() - startTick);

  std::cout
    << "{"
    << "\"status\":\"ready\","
    << "\"backend\":\"wasapi-wav-render\","
    << "\"deviceName\":\"" << EscapeJson(GetDeviceName(renderDevice.Get())) << "\","
    << "\"format\":{"
    << "\"sampleRate\":" << mixFormat->nSamplesPerSec << ","
    << "\"channels\":" << mixFormat->nChannels << ","
    << "\"bitsPerSample\":" << mixFormat->wBitsPerSample << ","
    << "\"blockAlign\":" << mixFormat->nBlockAlign
    << "},"
    << "\"source\":";
  if (hasDeckA) {
    std::cout
      << "{"
      << "\"type\":\"wav\","
      << "\"sampleRate\":" << deckAWav.sampleRate << ","
      << "\"channels\":" << deckAWav.channels << ","
      << "\"bitsPerSample\":" << deckAWav.bitsPerSample << ","
      << "\"frames\":" << sourceFrames << ","
      << "\"startMs\":" << deckAStartMs
      << "}";
  } else {
    std::cout << "null";
  }
  std::cout
    << ",\"sources\":[";
  bool wroteSource = false;
  if (hasDeckA) {
    std::cout << "{\"deck\":\"A\",\"type\":\"wav\",\"sampleRate\":" << deckAWav.sampleRate << ",\"channels\":" << deckAWav.channels << ",\"bitsPerSample\":" << deckAWav.bitsPerSample << ",\"frames\":" << sourceFrames << ",\"durationMs\":" << WavDurationMs(deckAWav) << ",\"startMs\":" << deckAStartMs << "}";
    wroteSource = true;
  }
  if (hasDeckB) {
    if (wroteSource) std::cout << ",";
    std::cout << "{\"deck\":\"B\",\"type\":\"wav\",\"sampleRate\":" << deckBWav.sampleRate << ",\"channels\":" << deckBWav.channels << ",\"bitsPerSample\":" << deckBWav.bitsPerSample << ",\"frames\":" << sourceBFrames << ",\"durationMs\":" << WavDurationMs(deckBWav) << ",\"startMs\":" << deckBStartMs << "}";
  }
  std::cout
    << "],"
    << "\"buffer\":{"
    << "\"frames\":" << bufferFrames << ","
    << "\"durationMs\":" << (bufferFrames * 1000.0 / sampleRate) << ","
    << "\"defaultPeriodMs\":" << (defaultPeriod / 10000.0) << ","
    << "\"minimumPeriodMs\":" << (minimumPeriod / 10000.0)
    << "},"
    << "\"render\":{"
    << "\"type\":\"wav\","
    << "\"requestedMs\":" << targetMs << ","
    << "\"elapsedMs\":" << elapsedMs << ","
    << "\"framesWritten\":" << renderStats.framesWritten << ","
    << "\"passes\":" << renderStats.passes << ","
    << "\"underruns\":" << renderStats.underruns << ","
    << "\"masterPeakLeft\":" << renderStats.masterPeakLeft << ","
    << "\"masterPeakRight\":" << renderStats.masterPeakRight
    << "},"
    << "\"routes\":[";
  bool wroteRoute = false;
  if (hasDeckA) {
    std::cout << "{\"deck\":\"A\",\"status\":\"wav\",\"gain\":" << deckA.gain << ",\"pan\":" << deckA.pan << ",\"eqLowDb\":" << deckA.eqLowDb << ",\"eqMidDb\":" << deckA.eqMidDb << ",\"eqHighDb\":" << deckA.eqHighDb << ",\"eqLinear\":" << EqGainForFrequency(deckA) << ",\"framesWritten\":" << deckAStats.framesWritten << ",\"leftPeak\":" << deckAStats.leftPeak << ",\"rightPeak\":" << deckAStats.rightPeak << "}";
    wroteRoute = true;
  }
  if (hasDeckB) {
    if (wroteRoute) std::cout << ",";
    std::cout << "{\"deck\":\"B\",\"status\":\"wav\",\"gain\":" << deckB.gain << ",\"pan\":" << deckB.pan << ",\"eqLowDb\":" << deckB.eqLowDb << ",\"eqMidDb\":" << deckB.eqMidDb << ",\"eqHighDb\":" << deckB.eqHighDb << ",\"eqLinear\":" << EqGainForFrequency(deckB) << ",\"framesWritten\":" << deckBStats.framesWritten << ",\"leftPeak\":" << deckBStats.leftPeak << ",\"rightPeak\":" << deckBStats.rightPeak << "}";
  }
  std::cout
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
  if (command == L"--render-tone") {
    int durationMs = 250;
    double deckAGain = 0.08;
    double deckBGain = 0.06;
    double deckAPan = -18.0;
    double deckBPan = 18.0;
    double deckAEqLowDb = 0.0;
    double deckAEqMidDb = 0.0;
    double deckAEqHighDb = 0.0;
    double deckBEqLowDb = 0.0;
    double deckBEqMidDb = 0.0;
    double deckBEqHighDb = 0.0;
    for (int i = 2; i < argc - 1; ++i) {
      const std::wstring arg = argv[i];
      if (arg == L"--duration-ms") durationMs = _wtoi(argv[i + 1]);
      if (arg == L"--deck-a-gain") deckAGain = _wtof(argv[i + 1]);
      if (arg == L"--deck-b-gain") deckBGain = _wtof(argv[i + 1]);
      if (arg == L"--deck-a-pan") deckAPan = _wtof(argv[i + 1]);
      if (arg == L"--deck-b-pan") deckBPan = _wtof(argv[i + 1]);
      if (arg == L"--deck-a-eq-low") deckAEqLowDb = _wtof(argv[i + 1]);
      if (arg == L"--deck-a-eq-mid") deckAEqMidDb = _wtof(argv[i + 1]);
      if (arg == L"--deck-a-eq-high") deckAEqHighDb = _wtof(argv[i + 1]);
      if (arg == L"--deck-b-eq-low") deckBEqLowDb = _wtof(argv[i + 1]);
      if (arg == L"--deck-b-eq-mid") deckBEqMidDb = _wtof(argv[i + 1]);
      if (arg == L"--deck-b-eq-high") deckBEqHighDb = _wtof(argv[i + 1]);
    }
    return RenderTone(
      durationMs,
      deckAGain,
      deckBGain,
      deckAPan,
      deckBPan,
      deckAEqLowDb,
      deckAEqMidDb,
      deckAEqHighDb,
      deckBEqLowDb,
      deckBEqMidDb,
      deckBEqHighDb);
  }
  if (command == L"--render-wav") {
    int durationMs = 1000;
    std::wstring deckAPath;
    std::wstring deckBPath;
    double deckAStartMs = 0.0;
    double deckBStartMs = 0.0;
    double deckAGain = 0.12;
    double deckBGain = 0.12;
    double deckAPan = 0.0;
    double deckBPan = 0.0;
    double deckAEqLowDb = 0.0;
    double deckAEqMidDb = 0.0;
    double deckAEqHighDb = 0.0;
    double deckBEqLowDb = 0.0;
    double deckBEqMidDb = 0.0;
    double deckBEqHighDb = 0.0;
    for (int i = 2; i < argc - 1; ++i) {
      const std::wstring arg = argv[i];
      if (arg == L"--duration-ms") durationMs = _wtoi(argv[i + 1]);
      if (arg == L"--deck-a") deckAPath = argv[i + 1];
      if (arg == L"--deck-b") deckBPath = argv[i + 1];
      if (arg == L"--deck-a-start-ms") deckAStartMs = _wtof(argv[i + 1]);
      if (arg == L"--deck-b-start-ms") deckBStartMs = _wtof(argv[i + 1]);
      if (arg == L"--deck-a-gain") deckAGain = _wtof(argv[i + 1]);
      if (arg == L"--deck-b-gain") deckBGain = _wtof(argv[i + 1]);
      if (arg == L"--deck-a-pan") deckAPan = _wtof(argv[i + 1]);
      if (arg == L"--deck-b-pan") deckBPan = _wtof(argv[i + 1]);
      if (arg == L"--deck-a-eq-low") deckAEqLowDb = _wtof(argv[i + 1]);
      if (arg == L"--deck-a-eq-mid") deckAEqMidDb = _wtof(argv[i + 1]);
      if (arg == L"--deck-a-eq-high") deckAEqHighDb = _wtof(argv[i + 1]);
      if (arg == L"--deck-b-eq-low") deckBEqLowDb = _wtof(argv[i + 1]);
      if (arg == L"--deck-b-eq-mid") deckBEqMidDb = _wtof(argv[i + 1]);
      if (arg == L"--deck-b-eq-high") deckBEqHighDb = _wtof(argv[i + 1]);
    }
    if (deckAPath.empty() && deckBPath.empty()) {
      std::cerr << "{\"error\":\"At least one deck WAV path is required\"}\n";
      return 65;
    }
    return RenderWav(
      durationMs,
      deckAPath,
      deckBPath,
      deckAStartMs,
      deckBStartMs,
      deckAGain,
      deckBGain,
      deckAPan,
      deckBPan,
      deckAEqLowDb,
      deckAEqMidDb,
      deckAEqHighDb,
      deckBEqLowDb,
      deckBEqMidDb,
      deckBEqHighDb);
  }

  std::cerr << "{\"error\":\"Unknown command\"}\n";
  return 64;
}

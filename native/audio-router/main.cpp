#include <Windows.h>
#include <Audioclient.h>
#include <Propkeydef.h>
#include <Functiondiscoverykeys_devpkey.h>
#include <ksmedia.h>
#include <Mmdeviceapi.h>
#include <Propvarutil.h>
#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <cmath>
#include <deque>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>
#include <wrl/client.h>

using Microsoft::WRL::ComPtr;
namespace fs = std::filesystem;

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

std::string EscapeJsonString(const std::string& value) {
  std::ostringstream out;
  for (char ch : value) {
    if (ch == '\\') out << "\\\\";
    else if (ch == '"') out << "\\\"";
    else if (ch == '\n') out << "\\n";
    else if (ch == '\r') out << "\\r";
    else if (ch == '\t') out << "\\t";
    else out << ch;
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

bool GetEndpointByIdOrDefault(EDataFlow flow, const std::wstring& deviceId, ComPtr<IMMDevice>& device) {
  if (deviceId.empty() || deviceId == L"default-output" || deviceId == L"default-input") {
    return GetDefaultEndpoint(flow, device);
  }

  ComPtr<IMMDeviceEnumerator> enumerator;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
  if (FAILED(hr)) return false;
  hr = enumerator->GetDevice(deviceId.c_str(), &device);
  return SUCCEEDED(hr);
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

constexpr size_t kPersistentEqBandCount = 8;
const std::array<double, kPersistentEqBandCount> kPersistentEqFrequencies = { 31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0 };

struct BiquadFilter {
  double b0 = 1.0;
  double b1 = 0.0;
  double b2 = 0.0;
  double a1 = 0.0;
  double a2 = 0.0;
  double z1 = 0.0;
  double z2 = 0.0;

  void Reset() {
    z1 = 0.0;
    z2 = 0.0;
  }

  void ConfigurePeak(double sampleRate, double frequency, double gainDb, double q = 1.15) {
    if (sampleRate <= 0.0 || frequency <= 0.0 || frequency >= sampleRate * 0.5) {
      b0 = 1.0;
      b1 = 0.0;
      b2 = 0.0;
      a1 = 0.0;
      a2 = 0.0;
      return;
    }

    const double clampedGain = ClampDouble(gainDb, -18.0, 18.0);
    if (std::abs(clampedGain) < 0.001) {
      b0 = 1.0;
      b1 = 0.0;
      b2 = 0.0;
      a1 = 0.0;
      a2 = 0.0;
      return;
    }

    const double twoPi = 6.28318530717958647692;
    const double a = std::pow(10.0, clampedGain / 40.0);
    const double omega = twoPi * frequency / sampleRate;
    const double alpha = std::sin(omega) / (2.0 * q);
    const double cosOmega = std::cos(omega);
    const double rawB0 = 1.0 + alpha * a;
    const double rawB1 = -2.0 * cosOmega;
    const double rawB2 = 1.0 - alpha * a;
    const double rawA0 = 1.0 + alpha / a;
    const double rawA1 = -2.0 * cosOmega;
    const double rawA2 = 1.0 - alpha / a;

    b0 = rawB0 / rawA0;
    b1 = rawB1 / rawA0;
    b2 = rawB2 / rawA0;
    a1 = rawA1 / rawA0;
    a2 = rawA2 / rawA0;
  }

  double Process(double input) {
    const double output = (b0 * input) + z1;
    z1 = (b1 * input) - (a1 * output) + z2;
    z2 = (b2 * input) - (a2 * output);
    if (!std::isfinite(z1)) z1 = 0.0;
    if (!std::isfinite(z2)) z2 = 0.0;
    return std::isfinite(output) ? output : 0.0;
  }
};

struct PersistentDeckEq {
  std::array<double, kPersistentEqBandCount> gainsDb = {};
  std::array<BiquadFilter, kPersistentEqBandCount> leftFilters;
  std::array<BiquadFilter, kPersistentEqBandCount> rightFilters;

  void Configure(double sampleRate) {
    for (size_t index = 0; index < kPersistentEqBandCount; ++index) {
      const double gain = ClampDouble(gainsDb[index], -18.0, 18.0);
      gainsDb[index] = gain;
      leftFilters[index].ConfigurePeak(sampleRate, kPersistentEqFrequencies[index], gain);
      rightFilters[index].ConfigurePeak(sampleRate, kPersistentEqFrequencies[index], gain);
    }
  }

  void Reset() {
    for (size_t index = 0; index < kPersistentEqBandCount; ++index) {
      leftFilters[index].Reset();
      rightFilters[index].Reset();
    }
  }

  void Process(double& left, double& right) {
    for (size_t index = 0; index < kPersistentEqBandCount; ++index) {
      left = leftFilters[index].Process(left);
      right = rightFilters[index].Process(right);
    }
  }
};

struct RenderStats {
  uint64_t framesWritten = 0;
  uint32_t passes = 0;
  uint32_t underruns = 0;
  double masterPeakLeft = 0.0;
  double masterPeakRight = 0.0;
};

struct LatencySettings {
  std::string profile = "balanced";
  int bufferMs = 80;
  bool restartRequired = false;
};

LatencySettings MakeLatencySettings(const std::string& profile, double requestedBufferMs = 0.0) {
  LatencySettings settings;
  if (profile == "low") {
    settings.profile = "low";
    settings.bufferMs = 30;
  } else if (profile == "stable") {
    settings.profile = "stable";
    settings.bufferMs = 160;
  } else if (profile == "custom") {
    settings.profile = "custom";
    settings.bufferMs = static_cast<int>(ClampDouble(requestedBufferMs, 20.0, 500.0));
  } else {
    settings.profile = "balanced";
    settings.bufferMs = 80;
  }
  return settings;
}

REFERENCE_TIME BufferMsToReferenceTime(int bufferMs) {
  return static_cast<REFERENCE_TIME>(std::max(20, std::min(500, bufferMs))) * 10000;
}

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

void MixDeckStereoFrame(const DeckState& deck, DeckStats& stats, double sourceLeft, double sourceRight, double& left, double& right);
void MixDeckStereoFrameWithoutEq(const DeckState& deck, DeckStats& stats, double sourceLeft, double sourceRight, double& left, double& right);

std::wstring Utf8ToWide(const std::string& value) {
  if (value.empty()) return L"";
  const int size = MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, nullptr, 0);
  if (size <= 0) return L"";
  std::wstring wide(size - 1, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, wide.data(), size);
  return wide;
}

std::string JsonStringValue(const std::string& line, const std::string& key) {
  const std::string marker = "\"" + key + "\"";
  size_t pos = line.find(marker);
  if (pos == std::string::npos) return "";
  pos = line.find(':', pos + marker.size());
  if (pos == std::string::npos) return "";
  pos = line.find('"', pos + 1);
  if (pos == std::string::npos) return "";
  std::string value;
  bool escaped = false;
  for (size_t index = pos + 1; index < line.size(); ++index) {
    const char ch = line[index];
    if (escaped) {
      if (ch == 'n') value.push_back('\n');
      else if (ch == 'r') value.push_back('\r');
      else if (ch == 't') value.push_back('\t');
      else value.push_back(ch);
      escaped = false;
      continue;
    }
    if (ch == '\\') {
      escaped = true;
      continue;
    }
    if (ch == '"') break;
    value.push_back(ch);
  }
  return value;
}

double JsonNumberValue(const std::string& line, const std::string& key, double fallback = 0.0) {
  const std::string marker = "\"" + key + "\"";
  size_t pos = line.find(marker);
  if (pos == std::string::npos) return fallback;
  pos = line.find(':', pos + marker.size());
  if (pos == std::string::npos) return fallback;
  const size_t start = line.find_first_of("-0123456789.", pos + 1);
  if (start == std::string::npos) return fallback;
  char* end = nullptr;
  const double value = std::strtod(line.c_str() + start, &end);
  return end == line.c_str() + start ? fallback : value;
}

int Base64Value(char ch) {
  if (ch >= 'A' && ch <= 'Z') return ch - 'A';
  if (ch >= 'a' && ch <= 'z') return ch - 'a' + 26;
  if (ch >= '0' && ch <= '9') return ch - '0' + 52;
  if (ch == '+') return 62;
  if (ch == '/') return 63;
  return -1;
}

const char kBase64Alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::vector<uint8_t> DecodeBase64(const std::string& value) {
  std::vector<uint8_t> bytes;
  int accumulator = 0;
  int bits = -8;
  for (char ch : value) {
    if (ch == '=') break;
    const int decoded = Base64Value(ch);
    if (decoded < 0) continue;
    accumulator = (accumulator << 6) | decoded;
    bits += 6;
    if (bits >= 0) {
      bytes.push_back(static_cast<uint8_t>((accumulator >> bits) & 0xff));
      bits -= 8;
    }
  }
  return bytes;
}

std::string EncodeBase64(const std::vector<uint8_t>& bytes) {
  std::string output;
  output.reserve(((bytes.size() + 2) / 3) * 4);
  for (size_t index = 0; index < bytes.size(); index += 3) {
    const uint32_t octetA = bytes[index];
    const uint32_t octetB = index + 1 < bytes.size() ? bytes[index + 1] : 0;
    const uint32_t octetC = index + 2 < bytes.size() ? bytes[index + 2] : 0;
    const uint32_t triple = (octetA << 16) | (octetB << 8) | octetC;
    output.push_back(kBase64Alphabet[(triple >> 18) & 0x3f]);
    output.push_back(kBase64Alphabet[(triple >> 12) & 0x3f]);
    output.push_back(index + 1 < bytes.size() ? kBase64Alphabet[(triple >> 6) & 0x3f] : '=');
    output.push_back(index + 2 < bytes.size() ? kBase64Alphabet[triple & 0x3f] : '=');
  }
  return output;
}

double SampleAsDouble(const BYTE* bytes, WORD bitsPerSample, WORD blockAlign, WORD channelCount, UINT32 frame, WORD channel, bool isFloat) {
  const WORD bytesPerSample = std::max<WORD>(1, bitsPerSample / 8);
  const BYTE* sample = bytes + (frame * blockAlign) + (std::min<WORD>(channel, channelCount - 1) * bytesPerSample);
  if (isFloat && bitsPerSample == 32) return ClampDouble(*reinterpret_cast<const float*>(sample), -1.0, 1.0);
  if (bitsPerSample == 16) return ClampDouble(static_cast<double>(*reinterpret_cast<const int16_t*>(sample)) / 32768.0, -1.0, 1.0);
  if (bitsPerSample == 24) {
    int32_t packed = sample[0] | (sample[1] << 8) | (sample[2] << 16);
    if (packed & 0x800000) packed |= ~0xffffff;
    return ClampDouble(static_cast<double>(packed) / 8388608.0, -1.0, 1.0);
  }
  if (bitsPerSample == 32) return ClampDouble(static_cast<double>(*reinterpret_cast<const int32_t*>(sample)) / 2147483648.0, -1.0, 1.0);
  return 0.0;
}

void AppendPcm16Base64(std::deque<std::array<double, 2>>& buffer, const std::string& encoded, int channels, size_t maxFrames) {
  const std::vector<uint8_t> bytes = DecodeBase64(encoded);
  const int sourceChannels = std::max(1, std::min(2, channels));
  const size_t bytesPerFrame = static_cast<size_t>(sourceChannels) * 2;
  if (bytesPerFrame == 0) return;

  const size_t frames = bytes.size() / bytesPerFrame;
  for (size_t frame = 0; frame < frames; ++frame) {
    const uint8_t* frameStart = bytes.data() + (frame * bytesPerFrame);
    int16_t leftPacked = 0;
    std::memcpy(&leftPacked, frameStart, sizeof(int16_t));
    int16_t rightPacked = leftPacked;
    if (sourceChannels > 1) {
      std::memcpy(&rightPacked, frameStart + 2, sizeof(int16_t));
    }
    buffer.push_back({
      ClampDouble(static_cast<double>(leftPacked) / 32768.0, -1.0, 1.0),
      ClampDouble(static_cast<double>(rightPacked) / 32768.0, -1.0, 1.0),
    });
  }

  while (buffer.size() > maxFrames) buffer.pop_front();
}

void AppendInterleavedCaptureFrames(
  std::deque<std::array<double, 2>>& buffer,
  const BYTE* data,
  UINT32 frames,
  const WAVEFORMATEX* format,
  size_t maxFrames) {
  if (!data || !format) return;
  const WORD channels = std::max<WORD>(1, format->nChannels);
  const WORD bits = format->wBitsPerSample;
  const bool isFloat = IsFloatFormat(format);
  for (UINT32 frame = 0; frame < frames; ++frame) {
    const double left = SampleAsDouble(data, bits, format->nBlockAlign, channels, frame, 0, isFloat);
    const double right = channels > 1 ? SampleAsDouble(data, bits, format->nBlockAlign, channels, frame, 1, isFloat) : left;
    buffer.push_back({ left, right });
  }
  while (buffer.size() > maxFrames) buffer.pop_front();
}

std::wstring Vst3BridgePath() {
  wchar_t modulePath[MAX_PATH] = {};
  GetModuleFileNameW(nullptr, modulePath, MAX_PATH);
  fs::path current(modulePath);
  fs::path nativeRoot = current.parent_path().parent_path().parent_path().parent_path();
  fs::path bridge = nativeRoot / L"vst3-bridge" / L"build" / L"Release" / L"resonance-vst3-bridge.exe";
  return bridge.wstring();
}

struct Vst3BridgeProcess {
  PROCESS_INFORMATION processInfo {};
  HANDLE stdinWrite = nullptr;
  HANDLE stdoutRead = nullptr;
  std::string pluginId;
  std::string pluginPath;
  bool loaded = false;

  ~Vst3BridgeProcess() {
    Stop();
  }

  void Stop() {
    if (stdinWrite) {
      const std::string exitLine = "{\"type\":\"exit\",\"requestId\":\"router-exit\"}\n";
      DWORD written = 0;
      WriteFile(stdinWrite, exitLine.data(), static_cast<DWORD>(exitLine.size()), &written, nullptr);
    }
    if (processInfo.hProcess) {
      WaitForSingleObject(processInfo.hProcess, 500);
      DWORD exitCode = 0;
      if (GetExitCodeProcess(processInfo.hProcess, &exitCode) && exitCode == STILL_ACTIVE) {
        TerminateProcess(processInfo.hProcess, 0);
      }
      CloseHandle(processInfo.hProcess);
      processInfo.hProcess = nullptr;
    }
    if (processInfo.hThread) {
      CloseHandle(processInfo.hThread);
      processInfo.hThread = nullptr;
    }
    if (stdinWrite) {
      CloseHandle(stdinWrite);
      stdinWrite = nullptr;
    }
    if (stdoutRead) {
      CloseHandle(stdoutRead);
      stdoutRead = nullptr;
    }
    loaded = false;
    pluginId.clear();
    pluginPath.clear();
  }

  bool Start(std::string& error) {
    if (processInfo.hProcess && stdinWrite && stdoutRead) return true;

    SECURITY_ATTRIBUTES security {};
    security.nLength = sizeof(SECURITY_ATTRIBUTES);
    security.bInheritHandle = TRUE;
    security.lpSecurityDescriptor = nullptr;

    HANDLE stdinRead = nullptr;
    HANDLE stdoutWrite = nullptr;
    if (!CreatePipe(&stdinRead, &stdinWrite, &security, 0)) {
      error = "VST3 bridge stdin pipe failed";
      return false;
    }
    if (!CreatePipe(&stdoutRead, &stdoutWrite, &security, 0)) {
      CloseHandle(stdinRead);
      CloseHandle(stdinWrite);
      stdinWrite = nullptr;
      error = "VST3 bridge stdout pipe failed";
      return false;
    }
    SetHandleInformation(stdinWrite, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(stdoutRead, HANDLE_FLAG_INHERIT, 0);

    STARTUPINFOW startup {};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = stdinRead;
    startup.hStdOutput = stdoutWrite;
    startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);

    std::wstring command = L"\"" + Vst3BridgePath() + L"\"";
    BOOL created = CreateProcessW(
      nullptr,
      command.data(),
      nullptr,
      nullptr,
      TRUE,
      CREATE_NO_WINDOW,
      nullptr,
      nullptr,
      &startup,
      &processInfo);

    CloseHandle(stdinRead);
    CloseHandle(stdoutWrite);
    if (!created) {
      Stop();
      error = "VST3 bridge process could not start";
      return false;
    }
    return true;
  }

  bool ReadLine(std::string& line, std::string& error) {
    line.clear();
    char ch = 0;
    DWORD read = 0;
    while (ReadFile(stdoutRead, &ch, 1, &read, nullptr) && read == 1) {
      if (ch == '\n') return true;
      if (ch != '\r') line.push_back(ch);
    }
    error = "VST3 bridge closed before responding";
    return false;
  }

  bool Request(const std::string& message, std::string& response, std::string& error) {
    if (!stdinWrite || !stdoutRead) {
      error = "VST3 bridge is not running";
      return false;
    }
    const std::string line = message + "\n";
    DWORD written = 0;
    if (!WriteFile(stdinWrite, line.data(), static_cast<DWORD>(line.size()), &written, nullptr) || written != line.size()) {
      error = "VST3 bridge write failed";
      return false;
    }
    return ReadLine(response, error);
  }

  bool EnsureLoaded(const std::string& nextPluginId, const std::string& nextPluginPath, std::string& error) {
    if (nextPluginPath.empty()) {
      Stop();
      return false;
    }
    if (loaded && pluginPath == nextPluginPath && pluginId == nextPluginId) return true;
    Stop();
    if (!Start(error)) return false;
    pluginId = nextPluginId.empty() ? "router-plugin" : nextPluginId;
    pluginPath = nextPluginPath;
    std::ostringstream request;
    request
      << "{\"type\":\"loadPlugin\",\"requestId\":\"router-load\","
      << "\"id\":\"" << EscapeJsonString(pluginId) << "\","
      << "\"path\":\"" << EscapeJsonString(pluginPath) << "\"}";
    std::string response;
    if (!Request(request.str(), response, error)) return false;
    loaded = response.find("\"status\":\"loaded\"") != std::string::npos;
    if (!loaded) error = "VST3 bridge plugin load failed";
    return loaded;
  }
};

struct ServerState;
void CaptureLoopbackIntoDeck(
  ServerState& state,
  char deckId,
  const std::wstring& deviceId,
  int durationMs,
  double renderSampleRate,
  size_t maxPcmFrames);
void ContinuousCaptureIntoDeck(
  ServerState& state,
  char deckId,
  const std::wstring& deviceId,
  size_t maxPcmFrames);

struct ServerDeck {
  char id = 'A';
  WavData wav;
  std::deque<std::array<double, 2>> pcmFrames;
  bool loaded = false;
  bool playing = false;
  uint64_t positionFrames = 0;
  uint64_t pcmFramesReceived = 0;
  uint64_t pcmFramesRendered = 0;
  uint32_t pcmUnderruns = 0;
  uint32_t captureFramesReceived = 0;
  bool captureStreaming = false;
  std::string sourceType = "empty";
  DeckState processing = MakeDeck("A", 1000.0, 0.12, 0.0, 0.0, 0.0, 0.0);
  PersistentDeckEq eq;
  uint32_t pluginCount = 0;
  double pluginGainDb = 0.0;
  double pluginOutputGainDb = 0.0;
  double pluginDrive = 1.0;
  double pluginWetDry = 100.0;
  std::string vst3PluginId;
  std::string vst3PluginPath;
  std::string vst3ParameterValues;
  std::string vst3Status = "disabled";
  uint64_t vst3BlocksProcessed = 0;
  uint32_t vst3Failures = 0;
  Vst3BridgeProcess vst3Bridge;
  DeckStats stats;
  std::wstring name;
  std::string error;
};

struct ServerState {
  ServerDeck deckA;
  ServerDeck deckB;
  std::thread captureAThread;
  std::thread captureBThread;
  LatencySettings latency;
  UINT32 actualBufferFrames = 0;
  double actualBufferMs = 0.0;
  double defaultPeriodMs = 0.0;
  double minimumPeriodMs = 0.0;
  bool running = true;
  uint64_t framesWritten = 0;
  uint32_t passes = 0;
  uint32_t underruns = 0;
  double masterPeakLeft = 0.0;
  double masterPeakRight = 0.0;
  std::mutex mutex;
};

ServerDeck& SelectServerDeck(ServerState& state, const std::string& deck) {
  return deck == "B" ? state.deckB : state.deckA;
}

double ServerDeckPositionMs(const ServerDeck& deck) {
  if (deck.sourceType == "pcm" || deck.sourceType == "loopback") return 0.0;
  if (!deck.loaded || deck.wav.sampleRate == 0) return 0.0;
  return static_cast<double>(deck.positionFrames) * 1000.0 / static_cast<double>(deck.wav.sampleRate);
}

void ApplyDeckPluginLane(ServerDeck& deck, double& left, double& right) {
  if (deck.pluginCount == 0) return;
  const double inputGain = std::pow(10.0, ClampDouble(deck.pluginGainDb, -12.0, 12.0) / 20.0);
  const double outputGain = std::pow(10.0, ClampDouble(deck.pluginOutputGainDb, -24.0, 24.0) / 20.0);
  const double drive = ClampDouble(deck.pluginDrive, 1.0, 3.0);
  const double wet = ClampDouble(deck.pluginWetDry, 0.0, 100.0) / 100.0;
  const double normalize = std::tanh(drive);
  const double denominator = std::abs(normalize) > 0.0001 ? normalize : 1.0;
  const double dryLeft = left;
  const double dryRight = right;
  const double wetLeft = (std::tanh(left * inputGain * drive) / denominator) * outputGain;
  const double wetRight = (std::tanh(right * inputGain * drive) / denominator) * outputGain;
  left = (dryLeft * (1.0 - wet)) + (wetLeft * wet);
  right = (dryRight * (1.0 - wet)) + (wetRight * wet);
}

bool ProcessDeckVst3Block(ServerDeck& deck, std::vector<std::array<double, 2>>& frames, double sampleRate) {
  if (deck.vst3PluginPath.empty() || frames.empty()) return false;
  std::string error;
  if (!deck.vst3Bridge.EnsureLoaded(deck.vst3PluginId, deck.vst3PluginPath, error)) {
    deck.vst3Status = "load-failed";
    deck.error = error;
    deck.vst3Failures += 1;
    return false;
  }

  std::vector<uint8_t> bytes(frames.size() * 4);
  double inputPeak = 0.0;
  for (size_t frame = 0; frame < frames.size(); ++frame) {
    inputPeak = std::max(inputPeak, std::abs(frames[frame][0]));
    inputPeak = std::max(inputPeak, std::abs(frames[frame][1]));
    const int16_t left = static_cast<int16_t>(ClampDouble(frames[frame][0], -1.0, 1.0) * 32767.0);
    const int16_t right = static_cast<int16_t>(ClampDouble(frames[frame][1], -1.0, 1.0) * 32767.0);
    std::memcpy(bytes.data() + (frame * 4), &left, sizeof(int16_t));
    std::memcpy(bytes.data() + (frame * 4) + sizeof(int16_t), &right, sizeof(int16_t));
  }

  std::ostringstream request;
  request
    << "{\"type\":\"processPcm\",\"requestId\":\"router-pcm\","
    << "\"pluginId\":\"" << EscapeJsonString(deck.vst3PluginId) << "\","
    << "\"frames\":" << frames.size() << ","
    << "\"channels\":2,"
    << "\"sampleRate\":" << sampleRate << ","
    << "\"parameterValues\":\"" << EscapeJsonString(deck.vst3ParameterValues) << "\","
    << "\"pcm16Base64\":\"" << EncodeBase64(bytes) << "\"}";

  std::string response;
  if (!deck.vst3Bridge.Request(request.str(), response, error)) {
    deck.vst3Status = "process-failed";
    deck.error = error;
    deck.vst3Failures += 1;
    return false;
  }
  if (response.find("\"status\":\"processed\"") == std::string::npos) {
    deck.vst3Status = "process-failed";
    deck.error = "VST3 bridge processPcm failed";
    deck.vst3Failures += 1;
    return false;
  }
  const double outputPeak = JsonNumberValue(response, "outputPeak", 0.0);
  if (inputPeak > 0.001 && outputPeak < 0.000001) {
    deck.vst3Status = "silent-output-fallback";
    deck.error = "VST3 bridge returned silence; using fallback DSP";
    deck.vst3Failures += 1;
    return false;
  }

  const std::vector<uint8_t> outputBytes = DecodeBase64(JsonStringValue(response, "pcm16Base64"));
  const size_t outputFrames = std::min(frames.size(), outputBytes.size() / 4);
  if (outputFrames == 0) {
    deck.vst3Status = "empty-output";
    deck.error = "VST3 bridge returned empty PCM";
    deck.vst3Failures += 1;
    return false;
  }
  for (size_t frame = 0; frame < outputFrames; ++frame) {
    int16_t left = 0;
    int16_t right = 0;
    std::memcpy(&left, outputBytes.data() + (frame * 4), sizeof(int16_t));
    std::memcpy(&right, outputBytes.data() + (frame * 4) + sizeof(int16_t), sizeof(int16_t));
    frames[frame][0] = ClampDouble(static_cast<double>(left) / 32768.0, -1.0, 1.0);
    frames[frame][1] = ClampDouble(static_cast<double>(right) / 32768.0, -1.0, 1.0);
  }
  deck.vst3Status = "processing";
  deck.vst3BlocksProcessed += 1;
  deck.error.clear();
  return true;
}

void CaptureLoopbackIntoDeck(
  ServerState& state,
  char deckId,
  const std::wstring& deviceId,
  int durationMs,
  double renderSampleRate,
  size_t maxPcmFrames) {
  ComInit com;
  if (FAILED(com.hr) && com.hr != RPC_E_CHANGED_MODE) {
    std::lock_guard<std::mutex> lock(state.mutex);
    SelectServerDeck(state, deckId == 'B' ? "B" : "A").error = "COM initialization failed for capture";
    return;
  }

  ComPtr<IMMDevice> captureDevice;
  EDataFlow captureFlow = deviceId.find(L"{0.0.1.") != std::wstring::npos ? eCapture : eRender;
  DWORD streamFlags = captureFlow == eRender ? AUDCLNT_STREAMFLAGS_LOOPBACK : 0;
  if (!GetEndpointByIdOrDefault(captureFlow, deviceId, captureDevice)) {
    captureFlow = captureFlow == eRender ? eCapture : eRender;
    streamFlags = captureFlow == eRender ? AUDCLNT_STREAMFLAGS_LOOPBACK : 0;
  }
  if (!captureDevice) {
    std::lock_guard<std::mutex> lock(state.mutex);
    SelectServerDeck(state, deckId == 'B' ? "B" : "A").error = "Capture endpoint unavailable";
    return;
  }

  ComPtr<IAudioClient> audioClient;
  HRESULT hr = captureDevice->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &audioClient);
  if (FAILED(hr)) {
    std::lock_guard<std::mutex> lock(state.mutex);
    SelectServerDeck(state, deckId == 'B' ? "B" : "A").error = "Loopback IAudioClient activation failed";
    return;
  }

  WAVEFORMATEX* mixFormat = nullptr;
  hr = audioClient->GetMixFormat(&mixFormat);
  if (FAILED(hr) || !mixFormat) {
    std::lock_guard<std::mutex> lock(state.mutex);
    SelectServerDeck(state, deckId == 'B' ? "B" : "A").error = "Loopback mix format unavailable";
    return;
  }

  const REFERENCE_TIME bufferDuration = 10000000;
  hr = audioClient->Initialize(
    AUDCLNT_SHAREMODE_SHARED,
    streamFlags,
    bufferDuration,
    0,
    mixFormat,
    nullptr);
  if (FAILED(hr)) {
    CoTaskMemFree(mixFormat);
    std::lock_guard<std::mutex> lock(state.mutex);
    SelectServerDeck(state, deckId == 'B' ? "B" : "A").error = "Loopback capture initialize failed";
    return;
  }

  ComPtr<IAudioCaptureClient> captureClient;
  hr = audioClient->GetService(IID_PPV_ARGS(&captureClient));
  if (FAILED(hr)) {
    CoTaskMemFree(mixFormat);
    std::lock_guard<std::mutex> lock(state.mutex);
    SelectServerDeck(state, deckId == 'B' ? "B" : "A").error = "Loopback capture client unavailable";
    return;
  }

  audioClient->Start();
  const DWORD start = GetTickCount();
  const DWORD targetMs = static_cast<DWORD>(std::max(50, std::min(5000, durationMs)));
  while (GetTickCount() - start < targetMs) {
    UINT32 packetFrames = 0;
    captureClient->GetNextPacketSize(&packetFrames);
    while (packetFrames > 0) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      hr = captureClient->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
      if (SUCCEEDED(hr)) {
        if (!(flags & AUDCLNT_BUFFERFLAGS_SILENT) && data) {
          std::lock_guard<std::mutex> lock(state.mutex);
          ServerDeck& deck = SelectServerDeck(state, deckId == 'B' ? "B" : "A");
          AppendInterleavedCaptureFrames(deck.pcmFrames, data, frames, mixFormat, maxPcmFrames);
          deck.loaded = true;
          deck.playing = true;
          deck.sourceType = "loopback";
          deck.pcmFramesReceived += frames;
          deck.captureFramesReceived += frames;
        }
        captureClient->ReleaseBuffer(frames);
      }
      captureClient->GetNextPacketSize(&packetFrames);
    }
    Sleep(10);
  }

  audioClient->Stop();
  CoTaskMemFree(mixFormat);
}

void ContinuousCaptureIntoDeck(
  ServerState& state,
  char deckId,
  const std::wstring& deviceId,
  size_t maxPcmFrames) {
  ComInit com;
  const std::string deckKey = deckId == 'B' ? "B" : "A";
  auto failDeck = [&](const std::string& message) {
    std::lock_guard<std::mutex> lock(state.mutex);
    ServerDeck& deck = SelectServerDeck(state, deckKey);
    deck.error = message;
    deck.captureStreaming = false;
  };
  if (FAILED(com.hr) && com.hr != RPC_E_CHANGED_MODE) {
    failDeck("COM initialization failed for capture");
    return;
  }

  ComPtr<IMMDevice> captureDevice;
  EDataFlow captureFlow = deviceId.find(L"{0.0.1.") != std::wstring::npos ? eCapture : eRender;
  DWORD streamFlags = captureFlow == eRender ? AUDCLNT_STREAMFLAGS_LOOPBACK : 0;
  if (!GetEndpointByIdOrDefault(captureFlow, deviceId, captureDevice)) {
    captureFlow = captureFlow == eRender ? eCapture : eRender;
    streamFlags = captureFlow == eRender ? AUDCLNT_STREAMFLAGS_LOOPBACK : 0;
  }
  if (!captureDevice) {
    failDeck("Capture endpoint unavailable");
    return;
  }

  ComPtr<IAudioClient> audioClient;
  HRESULT hr = captureDevice->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &audioClient);
  if (FAILED(hr)) {
    failDeck("Loopback IAudioClient activation failed");
    return;
  }

  WAVEFORMATEX* mixFormat = nullptr;
  hr = audioClient->GetMixFormat(&mixFormat);
  if (FAILED(hr) || !mixFormat) {
    failDeck("Loopback mix format unavailable");
    return;
  }

  const REFERENCE_TIME bufferDuration = 10000000;
  hr = audioClient->Initialize(
    AUDCLNT_SHAREMODE_SHARED,
    streamFlags,
    bufferDuration,
    0,
    mixFormat,
    nullptr);
  if (FAILED(hr)) {
    CoTaskMemFree(mixFormat);
    failDeck("Loopback capture initialize failed");
    return;
  }

  ComPtr<IAudioCaptureClient> captureClient;
  hr = audioClient->GetService(IID_PPV_ARGS(&captureClient));
  if (FAILED(hr)) {
    CoTaskMemFree(mixFormat);
    failDeck("Loopback capture client unavailable");
    return;
  }

  hr = audioClient->Start();
  if (FAILED(hr)) {
    CoTaskMemFree(mixFormat);
    failDeck("Loopback capture start failed");
    return;
  }

  while (true) {
    {
      std::lock_guard<std::mutex> lock(state.mutex);
      const ServerDeck& deck = SelectServerDeck(state, deckKey);
      if (!state.running || !deck.captureStreaming) break;
    }

    UINT32 packetFrames = 0;
    captureClient->GetNextPacketSize(&packetFrames);
    while (packetFrames > 0) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      hr = captureClient->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
      if (SUCCEEDED(hr)) {
        if (!(flags & AUDCLNT_BUFFERFLAGS_SILENT) && data) {
          std::lock_guard<std::mutex> lock(state.mutex);
          ServerDeck& deck = SelectServerDeck(state, deckKey);
          AppendInterleavedCaptureFrames(deck.pcmFrames, data, frames, mixFormat, maxPcmFrames);
          deck.loaded = true;
          deck.playing = true;
          deck.sourceType = "loopback";
          deck.pcmFramesReceived += frames;
          deck.captureFramesReceived += frames;
          deck.error.clear();
        }
        captureClient->ReleaseBuffer(frames);
      }
      captureClient->GetNextPacketSize(&packetFrames);
    }
    Sleep(10);
  }

  audioClient->Stop();
  CoTaskMemFree(mixFormat);
  {
    std::lock_guard<std::mutex> lock(state.mutex);
    SelectServerDeck(state, deckKey).captureStreaming = false;
  }
}

void PrintServerSnapshot(ServerState& state, const WAVEFORMATEX* mixFormat, const std::wstring& deviceName, const std::wstring& deviceId, const char* eventType) {
  std::lock_guard<std::mutex> lock(state.mutex);
  const double sampleRate = mixFormat ? std::max<DWORD>(1, mixFormat->nSamplesPerSec) : 48000.0;
  auto printDeckSource = [](const ServerDeck& deck) {
    std::cout
      << "{\"deck\":\"" << deck.id << "\","
      << "\"loaded\":" << (deck.loaded ? "true" : "false") << ","
      << "\"playing\":" << (deck.playing ? "true" : "false") << ","
      << "\"sourceType\":\"" << deck.sourceType << "\","
      << "\"positionMs\":" << ServerDeckPositionMs(deck) << ","
      << "\"durationMs\":" << WavDurationMs(deck.wav) << ","
      << "\"sampleRate\":" << deck.wav.sampleRate << ","
      << "\"channels\":" << deck.wav.channels << ","
      << "\"bitsPerSample\":" << deck.wav.bitsPerSample << ","
      << "\"pcmQueuedFrames\":" << deck.pcmFrames.size() << ","
      << "\"pcmFramesReceived\":" << deck.pcmFramesReceived << ","
      << "\"pcmFramesRendered\":" << deck.pcmFramesRendered << ","
      << "\"pcmUnderruns\":" << deck.pcmUnderruns << ","
      << "\"captureFramesReceived\":" << deck.captureFramesReceived << ","
      << "\"captureStreaming\":" << (deck.captureStreaming ? "true" : "false") << "}";
  };
  auto printDeckRoute = [](const ServerDeck& deck) {
    std::cout
      << "{\"deck\":\"" << deck.id << "\","
      << "\"status\":\"" << (deck.playing ? "playing" : deck.loaded ? "loaded" : "empty") << "\","
      << "\"sourceType\":\"" << deck.sourceType << "\","
      << "\"gain\":" << deck.processing.gain << ","
      << "\"pan\":" << deck.processing.pan << ","
      << "\"eqLowDb\":" << deck.processing.eqLowDb << ","
      << "\"eqMidDb\":" << deck.processing.eqMidDb << ","
      << "\"eqHighDb\":" << deck.processing.eqHighDb << ","
      << "\"eqLinear\":" << EqGainForFrequency(deck.processing) << ","
      << "\"pluginCount\":" << deck.pluginCount << ","
      << "\"pluginGainDb\":" << deck.pluginGainDb << ","
      << "\"pluginOutputGainDb\":" << deck.pluginOutputGainDb << ","
      << "\"pluginDrive\":" << deck.pluginDrive << ","
      << "\"pluginWetDry\":" << deck.pluginWetDry << ","
      << "\"vst3Status\":\"" << EscapeJsonString(deck.vst3Status) << "\","
      << "\"vst3PluginPath\":\"" << EscapeJsonString(deck.vst3PluginPath) << "\","
      << "\"vst3ParameterValues\":\"" << EscapeJsonString(deck.vst3ParameterValues) << "\","
      << "\"vst3BlocksProcessed\":" << deck.vst3BlocksProcessed << ","
      << "\"vst3Failures\":" << deck.vst3Failures << ","
      << "\"eqBandsDb\":[";
    for (size_t index = 0; index < kPersistentEqBandCount; ++index) {
      if (index > 0) std::cout << ",";
      std::cout << deck.eq.gainsDb[index];
    }
    std::cout
      << "],"
      << "\"framesWritten\":" << deck.stats.framesWritten << ","
      << "\"leftPeak\":" << deck.stats.leftPeak << ","
      << "\"rightPeak\":" << deck.stats.rightPeak << "}";
  };

  std::cout
    << "{"
    << "\"status\":\"ready\","
    << "\"event\":\"" << eventType << "\","
    << "\"backend\":\"wasapi-persistent-router\","
    << "\"deviceName\":\"" << EscapeJson(deviceName) << "\","
    << "\"deviceId\":\"" << EscapeJson(deviceId) << "\","
    << "\"format\":{"
    << "\"sampleRate\":" << static_cast<uint32_t>(sampleRate) << ","
    << "\"channels\":" << (mixFormat ? mixFormat->nChannels : 0) << ","
    << "\"bitsPerSample\":" << (mixFormat ? mixFormat->wBitsPerSample : 0) << ","
    << "\"blockAlign\":" << (mixFormat ? mixFormat->nBlockAlign : 0)
    << "},"
    << "\"latency\":{"
    << "\"profile\":\"" << state.latency.profile << "\","
    << "\"requestedBufferMs\":" << state.latency.bufferMs << ","
    << "\"actualBufferFrames\":" << state.actualBufferFrames << ","
    << "\"actualBufferMs\":" << state.actualBufferMs << ","
    << "\"defaultPeriodMs\":" << state.defaultPeriodMs << ","
    << "\"minimumPeriodMs\":" << state.minimumPeriodMs << ","
    << "\"restartRequired\":" << (state.latency.restartRequired ? "true" : "false")
    << "},"
    << "\"render\":{"
    << "\"type\":\"persistent-wav\","
    << "\"framesWritten\":" << state.framesWritten << ","
    << "\"passes\":" << state.passes << ","
    << "\"underruns\":" << state.underruns << ","
    << "\"masterPeakLeft\":" << state.masterPeakLeft << ","
    << "\"masterPeakRight\":" << state.masterPeakRight
    << "},"
    << "\"sources\":[";
  printDeckSource(state.deckA);
  std::cout << ",";
  printDeckSource(state.deckB);
  std::cout << "],\"routes\":[";
  printDeckRoute(state.deckA);
  std::cout << ",";
  printDeckRoute(state.deckB);
  std::cout << "]}\n";
  std::cout.flush();
}

void ApplyServerSettings(ServerDeck& deck, const std::string& line, double sampleRate) {
  deck.processing = MakeDeck(
    deck.id == 'B' ? "B" : "A",
    1000.0,
    JsonNumberValue(line, "gain", deck.processing.gain),
    JsonNumberValue(line, "pan", deck.processing.pan),
    JsonNumberValue(line, "eqLowDb", deck.processing.eqLowDb),
    JsonNumberValue(line, "eqMidDb", deck.processing.eqMidDb),
    JsonNumberValue(line, "eqHighDb", deck.processing.eqHighDb));
  for (size_t index = 0; index < kPersistentEqBandCount; ++index) {
    const std::string key = "eq" + std::to_string(static_cast<int>(kPersistentEqFrequencies[index])) + "Db";
    deck.eq.gainsDb[index] = ClampDouble(JsonNumberValue(line, key, deck.eq.gainsDb[index]), -18.0, 18.0);
  }
  deck.pluginCount = static_cast<uint32_t>(ClampDouble(JsonNumberValue(line, "pluginCount", deck.pluginCount), 0.0, 16.0));
  deck.pluginGainDb = ClampDouble(JsonNumberValue(line, "pluginGainDb", deck.pluginGainDb), -12.0, 12.0);
  deck.pluginOutputGainDb = ClampDouble(JsonNumberValue(line, "pluginOutputGainDb", deck.pluginOutputGainDb), -24.0, 24.0);
  deck.pluginDrive = ClampDouble(JsonNumberValue(line, "pluginDrive", deck.pluginDrive), 1.0, 3.0);
  deck.pluginWetDry = ClampDouble(JsonNumberValue(line, "pluginWetDry", deck.pluginWetDry), 0.0, 100.0);
  const std::string vst3PluginPath = JsonStringValue(line, "vst3PluginPath");
  const std::string vst3PluginId = JsonStringValue(line, "vst3PluginId");
  if (vst3PluginPath.empty()) {
    if (!deck.vst3PluginPath.empty()) deck.vst3Bridge.Stop();
    deck.vst3PluginPath.clear();
    deck.vst3PluginId.clear();
    deck.vst3ParameterValues.clear();
    deck.vst3Status = "disabled";
  } else if (vst3PluginPath != deck.vst3PluginPath || vst3PluginId != deck.vst3PluginId) {
    deck.vst3Bridge.Stop();
    deck.vst3PluginPath = vst3PluginPath;
    deck.vst3PluginId = vst3PluginId.empty() ? std::string("deck-") + deck.id + "-vst3" : vst3PluginId;
    deck.vst3Status = "pending";
  }
  deck.vst3ParameterValues = JsonStringValue(line, "vst3ParameterValues");
  deck.eq.Configure(sampleRate);
}

void ApplyServerLatency(ServerState& state, const std::string& line) {
  if (
    line.find("\"latencyProfile\"") == std::string::npos &&
    line.find("\"profile\"") == std::string::npos &&
    line.find("\"bufferMs\"") == std::string::npos) {
    return;
  }
  const std::string requestedProfile = JsonStringValue(line, "latencyProfile");
  const std::string profile = requestedProfile.empty() ? JsonStringValue(line, "profile") : requestedProfile;
  const double bufferMs = JsonNumberValue(line, "bufferMs", 0.0);
  const LatencySettings requested = MakeLatencySettings(profile, bufferMs);
  if (requested.profile != state.latency.profile || requested.bufferMs != state.latency.bufferMs) {
    state.latency = requested;
    state.latency.restartRequired = true;
  }
}

void RunServerCommand(ServerState& state, const std::string& line, double sampleRate) {
  const std::string type = JsonStringValue(line, "type");
  const std::string deckId = JsonStringValue(line, "deck");
  std::unique_lock<std::mutex> lock(state.mutex);

  if (type == "exit") {
    state.running = false;
    state.deckA.captureStreaming = false;
    state.deckB.captureStreaming = false;
    return;
  }

  if (type == "latency") {
    ApplyServerLatency(state, line);
    return;
  }

  ServerDeck& deck = SelectServerDeck(state, deckId);
  if (type == "load") {
    WavData wav;
    std::string error;
    const std::string path = JsonStringValue(line, "path");
    if (LoadWavFile(Utf8ToWide(path), wav, error)) {
      deck.wav = std::move(wav);
      deck.pcmFrames.clear();
      deck.loaded = true;
      deck.playing = false;
      deck.positionFrames = 0;
      deck.pcmFramesReceived = 0;
      deck.pcmFramesRendered = 0;
      deck.pcmUnderruns = 0;
      deck.captureFramesReceived = 0;
      deck.sourceType = "wav";
      deck.stats = {};
      deck.eq.Reset();
      deck.error.clear();
      deck.name = Utf8ToWide(JsonStringValue(line, "name"));
    } else {
      deck.loaded = false;
      deck.playing = false;
      deck.positionFrames = 0;
      deck.sourceType = "empty";
      deck.error = error;
    }
    return;
  }

  if (type == "pcm") {
    const size_t before = deck.pcmFrames.size();
    AppendPcm16Base64(
      deck.pcmFrames,
      JsonStringValue(line, "pcm16Base64"),
      static_cast<int>(JsonNumberValue(line, "channels", 2.0)),
      static_cast<size_t>(std::max(48000.0, sampleRate * 8.0)));
    const size_t appended = deck.pcmFrames.size() >= before ? deck.pcmFrames.size() - before : 0;
    deck.loaded = true;
    deck.playing = true;
    deck.sourceType = "pcm";
    deck.pcmFramesReceived += appended;
    deck.wav = {};
    deck.positionFrames = 0;
    return;
  }

  if (type == "captureLoopback") {
    const int durationMs = static_cast<int>(ClampDouble(JsonNumberValue(line, "durationMs", 500.0), 50.0, 5000.0));
    const std::wstring deviceId = Utf8ToWide(JsonStringValue(line, "deviceId"));
    const char captureDeckId = deck.id;
    deck.loaded = true;
    deck.playing = true;
    deck.sourceType = "loopback";
    deck.wav = {};
    deck.positionFrames = 0;
    deck.error.clear();
    lock.unlock();
    CaptureLoopbackIntoDeck(
      state,
      captureDeckId,
      deviceId,
      durationMs,
      sampleRate,
      static_cast<size_t>(std::max(48000.0, sampleRate * 8.0)));
    lock.lock();
    return;
  }

  if (type == "startCapture") {
    std::thread& captureThread = deck.id == 'B' ? state.captureBThread : state.captureAThread;
    if (captureThread.joinable()) {
      deck.captureStreaming = false;
      lock.unlock();
      captureThread.join();
      lock.lock();
    }
    const std::wstring deviceId = Utf8ToWide(JsonStringValue(line, "deviceId"));
    const char captureDeckId = deck.id;
    deck.loaded = true;
    deck.playing = true;
    deck.sourceType = "loopback";
    deck.wav = {};
    deck.positionFrames = 0;
    deck.error.clear();
    deck.captureStreaming = true;
    const size_t maxFrames = static_cast<size_t>(std::max(48000.0, sampleRate * 8.0));
    lock.unlock();
    captureThread = std::thread(ContinuousCaptureIntoDeck, std::ref(state), captureDeckId, deviceId, maxFrames);
    lock.lock();
    return;
  }

  if (type == "stopCapture") {
    std::thread& captureThread = deck.id == 'B' ? state.captureBThread : state.captureAThread;
    deck.captureStreaming = false;
    deck.playing = false;
    lock.unlock();
    if (captureThread.joinable()) captureThread.join();
    lock.lock();
    return;
  }

  if (type == "settings") {
    ApplyServerLatency(state, line);
    ApplyServerSettings(deck, line, sampleRate);
    return;
  }

  if (type == "play" && deck.loaded) {
    if (deck.sourceType == "wav") {
      const uint64_t frameCount = deck.wav.channels == 0 ? 0 : deck.wav.samples.size() / deck.wav.channels;
      if (deck.positionFrames >= frameCount) deck.positionFrames = 0;
    }
    deck.playing = true;
    return;
  }

  if (type == "pause") {
    deck.playing = false;
    return;
  }

  if (type == "stop") {
    std::thread& captureThread = deck.id == 'B' ? state.captureBThread : state.captureAThread;
    deck.playing = false;
    deck.captureStreaming = false;
    deck.positionFrames = 0;
    deck.pcmFrames.clear();
    deck.stats = {};
    deck.eq.Reset();
    lock.unlock();
    if (captureThread.joinable()) captureThread.join();
    lock.lock();
    return;
  }

  if (type == "seek" && deck.loaded && deck.sourceType == "wav") {
    const double positionMs = std::max(0.0, JsonNumberValue(line, "positionMs", 0.0));
    const uint64_t targetFrame = static_cast<uint64_t>(positionMs * deck.wav.sampleRate / 1000.0);
    const uint64_t frameCount = deck.wav.channels == 0 ? 0 : deck.wav.samples.size() / deck.wav.channels;
    deck.positionFrames = std::min<uint64_t>(targetFrame, frameCount);
    deck.eq.Reset();
    return;
  }
}

int RunPersistentServer(const std::wstring& outputDeviceId, LatencySettings latencySettings = MakeLatencySettings("balanced")) {
  ServerState state;
  state.latency = latencySettings;
  state.deckA.id = 'A';
  state.deckA.processing = MakeDeck("A", 1000.0, 0.12, -12.0, 0.0, 0.0, 0.0);
  state.deckB.id = 'B';
  state.deckB.processing = MakeDeck("B", 1000.0, 0.08, 12.0, 0.0, 0.0, 0.0);

  ComPtr<IMMDevice> renderDevice;
  if (!GetEndpointByIdOrDefault(eRender, outputDeviceId, renderDevice)) {
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

  const REFERENCE_TIME requestedDuration = BufferMsToReferenceTime(state.latency.bufferMs);
  hr = audioClient->Initialize(AUDCLNT_SHAREMODE_SHARED, 0, requestedDuration, 0, mixFormat, nullptr);
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
  state.actualBufferFrames = bufferFrames;
  state.actualBufferMs = bufferFrames * 1000.0 / std::max<DWORD>(1, mixFormat->nSamplesPerSec);
  state.defaultPeriodMs = defaultPeriod / 10000.0;
  state.minimumPeriodMs = minimumPeriod / 10000.0;
  const std::wstring deviceName = GetDeviceName(renderDevice.Get());
  std::wstring openedDeviceId;
  LPWSTR rawOpenedDeviceId = nullptr;
  if (SUCCEEDED(renderDevice->GetId(&rawOpenedDeviceId)) && rawOpenedDeviceId != nullptr) {
    openedDeviceId = rawOpenedDeviceId;
    CoTaskMemFree(rawOpenedDeviceId);
  }
  const double sampleRate = std::max<DWORD>(1, mixFormat->nSamplesPerSec);
  state.deckA.eq.Configure(sampleRate);
  state.deckB.eq.Configure(sampleRate);

  std::thread commandThread([&state, sampleRate]() {
    std::string line;
    while (std::getline(std::cin, line)) {
      if (!line.empty()) RunServerCommand(state, line, sampleRate);
      std::lock_guard<std::mutex> lock(state.mutex);
      if (!state.running) break;
    }
    std::lock_guard<std::mutex> lock(state.mutex);
    state.running = false;
  });

  hr = audioClient->Start();
  if (FAILED(hr)) {
    {
      std::lock_guard<std::mutex> lock(state.mutex);
      state.running = false;
    }
    commandThread.join();
    CoTaskMemFree(mixFormat);
    std::cerr << "{\"error\":\"IAudioClient Start failed\",\"hresult\":" << static_cast<int32_t>(hr) << "}\n";
    return 7;
  }

  PrintServerSnapshot(state, mixFormat, deviceName, openedDeviceId, "ready");
  DWORD lastSnapshotTick = GetTickCount();
  while (true) {
    {
      std::lock_guard<std::mutex> lock(state.mutex);
      if (!state.running) break;
    }

    UINT32 paddingFrames = 0;
    hr = audioClient->GetCurrentPadding(&paddingFrames);
    if (FAILED(hr)) {
      std::lock_guard<std::mutex> lock(state.mutex);
      state.underruns += 1;
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
      std::lock_guard<std::mutex> lock(state.mutex);
      state.underruns += 1;
      Sleep(1);
      continue;
    }

    {
      std::lock_guard<std::mutex> lock(state.mutex);
      auto renderDeckBlock = [&](ServerDeck& deck) {
        std::vector<std::array<double, 2>> frames(availableFrames, {0.0, 0.0});
        if (!deck.loaded || !deck.playing) return frames;
        for (UINT32 frame = 0; frame < availableFrames; ++frame) {
          double sourceLeft = 0.0;
          double sourceRight = 0.0;
          if (deck.sourceType == "pcm" || deck.sourceType == "loopback") {
            if (deck.pcmFrames.empty()) {
              deck.pcmUnderruns += 1;
              continue;
            }
            const auto sourceFrame = deck.pcmFrames.front();
            deck.pcmFrames.pop_front();
            sourceLeft = sourceFrame[0];
            sourceRight = sourceFrame[1];
            deck.pcmFramesRendered += 1;
          } else {
            if (deck.wav.channels == 0) continue;
            const uint64_t frameCount = deck.wav.samples.size() / deck.wav.channels;
            if (deck.positionFrames + frame >= frameCount) {
              deck.playing = false;
              deck.positionFrames = frameCount;
              continue;
            }
            const double renderFrame = static_cast<double>(deck.positionFrames + frame);
            sourceLeft = WavSample(deck.wav, renderFrame, sampleRate, 0);
            sourceRight = WavSample(deck.wav, renderFrame, sampleRate, 1);
          }
          deck.eq.Process(sourceLeft, sourceRight);
          frames[frame] = {sourceLeft, sourceRight};
        }

        if (!ProcessDeckVst3Block(deck, frames, sampleRate)) {
          for (auto& frame : frames) {
            ApplyDeckPluginLane(deck, frame[0], frame[1]);
          }
        }
        return frames;
      };

      auto deckABlock = renderDeckBlock(state.deckA);
      auto deckBBlock = renderDeckBlock(state.deckB);
      for (UINT32 frame = 0; frame < availableFrames; ++frame) {
        double left = 0.0;
        double right = 0.0;
        if (frame < deckABlock.size()) {
          MixDeckStereoFrameWithoutEq(state.deckA.processing, state.deckA.stats, deckABlock[frame][0], deckABlock[frame][1], left, right);
        }
        if (frame < deckBBlock.size()) {
          MixDeckStereoFrameWithoutEq(state.deckB.processing, state.deckB.stats, deckBBlock[frame][0], deckBBlock[frame][1], left, right);
        }
        left = ClampDouble(left, -0.95, 0.95);
        right = ClampDouble(right, -0.95, 0.95);
        state.masterPeakLeft = std::max(state.masterPeakLeft * 0.995, std::abs(left));
        state.masterPeakRight = std::max(state.masterPeakRight * 0.995, std::abs(right));
        WriteInterleavedFrame(buffer, mixFormat, frame, left, right);
      }
      if (state.deckA.loaded && state.deckA.playing) {
        if (state.deckA.sourceType == "wav") state.deckA.positionFrames += availableFrames;
        state.deckA.stats.framesWritten += availableFrames;
      }
      if (state.deckB.loaded && state.deckB.playing) {
        if (state.deckB.sourceType == "wav") state.deckB.positionFrames += availableFrames;
        state.deckB.stats.framesWritten += availableFrames;
      }
      state.framesWritten += availableFrames;
      state.passes += 1;
    }

    hr = renderClient->ReleaseBuffer(availableFrames, 0);
    if (FAILED(hr)) {
      std::lock_guard<std::mutex> lock(state.mutex);
      state.underruns += 1;
    }

    const DWORD now = GetTickCount();
    if (now - lastSnapshotTick >= 250) {
      lastSnapshotTick = now;
      PrintServerSnapshot(state, mixFormat, deviceName, openedDeviceId, "meters");
    }
  }

  audioClient->Stop();
  {
    std::lock_guard<std::mutex> lock(state.mutex);
    state.deckA.captureStreaming = false;
    state.deckB.captureStreaming = false;
  }
  if (state.captureAThread.joinable()) state.captureAThread.join();
  if (state.captureBThread.joinable()) state.captureBThread.join();
  if (commandThread.joinable()) commandThread.join();
  PrintServerSnapshot(state, mixFormat, deviceName, openedDeviceId, "stopped");
  CoTaskMemFree(mixFormat);
  return 0;
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

void MixDeckStereoFrameWithoutEq(const DeckState& deck, DeckStats& stats, double sourceLeft, double sourceRight, double& left, double& right) {
  const double deckLeft = sourceLeft * deck.gain * deck.leftScale;
  const double deckRight = sourceRight * deck.gain * deck.rightScale;
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
    << "\"commands\":[\"--describe\",\"--probe\",\"--run-once\",\"--render-silence\",\"--render-tone\",\"--render-wav\",\"--server\",\"--list-devices\"],"
    << "\"capabilities\":{"
    << "\"perDeckCapture\":true,"
    << "\"perDeckPan\":true,"
    << "\"perDeckEq\":true,"
    << "\"perDeckPlugins\":true,"
    << "\"nativePcmRouting\":true"
    << "}"
    << "}\n";
}

int PrintDeviceList() {
  ComPtr<IMMDeviceEnumerator> enumerator;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
  if (FAILED(hr)) {
    std::cerr << "{\"error\":\"MMDeviceEnumerator activation failed\"}\n";
    return 2;
  }

  auto printFlow = [&](EDataFlow flow, const char* role, bool& wroteDevice) {
    ComPtr<IMMDeviceCollection> collection;
    if (FAILED(enumerator->EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE, &collection))) return;
    UINT count = 0;
    collection->GetCount(&count);
    for (UINT index = 0; index < count; ++index) {
      ComPtr<IMMDevice> device;
      if (FAILED(collection->Item(index, &device))) continue;
      LPWSTR rawId = nullptr;
      if (FAILED(device->GetId(&rawId)) || rawId == nullptr) continue;
      if (wroteDevice) std::cout << ",";
      std::cout
        << "{"
        << "\"id\":\"" << EscapeJson(rawId) << "\","
        << "\"name\":\"" << EscapeJson(GetDeviceName(device.Get())) << "\","
        << "\"role\":\"" << role << "\","
        << "\"available\":true,"
        << "\"backend\":\"wasapi\""
        << "}";
      wroteDevice = true;
      CoTaskMemFree(rawId);
    }
  };

  bool wroteDevice = false;
  std::cout << "[";
  printFlow(eRender, "output", wroteDevice);
  printFlow(eCapture, "input", wroteDevice);
  std::cout << "]\n";
  return 0;
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
  if (command == L"--list-devices") {
    return PrintDeviceList();
  }
  if (command == L"--run-once") {
    return RunOnce();
  }
  if (command == L"--server") {
    std::wstring outputDeviceId;
    std::string latencyProfile = "balanced";
    double bufferMs = 0.0;
    for (int i = 2; i < argc - 1; ++i) {
      const std::wstring arg = argv[i];
      if (arg == L"--output-id") outputDeviceId = argv[i + 1];
      if (arg == L"--latency-profile") {
        const std::wstring value = argv[i + 1];
        if (value == L"low") latencyProfile = "low";
        else if (value == L"stable") latencyProfile = "stable";
        else if (value == L"custom") latencyProfile = "custom";
        else latencyProfile = "balanced";
      }
      if (arg == L"--buffer-ms") bufferMs = _wtof(argv[i + 1]);
    }
    return RunPersistentServer(outputDeviceId, MakeLatencySettings(latencyProfile, bufferMs));
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

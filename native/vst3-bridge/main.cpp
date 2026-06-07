#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <memory>
#include <sstream>
#include <string>
#include <vector>
#include <windows.h>

#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "public.sdk/source/vst/hosting/module.h"
#include "public.sdk/source/vst/hosting/parameterchanges.h"
#include "public.sdk/source/vst/hosting/plugprovider.h"
#include "public.sdk/source/vst/hosting/processdata.h"

namespace fs = std::filesystem;
using Steinberg::Vst::IEditController;
using Steinberg::Vst::ParameterInfo;
constexpr int32_t kVstString128Size = 128;
const char kBase64Alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

struct LoadedPlugin {
  VST3::Hosting::Module::Ptr module;
  std::unique_ptr<Steinberg::Vst::PlugProvider> provider;
  std::vector<ParameterInfo> parameters;
  std::string pluginId;
  std::string pluginPath;
  std::string className;
  std::string vendor;
  bool bridgePcmProcessing = false;
};

std::map<std::string, LoadedPlugin> gLoadedPlugins;

std::string JsonEscape(const std::string& value) {
  std::ostringstream output;
  for (const char character : value) {
    switch (character) {
      case '\\': output << "\\\\"; break;
      case '"': output << "\\\""; break;
      case '\n': output << "\\n"; break;
      case '\r': output << "\\r"; break;
      case '\t': output << "\\t"; break;
      default: output << character; break;
    }
  }
  return output.str();
}

std::string EnvValue(const char* name) {
  size_t required = 0;
  getenv_s(&required, nullptr, 0, name);
  if (required == 0) return "";
  std::vector<char> buffer(required);
  if (getenv_s(&required, buffer.data(), buffer.size(), name) != 0) return "";
  return std::string(buffer.data());
}

std::string Utf16ToUtf8(const Steinberg::Vst::TChar* value, int32_t maxChars) {
  if (!value) return "";
  std::wstring wide;
  for (int32_t index = 0; index < maxChars && value[index] != 0; ++index) {
    wide.push_back(static_cast<wchar_t>(value[index]));
  }
  if (wide.empty()) return "";
  const int size = WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()), nullptr, 0, nullptr, nullptr);
  if (size <= 0) return "";
  std::string result(size, '\0');
  WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()), result.data(), size, nullptr, nullptr);
  return result;
}

std::wstring Utf8ToWide(const std::string& value) {
  if (value.empty()) return L"";
  const int size = MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, nullptr, 0);
  if (size <= 0) return L"";
  std::wstring wide(size - 1, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, wide.data(), size);
  return wide;
}

bool PathExists(const std::string& path) {
  if (path.empty()) return false;
  std::error_code error;
  return fs::exists(fs::path(Utf8ToWide(path)), error);
}

std::string JsonStringValue(const std::string& line, const std::string& key) {
  const std::string pattern = "\"" + key + "\"";
  size_t position = line.find(pattern);
  if (position == std::string::npos) return "";
  position = line.find(':', position + pattern.size());
  if (position == std::string::npos) return "";
  position = line.find('"', position + 1);
  if (position == std::string::npos) return "";
  std::string value;
  bool escaped = false;
  for (size_t index = position + 1; index < line.size(); ++index) {
    const char character = line[index];
    if (escaped) {
      if (character == 'n') value.push_back('\n');
      else if (character == 'r') value.push_back('\r');
      else if (character == 't') value.push_back('\t');
      else value.push_back(character);
      escaped = false;
      continue;
    }
    if (character == '\\') {
      escaped = true;
      continue;
    }
    if (character == '"') break;
    value.push_back(character);
  }
  return value;
}

int Base64Value(char ch) {
  if (ch >= 'A' && ch <= 'Z') return ch - 'A';
  if (ch >= 'a' && ch <= 'z') return ch - 'a' + 26;
  if (ch >= '0' && ch <= '9') return ch - '0' + 52;
  if (ch == '+') return 62;
  if (ch == '/') return 63;
  return -1;
}

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

std::vector<uint8_t> ReadBinaryFile(const std::string& path) {
  if (path.empty()) return {};
  std::ifstream input(fs::path(Utf8ToWide(path)), std::ios::binary);
  if (!input) throw std::runtime_error("PCM input file could not be opened.");
  input.seekg(0, std::ios::end);
  const std::streamoff size = input.tellg();
  if (size <= 0) return {};
  input.seekg(0, std::ios::beg);
  std::vector<uint8_t> bytes(static_cast<size_t>(size));
  input.read(reinterpret_cast<char*>(bytes.data()), size);
  if (!input) throw std::runtime_error("PCM input file could not be read.");
  return bytes;
}

void WriteBinaryFile(const std::string& path, const std::vector<uint8_t>& bytes) {
  if (path.empty()) throw std::runtime_error("PCM output file path is empty.");
  std::ofstream output(fs::path(Utf8ToWide(path)), std::ios::binary | std::ios::trunc);
  if (!output) throw std::runtime_error("PCM output file could not be opened.");
  output.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
  if (!output) throw std::runtime_error("PCM output file could not be written.");
}

double JsonNumberValue(const std::string& line, const std::string& key, double fallback) {
  const std::string pattern = "\"" + key + "\"";
  size_t position = line.find(pattern);
  if (position == std::string::npos) return fallback;
  position = line.find(':', position + pattern.size());
  if (position == std::string::npos) return fallback;
  ++position;
  while (position < line.size() && std::isspace(static_cast<unsigned char>(line[position]))) ++position;
  const size_t start = position;
  while (position < line.size()) {
    const char character = line[position];
    if (!std::isdigit(static_cast<unsigned char>(character)) && character != '-' && character != '+' && character != '.' && character != 'e' && character != 'E') break;
    ++position;
  }
  if (start == position) return fallback;
  try {
    return std::stod(line.substr(start, position - start));
  } catch (...) {
    return fallback;
  }
}

int32_t JsonIntValue(const std::string& line, const std::string& key, int32_t fallback, int32_t minValue, int32_t maxValue) {
  const double number = JsonNumberValue(line, key, fallback);
  if (!std::isfinite(number)) return fallback;
  return std::max(minValue, std::min(maxValue, static_cast<int32_t>(std::lround(number))));
}

double ClampDouble(double value, double minValue, double maxValue) {
  if (!std::isfinite(value)) return minValue;
  return std::max(minValue, std::min(maxValue, value));
}

bool HasAudioProcessor(const LoadedPlugin& plugin) {
  auto component = plugin.provider ? plugin.provider->getComponentPtr() : nullptr;
  if (!component) return false;
  Steinberg::FUnknownPtr<Steinberg::Vst::IAudioProcessor> processor = component;
  return processor.getInterface() != nullptr;
}

std::vector<std::pair<Steinberg::Vst::ParamID, double>> ParseParameterValues(const std::string& value) {
  std::vector<std::pair<Steinberg::Vst::ParamID, double>> result;
  size_t start = 0;
  while (start < value.size()) {
    const size_t end = value.find(';', start);
    const std::string item = value.substr(start, end == std::string::npos ? std::string::npos : end - start);
    const size_t separator = item.find('=');
    if (separator != std::string::npos) {
      try {
        const auto id = static_cast<Steinberg::Vst::ParamID>(std::stoull(item.substr(0, separator)));
        const double normalized = ClampDouble(std::stod(item.substr(separator + 1)), 0.0, 1.0);
        result.emplace_back(id, normalized);
      } catch (...) {
      }
    }
    if (end == std::string::npos) break;
    start = end + 1;
  }
  return result;
}

void ApplyParameterValues(LoadedPlugin& plugin, Steinberg::Vst::ParameterChanges& parameterChanges, const std::string& parameterValues) {
  const auto parsed = ParseParameterValues(parameterValues);
  if (parsed.empty()) return;
  parameterChanges.setMaxParameters(static_cast<Steinberg::int32>(parsed.size()));
  parameterChanges.clearQueue();
  for (const auto& [id, value] : parsed) {
    Steinberg::int32 queueIndex = 0;
    if (auto* queue = parameterChanges.addParameterData(id, queueIndex)) {
      Steinberg::int32 pointIndex = 0;
      queue->addPoint(0, value, pointIndex);
    }
  }
}

std::string ParameterKind(const ParameterInfo& info) {
  if ((info.flags & ParameterInfo::kIsBypass) != 0) return "boolean";
  if ((info.flags & ParameterInfo::kCanAutomate) != 0) return "normalized";
  return "value";
}

std::string ParameterJson(const ParameterInfo& info) {
  std::ostringstream output;
  output
    << "{"
    << "\"id\":\"" << JsonEscape(std::to_string(info.id)) << "\","
    << "\"name\":\"" << JsonEscape(Utf16ToUtf8(info.title, kVstString128Size)) << "\","
    << "\"shortName\":\"" << JsonEscape(Utf16ToUtf8(info.shortTitle, kVstString128Size)) << "\","
    << "\"units\":\"" << JsonEscape(Utf16ToUtf8(info.units, kVstString128Size)) << "\","
    << "\"kind\":\"" << ParameterKind(info) << "\","
    << "\"defaultValue\":" << info.defaultNormalizedValue << ","
    << "\"minimum\":0,"
    << "\"maximum\":1,"
    << "\"stepCount\":" << info.stepCount << ","
    << "\"automatable\":" << ((info.flags & ParameterInfo::kCanAutomate) != 0 ? "true" : "false") << ","
    << "\"bypass\":" << ((info.flags & ParameterInfo::kIsBypass) != 0 ? "true" : "false")
    << "}";
  return output.str();
}

std::string ParametersJson(const std::vector<ParameterInfo>& parameters) {
  std::ostringstream output;
  output << "[";
  for (size_t index = 0; index < parameters.size(); ++index) {
    if (index > 0) output << ",";
    output << ParameterJson(parameters[index]);
  }
  output << "]";
  return output.str();
}

std::string SdkDir() {
  const std::string envPath = EnvValue("RESONANCE_VST3_SDK_DIR");
  if (!envPath.empty()) return envPath;
  return "third_party\\vst3sdk";
}

std::string TestPluginPath() {
  return EnvValue("RESONANCE_TEST_VST3_PLUGIN");
}

bool SdkLooksUsable(const std::string& sdkDir) {
  return PathExists(sdkDir) && (
    PathExists(sdkDir + "\\CMakeLists.txt") ||
    PathExists(sdkDir + "\\pluginterfaces\\vst\\ivstaudioprocessor.h"));
}

std::vector<VST3::Hosting::ClassInfo> AudioEffectClasses(const VST3::Hosting::Module::Ptr& module) {
  std::vector<VST3::Hosting::ClassInfo> result;
  for (const auto& classInfo : module->getFactory().classInfos()) {
    if (classInfo.category() == kVstAudioEffectClass) result.push_back(classInfo);
  }
  return result;
}

LoadedPlugin LoadVst3Plugin(const std::string& pluginId, const std::string& pluginPath) {
  std::string error;
  auto module = VST3::Hosting::Module::create(pluginPath, error);
  if (!module) {
    throw std::runtime_error(error.empty() ? "VST3 module could not be loaded." : error);
  }

  const auto audioClasses = AudioEffectClasses(module);
  if (audioClasses.empty()) {
    throw std::runtime_error("VST3 module does not expose an audio effect class.");
  }

  auto provider = std::make_unique<Steinberg::Vst::PlugProvider>(module->getFactory(), audioClasses.front());
  if (!provider->initialize()) {
    throw std::runtime_error("VST3 component/controller initialization failed.");
  }

  std::vector<ParameterInfo> parameters;
  if (auto controller = provider->getControllerPtr()) {
    const Steinberg::int32 count = controller->getParameterCount();
    parameters.reserve(std::max<Steinberg::int32>(0, count));
    for (Steinberg::int32 index = 0; index < count; ++index) {
      ParameterInfo info {};
      if (controller->getParameterInfo(index, info) == Steinberg::kResultOk) {
        parameters.push_back(info);
      }
    }
  }

  LoadedPlugin loaded;
  loaded.module = module;
  loaded.provider = std::move(provider);
  loaded.parameters = std::move(parameters);
  loaded.pluginId = pluginId;
  loaded.pluginPath = pluginPath;
  loaded.className = audioClasses.front().name();
  loaded.vendor = audioClasses.front().vendor();
  loaded.bridgePcmProcessing = HasAudioProcessor(loaded);
  return loaded;
}

struct ProcessToneResult {
  int32_t frames = 0;
  double sampleRate = 0;
  double inputPeak = 0;
  double outputPeak = 0;
  double maxDelta = 0;
  int32_t inputChannels = 0;
  int32_t outputChannels = 0;
  bool changed = false;
};

struct ProcessPcmResult {
  int32_t frames = 0;
  int32_t inputChannels = 0;
  int32_t outputChannels = 0;
  double sampleRate = 0;
  double inputPeak = 0;
  double outputPeak = 0;
  double maxDelta = 0;
  bool changed = false;
  int32_t parameterValueCount = 0;
  std::vector<uint8_t> pcm16Bytes;
};

double BufferPeak(Steinberg::Vst::AudioBusBuffers& bus, int32_t frames) {
  double peak = 0;
  for (Steinberg::int32 channel = 0; channel < bus.numChannels; ++channel) {
    auto* samples = bus.channelBuffers32 ? bus.channelBuffers32[channel] : nullptr;
    if (!samples) continue;
    for (int32_t frame = 0; frame < frames; ++frame) {
      peak = std::max(peak, static_cast<double>(std::abs(samples[frame])));
    }
  }
  return peak;
}

ProcessToneResult ProcessTone(LoadedPlugin& plugin, int32_t frames, double sampleRate, double frequency, double amplitude) {
  auto component = plugin.provider ? plugin.provider->getComponentPtr() : nullptr;
  if (!component) throw std::runtime_error("Loaded plugin does not expose an audio component.");

  Steinberg::FUnknownPtr<Steinberg::Vst::IAudioProcessor> processor = component;
  if (!processor) throw std::runtime_error("Loaded plugin does not expose an audio processor.");
  if (processor->canProcessSampleSize(Steinberg::Vst::kSample32) != Steinberg::kResultOk) {
    throw std::runtime_error("Loaded plugin does not support 32-bit float processing.");
  }

  component->activateBus(Steinberg::Vst::kAudio, Steinberg::Vst::kInput, 0, true);
  component->activateBus(Steinberg::Vst::kAudio, Steinberg::Vst::kOutput, 0, true);

  Steinberg::Vst::ProcessSetup setup {
    Steinberg::Vst::kRealtime,
    Steinberg::Vst::kSample32,
    frames,
    sampleRate,
  };
  if (processor->setupProcessing(setup) != Steinberg::kResultOk) {
    throw std::runtime_error("VST3 setupProcessing failed.");
  }

  Steinberg::Vst::HostProcessData processData;
  if (!processData.prepare(*component, frames, Steinberg::Vst::kSample32)) {
    throw std::runtime_error("VST3 process buffer preparation failed.");
  }
  processData.numSamples = frames;
  processData.processMode = Steinberg::Vst::kRealtime;
  processData.symbolicSampleSize = Steinberg::Vst::kSample32;

  if (processData.numInputs <= 0 || !processData.inputs || processData.inputs[0].numChannels <= 0) {
    throw std::runtime_error("Loaded plugin does not expose an audio input bus.");
  }
  if (processData.numOutputs <= 0 || !processData.outputs || processData.outputs[0].numChannels <= 0) {
    throw std::runtime_error("Loaded plugin does not expose an audio output bus.");
  }

  auto& inputBus = processData.inputs[0];
  auto& outputBus = processData.outputs[0];
  const double twoPi = 6.28318530717958647692;

  for (Steinberg::int32 channel = 0; channel < inputBus.numChannels; ++channel) {
    auto* samples = inputBus.channelBuffers32 ? inputBus.channelBuffers32[channel] : nullptr;
    if (!samples) continue;
    for (int32_t frame = 0; frame < frames; ++frame) {
      samples[frame] = static_cast<Steinberg::Vst::Sample32>(std::sin(twoPi * frequency * static_cast<double>(frame) / sampleRate) * amplitude);
    }
  }
  inputBus.silenceFlags = 0;

  for (Steinberg::int32 channel = 0; channel < outputBus.numChannels; ++channel) {
    auto* samples = outputBus.channelBuffers32 ? outputBus.channelBuffers32[channel] : nullptr;
    if (samples) std::fill(samples, samples + frames, 0.0f);
  }
  outputBus.silenceFlags = 0;

  const double inputPeak = BufferPeak(inputBus, frames);
  if (component->setActive(true) != Steinberg::kResultOk) {
    throw std::runtime_error("VST3 component activation failed.");
  }
  if (processor->setProcessing(true) != Steinberg::kResultOk) {
    component->setActive(false);
    throw std::runtime_error("VST3 setProcessing(true) failed.");
  }

  const Steinberg::tresult processResult = processor->process(processData);
  processor->setProcessing(false);
  component->setActive(false);
  if (processResult != Steinberg::kResultOk) {
    throw std::runtime_error("VST3 process call failed.");
  }

  const double outputPeak = BufferPeak(outputBus, frames);
  double maxDelta = 0;
  const Steinberg::int32 channels = std::min(inputBus.numChannels, outputBus.numChannels);
  for (Steinberg::int32 channel = 0; channel < channels; ++channel) {
    auto* inputSamples = inputBus.channelBuffers32 ? inputBus.channelBuffers32[channel] : nullptr;
    auto* outputSamples = outputBus.channelBuffers32 ? outputBus.channelBuffers32[channel] : nullptr;
    if (!inputSamples || !outputSamples) continue;
    for (int32_t frame = 0; frame < frames; ++frame) {
      maxDelta = std::max(maxDelta, static_cast<double>(std::abs(outputSamples[frame] - inputSamples[frame])));
    }
  }

  ProcessToneResult result;
  result.frames = frames;
  result.sampleRate = sampleRate;
  result.inputPeak = inputPeak;
  result.outputPeak = outputPeak;
  result.maxDelta = maxDelta;
  result.inputChannels = inputBus.numChannels;
  result.outputChannels = outputBus.numChannels;
  result.changed = maxDelta > 0.00001 || std::abs(outputPeak - inputPeak) > 0.00001;
  return result;
}

ProcessPcmResult ProcessPcm(LoadedPlugin& plugin, const std::vector<uint8_t>& bytes, int32_t frames, int32_t channels, double sampleRate, const std::string& parameterValues) {
  const int32_t sourceChannels = std::max<int32_t>(1, std::min<int32_t>(2, channels));
  const int32_t availableFrames = static_cast<int32_t>(bytes.size() / (static_cast<size_t>(sourceChannels) * sizeof(int16_t)));
  const int32_t frameCount = std::max<int32_t>(0, std::min<int32_t>(frames, availableFrames));
  if (frameCount <= 0) throw std::runtime_error("PCM payload is empty or invalid.");

  auto component = plugin.provider ? plugin.provider->getComponentPtr() : nullptr;
  if (!component) throw std::runtime_error("Loaded plugin does not expose an audio component.");

  Steinberg::FUnknownPtr<Steinberg::Vst::IAudioProcessor> processor = component;
  if (!processor) throw std::runtime_error("Loaded plugin does not expose an audio processor.");
  if (processor->canProcessSampleSize(Steinberg::Vst::kSample32) != Steinberg::kResultOk) {
    throw std::runtime_error("Loaded plugin does not support 32-bit float processing.");
  }

  component->activateBus(Steinberg::Vst::kAudio, Steinberg::Vst::kInput, 0, true);
  component->activateBus(Steinberg::Vst::kAudio, Steinberg::Vst::kOutput, 0, true);

  Steinberg::Vst::ProcessSetup setup {
    Steinberg::Vst::kRealtime,
    Steinberg::Vst::kSample32,
    frameCount,
    sampleRate,
  };
  if (processor->setupProcessing(setup) != Steinberg::kResultOk) {
    throw std::runtime_error("VST3 setupProcessing failed.");
  }

  Steinberg::Vst::HostProcessData processData;
  if (!processData.prepare(*component, frameCount, Steinberg::Vst::kSample32)) {
    throw std::runtime_error("VST3 process buffer preparation failed.");
  }
  processData.numSamples = frameCount;
  processData.processMode = Steinberg::Vst::kRealtime;
  processData.symbolicSampleSize = Steinberg::Vst::kSample32;
  const auto parsedParameterValues = ParseParameterValues(parameterValues);
  Steinberg::Vst::ParameterChanges parameterChanges;
  ApplyParameterValues(plugin, parameterChanges, parameterValues);
  if (parameterChanges.getParameterCount() > 0) {
    processData.inputParameterChanges = &parameterChanges;
  }

  if (processData.numInputs <= 0 || !processData.inputs || processData.inputs[0].numChannels <= 0) {
    throw std::runtime_error("Loaded plugin does not expose an audio input bus.");
  }
  if (processData.numOutputs <= 0 || !processData.outputs || processData.outputs[0].numChannels <= 0) {
    throw std::runtime_error("Loaded plugin does not expose an audio output bus.");
  }

  auto& inputBus = processData.inputs[0];
  auto& outputBus = processData.outputs[0];
  std::vector<std::array<float, 2>> dryFrames(static_cast<size_t>(frameCount));

  for (int32_t frame = 0; frame < frameCount; ++frame) {
    const size_t frameOffset = static_cast<size_t>(frame) * sourceChannels * sizeof(int16_t);
    int16_t leftPacked = 0;
    int16_t rightPacked = 0;
    std::memcpy(&leftPacked, bytes.data() + frameOffset, sizeof(int16_t));
    if (sourceChannels > 1) {
      std::memcpy(&rightPacked, bytes.data() + frameOffset + sizeof(int16_t), sizeof(int16_t));
    } else {
      rightPacked = leftPacked;
    }
    dryFrames[frame][0] = static_cast<float>(ClampDouble(static_cast<double>(leftPacked) / 32768.0, -1.0, 1.0));
    dryFrames[frame][1] = static_cast<float>(ClampDouble(static_cast<double>(rightPacked) / 32768.0, -1.0, 1.0));
  }

  for (Steinberg::int32 channel = 0; channel < inputBus.numChannels; ++channel) {
    auto* samples = inputBus.channelBuffers32 ? inputBus.channelBuffers32[channel] : nullptr;
    if (!samples) continue;
    const int32_t sourceChannel = channel == 0 ? 0 : 1;
    for (int32_t frame = 0; frame < frameCount; ++frame) {
      samples[frame] = dryFrames[frame][sourceChannel];
    }
  }
  inputBus.silenceFlags = 0;

  for (Steinberg::int32 channel = 0; channel < outputBus.numChannels; ++channel) {
    auto* samples = outputBus.channelBuffers32 ? outputBus.channelBuffers32[channel] : nullptr;
    if (samples) std::fill(samples, samples + frameCount, 0.0f);
  }
  outputBus.silenceFlags = 0;

  const double inputPeak = BufferPeak(inputBus, frameCount);
  if (component->setActive(true) != Steinberg::kResultOk) {
    throw std::runtime_error("VST3 component activation failed.");
  }
  if (processor->setProcessing(true) != Steinberg::kResultOk) {
    component->setActive(false);
    throw std::runtime_error("VST3 setProcessing(true) failed.");
  }

  const Steinberg::tresult processResult = processor->process(processData);
  processor->setProcessing(false);
  component->setActive(false);
  if (processResult != Steinberg::kResultOk) {
    throw std::runtime_error("VST3 process call failed.");
  }

  const double outputPeak = BufferPeak(outputBus, frameCount);
  double maxDelta = 0;
  std::vector<uint8_t> outputBytes(static_cast<size_t>(frameCount) * 2 * sizeof(int16_t));
  for (int32_t frame = 0; frame < frameCount; ++frame) {
    double left = dryFrames[frame][0];
    double right = dryFrames[frame][1];
    if (outputBus.numChannels > 0 && outputBus.channelBuffers32 && outputBus.channelBuffers32[0]) {
      left = outputBus.channelBuffers32[0][frame];
    }
    if (outputBus.numChannels > 1 && outputBus.channelBuffers32 && outputBus.channelBuffers32[1]) {
      right = outputBus.channelBuffers32[1][frame];
    } else {
      right = left;
    }
    maxDelta = std::max(maxDelta, std::abs(left - static_cast<double>(dryFrames[frame][0])));
    maxDelta = std::max(maxDelta, std::abs(right - static_cast<double>(dryFrames[frame][1])));
    const int16_t packedLeft = static_cast<int16_t>(ClampDouble(left, -1.0, 1.0) * 32767.0);
    const int16_t packedRight = static_cast<int16_t>(ClampDouble(right, -1.0, 1.0) * 32767.0);
    std::memcpy(outputBytes.data() + (static_cast<size_t>(frame) * 4), &packedLeft, sizeof(int16_t));
    std::memcpy(outputBytes.data() + (static_cast<size_t>(frame) * 4) + sizeof(int16_t), &packedRight, sizeof(int16_t));
  }

  ProcessPcmResult result;
  result.frames = frameCount;
  result.inputChannels = sourceChannels;
  result.outputChannels = std::min<int32_t>(2, std::max<int32_t>(1, outputBus.numChannels));
  result.sampleRate = sampleRate;
  result.inputPeak = inputPeak;
  result.outputPeak = outputPeak;
  result.maxDelta = maxDelta;
  result.changed = maxDelta > 0.00001 || std::abs(outputPeak - inputPeak) > 0.00001;
  result.parameterValueCount = static_cast<int32_t>(parsedParameterValues.size());
  result.pcm16Bytes = std::move(outputBytes);
  return result;
}

std::string DescribeJson(const std::string& requestId = "") {
  const std::string sdkDir = SdkDir();
  const std::string testPlugin = TestPluginPath();
  const bool sdkFound = SdkLooksUsable(sdkDir);
  const bool testPluginFound = PathExists(testPlugin);
  std::ostringstream output;
  output
    << "{"
    << "\"type\":\"describe\",";
  if (!requestId.empty()) output << "\"requestId\":\"" << JsonEscape(requestId) << "\",";
  output
    << "\"name\":\"resonance-vst3-bridge\","
    << "\"protocolVersion\":1,"
    << "\"status\":\"" << (sdkFound ? "ready" : "sdk-missing") << "\","
    << "\"sdk\":{"
    << "\"path\":\"" << JsonEscape(sdkDir) << "\","
    << "\"found\":" << (sdkFound ? "true" : "false")
    << "},"
    << "\"testPlugin\":{"
    << "\"path\":\"" << JsonEscape(testPlugin) << "\","
    << "\"found\":" << (testPluginFound ? "true" : "false")
    << "},"
    << "\"capabilities\":{"
    << "\"metadataLifecycle\":true,"
    << "\"binaryInstantiation\":" << (sdkFound ? "true" : "false") << ","
    << "\"parameterEnumeration\":" << (sdkFound ? "true" : "false") << ","
    << "\"pcmProcessing\":" << (sdkFound ? "true" : "false") << ","
    << "\"pcmFileTransport\":" << (sdkFound ? "true" : "false")
    << "},"
    << "\"note\":\"Native VST3 bridge can instantiate VST3 modules, enumerate parameters, process internal test blocks, and process external Deck A/B PCM blocks when the SDK is present.\""
    << "}";
  return output.str();
}

void Respond(const std::string& message) {
  std::cout << message << std::endl;
}

void HandleLine(const std::string& line) {
  const std::string type = JsonStringValue(line, "type");
  const std::string requestId = JsonStringValue(line, "requestId");
  if (type == "describe") {
    Respond(DescribeJson(requestId));
    return;
  }
  if (type == "loadPlugin") {
    const std::string pluginId = JsonStringValue(line, "id");
    const std::string pluginPath = JsonStringValue(line, "path");
    const bool sdkFound = SdkLooksUsable(SdkDir());
    const bool pluginFound = PathExists(pluginPath);
    std::ostringstream output;
    output
      << "{"
      << "\"type\":\"loadPlugin\","
      << "\"requestId\":\"" << JsonEscape(requestId) << "\","
      << "\"pluginId\":\"" << JsonEscape(pluginId) << "\","
      << "\"pluginPath\":\"" << JsonEscape(pluginPath) << "\","
      << "\"pluginFound\":" << (pluginFound ? "true" : "false") << ",";
    if (pluginFound && sdkFound) {
      try {
        auto loaded = LoadVst3Plugin(pluginId, pluginPath);
        const auto parameterCount = loaded.parameters.size();
        const std::string className = loaded.className;
        const std::string vendor = loaded.vendor;
        const std::string parametersJson = ParametersJson(loaded.parameters);
        gLoadedPlugins[pluginId] = std::move(loaded);
        output
          << "\"status\":\"loaded\","
          << "\"className\":\"" << JsonEscape(className) << "\","
          << "\"vendor\":\"" << JsonEscape(vendor) << "\","
          << "\"parameterCount\":" << parameterCount << ","
          << "\"parameters\":" << parametersJson << ","
          << "\"processingEnabled\":false,"
          << "\"bridgePcmProcessing\":" << (gLoadedPlugins[pluginId].bridgePcmProcessing ? "true" : "false") << ","
          << "\"parameterEnumeration\":true,"
          << "\"pcmProcessing\":false,"
          << "\"error\":null";
      } catch (const std::exception& error) {
        output
          << "\"status\":\"load-failed\","
          << "\"processingEnabled\":false,"
          << "\"error\":\"" << JsonEscape(error.what()) << "\"";
      }
    } else {
      output
      << "\"status\":\"" << (!pluginFound ? "plugin-missing" : sdkFound ? "sdk-ready-loader-missing" : "sdk-missing") << "\","
      << "\"processingEnabled\":false,"
      << "\"error\":\""
      << (!pluginFound
        ? "Plugin path does not exist on this machine."
        : sdkFound
          ? "VST3 SDK detected, but plugin loading did not start."
          : "VST3 SDK not found. Set RESONANCE_VST3_SDK_DIR to the Steinberg VST3 SDK root.")
      << "\"";
    }
    output
      << "}";
    Respond(output.str());
    return;
  }
  if (type == "unloadPlugin") {
    const std::string pluginId = JsonStringValue(line, "pluginId").empty() ? JsonStringValue(line, "id") : JsonStringValue(line, "pluginId");
    const bool erased = gLoadedPlugins.erase(pluginId) > 0;
    Respond("{\"type\":\"unloadPlugin\",\"requestId\":\"" + JsonEscape(requestId) + "\",\"status\":\"" + (erased ? "unloaded" : "not-loaded") + "\",\"pluginId\":\"" + JsonEscape(pluginId) + "\"}");
    return;
  }
  if (type == "enumerateParameters") {
    const std::string pluginId = JsonStringValue(line, "pluginId").empty() ? JsonStringValue(line, "id") : JsonStringValue(line, "pluginId");
    const auto plugin = gLoadedPlugins.find(pluginId);
    if (plugin == gLoadedPlugins.end()) {
      Respond("{\"type\":\"enumerateParameters\",\"requestId\":\"" + JsonEscape(requestId) + "\",\"status\":\"not-loaded\",\"pluginId\":\"" + JsonEscape(pluginId) + "\",\"parameters\":[]}");
      return;
    }
    Respond("{\"type\":\"enumerateParameters\",\"requestId\":\"" + JsonEscape(requestId) + "\",\"status\":\"ready\",\"pluginId\":\"" + JsonEscape(pluginId) + "\",\"parameters\":" + ParametersJson(plugin->second.parameters) + "}");
    return;
  }
  if (type == "processTone") {
    const std::string pluginId = JsonStringValue(line, "pluginId").empty() ? JsonStringValue(line, "id") : JsonStringValue(line, "pluginId");
    const auto plugin = gLoadedPlugins.find(pluginId);
    if (plugin == gLoadedPlugins.end()) {
      Respond("{\"type\":\"processTone\",\"requestId\":\"" + JsonEscape(requestId) + "\",\"status\":\"not-loaded\",\"pluginId\":\"" + JsonEscape(pluginId) + "\",\"error\":\"Plugin is not loaded.\"}");
      return;
    }
    const int32_t frames = JsonIntValue(line, "frames", 512, 64, 8192);
    const double sampleRate = ClampDouble(JsonNumberValue(line, "sampleRate", 48000), 8000, 384000);
    const double frequency = ClampDouble(JsonNumberValue(line, "frequency", 440), 20, 20000);
    const double amplitude = ClampDouble(JsonNumberValue(line, "amplitude", 0.2), 0, 1);
    try {
      const auto result = ProcessTone(plugin->second, frames, sampleRate, frequency, amplitude);
      std::ostringstream output;
      output
        << "{"
        << "\"type\":\"processTone\","
        << "\"requestId\":\"" << JsonEscape(requestId) << "\","
        << "\"status\":\"processed\","
        << "\"pluginId\":\"" << JsonEscape(pluginId) << "\","
        << "\"frames\":" << result.frames << ","
        << "\"sampleRate\":" << result.sampleRate << ","
        << "\"inputChannels\":" << result.inputChannels << ","
        << "\"outputChannels\":" << result.outputChannels << ","
        << "\"inputPeak\":" << result.inputPeak << ","
        << "\"outputPeak\":" << result.outputPeak << ","
        << "\"maxDelta\":" << result.maxDelta << ","
        << "\"changed\":" << (result.changed ? "true" : "false") << ","
        << "\"bridgePcmProcessing\":true,"
        << "\"processingEnabled\":false"
        << "}";
      Respond(output.str());
    } catch (const std::exception& error) {
      Respond("{\"type\":\"processTone\",\"requestId\":\"" + JsonEscape(requestId) + "\",\"status\":\"process-failed\",\"pluginId\":\"" + JsonEscape(pluginId) + "\",\"bridgePcmProcessing\":false,\"processingEnabled\":false,\"error\":\"" + JsonEscape(error.what()) + "\"}");
    }
    return;
  }
  if (type == "processPcm") {
    const std::string pluginId = JsonStringValue(line, "pluginId").empty() ? JsonStringValue(line, "id") : JsonStringValue(line, "pluginId");
    const auto plugin = gLoadedPlugins.find(pluginId);
    if (plugin == gLoadedPlugins.end()) {
      Respond("{\"type\":\"processPcm\",\"requestId\":\"" + JsonEscape(requestId) + "\",\"status\":\"not-loaded\",\"pluginId\":\"" + JsonEscape(pluginId) + "\",\"error\":\"Plugin is not loaded.\"}");
      return;
    }
    const std::string pcm16File = JsonStringValue(line, "pcm16File");
    const std::string outputPcm16File = JsonStringValue(line, "outputPcm16File");
    const int32_t frames = JsonIntValue(line, "frames", 512, 1, 8192);
    const int32_t channels = JsonIntValue(line, "channels", 2, 1, 2);
    const double sampleRate = ClampDouble(JsonNumberValue(line, "sampleRate", 48000), 8000, 384000);
    try {
      const std::vector<uint8_t> inputBytes = !pcm16File.empty()
        ? ReadBinaryFile(pcm16File)
        : DecodeBase64(JsonStringValue(line, "pcm16Base64"));
      const auto result = ProcessPcm(plugin->second, inputBytes, frames, channels, sampleRate, JsonStringValue(line, "parameterValues"));
      if (!outputPcm16File.empty()) {
        WriteBinaryFile(outputPcm16File, result.pcm16Bytes);
      }
      std::ostringstream output;
      output
        << "{"
        << "\"type\":\"processPcm\","
        << "\"requestId\":\"" << JsonEscape(requestId) << "\","
        << "\"status\":\"processed\","
        << "\"pluginId\":\"" << JsonEscape(pluginId) << "\","
        << "\"frames\":" << result.frames << ","
        << "\"channels\":2,"
        << "\"sampleRate\":" << result.sampleRate << ","
        << "\"inputChannels\":" << result.inputChannels << ","
        << "\"outputChannels\":" << result.outputChannels << ","
        << "\"inputPeak\":" << result.inputPeak << ","
        << "\"outputPeak\":" << result.outputPeak << ","
        << "\"maxDelta\":" << result.maxDelta << ","
        << "\"changed\":" << (result.changed ? "true" : "false") << ","
        << "\"bridgePcmProcessing\":true,"
        << "\"processingEnabled\":false,"
        << "\"parameterValueCount\":" << result.parameterValueCount << ",";
      if (!outputPcm16File.empty()) {
        output
          << "\"pcmTransport\":\"file\","
          << "\"pcm16File\":\"" << JsonEscape(outputPcm16File) << "\"";
      } else {
        output
          << "\"pcmTransport\":\"base64\","
          << "\"pcm16Base64\":\"" << EncodeBase64(result.pcm16Bytes) << "\"";
      }
      output << "}";
      Respond(output.str());
    } catch (const std::exception& error) {
      Respond("{\"type\":\"processPcm\",\"requestId\":\"" + JsonEscape(requestId) + "\",\"status\":\"process-failed\",\"pluginId\":\"" + JsonEscape(pluginId) + "\",\"bridgePcmProcessing\":false,\"processingEnabled\":false,\"error\":\"" + JsonEscape(error.what()) + "\"}");
    }
    return;
  }
  if (type == "exit") {
    Respond("{\"type\":\"exit\",\"requestId\":\"" + JsonEscape(requestId) + "\",\"status\":\"ok\"}");
    std::exit(0);
  }
  Respond("{\"type\":\"error\",\"requestId\":\"" + JsonEscape(requestId) + "\",\"status\":\"error\",\"error\":\"Unsupported VST3 bridge command.\"}");
}

int main(int argc, char** argv) {
  const std::vector<std::string> args(argv + 1, argv + argc);
  if (std::find(args.begin(), args.end(), "--describe") != args.end()) {
    Respond(DescribeJson());
    return 0;
  }

  std::string line;
  while (std::getline(std::cin, line)) {
    if (!line.empty()) HandleLine(line);
  }
  return 0;
}

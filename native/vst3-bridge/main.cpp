#include <algorithm>
#include <cstdlib>
#include <filesystem>
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
#include "public.sdk/source/vst/hosting/plugprovider.h"

namespace fs = std::filesystem;
using Steinberg::Vst::IEditController;
using Steinberg::Vst::ParameterInfo;
constexpr int32_t kVstString128Size = 128;

struct LoadedPlugin {
  VST3::Hosting::Module::Ptr module;
  std::unique_ptr<Steinberg::Vst::PlugProvider> provider;
  std::vector<ParameterInfo> parameters;
  std::string pluginId;
  std::string pluginPath;
  std::string className;
  std::string vendor;
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

bool PathExists(const std::string& path) {
  if (path.empty()) return false;
  std::error_code error;
  return fs::exists(fs::path(path), error);
}

std::string JsonStringValue(const std::string& line, const std::string& key) {
  const std::string pattern = "\"" + key + "\"";
  size_t position = line.find(pattern);
  if (position == std::string::npos) return "";
  position = line.find(':', position + pattern.size());
  if (position == std::string::npos) return "";
  position = line.find('"', position + 1);
  if (position == std::string::npos) return "";
  const size_t start = position + 1;
  position = line.find('"', start);
  if (position == std::string::npos) return "";
  return line.substr(start, position - start);
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
  return loaded;
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
    << "\"pcmProcessing\":false"
    << "},"
    << "\"note\":\"Native VST3 bridge can instantiate VST3 modules and enumerate parameters when the SDK is present; PCM processing is still pending.\""
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

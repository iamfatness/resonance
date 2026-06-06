#include <algorithm>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace fs = std::filesystem;

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
    << "\"binaryInstantiation\":false,"
    << "\"pcmProcessing\":false"
    << "},"
    << "\"note\":\"Native VST3 bridge scaffold is built; install the Steinberg VST3 SDK and set RESONANCE_VST3_SDK_DIR before binary instantiation is enabled.\""
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
      << "\"status\":\"" << (!pluginFound ? "plugin-missing" : sdkFound ? "sdk-ready-loader-missing" : "sdk-missing") << "\","
      << "\"pluginId\":\"" << JsonEscape(pluginId) << "\","
      << "\"pluginPath\":\"" << JsonEscape(pluginPath) << "\","
      << "\"pluginFound\":" << (pluginFound ? "true" : "false") << ","
      << "\"processingEnabled\":false,"
      << "\"error\":\""
      << (!pluginFound
        ? "Plugin path does not exist on this machine."
        : sdkFound
          ? "VST3 SDK detected, but binary instantiation is not implemented in this scaffold."
          : "VST3 SDK not found. Set RESONANCE_VST3_SDK_DIR to the Steinberg VST3 SDK root.")
      << "\""
      << "}";
    Respond(output.str());
    return;
  }
  if (type == "unloadPlugin") {
    Respond("{\"type\":\"unloadPlugin\",\"requestId\":\"" + JsonEscape(requestId) + "\",\"status\":\"not-loaded\"}");
    return;
  }
  if (type == "enumerateParameters") {
    Respond("{\"type\":\"enumerateParameters\",\"requestId\":\"" + JsonEscape(requestId) + "\",\"status\":\"not-loaded\",\"parameters\":[]}");
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

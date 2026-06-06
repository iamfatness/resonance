cmake_minimum_required(VERSION 3.25)
project(resonance_vst3_bridge LANGUAGES CXX)

set(RESONANCE_VST3_SDK_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../third_party/vst3sdk" CACHE PATH "Steinberg VST3 SDK root")
set(SMTG_ENABLE_VST3_PLUGIN_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VST3_HOSTING_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VSTGUI_SUPPORT OFF CACHE BOOL "" FORCE)
set(SMTG_ENABLE_AUV2_BUILDS OFF CACHE BOOL "" FORCE)
set(SMTG_RUN_VST_VALIDATOR OFF CACHE BOOL "" FORCE)
set(SMTG_CREATE_MODULE_INFO OFF CACHE BOOL "" FORCE)
add_subdirectory("${RESONANCE_VST3_SDK_DIR}" "${CMAKE_CURRENT_BINARY_DIR}/vst3sdk")

set(RESONANCE_VST3_BRIDGE_SOURCES
  main.cpp
  "${RESONANCE_VST3_SDK_DIR}/public.sdk/source/vst/hosting/plugprovider.cpp"
  "${RESONANCE_VST3_SDK_DIR}/public.sdk/source/vst/hosting/module_win32.cpp"
)

add_executable(resonance-vst3-bridge ${RESONANCE_VST3_BRIDGE_SOURCES})
target_compile_features(resonance-vst3-bridge PRIVATE cxx_std_17)
target_compile_definitions(resonance-vst3-bridge PRIVATE UNICODE _UNICODE NOMINMAX)
target_link_libraries(resonance-vst3-bridge PRIVATE sdk_hosting)

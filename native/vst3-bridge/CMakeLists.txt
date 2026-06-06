cmake_minimum_required(VERSION 3.20)
project(resonance_vst3_bridge LANGUAGES CXX)

add_executable(resonance-vst3-bridge main.cpp)
target_compile_features(resonance-vst3-bridge PRIVATE cxx_std_17)
target_compile_definitions(resonance-vst3-bridge PRIVATE UNICODE _UNICODE NOMINMAX)

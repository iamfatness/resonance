cmake_minimum_required(VERSION 3.20)
project(resonance_audio_router LANGUAGES CXX)

add_executable(resonance-audio-router main.cpp)
target_compile_features(resonance-audio-router PRIVATE cxx_std_17)
target_compile_definitions(resonance-audio-router PRIVATE UNICODE _UNICODE NOMINMAX)
target_link_libraries(resonance-audio-router PRIVATE ole32 uuid avrt)

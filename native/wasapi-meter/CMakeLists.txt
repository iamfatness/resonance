cmake_minimum_required(VERSION 3.20)
project(resonance_wasapi_meter LANGUAGES CXX)

add_executable(resonance-wasapi-meter main.cpp)
target_compile_features(resonance-wasapi-meter PRIVATE cxx_std_17)
target_compile_definitions(resonance-wasapi-meter PRIVATE UNICODE _UNICODE NOMINMAX)
target_link_libraries(resonance-wasapi-meter PRIVATE ole32 uuid avrt)

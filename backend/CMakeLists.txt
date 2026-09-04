set(CMAKE_POLICY_VERSION_MINIMUM "3.5" CACHE STRING "" FORCE)

cmake_minimum_required(VERSION 3.15)
project(MakeShiftBackend VERSION 1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

enable_testing()
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if (CMAKE_VERSION VERSION_LESS 3.18)
    set(DEV_MODULE Development)
else()
    set(DEV_MODULE Development.Module)
endif()
find_package(Python 3.12 COMPONENTS Interpreter ${DEV_MODULE} REQUIRED)

execute_process(
    COMMAND "${Python_EXECUTABLE}" -m nanobind --cmake_dir
    OUTPUT_STRIP_TRAILING_WHITESPACE OUTPUT_VARIABLE nanobind_ROOT
)

if(NOT nanobind_ROOT)
    message(FATAL_ERROR "nanobind not found!")
endif()

list(APPEND CMAKE_PREFIX_PATH "${nanobind_ROOT}")
find_package(nanobind CONFIG REQUIRED)
find_package(Threads REQUIRED)

include(FetchContent)

# Disable PortAudio's default tests and examples to speed up the build
set(PA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(PA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)

# CRITICAL FIX: Force static compilation to prevent vcpkg DLL copying errors
set(PA_BUILD_SHARED OFF CACHE BOOL "" FORCE)
set(PA_BUILD_STATIC ON CACHE BOOL "" FORCE)

FetchContent_Declare(
    portaudio
    GIT_REPOSITORY https://github.com/PortAudio/portaudio.git
    GIT_TAG        v19.7.0
)
FetchContent_MakeAvailable(portaudio)

set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)

FetchContent_Declare(
  googletest
  GIT_REPOSITORY https://github.com/google/googletest.git
  GIT_TAG        v1.14.0
)
FetchContent_MakeAvailable(googletest)

set(SOURCES
    src/audio/AudioEngine.cpp
)

add_library(MakeShiftAudio STATIC ${SOURCES})
target_include_directories(MakeShiftAudio PUBLIC src)
target_link_libraries(MakeShiftAudio PUBLIC Threads::Threads portaudio_static)

# --- Python Extension Module ---
nanobind_add_module(audio_engine src/bindings.cpp)

set_target_properties(audio_engine PROPERTIES 
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/src/audio"
    LIBRARY_OUTPUT_DIRECTORY_DEBUG "${CMAKE_SOURCE_DIR}/src/audio"
    LIBRARY_OUTPUT_DIRECTORY_RELEASE "${CMAKE_SOURCE_DIR}/src/audio"
)

target_link_libraries(audio_engine PRIVATE MakeShiftAudio)

set(TEST_SOURCES
    ../tests/test_audio.cpp
)
add_executable(MakeShiftTests ${TEST_SOURCES})
target_link_libraries(MakeShiftTests PRIVATE MakeShiftAudio gtest_main)

include(GoogleTest)
gtest_discover_tests(MakeShiftTests)
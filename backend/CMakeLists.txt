cmake_minimum_required(VERSION 3.15)
project(MakeShiftBackend VERSION 1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

enable_testing()

# --- Python & Nanobind Setup ---
# Locate Python >= 3.10 and the Development.Module component required by nanobind
if (CMAKE_VERSION VERSION_LESS 3.18)
    set(DEV_MODULE Development)
else()
    set(DEV_MODULE Development.Module)
endif()
find_package(Python 3.12 COMPONENTS Interpreter ${DEV_MODULE} REQUIRED)

# Detect the installed nanobind package and import it into CMake
execute_process(
    COMMAND "${Python_EXECUTABLE}" -m nanobind --cmake_dir
    OUTPUT_STRIP_TRAILING_WHITESPACE OUTPUT_VARIABLE nanobind_ROOT)
find_package(nanobind CONFIG REQUIRED)

# --- Find C++ Dependencies ---
find_package(Threads REQUIRED)

find_package(PkgConfig REQUIRED)
pkg_check_modules(PORTAUDIO REQUIRED portaudio-2.0)

find_package(GTest REQUIRED)

# --- Define Source Files ---
# Include PortAudio playback and lock-free data structures here
set(SOURCES
    src/audio/audio_engine.cpp
    # src/audio/lock_free_queue.cpp 
)

# --- Core Library ---
# Build a static library to share between the testing framework and the Python extension
add_library(MakeShiftAudio STATIC ${SOURCES})
target_include_directories(MakeShiftAudio PUBLIC src)
target_link_libraries(MakeShiftAudio PUBLIC Threads::Threads ${PORTAUDIO_LIBRARIES})
target_include_directories(MakeShiftAudio PUBLIC ${PORTAUDIO_INCLUDE_DIRS})

# --- Python Extension Module ---
# Compile a nanobind extension module using the specified target name and source files
nanobind_add_module(makeshift_ext src/bindings.cpp)
target_link_libraries(makeshift_ext PRIVATE MakeShiftAudio)

# --- Tests ---
set(TEST_SOURCES
    ../tests/test_audio.cpp
)
add_executable(MakeShiftTests ${TEST_SOURCES})
target_link_libraries(MakeShiftTests PRIVATE MakeShiftAudio GTest::gtest_main)

include(GoogleTest)
gtest_discover_tests(MakeShiftTests)
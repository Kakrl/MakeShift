cmake_minimum_required(VERSION 3.15)
project(MakeShiftCV LANGUAGES CXX)

# Standalone experiment: no PortAudio, nanobind, Python, GUI, or browser runtime.
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
find_package(OpenCV 4.12 CONFIG REQUIRED COMPONENTS core imgproc imgcodecs)

add_library(makeshift_cv_baseline STATIC Homography.cpp ShadowDetection.cpp Fingertips.cpp ShadowPaths.cpp)
target_include_directories(makeshift_cv_baseline PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}")
target_link_libraries(makeshift_cv_baseline PUBLIC opencv_core)
add_executable(shadow_images shadow_images.cpp)
add_library(makeshift_cv_diagnostics STATIC ShadowDiagnostics.cpp)
target_link_libraries(makeshift_cv_diagnostics PUBLIC makeshift_cv_baseline opencv_imgproc)
target_link_libraries(shadow_images PRIVATE makeshift_cv_diagnostics opencv_imgcodecs)

include(CTest)
if(BUILD_TESTING)
    add_executable(baseline_tests ../../../tests/cv/test_baseline.cpp)
    target_link_libraries(baseline_tests PRIVATE makeshift_cv_baseline opencv_imgproc opencv_imgcodecs)
    add_test(NAME cv_baseline COMMAND baseline_tests)
endif()

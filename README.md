# MakeShift

- Carl Xu
- Harry Deng
- Jadden Picardal
- Francis Ozua

## C++ Audio Engine Setup & Build
The backend includes a high-performance C++ audio engine exposed to Python via nanobind and tested using GoogleTest.

### Prerequisites
- C++ Compiler: MSVC (Windows), GCC/Clang (Linux/macOS) supporting C++23.
- CMake: Version 3.15 or higher.
- Python: Version 3.10+ with an active virtual environment.

1. Install Python Dependencies
Activate your virtual environment and install the required build tools (including nanobind):

pip install nanobind

2. Configure and Build (Local)
Navigate to the backend/ directory, create a build folder, and compile the project:

cd backend
cmake -B build -S .
cmake --build build --config Release

3. Run C++ Unit Tests
To verify the audio engine locally using CTest, run:

cd build
ctest -C Release --output-on-failure
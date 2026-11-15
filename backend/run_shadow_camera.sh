#!/bin/sh
# Build the standalone vision library and launch its live camera viewer.
set -eu
REPO_ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
VISION_BUILD="$REPO_ROOT/build/vision"
if [ ! -f "$VISION_BUILD/conan_toolchain.cmake" ]; then
    conan install "$REPO_ROOT/backend/src/CV" --output-folder="$VISION_BUILD" \
        --build=missing -s build_type=Release -s compiler.cppstd=17 \
        -c tools.build:jobs=4
fi
cmake -S "$REPO_ROOT/backend/src/CV" -B "$VISION_BUILD" \
    -DCMAKE_TOOLCHAIN_FILE="$VISION_BUILD/conan_toolchain.cmake" \
    -DCMAKE_BUILD_TYPE=Release -DMAKESHIFT_LIVE_CAMERA=ON
cmake --build "$VISION_BUILD" --parallel 4
exec "$VISION_BUILD/shadow_camera" "$@"

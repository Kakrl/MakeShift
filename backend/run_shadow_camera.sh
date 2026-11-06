#!/bin/sh
# Optional native desktop environment; keep the existing still-image build intact.
set -eu
ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
BUILD="$ROOT/build/shadow-camera"
if [ ! -f "$BUILD/camera-keys-v1.ready" ]; then
    conan install "$ROOT/backend/src/CV" --output-folder="$BUILD" --build=missing \
        -s build_type=Release -s compiler.cppstd=17 -c tools.build:jobs=4 \
        -o 'opencv/*:highgui=True' -o 'opencv/*:videoio=True' \
        -o 'opencv/*:objdetect=True' -o 'opencv/*:calib3d=True' \
        -o 'opencv/*:features2d=True' -o 'opencv/*:flann=True' \
        -o 'opencv/*:with_quirc=False'
    cmake -S "$ROOT/backend/src/CV" -B "$BUILD" \
        -DCMAKE_TOOLCHAIN_FILE=conan_toolchain.cmake -DCMAKE_BUILD_TYPE=Release \
        -DMAKESHIFT_LIVE_CAMERA=ON
    touch "$BUILD/camera-keys-v1.ready"
fi
cmake --build "$BUILD" --parallel 4
cd "$ROOT"
exec "$BUILD/shadow_camera" "$@"

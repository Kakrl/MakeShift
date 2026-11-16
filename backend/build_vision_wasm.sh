#!/usr/bin/env bash
# Pinned, isolated SDK/OpenCV build. Downloads only into ignored build/.
set -euo pipefail
REPO_ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
CV_SOURCE="$REPO_ROOT/backend/src/CV"
source "$CV_SOURCE/wasm/toolchain.env"
WASM_DEPS="$REPO_ROOT/build/vision-wasm-deps"
SDK_PATH="$WASM_DEPS/emsdk"
OPENCV_PATH="$WASM_DEPS/opencv"
mkdir -p "$WASM_DEPS"
if [ ! -d "$SDK_PATH/.git" ]; then
    git clone --depth 1 --branch "$EMSDK_VERSION" https://github.com/emscripten-core/emsdk.git "$SDK_PATH"
fi
if [ "$(git -C "$SDK_PATH" rev-parse HEAD)" != "$EMSDK_REV" ]; then
    echo "Emscripten SDK revision does not match wasm/toolchain.env" >&2
    exit 1
fi
if [ ! -d "$OPENCV_PATH/.git" ]; then
    git clone --depth 1 --branch "$OPENCV_VERSION" https://github.com/opencv/opencv.git "$OPENCV_PATH"
fi
if [ "$(git -C "$OPENCV_PATH" rev-parse HEAD)" != "$OPENCV_REV" ]; then
    echo "OpenCV revision does not match wasm/toolchain.env" >&2
    exit 1
fi
if [ ! -x "$SDK_PATH/upstream/emscripten/emcc" ]; then
    "$SDK_PATH/emsdk" install "$EMSDK_VERSION"
fi
"$SDK_PATH/emsdk" activate "$EMSDK_VERSION"
export EMSDK_QUIET=1
source "$SDK_PATH/emsdk_env.sh"
emcc --version | head -1
emcmake cmake -S "$OPENCV_PATH" -B "$WASM_DEPS/opencv-build" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$WASM_DEPS/opencv-install" \
    -DBUILD_LIST=core,imgproc,objdetect -DBUILD_SHARED_LIBS=OFF \
    -DBUILD_TESTS=OFF -DBUILD_PERF_TESTS=OFF -DBUILD_EXAMPLES=OFF \
    -DBUILD_opencv_apps=OFF -DBUILD_opencv_js=OFF -DBUILD_JAVA=OFF \
    -DBUILD_opencv_python3=OFF -DBUILD_opencv_dnn=OFF \
    -DWITH_IPP=OFF -DWITH_OPENCL=OFF -DWITH_ITT=OFF -DWITH_PTHREADS_PF=OFF \
    -DWITH_PROTOBUF=OFF -DWITH_EIGEN=OFF -DWITH_LAPACK=OFF -DWITH_QUIRC=OFF \
    -DWITH_TIFF=OFF -DWITH_JPEG=OFF -DWITH_PNG=OFF -DWITH_WEBP=OFF \
    -DWITH_OPENEXR=OFF -DWITH_OPENJPEG=OFF -DWITH_JASPER=OFF -DWITH_AVIF=OFF \
    -DCV_ENABLE_INTRINSICS=OFF -DCPU_BASELINE= -DCPU_DISPATCH= \
    -DENABLE_PRECOMPILED_HEADERS=OFF -DCMAKE_CXX_FLAGS=-fexceptions \
    -DCMAKE_POLICY_VERSION_MINIMUM=3.5
cmake --build "$WASM_DEPS/opencv-build" --parallel 4
cmake --install "$WASM_DEPS/opencv-build"
emcmake cmake -S "$CV_SOURCE" -B "$REPO_ROOT/build/vision-wasm" \
    -DCMAKE_BUILD_TYPE=Release -DOpenCV_DIR="$WASM_DEPS/opencv-install/lib/cmake/opencv4" \
    -DMAKESHIFT_LIVE_CAMERA=OFF -DBUILD_TESTING=ON
cmake --build "$REPO_ROOT/build/vision-wasm" --parallel 4
python3 - "$REPO_ROOT" <<'PY'
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
root = pathlib.Path(sys.argv[1])
staging = root / 'build/vision-wasm/dist'
dist = root / 'backend/src/CV/wasm/dist'
dist.mkdir(parents=True, exist_ok=True)
names = ['makeshift-vision.mjs', 'makeshift-vision-core.mjs',
         'makeshift-vision-core.wasm', 'makeshift-vision.d.mts', 'toolchain.env']
for name in names:
    shutil.copy2(staging / name, dist / name)
files = [dist / name for name in names]
source = sorted((root / 'backend/src/CV').glob('*.cpp'))
source += sorted((root / 'backend/src/CV').glob('*.hpp'))
source += sorted((root / 'backend/src/CV/wasm').glob('*'))
source += [root / 'backend/src/CV/CMakeLists.txt', root / 'backend/build_vision_wasm.sh']
info = {
    'schemaVersion': 1,
    'gitHead': subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip(),
    'sourceSha256': {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
                     for p in source if p.is_file()},
    'artifactSha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
}
(dist / 'build-info.json').write_text(json.dumps(info, indent=2) + '\n')
PY
printf 'Vision WASM handoff bundle: %s\n' "$CV_SOURCE/wasm/dist"

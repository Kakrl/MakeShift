"""Dependencies for the standalone C++ MOG2 experiment."""

# Conan is supplied by the build CLI, outside the app's Python environment.
from conan import ConanFile  # type: ignore[import-not-found]
from conan.tools.cmake import (  # type: ignore[import-not-found]
    CMakeDeps,
    CMakeToolchain,
)


class Mog2ExperimentConan(ConanFile):
    settings = "os", "arch", "compiler", "build_type"
    requires = "opencv/4.12.0"
    default_options = {
        "opencv/*:shared": False,
        "opencv/*:contrib": False,
        "opencv/*:calib3d": False,
        "opencv/*:dnn": False,
        "opencv/*:features2d": False,
        "opencv/*:flann": False,
        "opencv/*:gapi": False,
        "opencv/*:highgui": False,
        "opencv/*:ml": False,
        "opencv/*:objdetect": False,
        "opencv/*:photo": False,
        "opencv/*:stitching": False,
        "opencv/*:video": True,
        "opencv/*:videoio": False,
        "opencv/*:imgproc": True,
        "opencv/*:imgcodecs": True,
        "opencv/*:with_eigen": False,
        "opencv/*:with_ffmpeg": False,
        "opencv/*:with_tiff": False,
        "opencv/*:with_jpeg2000": False,
        "opencv/*:with_openexr": False,
        "opencv/*:with_protobuf": False,
        "opencv/*:with_flatbuffers": False,
    }

    def generate(self):
        CMakeDeps(self).generate()
        toolchain = CMakeToolchain(self)
        toolchain.user_presets_path = False
        toolchain.generate()

#include <nanobind/nanobind.h>
#include "AudioEngine.h"

namespace nb = nanobind;

NB_MODULE(audio_engine, m) {
    m.doc() = "MakeShift Low-Latency Audio Engine Plugin";

    nb::class_<AudioEngine>(m, "AudioEngine")
        .def(nb::init<>())
        .def("initialize", &AudioEngine::initialize)
        .def("start_stream", &AudioEngine::startStream)
        .def("stop_stream", &AudioEngine::stopStream);
}
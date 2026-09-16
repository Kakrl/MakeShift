#include "audio/AudioEngine.h"
#include <nanobind/nanobind.h>

namespace nb = nanobind;

NB_MODULE(audio_engine, m) {
    m.doc() = "MakeShift Low-Latency Audio Engine Plugin";

    nb::class_<AudioEngine>(m, "AudioEngine")
        .def(nb::init<>())
        .def("initialize", &AudioEngine::initialize)
        .def("start_stream", &AudioEngine::startStream)
        .def("stop_stream", &AudioEngine::stopStream)
        .def("submit_hit", &AudioEngine::submitHit, nb::arg("note"), nb::arg("velocity"),
             "Queue a MIDI note (0-127) and normalized velocity (0 < velocity <= 1). "
             "Use one producer thread. Returns false for invalid input or a full queue.");
}

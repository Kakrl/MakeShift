#include "audio/AudioEngine.h"
#include <nanobind/nanobind.h>
#include <nanobind/stl/vector.h>

namespace nb = nanobind;

NB_MODULE(audio_engine, m) {
    m.doc() = "MakeShift Low-Latency Audio Engine Plugin";

    nb::class_<AudioEngine>(m, "AudioEngine")
        .def(nb::init<int>(), nb::arg("voice_limit") = AudioEngine::MaxVoices)
        .def("note_on", &AudioEngine::noteOn, nb::arg("note"))
        .def("note_off", &AudioEngine::noteOff, nb::arg("note"))
        .def("active_notes", &AudioEngine::activeNotes)
        .def("initialize", &AudioEngine::initialize)
        .def("start_stream", &AudioEngine::startStream)
        .def("stop_stream", &AudioEngine::stopStream);
}
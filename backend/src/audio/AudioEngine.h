#pragma once
#include <portaudio.h>
#include <stdexcept>
#include <string>

class AudioEngine {
  public:
    AudioEngine();
    ~AudioEngine();

    void initialize();
    void startStream();
    void stopStream();

  private:
    PaStream *stream;

    // PortAudio requires a static C-style callback function
    static int audioCallback(const void *inputBuffer, void *outputBuffer,
                             unsigned long framesPerBuffer,
                             const PaStreamCallbackTimeInfo *timeInfo,
                             PaStreamCallbackFlags statusFlags, void *userData);
};

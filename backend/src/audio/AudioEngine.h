#pragma once
#include "SpscQueue.h"
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

    // Call from one hit-detection producer thread. False means invalid or full.
    bool submitHit(int note, float velocity) noexcept;

    // Consumer entry point used by PortAudio; output holds frames * 2 floats.
    // Offline callers must not call this while the stream is running.
    void render(float *output, unsigned long frames) noexcept;

    static constexpr std::size_t eventCapacity = 256;

  private:
    struct HitEvent {
        int note;
        float velocity;
    };
    struct Voice {
        double phase = 0.0;
        double phaseStep = 0.0;
        float amplitude = 0.0f;
        unsigned int remaining = 0;
    };
    static constexpr unsigned int sampleRate = 44100;
    static constexpr unsigned int hitFrames = sampleRate / 10;
    SpscQueue<HitEvent, eventCapacity> events;
    std::array<Voice, 16> voices{};
    std::size_t nextVoice = 0;
    PaStream *stream;

    // PortAudio requires a static C-style callback function
    static int audioCallback(const void *inputBuffer, void *outputBuffer,
                             unsigned long framesPerBuffer,
                             const PaStreamCallbackTimeInfo *timeInfo,
                             PaStreamCallbackFlags statusFlags, void *userData);
};

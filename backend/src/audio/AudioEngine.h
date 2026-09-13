#pragma once
#include <bitset>
#include <mutex>
#include <portaudio.h>
#include <stdexcept>
#include <string>
#include <vector>

class AudioEngine {
  public:
    static constexpr int MaxVoices = 10;
    explicit AudioEngine(int voiceLimit = MaxVoices);
    ~AudioEngine();

    void initialize();
    void startStream();
    void stopStream();

    // MIDI notes 0-127. Repeated note-on events for a held key are ignored.
    // Returns the stolen note, or -1 when no voice was stolen.
    int noteOn(int note);
    void noteOff(int note);
    std::vector<int> activeNotes() const;

  private:
    PaStream *stream;
    const int voiceLimit;
    mutable std::mutex voiceMutex;
    // Active voices ordered from oldest key press to newest.
    std::vector<int> voices;
    std::bitset<128> heldNotes;

    // PortAudio requires a static C-style callback function
    static int audioCallback(const void *inputBuffer, void *outputBuffer,
                             unsigned long framesPerBuffer,
                             const PaStreamCallbackTimeInfo *timeInfo,
                             PaStreamCallbackFlags statusFlags, void *userData);
};

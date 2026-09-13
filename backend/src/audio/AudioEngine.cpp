#include "AudioEngine.h"
#include <algorithm>

AudioEngine::AudioEngine(int voiceLimit) : stream(nullptr), voiceLimit(voiceLimit) {
    if (voiceLimit < 1 || voiceLimit > MaxVoices) {
        throw std::invalid_argument("Voice limit must be between 1 and 10.");
    }
    voices.reserve(voiceLimit);
}

int AudioEngine::noteOn(int note) {
    if (note < 0 || note > 127) {
        throw std::invalid_argument("MIDI note must be between 0 and 127.");
    }
    std::lock_guard<std::mutex> lock(voiceMutex);
    if (heldNotes.test(note)) {
        return -1;
    }
    heldNotes.set(note);
    int stolenNote = -1;
    if (voices.size() == static_cast<std::size_t>(voiceLimit)) {
        stolenNote = voices.front();
        voices.erase(voices.begin());
    }
    voices.push_back(note);
    return stolenNote;
}

void AudioEngine::noteOff(int note) {
    if (note < 0 || note > 127) {
        throw std::invalid_argument("MIDI note must be between 0 and 127.");
    }
    std::lock_guard<std::mutex> lock(voiceMutex);
    heldNotes.reset(note);
    auto voice = std::find(voices.begin(), voices.end(), note);
    if (voice != voices.end()) {
        voices.erase(voice);
    }
}

std::vector<int> AudioEngine::activeNotes() const {
    std::lock_guard<std::mutex> lock(voiceMutex);
    return voices;
}

AudioEngine::~AudioEngine() {
    stopStream();
    Pa_Terminate();
}

void AudioEngine::initialize() {
    PaError err = Pa_Initialize();
    if (err != paNoError) {
        throw std::runtime_error(std::string("PortAudio Init Error: ") + Pa_GetErrorText(err));
    }
}

int AudioEngine::audioCallback(const void *inputBuffer, void *outputBuffer,
                               unsigned long framesPerBuffer,
                               const PaStreamCallbackTimeInfo *timeInfo,
                               PaStreamCallbackFlags statusFlags, void *userData) {

    float *out = static_cast<float *>(outputBuffer);
    AudioEngine *engine = static_cast<AudioEngine *>(userData);

    // Minimal loop: Fill with silence for initialization testing
    for (unsigned long i = 0; i < framesPerBuffer; ++i) {
        *out++ = 0.0f; // Left channel
        *out++ = 0.0f; // Right channel
    }

    return paContinue;
}

void AudioEngine::startStream() {
    PaStreamParameters outputParams;
    outputParams.device = Pa_GetDefaultOutputDevice();

    if (outputParams.device == paNoDevice) {
        throw std::runtime_error("No default output device found.");
    }

    const PaDeviceInfo *deviceInfo = Pa_GetDeviceInfo(outputParams.device);
    outputParams.channelCount = 2;
    outputParams.sampleFormat = paFloat32;

    // Request the hardware's minimum possible latency
    outputParams.suggestedLatency = deviceInfo->defaultLowOutputLatency;
    outputParams.hostApiSpecificStreamInfo = nullptr;

    // ISSUE 21 REQUIREMENT: Minimal buffer size to prioritize low latency over CPU efficiency
    unsigned long bufferSize = 64;

    PaError err = Pa_OpenStream(&stream, nullptr, &outputParams, 44100, bufferSize, paClipOff,
                                audioCallback, this);

    if (err != paNoError) {
        throw std::runtime_error(std::string("Stream Open Error: ") + Pa_GetErrorText(err));
    }

    err = Pa_StartStream(stream);
    if (err != paNoError) {
        throw std::runtime_error(std::string("Stream Start Error: ") + Pa_GetErrorText(err));
    }
}

void AudioEngine::stopStream() {
    if (stream) {
        Pa_StopStream(stream);
        Pa_CloseStream(stream);
        stream = nullptr;
    }
    std::lock_guard<std::mutex> lock(voiceMutex);
    voices.clear();
    heldNotes.reset();
}

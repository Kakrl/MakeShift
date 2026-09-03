#include "AudioEngine.h"

AudioEngine::AudioEngine() : stream(nullptr) {}

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

int AudioEngine::audioCallback(const void* inputBuffer, void* outputBuffer,
                               unsigned long framesPerBuffer,
                               const PaStreamCallbackTimeInfo* timeInfo,
                               PaStreamCallbackFlags statusFlags,
                               void* userData) {
    
    float* out = static_cast<float*>(outputBuffer);
    AudioEngine* engine = static_cast<AudioEngine*>(userData);

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

    const PaDeviceInfo* deviceInfo = Pa_GetDeviceInfo(outputParams.device);
    outputParams.channelCount = 2; 
    outputParams.sampleFormat = paFloat32;
    
    // Request the hardware's minimum possible latency
    outputParams.suggestedLatency = deviceInfo->defaultLowOutputLatency;
    outputParams.hostApiSpecificStreamInfo = nullptr;

    // ISSUE 21 REQUIREMENT: Minimal buffer size to prioritize low latency over CPU efficiency
    unsigned long bufferSize = 64; 

    PaError err = Pa_OpenStream(&stream, nullptr, &outputParams, 
                                44100, bufferSize, paClipOff, 
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
}

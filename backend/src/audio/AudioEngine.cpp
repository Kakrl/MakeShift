#include "AudioEngine.h"
#include <algorithm>
#include <cmath>
#include <numbers>

AudioEngine::AudioEngine(int voiceLimit) : voiceLimit(voiceLimit), stream(nullptr) {
    if (voiceLimit < 1 || voiceLimit > static_cast<int>(MaxVoices)) {
        throw std::invalid_argument("Voice limit must be between 1 and 10.");
    }
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

bool AudioEngine::submitHit(int note, float velocity) noexcept {
    if (note < 0 || note > 127 || !std::isfinite(velocity) || velocity <= 0.0f || velocity > 1.0f) {
        return false;
    }
    return events.tryPush({note, velocity});
}

void AudioEngine::render(float *output, unsigned long frames) noexcept {
    if (frames == 0) {
        return;
    }
    // Reuse expired slots before stealing an active voice. Stable compaction
    // preserves hit order, including hits received in the same callback.
    auto activeEnd = std::remove_if(voices.begin(), voices.begin() + activeVoiceCount,
                                    [](const Voice &voice) { return voice.remaining == 0; });
    activeVoiceCount = static_cast<std::size_t>(activeEnd - voices.begin());
    HitEvent event{};
    // Bound callback work even when the producer keeps adding events.
    for (std::size_t i = 0; i < eventCapacity && events.tryPop(event); ++i) {
        if (activeVoiceCount == voiceLimit) {
            // Drop the oldest hit and retain the remaining voices' playback state.
            for (std::size_t j = 1; j < activeVoiceCount; ++j) {
                voices[j - 1] = voices[j];
            }
            --activeVoiceCount;
        }
        auto &voice = voices[activeVoiceCount++];
        const double frequency = 440.0 * std::exp2((event.note - 69) / 12.0);
        voice = {0.0, 2.0 * std::numbers::pi * frequency / sampleRate, event.velocity * 0.2f,
                 hitFrames};
    }
    for (unsigned long i = 0; i < frames; ++i) {
        float sample = 0.0f;
        for (std::size_t j = 0; j < activeVoiceCount; ++j) {
            auto &voice = voices[j];
            if (voice.remaining == 0) {
                continue;
            }
            sample += static_cast<float>(std::sin(voice.phase)) * voice.amplitude *
                      (static_cast<float>(voice.remaining) / hitFrames);
            voice.phase += voice.phaseStep;
            if (voice.phase >= 2.0 * std::numbers::pi) {
                voice.phase -= 2.0 * std::numbers::pi;
            }
            --voice.remaining;
        }
        sample = std::clamp(sample, -1.0f, 1.0f);
        *output++ = sample;
        *output++ = sample;
    }
}

int AudioEngine::audioCallback(const void *inputBuffer, void *outputBuffer,
                               unsigned long framesPerBuffer,
                               const PaStreamCallbackTimeInfo *timeInfo,
                               PaStreamCallbackFlags statusFlags, void *userData) {

    float *out = static_cast<float *>(outputBuffer);
    AudioEngine *engine = static_cast<AudioEngine *>(userData);

    engine->render(out, framesPerBuffer);

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

    PaError err = Pa_OpenStream(&stream, nullptr, &outputParams, sampleRate, bufferSize, paClipOff,
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

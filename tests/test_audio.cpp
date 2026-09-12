#include <gtest/gtest.h>
#include <portaudio.h>
#include <iostream>
#include "audio/AudioEngine.h" // Adjust capitalization if necessary

class AudioEngineTest : public ::testing::Test {
protected:
    AudioEngine engine;

    void SetUp() override {
        engine.initialize();
    }

    void TearDown() override {
        engine.stopStream();
        Pa_Terminate();
    }
};

// Test 1: Verify PortAudio initializes without throwing exceptions
TEST_F(AudioEngineTest, InitializationSucceeds) {
    EXPECT_NO_THROW(engine.initialize());
}

// Test 2: Verify the stream can start and stop cleanly
TEST_F(AudioEngineTest, StreamStartsAndStops) {
    PaDeviceIndex defaultDevice = Pa_GetDefaultOutputDevice();
    if (defaultDevice == paNoDevice) {
        std::cout << "[  SKIPPED ] No default audio device available (likely running in CI).\n";
        return; // Exit the test early instead of failing
    }

    EXPECT_NO_THROW(engine.startStream());
    EXPECT_NO_THROW(engine.stopStream());
}

// Test 3: Verify the engine can handle multiple start/stop cycles
TEST_F(AudioEngineTest, MultipleStartStopCycles) {
    if (Pa_GetDefaultOutputDevice() == paNoDevice) {
        std::cout << "[  SKIPPED ] No audio device. Skipping cycle test.\n";
        return;
    }

    // First cycle
    EXPECT_NO_THROW(engine.startStream());
    EXPECT_NO_THROW(engine.stopStream());
    
    // Second cycle
    EXPECT_NO_THROW(engine.startStream());
    EXPECT_NO_THROW(engine.stopStream());
}
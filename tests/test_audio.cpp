#include "audio/AudioEngine.h" // Adjust capitalization if necessary
#include <gtest/gtest.h>
#include <iostream>
#include <portaudio.h>

class AudioEngineTest : public ::testing::Test {
  protected:
    AudioEngine engine;

    void SetUp() override { engine.initialize(); }

    void TearDown() override {
        engine.stopStream();
        Pa_Terminate();
    }
};

// Test 1: Verify PortAudio initializes without throwing exceptions
TEST_F(AudioEngineTest, InitializationSucceeds) { EXPECT_NO_THROW(engine.initialize()); }

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
// Voice allocation does not require an output device.
TEST(AudioVoices, StealsOldestAtTenNotes) {
    AudioEngine engine;
    for (int note = 60; note < 70; ++note)
        EXPECT_EQ(engine.noteOn(note), -1);
    EXPECT_EQ(engine.activeNotes().size(), 10u);
    EXPECT_EQ(engine.noteOn(70), 60);
    EXPECT_EQ(engine.noteOn(71), 61);
    EXPECT_EQ(engine.activeNotes(), (std::vector<int>{62, 63, 64, 65, 66, 67, 68, 69, 70, 71}));
}
TEST(AudioVoices, ReleasedSlotIsReusedAndRepressIsNewest) {
    AudioEngine engine(3);
    engine.noteOn(60);
    engine.noteOn(61);
    engine.noteOn(62);
    engine.noteOff(61);
    EXPECT_EQ(engine.noteOn(61), -1);
    EXPECT_EQ(engine.noteOn(63), 60);
    EXPECT_EQ(engine.activeNotes(), (std::vector<int>{62, 61, 63}));
}
TEST(AudioVoices, RepeatedDetectionsDoNotRefreshOrResurrectHeldNotes) {
    AudioEngine engine(2);
    engine.noteOn(60);
    engine.noteOn(61);
    EXPECT_EQ(engine.noteOn(60), -1);
    EXPECT_EQ(engine.noteOn(62), 60);
    EXPECT_EQ(engine.noteOn(60), -1);
    EXPECT_EQ(engine.activeNotes(), (std::vector<int>{61, 62}));
    engine.noteOff(60);
    EXPECT_EQ(engine.activeNotes(), (std::vector<int>{61, 62}));
    EXPECT_EQ(engine.noteOn(60), 61);
}
TEST(AudioVoices, UnknownReleasesAreHarmless) {
    AudioEngine engine;
    engine.noteOn(60);
    engine.noteOff(61);
    engine.noteOff(60);
    engine.noteOff(60);
    EXPECT_TRUE(engine.activeNotes().empty());
}
TEST(AudioVoices, ValidatesLimitsAndNotes) {
    EXPECT_THROW(AudioEngine(0), std::invalid_argument);
    EXPECT_THROW(AudioEngine(11), std::invalid_argument);
    AudioEngine engine(1);
    EXPECT_THROW(engine.noteOn(-1), std::invalid_argument);
    EXPECT_THROW(engine.noteOn(128), std::invalid_argument);
    EXPECT_THROW(engine.noteOff(-1), std::invalid_argument);
    EXPECT_THROW(engine.noteOff(128), std::invalid_argument);
    EXPECT_TRUE(engine.activeNotes().empty());
    EXPECT_EQ(engine.noteOn(0), -1);
    EXPECT_EQ(engine.noteOn(127), 0);
    EXPECT_EQ(engine.activeNotes(), (std::vector<int>{127}));
}
TEST(AudioVoices, StopClearsActiveAndHeldNotes) {
    AudioEngine engine(1);
    engine.noteOn(60);
    engine.noteOn(61);
    engine.stopStream();
    EXPECT_TRUE(engine.activeNotes().empty());
    EXPECT_EQ(engine.noteOn(60), -1);
}

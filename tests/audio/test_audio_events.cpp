#include "audio/AudioEngine.h"
#include "audio/SpscQueue.h"
#include <array>
#include <atomic>
#include <cmath>
#include <gtest/gtest.h>
#include <limits>
#include <thread>
#include <vector>

TEST(SpscQueueTest, EmptyFullAndWraparoundPreserveOrder) {
    SpscQueue<int, 3> queue;
    int value = -1;
    EXPECT_FALSE(queue.tryPop(value));
    EXPECT_EQ(value, -1);
    for (int cycle = 0; cycle < 100; ++cycle) {
        for (int i = 0; i < 3; ++i) {
            ASSERT_TRUE(queue.tryPush(cycle * 3 + i));
        }
        EXPECT_FALSE(queue.tryPush(-1));
        for (int i = 0; i < 3; ++i) {
            ASSERT_TRUE(queue.tryPop(value));
            EXPECT_EQ(value, cycle * 3 + i);
        }
        EXPECT_FALSE(queue.tryPop(value));
    }
}

TEST(SpscQueueTest, CapacityOneCanBeReused) {
    SpscQueue<int, 1> queue;
    int value;
    ASSERT_TRUE(queue.tryPush(42));
    EXPECT_FALSE(queue.tryPush(43));
    ASSERT_TRUE(queue.tryPop(value));
    EXPECT_EQ(value, 42);
    ASSERT_TRUE(queue.tryPush(43));
    ASSERT_TRUE(queue.tryPop(value));
    EXPECT_EQ(value, 43);
}

TEST(SpscQueueTest, ConcurrentProducerAndConsumerPreservePayloads) {
    struct Payload {
        int sequence;
        int check;
    };
    SpscQueue<Payload, 31> queue;
    constexpr int count = 200000;
    std::atomic<bool> ordered{true};
    std::thread producer([&] {
        for (int i = 0; i < count; ++i) {
            while (!queue.tryPush({i, ~i})) {
                std::this_thread::yield();
            }
        }
    });
    std::thread consumer([&] {
        for (int i = 0; i < count; ++i) {
            Payload value{};
            while (!queue.tryPop(value)) {
                std::this_thread::yield();
            }
            if (value.sequence != i || value.check != ~i) {
                ordered.store(false);
            }
        }
    });
    producer.join();
    consumer.join();
    EXPECT_TRUE(ordered.load());
}

TEST(AudioEventsTest, RejectsInvalidHitsWithoutFillingQueue) {
    AudioEngine engine;
    EXPECT_FALSE(engine.submitHit(-1, 1.0f));
    EXPECT_FALSE(engine.submitHit(128, 1.0f));
    EXPECT_FALSE(engine.submitHit(60, 0.0f));
    EXPECT_FALSE(engine.submitHit(60, -0.1f));
    EXPECT_FALSE(engine.submitHit(60, 1.1f));
    EXPECT_FALSE(engine.submitHit(60, std::numeric_limits<float>::quiet_NaN()));
    EXPECT_FALSE(engine.submitHit(60, std::numeric_limits<float>::infinity()));
    for (std::size_t i = 0; i < AudioEngine::eventCapacity; ++i) {
        ASSERT_TRUE(engine.submitHit(60, 1.0f));
    }
    EXPECT_FALSE(engine.submitHit(60, 1.0f));
    std::array<float, 128> output{};
    engine.render(output.data(), 64);
    EXPECT_TRUE(engine.submitHit(0, 1.0f));
    EXPECT_TRUE(engine.submitHit(127, 1.0f));
}

TEST(AudioEventsTest, QueuedHitProducesBoundedStereoThenDecaysToSilence) {
    AudioEngine engine;
    std::vector<float> output(4410 * 2, 1.0f);
    engine.render(output.data(), 4410);
    for (float sample : output) {
        ASSERT_EQ(sample, 0.0f);
    }
    ASSERT_TRUE(engine.submitHit(69, 0.5f));
    engine.render(output.data(), 4410);
    bool audible = false;
    for (std::size_t i = 0; i < output.size(); i += 2) {
        ASSERT_TRUE(std::isfinite(output[i]));
        ASSERT_LE(std::abs(output[i]), 1.0f);
        ASSERT_EQ(output[i], output[i + 1]);
        audible = audible || output[i] != 0.0f;
    }
    EXPECT_TRUE(audible);
    engine.render(output.data(), 4410);
    for (float sample : output) {
        ASSERT_EQ(sample, 0.0f);
    }
}

TEST(AudioEventsTest, VoiceStateContinuesAcrossCallbacks) {
    AudioEngine whole;
    AudioEngine split;
    ASSERT_TRUE(whole.submitHit(60, 1.0f));
    ASSERT_TRUE(split.submitHit(60, 1.0f));
    std::array<float, 256> expected{};
    std::array<float, 256> actual{};
    whole.render(expected.data(), 128);
    split.render(actual.data(), 64);
    split.render(actual.data() + 128, 64);
    EXPECT_EQ(expected, actual);
}

TEST(AudioPolyphonyTest, DefaultLimitKeepsNewestTenHitsInQueueOrder) {
    AudioEngine actual;
    AudioEngine expected;
    for (int note = 40; note < 64; ++note) {
        ASSERT_TRUE(actual.submitHit(note, 0.1f));
        if (note >= 54)
            ASSERT_TRUE(expected.submitHit(note, 0.1f));
    }
    std::array<float, 256> a{}, b{};
    actual.render(a.data(), 128);
    expected.render(b.data(), 128);
    EXPECT_EQ(a, b);
}

TEST(AudioPolyphonyTest, StealsOldestAcrossCallbacksWithoutRestartingOtherVoices) {
    AudioEngine actual(2);
    AudioEngine expected(2);
    ASSERT_TRUE(actual.submitHit(60, 0.1f));
    ASSERT_TRUE(actual.submitHit(61, 0.1f));
    ASSERT_TRUE(expected.submitHit(61, 0.1f));
    std::array<float, 256> a{}, b{};
    actual.render(a.data(), 128);
    expected.render(b.data(), 128);
    ASSERT_TRUE(actual.submitHit(62, 0.1f));
    ASSERT_TRUE(expected.submitHit(62, 0.1f));
    actual.render(a.data(), 128);
    expected.render(b.data(), 128);
    EXPECT_EQ(a, b);
}

TEST(AudioPolyphonyTest, ReusesExpiredVoicesBeforeStealing) {
    AudioEngine actual(3);
    AudioEngine expected(3);
    std::vector<float> scratch(8000);
    ASSERT_TRUE(actual.submitHit(60, 0.1f));
    actual.render(scratch.data(), 4000);
    for (int note : {61, 62}) {
        ASSERT_TRUE(actual.submitHit(note, 0.1f));
        ASSERT_TRUE(expected.submitHit(note, 0.1f));
    }
    actual.render(scratch.data(), 410);
    expected.render(scratch.data(), 410);
    ASSERT_TRUE(actual.submitHit(63, 0.1f));
    ASSERT_TRUE(expected.submitHit(63, 0.1f));
    std::array<float, 256> a{}, b{};
    actual.render(a.data(), 128);
    expected.render(b.data(), 128);
    EXPECT_EQ(a, b);
}

TEST(AudioPolyphonyTest, RepeatedPitchIsANewHitAndSingleVoiceLimitWorks) {
    AudioEngine actual(1);
    AudioEngine expected(1);
    ASSERT_TRUE(actual.submitHit(60, 0.1f));
    std::array<float, 256> a{}, b{};
    actual.render(a.data(), 128);
    ASSERT_TRUE(actual.submitHit(60, 0.2f));
    ASSERT_TRUE(expected.submitHit(60, 0.2f));
    actual.render(a.data(), 128);
    expected.render(b.data(), 128);
    EXPECT_EQ(a, b);
}

TEST(AudioPolyphonyTest, RejectsLimitsOutsideOneToTen) {
    EXPECT_THROW(AudioEngine(0), std::invalid_argument);
    EXPECT_THROW(AudioEngine(-1), std::invalid_argument);
    EXPECT_THROW(AudioEngine(11), std::invalid_argument);
    EXPECT_NO_THROW(AudioEngine(1));
    EXPECT_NO_THROW(AudioEngine(10));
}

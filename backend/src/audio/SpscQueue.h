#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <type_traits>

// Exactly one thread pushes and exactly one thread pops. Neither operation waits.
template <typename T, std::size_t Capacity> class SpscQueue {
    static_assert(Capacity > 0);
    static_assert(std::is_trivially_copyable_v<T>);
    static_assert(std::atomic<std::size_t>::is_always_lock_free);

  public:
    bool tryPush(const T &value) noexcept {
        const auto write = writeIndex.load(std::memory_order_relaxed);
        const auto next = advance(write);
        if (next == readIndex.load(std::memory_order_acquire)) {
            return false;
        }
        slots[write] = value;
        writeIndex.store(next, std::memory_order_release);
        return true;
    }

    bool tryPop(T &value) noexcept {
        const auto read = readIndex.load(std::memory_order_relaxed);
        if (read == writeIndex.load(std::memory_order_acquire)) {
            return false;
        }
        value = slots[read];
        readIndex.store(advance(read), std::memory_order_release);
        return true;
    }

  private:
    static constexpr std::size_t advance(std::size_t index) noexcept {
        return (index + 1) % (Capacity + 1);
    }

    // One spare slot distinguishes a full queue from an empty queue.
    std::array<T, Capacity + 1> slots{};
    alignas(64) std::atomic<std::size_t> writeIndex{0};
    alignas(64) std::atomic<std::size_t> readIndex{0};
};

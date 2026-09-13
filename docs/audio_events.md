# Audio Event Queue

Issue: [#23](https://github.com/Kakrl/MakeShift/issues/23).

## Submitting Hits

The audio engine accepts hit events through `submit_hit(note, velocity)` in
Python or `submitHit(note, velocity)` in C++. Notes use MIDI numbers from 0 to
127. Velocity is a finite value greater than 0 and at most 1.

```python
from backend.src.audio.audio_engine import AudioEngine

engine = AudioEngine()
engine.initialize()
engine.start_stream()
try:
    accepted = engine.submit_hit(note=60, velocity=0.8)
finally:
    engine.stop_stream()
```

In the application, keep the stream running while hit detection submits events.
The short example only shows the API; stopping immediately may prevent playback.
A return value of `False` means the input was invalid or the queue was full.
Drop that hit or record the failure on the producer side. Do not retry in a busy
loop in the hit-detection path.

## Thread Ownership

- One hit-detection thread is the producer. Route all submissions through it.
- The PortAudio callback is the only consumer while the stream is running.
- Initialize, start, stop, and destroy the engine from its owning control thread.
  Stop the producer and stream before destroying the engine.
- C++ offline tests may call `render` with space for two floats per frame, but
  must not call it concurrently with a running stream or another renderer.

The queue holds 256 events in FIFO order. A full queue rejects the newest event
without changing queued events. Storage is allocated with the engine. Atomic
read and write indices use acquire/release ordering to publish payloads and
prevent a producer from overwriting a slot before the consumer finishes reading.
The build requires index atomics that are always lock-free.

Neither queue operation allocates, locks, or waits. This is a single-producer,
single-consumer contract, not a queue for arbitrary concurrent callers. Lock-free
handoff does not guarantee operating-system scheduling or eliminate device latency.

## Playback

Each callback consumes at most 256 events before rendering its buffer. Events
start at a buffer boundary; sample-accurate timestamps are not supported yet.
The initial renderer plays a 100 ms decaying sine tone at the requested MIDI
pitch. This provides audible output for the event path until instrument samples
are available. It mixes 16 voices into stereo at 44.1 kHz and clamps output to
[-1, 1]. When all voice slots have been used, new hits replace voices in rotation.
Stopping the stream preserves pending events and voice state for a later restart.

## Testing

Run the C++ suite using the build instructions in the repository README. Queue
tests cover empty and full behavior, wraparound, capacity one, and ordered payload
transfer between two threads. Audio tests cover validation, overflow recovery,
stereo output, decay, and continuity across buffers without opening an audio
device.

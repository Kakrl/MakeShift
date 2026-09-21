# Audio Voice Allocation

This document describes the existing **native C++/PortAudio implementation**.
For planned browser playback and musical events, see the
[browser architecture](architecture.md). Native hit/queue semantics below do not
define the browser note-on/note-off or session-reset contract.

Issue: [#26](https://github.com/Kakrl/MakeShift/issues/26).

## Polyphony and Voice Stealing

The audio renderer allows up to 10 active voices. Each accepted hit starts a
voice when the callback consumes it. Expired voices are reused first. At the
limit, the new hit replaces the oldest active hit. Hits consumed in the same
callback retain their queue order, so the oldest queued hit is stolen first.
The remaining voices keep their phase and decay state.

## Configuring the Limit

```python
from backend.src.audio.audio_engine import AudioEngine

engine = AudioEngine(voice_limit=8)
```

The optional `voice_limit` defaults to 10 and must be between 1 and 10.
Invalid limits raise `ValueError` in Python or `std::invalid_argument` in C++.
Choose a lower limit when constructing the engine if clipping persists.
The renderer retains its output clamp; limiting voices alone does not guarantee
that their sum stays within the output range.

## Event Queue Integration

Submit notes through the [audio event queue](audio_events.md) using
`submit_hit(note, velocity)`. Each event represents a new hit, including repeated
hits of the same pitch. The current tones expire after 100 ms; there is no
held-key or note-off interface. Stopping the stream preserves queued events and
voice state, following the queue's restart behavior.

Only the rendering consumer changes voices. The fixed voice pool requires no
allocation, mutex, or waiting in the callback. C++ offline callers may use
`render` only while the stream is stopped and no other renderer is active.

## Testing

The offline audio tests compare rendered samples against reference mixes to
check the default limit, oldest-hit stealing within and across callbacks,
expired-slot reuse, repeated pitches, and lower limits. These tests do not
require an audio device.

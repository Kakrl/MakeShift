# Audio Voice Allocation

## Polyphony and Voice Stealing

The audio engine allows up to 10 active notes. When a new key press arrives
at the limit, it replaces the oldest active key press. Releasing a note frees
its voice immediately. A stolen note stays silent until it is released and
pressed again.

Repeated detections of a held key do not allocate another voice or change its
age. Releasing a stolen note does not stop the note that replaced it.
Stopping the stream clears active notes and held-key state.

## Python Interface

```python
from backend.src.audio.audio_engine import AudioEngine

engine = AudioEngine(voice_limit=10)
stolen_note = engine.note_on(60)  # MIDI note number, 0-127
active_notes = engine.active_notes()  # Oldest to newest
engine.note_off(60)
```

`note_on` returns the stolen MIDI note number, or `-1` if no voice was stolen.
`note_off` ignores valid notes that are not held. Invalid MIDI note numbers
raise `ValueError`.

The optional `voice_limit` must be between 1 and 10 and defaults to 10.
Choose a lower value when constructing the engine if audio clipping persists.

## Current Integration

Voice allocation is available through the C++ and Python interfaces. The
PortAudio callback currently outputs silence; waveform generation and mixing
must use the allocated voices when they are implemented. The note limit alone
does not guarantee that a future mix will avoid clipping.

## Testing

The voice allocation tests in `tests/test_audio.cpp` run without an audio
device. They cover the ten-note limit, oldest-note stealing, released slots,
repeated detections, stolen-note releases, lower limits, invalid input, and
clearing state when the stream stops.

# Pedal recording and replay follow-up

Tracked in [#222](https://github.com/Kakrl/MakeShift/issues/222), following #176
and PR #221; suggested owner Harry Deng. Live pedals are intentionally not serialized into MIDI
notes: key duration remains physical press duration.

Add a separate ordered, versioned control-event stream, MIDI CC export and
playback restoration. Specify pause/resume/seek/stop resets, seeking into retained
voices, event-format migration, overlapping note/control ordering and stale
sessions. Audio dispatch must remain independent of serialization. Verify that
exported pedal CCs and playback never extend physical note durations.

# Pedal recording and replay follow-up

Local follow-up proposal for #176, owner Harry Deng. Public issue creation is
pending user approval. Live pedals are intentionally not serialized into MIDI
notes: key duration remains physical press duration.

Add a separate ordered, versioned control-event stream, MIDI CC export and
playback restoration. Specify pause/resume/seek/stop resets, seeking into retained
voices, event-format migration, overlapping note/control ordering and stale
sessions. Audio dispatch must remain independent of serialization. Verify that
exported pedal CCs and playback never extend physical note durations.

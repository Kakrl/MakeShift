# Ordered pedal recording, export and replay (#222)

New takes optionally add a separately versioned `pedals` object alongside
unchanged physical `notes`. Version 1 contains `events` (effective full binary
state, recording-relative `timeMs`, unique nonnegative safe-integer `order`)
and `noteOrder` (parallel to sorted notes, with each physical onset/release's
`on`/`off` order). The recorder assigns one performance sequence, independent
of the live CV sequence. Boundaries sort by timestamp, then that order; equal
rounded MIDI ticks retain the pre-rounding order. Full state changes clear all
three pedals atomically in browser audio. Duplicated effective states add no event.
The UI sends audio first, drains earlier accepted note history, then records the
pedal transition synchronously. Serialization never sits on the audio path.

Pause closes physical notes and records pedals-off at the pause boundary;
paused time and control activity are excluded. Resume count-in requires fresh
presses. Stop and session release-all close physical presses and pedals without
lengthening notes. Existing note-only
recordings need no rewrite: absence of `pedals` means no controls, retaining
legacy release-before-onset tie ordering. The local storage envelope remains v1.
Explicit null/unsupported versions, duplicate/invalid orders, wrong note-order
length, nonbinary states, decreasing/negative/nonfinite control times are rejected. Sharing additionally
limits controls to 10,000 events and 30 minutes; local recordings retain their
existing storage-quota behavior. Snapshots copy only known fields;
extra imported fields cannot override transport type, version or session.

## MIDI

Notes keep their physical onset/off timestamps (128 PPQ, rounded absolute ticks).
Controls are CC64 sustain, CC66 sostenuto, CC67 soft; off=0, on=127. New pedal
takes use one melodic channel per press, from channels 1–9 and 11–16; channel 10
is excluded. This isolates repeated pitches for press-identity sostenuto. All
channels receive ordered effective pedal transitions and initial/terminal offs.
Channel reuse clears any previous envelope with CC120 and resets CC66 before
the new strike, so an already-down sostenuto does not capture it. Within a full
state update CC64 precedes CC66, then CC67. Browser snapshots are atomic, while
MIDI necessarily encodes these as successive zero-delta messages.

The export mirrors a ten-sounding-voice budget, silencing the oldest retained
voice with CC120 when needed. A stolen physical press reserves its channel until
its original note-off, preventing that release from killing a replacement.
More than fifteen simultaneous physical presses fails export explicitly rather
than corrupting identities. This exceeds the live ten-finger input range;
imported synthetic performances may reach it. Note-only exports keep their
legacy single-channel policy. External instruments must use the same piano
program on all melodic channels and support these CCs; receiver-specific soft
pedal timbre, envelopes and voice-stealing behavior require listening tests.

## Playback discontinuities and bounds

The timeline dispatches controls and physical edges directly through the existing
session-scoped BrowserAudio port (64 outstanding commands, reset-on-overflow).
It does not serialize MIDI, recreate contexts or wait for React. Invalidation
retires its timer generation; canceled initialization and stale callbacks cannot
restart playback. Pause, seek, stop, end and disposal send ordered release-all,
clearing every voice/capture/pedal without invalidating or gating the transport.
On transport failure, the owner resets the session as before.

If a timer fires after a missed strike's physical release, playback skips that
strike even when sustain is down. An already dispatched strike still receives
its note-off and can ring until the pedal lifts.

Resume/seek simulates history in memory. It restores final pedals, original soft
strike state and sostenuto membership for at most ten nonretired physical presses spanning the selected position.
The history model counts physical/retained voices and retires the oldest at ten;
it does not reconstruct already released sample envelopes or sample decay. Released sustain/sostenuto tails remain
silent across discontinuities: neither pedal restoration nor seek resurrects a
retired voice. Restored held notes rearticulate for their remaining duration;
they do not resume their previous sample offset/envelope. Controls are grouped
around captured versus uncaptured restored strikes, requiring at most 23 pedal
messages plus ten onsets, independent of seek distance. Late timer handling
continues skipping already-ended strikes; this is not sample-accurate scheduling.
Playback claims a new transport session after initialization, retiring live
performance and any other player through invalidation while retaining the
context and decoded bank. Reentrant live release cannot reset the new claim.

## Verification

See PR-01 through PR-06 in the verification inventory and the
[manual report](../tests/manual/2026-11-02_PR-05.md). Carl Xu confirmed expected
functionality on the production localhost build on 2026-11-02; individual
scenario results, device metadata and external MIDI-import evidence were not
provided. The [Frontend CI job](https://github.com/Kakrl/MakeShift/actions/runs/41550485293/job/125636554008)
passed for head 41a81e5, including 763 tests and Chromium smoke checks. Deterministic/reference DSP,
mocked transport and parsed MIDI bytes do not establish external instrument
compatibility, actual speaker output or physical latency. Database migration
`20261113000000_recording_pedals.sql` must precede API deployment.

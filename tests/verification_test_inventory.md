# Verification Test Inventory

Every verification test for MakeShift. Test Case IDs and Req. IDs match the
RVTM. Tests added since the RVTM are marked **Added** and numbered after the
RVTM tests for the same requirement. Update this table in the same PR that
adds, changes, or wires a test into CI (see `AGENTS.md`).

- **Automated tests** must run in CI. If they do not yet, "CI Integrated?" says
  "Not completed yet" and "Evidence Link" gives the target date once the team sets one.
- **Manual tests** list the date of their first scheduled run once set. Completed runs
  link to a report in `tests/manual/`.
- Defect IDs (D1, D2, ...) refer to the Known Defects table in
  [`README.md`](README.md).

## Requirement Coverage

| Req ID | Software Requirement (short) | Tests |
| :--- | :--- | :--- |
| 1.1 | Calibrate to the piano sheet position | 1.1.1, 1.1.2, 1.1.3, 1.1.4 |
| 1.2 | Change the number of octaves | 1.2.1, 1.2.2 |
| 1.3 | Change the starting note | 1.3.1 |
| 2.1 | Play notes for hand and key collisions | 2.1.1, 2.1.2 |
| 2.2 | Play different octaves with configurable volume | 2.2.1 to 2.2.12 |
| 2.3 | Low-latency live feedback | 2.3.1 to 2.3.5 |
| 2.4 | Volume scales with key press speed | 2.4.1, 2.4.2 |
| 3.1 | Clearly labeled, consistently positioned controls | 3.1.1, 3.1.2 |
| 3.2 | Visual feedback for key presses, calibration, and recording | 3.2.1, 3.2.2 |
| 3.3 | Minimal UI that keeps the piano visible | 3.3.1, 3.3.2 |
| 3.4 | Visually accessible | 3.4.1, 3.4.2, 3.4.3 |
| 4.1 | Start and stop recording from the UI | 4.1.1 to 4.1.7 |
| 4.2 | Export a MIDI file after recording | 4.2.1, 4.2.2, 4.2.3 |
| 5.1 | Runs entirely in the browser | 5.1.1 |
| 5.2 | HTTPS only | 5.2.1, 5.2.2, 5.2.3 |
| 5.3 | Loads quickly | 5.3.1 |
| 6.1 | Documentation page | 6.1.1, 6.1.2 |
| 6.2 | Guided calibration sequence | 6.2.1, 6.2.2 |
| 6.3 | MIDI recording tutorial | 6.3.1, 6.3.2, 6.3.3 |

## Inventory

| Test Case ID | Level (Unit / Integration / System) | Description | Req. ID | Test Owner | Tool | Automated? | CI Integrated? | Evidence Link |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| 1.1.1 | Integration | Check that calibration correctly identifies the piano sheet position (ArUco markers 0 to 3 and homography) in recorded webcam video | 1.1 | TBD | Selenium (Chrome fake camera) + recorded video | Yes | Not completed yet | Target date TBD |
| 1.1.2 | Integration | Check that each finger position during the hover phase of calibration is correctly identified | 1.1 | TBD | Selenium (Chrome fake camera) + recorded video | Yes | Not completed yet | Target date TBD |
| 1.1.3 | Integration | Check that each finger position during the place phase of calibration is correctly identified | 1.1 | TBD | Selenium (Chrome fake camera) + recorded video | Yes | Not completed yet | Target date TBD |
| 1.1.4 | Unit | **Added.** `computeHomography`, `projectPoint`, and `getWhiteKeyPolygons` map known paper corners to the expected key regions, and degenerate corners return `null` | 1.1 | TBD | Vitest | Yes | Not completed yet | Target date TBD |
| 1.2.1 | Integration | For every available octave count, check that every note plays the correct pitch | 1.2 | TBD | GoogleTest (render and FFT pitch check) | Yes | Not completed yet (octave setting is not wired to audio yet, see D6) | Target date TBD |
| 1.2.2 | System | Check that the system warns when the selected octave range does not fit the paper, and behaves as selected if the user overrides the warning | 1.2 | TBD | MakeShift + printed sheet | No | N/A (manual) | First run date TBD |
| 1.3.1 | Integration | For every starting note and octave count, check that all notes shift pitch correctly | 1.3 | TBD | GoogleTest (render and FFT pitch check) | Yes | Not completed yet (starting note is not wired to audio yet, see D6) | Target date TBD |
| 2.1.1 | Unit | Run collision detection on labeled input videos and count false positives and false negatives. The combined rate must be under 3% | 2.1 | TBD | Vitest + labeled video set | Yes | Not completed yet (collision detection is issue #34) | Target date TBD |
| 2.1.2 | Integration | Pipeline test: a detected key collision in the CV system produces a hit event that the audio system plays | 2.1 | TBD | GoogleTest / pytest | Yes | Not completed yet | Target date TBD |
| 2.2.1 | Integration | Use Selenium to change volume in the frontend and check that the setting reaches the audio system | 2.2 | TBD | Selenium | Yes | Not completed yet (no volume control yet) | Target date TBD |
| 2.2.2 | Unit | Check that the audio engine renders the correct pitch for notes in each octave, and that output amplitude matches the volume and velocity ratios | 2.2 | TBD | GoogleTest / CTest | Yes | Not completed yet (partly covered by 2.2.4 to 2.2.6) | Target date TBD |
| 2.2.3 | Integration | Check that audio from the audio system reaches the frontend and plays correctly | 2.2 | TBD | Selenium + audio loopback | Yes | Not completed yet | Target date TBD |
| 2.2.4 | Unit | **Added.** `AudioEventsTest.RejectsInvalidHitsWithoutFillingQueue`: out-of-range notes and velocities are rejected without using queue space | 2.2 | TBD | GoogleTest / CTest | Yes | Yes (`testing.yml`, runs on C++ changes) | [Tests workflow](https://github.com/Kakrl/MakeShift/actions/workflows/testing.yml) |
| 2.2.5 | Unit | **Added.** `AudioEventsTest.QueuedHitProducesBoundedStereoThenDecaysToSilence`: a hit renders clamped stereo audio that decays to silence | 2.2 | TBD | GoogleTest / CTest | Yes | Yes (`testing.yml`) | [Tests workflow](https://github.com/Kakrl/MakeShift/actions/workflows/testing.yml) |
| 2.2.6 | Unit | **Added.** `AudioEventsTest.VoiceStateContinuesAcrossCallbacks`: a note continues smoothly across audio buffers | 2.2 | TBD | GoogleTest / CTest | Yes | Yes (`testing.yml`) | [Tests workflow](https://github.com/Kakrl/MakeShift/actions/workflows/testing.yml) |
| 2.2.7 | Unit | **Added.** `AudioEngineTest.*`: PortAudio initializes, and the output stream starts, stops, and restarts | 2.2 | TBD | GoogleTest / CTest | Yes | Partial: stream tests skip on CI runners with no audio device (see D5) | [Tests workflow](https://github.com/Kakrl/MakeShift/actions/workflows/testing.yml) |
| 2.2.8 | Unit | **Added.** `AudioPolyphonyTest.DefaultLimitKeepsNewestTenHitsInQueueOrder`: with the default limit, the newest 10 hits play in queue order | 2.2 | TBD | GoogleTest / CTest | Yes | Yes (`testing.yml`) | [Tests workflow](https://github.com/Kakrl/MakeShift/actions/workflows/testing.yml) |
| 2.2.9 | Unit | **Added.** `AudioPolyphonyTest.StealsOldestAcrossCallbacksWithoutRestartingOtherVoices`: at the limit, the oldest voice is replaced and the other voices keep playing | 2.2 | TBD | GoogleTest / CTest | Yes | Yes (`testing.yml`) | [Tests workflow](https://github.com/Kakrl/MakeShift/actions/workflows/testing.yml) |
| 2.2.10 | Unit | **Added.** `AudioPolyphonyTest.ReusesExpiredVoicesBeforeStealing`: expired voices are reused before an active voice is replaced | 2.2 | TBD | GoogleTest / CTest | Yes | Yes (`testing.yml`) | [Tests workflow](https://github.com/Kakrl/MakeShift/actions/workflows/testing.yml) |
| 2.2.11 | Unit | **Added.** `AudioPolyphonyTest.RepeatedPitchIsANewHitAndSingleVoiceLimitWorks`: repeating a pitch starts a new hit, and a limit of 1 voice works | 2.2 | TBD | GoogleTest / CTest | Yes | Yes (`testing.yml`) | [Tests workflow](https://github.com/Kakrl/MakeShift/actions/workflows/testing.yml) |
| 2.2.12 | Unit | **Added.** `AudioPolyphonyTest.RejectsLimitsOutsideOneToTen`: voice limits outside 1 to 10 are rejected | 2.2 | TBD | GoogleTest / CTest | Yes | Yes (`testing.yml`) | [Tests workflow](https://github.com/Kakrl/MakeShift/actions/workflows/testing.yml) |
| 2.3.1 | System | Run recorded videos with expected outputs through the whole pipeline, measure the time from key press to sound, and compare the waveform to the expected sound (issue #30) | 2.3 | TBD | Custom latency harness | Yes (manual stopwatch fallback) | Not completed yet | Target date TBD |
| 2.3.2 | Unit | Measure the speed of each stage from key press to sound: frame capture, marker and hand detection, collision detection, hit queue, and audio render | 2.3 | TBD | Vitest bench + GoogleTest | Yes | Not completed yet | Target date TBD |
| 2.3.3 | Unit | **Added.** `SpscQueueTest.EmptyFullAndWraparoundPreserveOrder`: the lock-free hit queue rejects pushes when full and keeps FIFO order across wraparound | 2.3 | TBD | GoogleTest / CTest | Yes | Yes (`testing.yml`) | [Tests workflow](https://github.com/Kakrl/MakeShift/actions/workflows/testing.yml) |
| 2.3.4 | Unit | **Added.** `SpscQueueTest.CapacityOneCanBeReused`: the smallest queue is reusable | 2.3 | TBD | GoogleTest / CTest | Yes | Yes (`testing.yml`) | [Tests workflow](https://github.com/Kakrl/MakeShift/actions/workflows/testing.yml) |
| 2.3.5 | Unit | **Added.** `SpscQueueTest.ConcurrentProducerAndConsumerPreservePayloads`: payloads survive a real producer and consumer thread pair without locks | 2.3 | TBD | GoogleTest / CTest | Yes | Yes (`testing.yml`) | [Tests workflow](https://github.com/Kakrl/MakeShift/actions/workflows/testing.yml) |
| 2.4.1 | Integration | Check that the CV system sends finger speed to the audio system, and that volume scales on top of the user's volume setting | 2.4 | TBD | GoogleTest / Vitest | Yes | Not completed yet | Target date TBD |
| 2.4.2 | System | Play slow, normal, and fast presses and record the volume of each. Following the V&V plan, fast presses must be more than 5 dB louder than slow presses over 10 trials in a row | 2.4 | TBD | MakeShift + decibel meter app | No | N/A (manual) | First run date TBD |
| 3.1.1 | Unit | Check that the Calibration, Tutorial, Documentation, and Record controls are visible on first load without scrolling | 3.1 | TBD | Selenium | Yes | Not completed yet | Target date TBD |
| 3.1.2 | Unit | Check that controls stay in the same positions across every page and mode | 3.1 | TBD | Selenium | Yes | Not completed yet | Target date TBD |
| 3.2.1 | Integration | Check that a piano key changes color when a finger press is detected | 3.2 | TBD | Selenium (Chrome fake camera) | Yes | Not completed yet (overlay not rendered, see D1. Collision detection is issue #34) | Target date TBD |
| 3.2.2 | Unit | Check that the recording status indicator changes when recording starts, pauses, and stops | 3.2 | TBD | Selenium | Yes | Not completed yet | Target date TBD |
| 3.3.1 | System | Check that the piano keys and sheet stay fully visible during active play | 3.3 | TBD | MakeShift + screenshots | No | N/A (manual) | First run date TBD |
| 3.3.2 | Unit | Check that popups and controls do not overlap the keyboard area (bounding box check) | 3.3 | TBD | Selenium | Yes | Not completed yet | Target date TBD |
| 3.4.1 | Unit | Run Selenium tests for contrast and scaling: axe-core contrast rules on every page, plus layout at 200% zoom and at mobile, tablet, and desktop widths | 3.4 | TBD | Selenium + axe-core | Yes | Not completed yet | Target date TBD |
| 3.4.2 | System | WCAG 2.2 AA compliance review: keyboard-only navigation, focus order, screen reader labels, and live regions | 3.4 | TBD | Manual checklist + Lighthouse | No | N/A (manual) | First run date TBD |
| 3.4.3 | Unit | **Added.** WCAG contrast audit of every `--color-*` foreground and background pair: 4.5:1 for text, 3:1 for UI components | 3.4 | TBD | Node (`tests/check-contrast.mjs`) | Yes | Yes (`frontend-ci.yml`) | [Frontend CI](https://github.com/Kakrl/MakeShift/actions/workflows/frontend-ci.yml), `contrast-report` artifact |
| 4.1.1 | Unit | Send the MIDI system a random stream of key inputs mixed with start, pause, resume, and stop, then compare the expected and actual MIDI files | 4.1 | TBD | Vitest | Yes | Not completed yet (pause and resume are not in `midiUtils` yet. Vitest is not in CI, see D3) | Target date TBD |
| 4.1.2 | Unit | Check that the UI has a record button and shows when recording is active, paused, or stopped | 4.1 | TBD | Selenium | Yes | Not completed yet | Target date TBD |
| 4.1.3 | Unit | **Added.** `millisecondsToTicks` converts 500 ms at 120 BPM to 128 ticks | 4.1 | TBD | Vitest | Yes | Not completed yet (see D3) | Target date TBD |
| 4.1.4 | Unit | **Added.** `startRecording` sets the track tempo | 4.1 | TBD | Vitest | Yes | Not completed yet (see D3) | Target date TBD |
| 4.1.5 | Unit | **Added.** `noteOn` and `noteOff` add events with the correct pitch, velocity, and tick | 4.1 | TBD | Vitest | Yes | Not completed yet (see D3) | Target date TBD |
| 4.1.6 | Unit | **Added.** `stopRecording` closes every held pitch | 4.1 | TBD | Vitest | Yes | Not completed yet (see D3) | Target date TBD |
| 4.1.7 | Unit | **Added.** Simultaneous notes (chords) produce multiple note-on events | 4.1 | TBD | Vitest | Yes | Not completed yet (see D3) | Target date TBD |
| 4.2.1 | Integration | Check that MIDI files are saved and can be retrieved later, after a browser restart | 4.2 | TBD | Selenium | Yes | Not completed yet (persistence is not implemented yet) | Target date TBD |
| 4.2.2 | Unit | Check that the UI has working buttons to access, delete, and download MIDI files | 4.2 | TBD | Selenium | Yes | Not completed yet (export does not produce a file, see D2) | Target date TBD |
| 4.2.3 | Unit | **Added.** `downloadMidi` creates a `recording.mid` download | 4.2 | TBD | Vitest | Yes | Not completed yet (see D3) | Target date TBD |
| 5.1.1 | System | Check that the app runs without errors on a clean machine and a fresh browser profile, with no installs and no console errors | 5.1 | TBD | Fresh browser profile (Chrome, Firefox, Safari) | No | N/A (manual) | First run date TBD |
| 5.2.1 | System | Check that traffic uses HTTPS encryption (valid certificate, TLS 1.2 or later) | 5.2 | TBD | `curl` / SSL Labs | No | N/A (manual, needs a deployed site) | First run date TBD |
| 5.2.2 | System | Check that HTTP requests redirect to HTTPS | 5.2 | TBD | `curl -I` | Yes | Not completed yet (needs a deployed site) | Target date TBD |
| 5.2.3 | Integration | Check that every API call from the frontend uses `https://` or `wss://` | 5.2 | TBD | pytest / Selenium network log | Yes | Not completed yet (no network API yet) | Target date TBD |
| 5.3.1 | System | Check that initial load takes under 3 seconds on a standard broadband connection | 5.3 | TBD | Lighthouse CI | Yes | Not completed yet | Target date TBD |
| 6.1.1 | Unit | Check that the documentation page opens from the main navigation | 6.1 | TBD | Selenium | Yes | Not completed yet | Target date TBD |
| 6.1.2 | Unit | Check that the documentation page loads with no missing content, broken links, or broken layout | 6.1 | TBD | Selenium | Yes | Not completed yet | Target date TBD |
| 6.2.1 | Unit | Check that the calibration sequence opens from the main navigation | 6.2 | TBD | Selenium | Yes | Not completed yet | Target date TBD |
| 6.2.2 | System | Walk through calibration with a real webcam and printed sheet, including camera denial and retry, and check that each step guides the user (critical workflow, needs a manual report) | 6.2 | TBD | MakeShift + webcam | No | N/A (manual) | First run date TBD |
| 6.3.1 | System | Check that the tutorial explains how to start a MIDI recording | 6.3 | TBD | Manual content review | No | N/A (manual) | First run date TBD |
| 6.3.2 | System | Check that the tutorial explains how to stop a MIDI recording | 6.3 | TBD | Manual content review | No | N/A (manual) | First run date TBD |
| 6.3.3 | System | Check that the tutorial explains how to pause a MIDI recording | 6.3 | TBD | Manual content review | No | N/A (manual) | First run date TBD |

## Supporting CI Checks

These checks guard code quality. They do not verify a requirement on their own.

| Check | Workflow | Runs on |
| :--- | :--- | :--- |
| ESLint, `tsc --noEmit`, `next build` | `frontend-ci.yml` | Changes under `frontend/` |
| Ruff, mypy | `linting.yml` | Python changes |
| clang-format 17 | `linting.yml` | C++ changes under `backend/src` |
| `tests/test_dummy.py` | `testing.yml` | Placeholder so pytest collects a test. Replace it once Python code exists |

## Validation (not verification)

User acceptance testing follows the V&V plan: at least 4 diverse subjects, run
twice (after the first milestone and at the end of the semester). Record
results with the manual test template.

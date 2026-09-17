# MakeShift Testing

This directory holds MakeShift's verification tests and their documentation:
the test inventory, manual test reports, known defects, and root cause
analyses (RCAs).

## Where Test Documentation Lives

| Document | Location |
| :--- | :--- |
| Verification Test Inventory | [`verification_test_inventory.md`](verification_test_inventory.md) |
| Manual test template | [`manual/manual_test_template.md`](manual/manual_test_template.md) |
| Manual test reports | `manual/YYYY-MM-DD_<test-case-id>.md` |
| Defect report template | [`.github/ISSUE_TEMPLATE/defect_report.yml`](../.github/ISSUE_TEMPLATE/defect_report.yml) |
| Defect reports and RCAs | GitHub issues labeled `bug`. RCAs are posted as comments on the defect issue |
| Known defects and RCA log | This file |
| V&V plan, SDP, design | [`docs/`](../docs) |

**Why here.** `tests/` already holds the test code (GoogleTest suites, the
contrast audit, pytest), so the inventory and reports sit next to the tests
they describe. A PR that adds a test can update its inventory row in the same
directory. `docs/` stays for planning documents (SDP, V&V plan, design) that
change once per milestone, and `tests/` holds records that change every
sprint. The defect template has to live in `.github/ISSUE_TEMPLATE/` because
GitHub only reads templates from there. RCAs stay on the defect issue so the
analysis, fix PR, and discussion are in one place, and the log below indexes
them.

## Layout

```text
tests/
├── README.md                          # this file
├── verification_test_inventory.md     # every test, its requirement, owner, and CI status
├── manual/
│   └── manual_test_template.md        # copy for each manual test report
├── check-contrast.mjs                 # 3.4.3: WCAG contrast audit
├── test_audio.cpp                     # 2.2.7: PortAudio init and stream lifecycle
├── test_audio_events.cpp              # 2.2.4-2.2.6, 2.2.8-2.2.12, 2.3.3-2.3.5: rendering, polyphony, SPSC queue
└── test_dummy.py                      # placeholder so pytest collects a test
```

Vitest specs sit next to the module they test (for example,
`frontend/src/app/midi/midiUtils.test.ts`).

## Running the Tests

| Suite | Command | Needs |
| :--- | :--- | :--- |
| C++ (GoogleTest) | `cmake -B build -S backend && cmake --build build --config Release && ctest --test-dir build -C Release --output-on-failure` | CMake 3.15+, C++23 compiler, Python 3.12, `pip install -r requirements.txt` |
| Python | `python -m pytest --cov=backend --cov-report=term-missing` | `pip install -r requirements.txt` |
| Frontend unit (Vitest) | `cd frontend && npx vitest run` | `npm ci` in `frontend/` |
| Contrast audit | `cd frontend && npm run test:contrast` | Node 20. Writes `frontend/test-results/contrast-report.json` |

## Documentation Expectations by Severity

Not every defect needs the same amount of documentation. Use this table to
decide what to record.

| Severity | Examples | Documentation Required |
| :--- | :--- | :--- |
| High | A core workflow is broken or a High priority requirement fails: no sound on a detected key press, latency over 50 ms, calibration can't be completed, a merged feature is missing from the app, wrong notes play | Defect issue from the template, a row in Known Defects, and a full RCA comment on the issue after the fix, logged in the RCA table. The fix PR must name its regression test |
| Medium | A requirement is degraded or verification has a gap, but a workaround exists: tests not running in CI, a test that passes without checking anything, a resource leak on repeated actions, debug logging in a hot loop | Defect issue from the template and a row in Known Defects. RCA only if the team or mentor asks. The fix PR links the issue |
| Low | Cosmetic issues, dead code, stale docs, lint warnings, or edge cases with no user impact | A row in Known Defects or a line in the fixing PR description. No issue required |

Aim for 2 to 3 postmortem RCAs per build checkpoint unless the team mentor
asks for more.

## Known Defects

Found in the codebase audit for issue #79 (2026-09-16, upstream `main` at
`c4cc55b`). Status is updated when a fix merges. "Issue" is filled in once a
defect report is filed.

| ID | Severity | Area | Defect | Location | Issue | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| D1 | High | CV / UI | (Req 1.1, 3.2) The ArUco marker and virtual keyboard overlay from PR #63 never renders. `MarkerTrackingOverlay` is imported in `page.tsx` but no JSX uses it. The `<MarkerTrackingOverlay videoRef={videoRef} />` element was dropped while resolving conflicts in merge `1669079` ("Merge branch 'main' into feature/visual-keyboard"). ESLint flags it as an unused variable, but warnings don't fail CI | `frontend/src/app/page.tsx:10` | | Open |
| D2 | High | MIDI / UI | (Req 4.1, 4.2) Recording and export are UI-only. The home page recording state machine never calls `startRecording`, `noteOn`, `noteOff`, `stopRecording`, or `downloadMidi`, and the Export button only closes the dialog, so no MIDI file is produced | `frontend/src/app/page.tsx:150-190`, `:551-556` | | Open |
| D3 | Medium | CI | The Vitest suite (4.1.3-4.1.7, 4.2.3) is not run in CI. `frontend-ci.yml` runs lint, type check, contrast, and build, but not `vitest run`, so MIDI regressions merge undetected | `.github/workflows/frontend-ci.yml` | | Open |
| D4 | Medium | CI | The C++ test path filter `'CMakeLists.txt'` only matches a root-level file. A PR that only changes `backend/CMakeLists.txt` skips the C++ build and tests. It should be `'**/CMakeLists.txt'` | `.github/workflows/testing.yml:29` | | Open |
| D5 | Medium | Tests | `AudioEngineTest.StreamStartsAndStops` and `MultipleStartStopCycles` `return` early when there is no audio device, so on CI they report PASS without testing anything. Use `GTEST_SKIP()` so the skip shows in results | `tests/test_audio.cpp:24-27`, `:35-38` | | Open |
| D6 | Medium | Calibration | (Req 1.1, 1.2, 1.3, 6.2) Calibration doesn't validate or persist a real result. Only an `isCalibrated` boolean is stored (issue #19, closed, asked for a versioned calibration object). Step 3 paper rejection only fires on the `i` key (prototype trigger), step 5 succeeds when a countdown ends, and the flag is deleted on every page unload | `frontend/src/app/calibration/page.tsx:184-190`, `:261`, `:280`; `frontend/src/app/page.tsx:97-104` | | Open |
| D7 | Medium | CV / performance | Debug `console.log` calls run in the marker detection `requestAnimationFrame` loop (about 60 per second) and on every detection update. That adds main-thread work that counts against requirement 2.3 (latency) once D1 is fixed | `frontend/src/app/MarkerTrackingOverlay.tsx:49,95,102,111,121`; `frontend/src/cv/markerDetector.ts:103,105,119` | | Open |
| D8 | Medium | Audio | Calling `AudioEngine::startStream()` twice overwrites `stream` without closing it, which leaks the first PortAudio stream. `Pa_GetDeviceInfo` is dereferenced without a null check | `backend/src/audio/AudioEngine.cpp:89-119` | | Open |
| D9 | Medium | Audio / Python | Importing `backend.src.audio` builds an `AudioEngine` and calls `Pa_Initialize()` as a side effect. Any import (including from pytest) touches audio hardware and fails if the extension is not built. The example in `docs/audio_events.md` creates a second engine | `backend/src/audio/__init__.py:3-5` | | Open |
| D10 | Low | CV | `HandTrackingOverlay` loads MediaPipe WASM from `@latest`, the version mismatch that #12 fixed in `useHandLandmarker`. The component isn't used right now | `frontend/src/app/cv/HandTrackingOverlay.tsx:7-8` | | Open |
| D11 | Low | MIDI | `stopRecording` leaves `track` set, so `noteOn` and `noteOff` calls after stopping are still recorded | `frontend/src/app/midi/midiUtils.ts:66-82` | | Open |
| D12 | Low | Backend | `backend/src/MIDI/noteMap.ts` is a TypeScript file inside the Python backend package and nothing imports it | `backend/src/MIDI/noteMap.ts` | | Open |
| D13 | Low | Tests | The contrast audit only checks `--color-*` token pairs. Hardcoded canvas colors drawn over live video (`#00ff88`, `#ffd60a`, `#ff3b30`) aren't checked | `frontend/src/app/MarkerTrackingOverlay.tsx:136-192`, `frontend/src/app/cv/handLandmarkDrawing.ts:33-34` | | Open |
| D14 | Low | Tests | The only Python test is `test_dummy.py`, so the pytest coverage report in CI measures nothing | `tests/test_dummy.py` | | Open |
| D15 | Low | Docs | The root README said Python 3.10+ for the C++ build, but `backend/CMakeLists.txt` requires Python 3.12 | `README.md` | | Fixed in #79 PR |

## Root Cause Analysis Log

Every completed RCA is listed here. The full analysis lives in a comment on
the linked issue.

| Defect | Issue | Severity | Root Cause (one line) | Fix PR | Regression Test | RCA Date | Author |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| | | | | | | | |

### RCA Comment Template

Post this as a comment on the defect issue after the fix merges:

```markdown
## Root Cause Analysis

**Root cause:** What actually caused the defect (the mechanism, not the symptom).

**How was the defect discovered?**

**Which test exposed the issue?** Test Case ID or report. If no test caught it, say so and why.

**How was the fix verified?** Tests run, manual steps, and evidence links (CI run, report).

**What regression test prevents recurrence?** Test Case ID, file, and whether it runs in CI.

**Where else could this issue still occur?** Other files, patterns, or processes with the same weakness.

**Process change (postmortem):** What we change so this class of defect is caught earlier.
```

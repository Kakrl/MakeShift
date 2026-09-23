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
├── README.md
├── verification_test_inventory.md
├── audio/
│   ├── test_audio.cpp                # PortAudio lifecycle
│   └── test_audio_events.cpp         # rendering, polyphony, SPSC queue
├── automation/
│   └── rca.test.cjs                  # repository-process regression tests
├── frontend/
│   ├── browserAudio.test.ts      # production DSP offline rendering
│   ├── browserAudioLifecycle.test.ts # browser owner mocks
│   ├── browserAudio.browser.mjs  # production browser graph check
│   ├── noteEvents.test.ts            # shared event validation, sessions and clocks
│   ├── midiUtils.test.ts             # MIDI unit tests
│   └── check-contrast.mjs            # theme token contrast audit
├── python/
│   └── test_dummy.py                 # existing placeholder, no product coverage
└── manual/
    └── manual_test_template.md
```

Add future tests, helpers, and fixtures to the matching suite directory.
Frontend tests import application modules from `../../frontend/src/`.
`frontend/vitest.config.mts` selects `tests/frontend/` and resolves frontend
package dependencies. The frontend TypeScript and ESLint commands also include
that directory. Keep frontend dependencies and tool configuration in `frontend/`,
C++ build definitions in `backend/CMakeLists.txt`, and CI workflows in `.github/`.
Python's default recursive discovery finds `tests/python/` without extra config.
No test implementation requires an exception to this layout.

## Running the Tests

| Suite | Command | Needs |
| :--- | :--- | :--- |
| C++ (GoogleTest) | `cmake -B build -S backend && cmake --build build --config Release && ctest --test-dir build -C Release --output-on-failure` | CMake 3.15+, C++23 compiler, Python 3.12, `pip install -r requirements.txt` |
| Python | `python -m pytest --cov=backend --cov-report=term-missing` | `pip install -r requirements.txt` |
| Frontend unit (Vitest) | `cd frontend && npx vitest run` | `npm ci` in `frontend/` |
| Contrast audit | `cd frontend && npm run test:contrast` | Node 20. Writes `frontend/test-results/contrast-report.json` |
| RCA automation | `node --test tests/automation/rca.test.cjs` | Node 22; no package installation or GitHub credentials needed |

## Shared-event verification (issue #86)

Local Windows verification on 2026-09-22, branch
`feature/86-note-events`, stacked on #35 at `12d93f4`, with Node 22.20.0
and Vitest 4.1.11. This is local execution evidence, not an Actions result.

- All 98 Vitest tests passed: 43 shared event/clock/MessagePort cases,
  11 browser-owner/adapter lifecycle cases, 37 offline DSP and seven MIDI.
- Shared tests cover validation, immutable schema copies, ordered sequences,
  duplicates and gaps, same-pitch press identities, release matching,
  stop/reset/interruption/release-all, stale-session rejection, bounded
  recovery, audio-first deferred observers, and invalid/delayed clock inputs.
- The adapter tests use production BrowserAudio with mocked device objects.
  Suspension, overload, processor failure and close retire shared presses,
  deliver release-all to observers, and reject stale input after recovery.
- TypeScript, lint (zero errors; seven existing home-page warnings), all 18
  contrast pairs, and production build passed.
- Extra production Edge 153.0.4234.48 / Playwright 1.62.1 smoke check:
  the unchanged runner FAILED its final immediate navigation-cleanup
  assertion (context still running after the URL changed). A local diagnostic
  copy waiting for the unmount cleanup passed: asset HTTP 200, soft/loud RMS
  0.0140931503 / 0.0426029731, chord output, stop silence, suspension recovery
  and navigation closure. The diagnostic is not a passing result for the
  unchanged test. See D16 below; the separate issue could not be filed because
  the connector lacks permission and credential fallback was blocked.
- Vitest and the browser smoke runner remain outside CI (D3). No physical
  latency, camera accuracy, hardware listening, full MIDI recording lifecycle,
  live detector wiring or deployed cross-browser result is claimed.

## Browser audio verification (issue #35)

Local Windows verification on 2026-09-22, branch
`feature/35-browser-audio`, based on `30706c4`, with Node 22.20.0 and
Vitest 4.1.11. This is local evidence, not a CI result.

- Offline DSP: 37 tests passed, covering eleven pitches at 44.1/48/96 kHz,
  linear velocity, attack/release, ten voices, deterministic stealing, slot
  reuse, phase continuity, validation and session resets.
- Browser ownership: six tests passed for user activation, concurrent
  initialization, module failure/retry, suspended startup, interruption,
  bounded backlog, processor failure and close during initialization.
- Existing MIDI suite: seven tests passed.
- Production Edge 153.0.4234.48, Playwright 1.62.1, headless:
  `npm run test:audio-browser` passed. Soft/loud A4 RMS was
  0.014200991 / 0.042602973 (3:1). The worklet asset returned HTTP 200;
  ten-note graph output, stop silence, suspension/restart and navigation
  cleanup passed. Graph samples do not establish hardware audibility.
- Lint: zero errors, seven existing home-page unused-variable warnings.
  TypeScript, 18 contrast pairs, and production build passed.
- User-reported speaker listening passed for soft/loud A4, ten-note chord
  and Stop sound; see [manual report](manual/2026-09-22_2.2.3.md).
  Output device and browser details were not supplied. Physical latency,
  full shared #86 event integration and deployed/cross-browser compatibility
  remain pending. No native files changed.

To repeat the production smoke test: install frontend dependencies, run
`npm run build` and `npm start -- --hostname 127.0.0.1`; in another terminal
run `npm run test:audio-browser`. It uses an installed Edge by default.
See [browser audio](../docs/browser_audio.md) for environment overrides.
The tests remain outside CI (D3); no Actions execution is claimed.

## Test relocation verification (issue #83)

Local Windows verification on 2026-09-17, against baseline
`e34d73624c4d776cb2dd7c4e23a5f1d7d37ce33a`. Counts below are runner results,
not claims of CI execution. Node 22.20.0, Vitest 4.1.11, Python 3.12.10,
pytest 8.2.2, and the Release CMake build were used.

| Suite | Before relocation | After relocation | Source |
| :--- | :--- | :--- | :--- |
| MIDI | 7 passed | 7 passed | [MIDI unit tests](frontend/midiUtils.test.ts) |
| Audio and queue | 14 reported passed | 14 reported passed | [Lifecycle](audio/test_audio.cpp), [events and queue](audio/test_audio_events.cpp) |
| RCA | 18 passed | 18 passed | [RCA tests](automation/rca.test.cjs) |
| Python placeholder | 1 passed | 1 passed | [Placeholder](python/test_dummy.py) |
| Contrast audit | 18 pairs passed | 18 pairs passed | [Audit](frontend/check-contrast.mjs) |

Assertions and test cases are unchanged; only location-dependent imports changed.
The existing audio tests can report a pass without exercising stream operations
when no audio device is available (D5). The Python placeholder verifies no
product behavior (D14). Neither limitation is fixed by relocating files.
Frontend type checking and production build, Ruff, and mypy passed locally.
ESLint passed with the two existing application warnings. clang-format 17 was
not available locally; the C++ files were moved without content changes.
The frontend CI path filters now include `tests/frontend/**`; Vitest remains a
local suite pending the separate CI integration work tracked as D3.

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

The defect selected for the assignment requires an RCA regardless of severity.
Select **Assignment example (required)** in its issue form. On older issues, or
when the team requests an additional RCA, apply the `rca-required` issue label
(create that label if it does not exist). High severity is read from the issue
form's **Severity** field. Defect targets must retain the `bug` label.

## High Severity Bug Workflow

Follow these steps from discovery through publication of the RCA. Automatic
checks and comments are available once the RCA workflow is merged into `main`
(see [initial rollout and recovery](#automated-checks-publication-and-recovery)).
The assignment example follows the same RCA steps even at a lower severity.

1. **Report the defect.** Create a GitHub issue with the
   [defect report template](../.github/ISSUE_TEMPLATE/defect_report.yml), select
   **High** severity, and keep the `bug` label. Include the affected requirement,
   reproduction steps, expected and actual results, environment, and evidence.
   Identify the test that exposed it, or explain if it was found another way.
2. **Track it here.** Add or update its row in [Known Defects](#known-defects),
   linking the issue and marking it Open. Reuse an existing row for the same bug.
3. **Fix and verify.** Create a `fix/<issue>-short-description` branch using the
   [repository workflow](../docs/dev_process.md). Reproduce the failure, make
   the fix, add or identify a regression test that catches it, and run the checks
   for the affected areas. Record actual results and evidence links.
4. **Open the fix PR and write the RCA.** Target upstream `main` and include
   `Closes #N`. Copy the [RCA PR template](#rca-pr-template) into the description,
   set its explicit issue number, and complete all seven sections. Use a separate
   block for each defect. Open as a draft if you still need its PR number to
   complete the documentation.
5. **Complete the records in the same PR.** Fill all eight cells of the
   [RCA log](#root-cause-analysis-log), including the defect issue URL, fix PR
   URL, and regression test. Update the
   [verification inventory](verification_test_inventory.md) for any new or
   changed tests. If manual testing validates a critical workflow or exposes
   the defect, copy the [manual template](manual/manual_test_template.md) to
   `manual/YYYY-MM-DD_<test-case-id>.md`, record the results, and link the report
   in the inventory. Prepare the Known Defects status change so it records the
   fix when the PR merges.
6. **Review before merging.** Obtain at least one reviewer approval and passing
   required checks. The `RCA requirements` check validates the RCA fields,
   evidence link, target issues, and log rows. The reviewer verifies that the
   analysis, test results, and regression coverage are accurate; the check does
   not establish those facts. Request another review of substantive RCA edits.
7. **Merge and confirm publication.** Automation posts the RCA to each explicit
   defect issue with the fix PR and merged commit links. You do not need to copy
   the comment manually. Confirm that `Publish RCA` succeeded and the comment
   is present. For a failure, follow the
   [recovery steps](#automated-checks-publication-and-recovery); rerunning the
   job reuses existing bot comments instead of creating duplicates.

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
| D5 | Medium | Tests | `AudioEngineTest.StreamStartsAndStops` and `MultipleStartStopCycles` `return` early when there is no audio device, so on CI they report PASS without testing anything. Use `GTEST_SKIP()` so the skip shows in results | `tests/audio/test_audio.cpp:24-27`, `:35-38` | | Open |
| D6 | Medium | Calibration | (Req 1.1, 1.2, 1.3, 6.2) Calibration doesn't validate or persist a real result. Only an `isCalibrated` boolean is stored (issue #19, closed, asked for a versioned calibration object). Step 3 paper rejection only fires on the `i` key (prototype trigger), step 5 succeeds when a countdown ends, and the flag is deleted on every page unload | `frontend/src/app/calibration/page.tsx:184-190`, `:261`, `:280`; `frontend/src/app/page.tsx:97-104` | | Open |
| D7 | Medium | CV / performance | Debug `console.log` calls run in the marker detection `requestAnimationFrame` loop (about 60 per second) and on every detection update. That adds main-thread work that counts against requirement 2.3 (latency) once D1 is fixed | `frontend/src/app/MarkerTrackingOverlay.tsx:49,95,102,111,121`; `frontend/src/cv/markerDetector.ts:103,105,119` | | Open |
| D8 | Medium | Audio | Calling `AudioEngine::startStream()` twice overwrites `stream` without closing it, which leaks the first PortAudio stream. `Pa_GetDeviceInfo` is dereferenced without a null check | `backend/src/audio/AudioEngine.cpp:89-119` | | Open |
| D9 | Medium | Audio / Python | Importing `backend.src.audio` builds an `AudioEngine` and calls `Pa_Initialize()` as a side effect. Any import (including from pytest) touches audio hardware and fails if the extension is not built. The example in `docs/audio_events.md` creates a second engine | `backend/src/audio/__init__.py:3-5` | | Open |
| D10 | Low | CV | `HandTrackingOverlay` loads MediaPipe WASM from `@latest`, the version mismatch that #12 fixed in `useHandLandmarker`. The component isn't used right now | `frontend/src/app/cv/HandTrackingOverlay.tsx:7-8` | | Open |
| D11 | Low | MIDI | `stopRecording` leaves `track` set, so `noteOn` and `noteOff` calls after stopping are still recorded | `frontend/src/app/midi/midiUtils.ts:66-82` | | Open |
| D12 | Low | Backend | `backend/src/MIDI/noteMap.ts` is a TypeScript file inside the Python backend package and nothing imports it | `backend/src/MIDI/noteMap.ts` | | Open |
| D13 | Low | Tests | The contrast audit only checks `--color-*` token pairs. Hardcoded canvas colors drawn over live video (`#00ff88`, `#ffd60a`, `#ff3b30`) aren't checked | `frontend/src/app/MarkerTrackingOverlay.tsx:136-192`, `frontend/src/app/cv/handLandmarkDrawing.ts:33-34` | | Open |
| D14 | Low | Tests | The only Python test is `test_dummy.py`, so the pytest coverage report in CI measures nothing | `tests/python/test_dummy.py` | | Open |
| D15 | Low | Docs | The root README said Python 3.10+ for the C++ build, but `backend/CMakeLists.txt` requires Python 3.12 | `README.md` | | Fixed in #79 PR |
| D16 | Low | Tests | Browser audio smoke runner checks context closure immediately after URL navigation, before React's unmount effect may run. The unchanged runner failed; a bounded cleanup-wait diagnostic passed during #86 verification | `tests/frontend/browserAudio.browser.mjs:95` | Filing blocked (connector permission / approval review) | Open; separate fix needed |

## Root Cause Analysis Log

Every completed RCA is listed here. Add its row in the fix PR so it receives
review with the fix. The full analysis is automatically posted as an issue
comment after merge. Link the issue before the comment exists.

| Defect | Issue | Severity | Root Cause (one line) | Fix PR | Regression Test | RCA Date | Author |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| MIDI note-off events missing required duration information | [#91](https://github.com/Kakrl/MakeShift/issues/91) | Medium | Custom MidiWriterJS TypeScript declarations hid the library's required note event fields, allowing invalid note-off event construction. | [#92](https://github.com/Kakrl/MakeShift/pull/92) | `tests/frontend/midiUtils.test.ts` — `creates a note event using the note start time and duration` (not currently run in CI) | 2026-09-20 | harrydeng104 |
| | | | | | | | |

### RCA PR Template

Copy this block into the fix PR description, replacing `123` with the target
defect issue number. Repeat the block for each defect and add `Closes #123`
outside the block for each target. Only same-repository bug issues that GitHub
recognizes as closed by the PR are eligible. Ordinary PRs need no RCA block.
Keep the exact headings and replace every placeholder with actual analysis.

```markdown
<!-- rca:start issue=123 -->
### Root cause
<The mechanism that caused the defect, not just its symptom.>

### Discovery
<How the defect was discovered.>

### Exposing test
<Test ID or report. If no test caught it, explain why.>

### Fix verification
<Actual test results and an HTTPS link to the CI run, report, or other evidence.>

### Regression test
<Test ID, file, and whether it runs in CI.>

### Remaining risk
<Where else the issue could occur, what was checked, and what remains.>

### Process improvement
<What changes to catch this earlier, or explain why no change is needed.>
<!-- rca:end -->
```

Complete all eight cells of the log row above; do not leave `TBD` or placeholder
values. Use Markdown links with full URLs in the Issue and Fix PR cells:
`[#123](https://github.com/Kakrl/MakeShift/issues/123)` and
`[#124](https://github.com/Kakrl/MakeShift/pull/124)`. Open a draft PR to get
its number, then commit the log row before requesting review. Avoid table pipes
inside cells. The regression test must be identified, not invented.

### Automated checks, publication, and recovery

The read-only `RCA requirements` job runs on PR opening, description edits,
new commits, reopening, and readiness for review. It requires an RCA for every
closing High severity or explicitly RCA-required issue. Changing issue fields
does not itself trigger a PR run; rerun the check or edit the PR description
after changing severity or assignment selection. Reviewers must ensure all
fixed defects are linked and verify the evidence before merge.

After merge, `Publish RCA` validates again using the merged README and posts
one comment per explicit RCA target. It includes the fix PR and merged commit.
A stable PR/issue marker identifies its own bot comment, so reruns update that
comment instead of duplicating it. All targets validate before posting begins;
an API failure may still leave some comments posted and others pending.

If publication fails:

1. Open **Actions → RCA**, select the run for the merged PR, and inspect the
   `Publish RCA` failure. API/permission failures appear as failed jobs.
2. Restore the required repository permissions or resolve the transient API
   problem, then choose **Re-run failed jobs** (or **Re-run all jobs**).
   Previously posted comments are reused, including after partial failure.
3. A rerun uses the original merge event's PR description and original merged
   README. Editing a merged PR does not repair that snapshot. If the RCA text
   or log was incomplete, submit a reviewed follow-up PR with corrected RCA
   blocks, closing references, and log rows pointing to the follow-up PR.
   That PR publishes its own attributable correction; do not fabricate evidence
   to make the old run pass.

The workflow executes scripts only from the trusted base commit. PR descriptions
and README files are fetched as data, never executed. Only the publication job
has `issues: write`; regression tests run separately with a read-only token.
There is no AI-generated analysis or automatic assertion that tests passed.

**Initial rollout:** the trusted workflow becomes active after this change
lands on `main`; its own regression suite runs in the introducing PR. Once the
`RCA requirements` check appears, a maintainer should make it required in the
branch protection/ruleset alongside existing checks. The workflow alone does
not change repository merge settings. A missing required check on the first
rollout is not evidence that an RCA was validated.

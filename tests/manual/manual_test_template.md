# Manual Test Report: <Test Case ID> <Short Title>

<!--
Copy this file to tests/manual/YYYY-MM-DD_<test-case-id>.md and fill every
section. Write a report when a manual test covers a critical user workflow or
exposes a critical defect (see tests/README.md). Delete these comments.
-->

## Summary

| Field | Value |
| :--- | :--- |
| Test Case ID | e.g. 6.2.2 (must match `tests/verification_test_inventory.md`) |
| Requirement(s) | e.g. 6.2 |
| Level | Unit / Integration / System |
| Tester | Name |
| Date run | YYYY-MM-DD |
| Commit / branch tested | `git rev-parse --short HEAD` and branch name |
| Overall result | PASS / FAIL / BLOCKED |
| Linked defects | #issue numbers, or "None" |

## Objective

One or two sentences on what this test proves and why it matters.

## Environment

| Item | Value |
| :--- | :--- |
| OS and version | |
| Browser and version | |
| Hardware | CPU, RAM, laptop or desktop model |
| Camera | Model, resolution, frame rate |
| Audio output | Speakers or headphones, model |
| Lighting | e.g. overhead fluorescent, desk lamp, daylight |
| Test setup | e.g. printed piano sheet (1 octave), paper position, camera angle |
| Build | `npm run dev` or production build, plus backend build details |

## Preconditions

- State the system must be in before step 1 (e.g. site data cleared, camera
  permission not yet granted, printed sheet on the desk).

## Test Data

Inputs used, such as the song played, notes pressed, tempo, and image or video
files. Link stored files if applicable.

## Steps and Results

Record the actual result for every step, even when it matches. Mark the first
failing step and keep going if later steps are still meaningful.

| # | Action | Expected Result | Actual Result | Pass/Fail | Evidence |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |

## Measurements (if applicable)

For quantitative tests (latency, dB difference, accuracy, MIDI deviation),
record each trial, the pass threshold, and the computed result.

| Trial | Measurement | Threshold | Result |
| :--- | :--- | :--- | :--- |
| 1 | | | |

## Evidence

Screenshots, screen recordings, audio clips, exported files, or console logs.
Put files under `tests/manual/evidence/<report-name>/` or link to shared
storage.

## Deviations and Observations

Anything that did not follow the script, flaky behavior, usability problems,
or ideas for follow-up tests.

## Defects Raised

| Issue | Severity | Title |
| :--- | :--- | :--- |
| #NN | High / Medium / Low | |

## Sign-off

| Role | Name | Date |
| :--- | :--- | :--- |
| Tester | | |
| Reviewer (another team member) | | |

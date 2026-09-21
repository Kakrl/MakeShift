## Browser architecture update (issue #85)

The implementation direction is a browser-local virtual piano: camera capture,
CV worker processing, calibrated contact detection, shared note events,
AudioWorklet synthesis, MIDI recording/export, and feedback run on the user's
device. Vercel hosts the application/assets; no per-note network or WebRTC
transport is required.

The initial browser synthesizer uses JavaScript in an AudioWorklet. The existing
C++/PortAudio implementation remains a native reference. WebAssembly is optional
future work justified by measurements or DSP reuse, not a prerequisite.
Calibration validity, session cleanup, pitch correctness and measured
latency/accuracy take priority over cosmetic features.

See [architecture and delivery boundaries](architecture.md) and the
[browser RVTM addendum](rvtm_browser_addendum.md). The addendum records this
runtime change while preserving requirement IDs, the under-50 ms physical
latency target, and the under-3% detection-error target. These are verification
goals, not achieved performance. Existing requirements outside this transition,
including recording persistence, are not silently removed.

Implementation belongs to #28, #34, #35, #37, #86–#89 and related issues listed
in the architecture. #85 changes documentation only. External SDP/V&V links
below remain historical planning sources; this update does not edit them.

**Previous SDP Work**

[Initial SDP](https://docs.google.com/document/d/1dI5X3cngPTwBOdPjmCn8FGk9viVCrHLxQcX2h_NOIWU/edit?usp=sharing)

Updates:

| Feedback | Source | Summary of Change Made |
| :---- | :---- | :---- |
| The answer is only stated and not explained for “In Scope.” | Instructor | Added explanations. |
| The answer is only stated and not explained for “Under Eval.” | Instructor | Added explanations. |
| The answer is only stated and not explained for “Out of Scope.” | Instructor | Added explanations. |
| FR-3, rate requirement should be in the statement rather than “constantly.” | Instructor | Added image rate specification to the statement. |
| FR-8, no defined specific number of levels. | Instructor | Added specific dynamics to statement. |
| FR-9, the scope section lists “Three Octaves” as in-scope and “Full-size Piano” as under eval, but the Should-Have requirements include both “88 keys shown at once” and “Ability to change octave” (FR-9). Those two things are pulling in opposite directions. | Instructor | Moved the Octave Change feature to “in scope” and changed the priority of the functional requirement to must have. |
| I think directly addressing how the system would account for performance under different lighting conditions, camera angles, and device quality should be considered in scope. | Peer | Added their requirement to the functional requirements list, as well as a description in the “Scope” section. |
| Move Volume Algorithm/Volume Detection FR to Must Have. | Peer | Did what was suggested. |
| Add 5-finger key tracking to the in-scope section, as well as make a functional requirement for it. | Peer | Added it to the “Scope” section, as well as their functional requirement. |
| Remove FR-7: Support for Second Camera, as it is no longer in scope. | Teammate | The requirement was removed, and the feature was moved to the “out of scope” section. |
| Move MIDI Output to in scope. | Teammate | Moved to match the must-have priority for the respective functional requirement. |

[Final SDP](https://docs.google.com/document/d/1aY0_BR4jqOWXV6079ZuKNs0ZJ6xCylFTEWVt4BNLOMY/edit?usp=sharing)

**Development Methodology**

Scrum methodology is the most applicable to MakeShift. It embodies agility and testing, both of which are requirements for this project. Having the ability to step back and review current progress is very valuable, as it allows the ability to adapt and adjust next steps as needed. Integration testing will happen right before every sprint ends, and unit testing will happen throughout.

**Verification and Validation Plan**

[Verification and Validation Plan](https://docs.google.com/document/d/1ZRtmtfzFmI6ludDnvU06PjLBeKnEBjfGRIxXPKr8sT0/edit?usp=sharing)

**Gantt Chart**

[Gantt Chart](https://drive.google.com/file/d/1R86NexxWXXj2oYU1Q2-krOZNudny6dF3/view?usp=sharing)

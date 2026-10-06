# frontend

MakeShift Web Client built with Next.js

---

## Getting started

Make sure you have [Node.js](https://nodejs.org/) installed (v18 or later). Then, from the `frontend/` directory:

```bash
npm install   # downloads all the dependencies listed in package.json
npm run dev   # starts the local dev server at http://localhost:3000
```

---

## Tempo and metronome preferences

The home page remembers tempo and the metronome toggle between visits using
the shared versioned browser storage module (`makeshift:playback-settings:v1`).
The existing tempo range is 20–300 BPM. Missing or invalid settings restore
120 BPM and metronome on; out-of-range saved BPM falls back to defaults,
while user input is clamped to the range. If browser storage is blocked or
full, the controls still work for the current visit. Restoring preferences
does not start audio or recording.

## CV visual debugging

Visual debugging defaults to off. Set `SHOW_VISUAL_DEBUG` to `true` in
`src/app/CVOverlayCoordinator.tsx` to enable the finger panel, shadow previews,
sampling guides, knuckle boundaries, marker diagnostics, and hand landmarks/FPS.
Set it back to `false` to hide diagnostics and skip preview masks, contour
outlines, debug drawing, and per-frame debug state updates. Contact detection,
note dispatch, and pressed-key highlighting continue with debugging off.

The live sequence starts at `pipeline.processFrame(...)` in
`src/app/MarkerTrackingOverlay.tsx`. Follow `src/cv/liveContactPipeline.ts` to
read key overlap, knuckle eligibility, and the asynchronous shadow check in
order. That controller owns the worker, histories, stale-result checks, and
release timer; the overlay handles note dispatch and drawing. Individual checks
live in `src/cv/contactPipeline.ts`. The weighted `contactScore.ts` experiment
does not control live notes.

To isolate a technique, edit `CONTACT_TECHNIQUES` near the top of
`src/cv/liveContactPipeline.ts`, then reload the page:

```ts
export const CONTACT_TECHNIQUES: Readonly<ContactTechniques> = {
  knuckles: true,
  shadows: true,
};
```

| Knuckles | Shadows | Contact decision |
| --- | --- | --- |
| `true` | `true` | Key overlap, calibrated knuckle eligibility, fresh shadow confirmation (default) |
| `false` | `true` | Key overlap and fresh shadow confirmation; no knuckle calibration needed |
| `true` | `false` | Key overlap and calibrated knuckle eligibility; no shadow worker or pixel capture |
| `false` | `false` | Key-overlap-only debugging; no knuckle calibration or shadow processing |

Knuckle-only mode releases when eligibility is lost. Overlap-only mode releases
when key overlap is lost. Both release when landmark frames are over 150 ms old.
`SHOW_VISUAL_DEBUG` controls display independently; enable it
to see technique status. These switches are development settings, not UI controls.

Virtual keyboard highlights follow detected contact even before recording or
while paused. Audio/MIDI note dispatch still requires recording to be active.

## Scripts

These are commands you'll run regularly. They're defined in `package.json` under `"scripts"`.

| Command              | What it does                                                                 |
| -------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`        | Starts a local dev server with hot-reload. Use this while developing.        |
| `npm run build`      | Creates a production-ready build. Run this to check the app builds cleanly.  |
| `npm run lint`       | Checks your code for style and quality issues using ESLint (see below).      |
| `npm run test:contrast` | Checks WCAG text and UI color contrast and writes JSON evidence.          |
| `npx vitest run`     | Runs `tests/frontend/` Vitest unit tests (MIDI utils). Not yet run in CI.                  |
| `npx tsc --noEmit`   | Checks your TypeScript types without producing any output files.             |

> ^ the latter 3 are pretty much run every time the workflow runs so make sure they pass every PR

The contrast audit writes `test-results/contrast-report.json`. Frontend CI uploads
that report as the `contrast-report` artifact so each run retains the verification evidence for
requirement 3.4 (test 3.4.3). Colors live as `--color-*` tokens in the `@theme` block of
`src/app/globals.css` (use them as `bg-surface`, `text-ink`, `var(--color-accent)`, etc.
instead of hardcoded hex values). Add every new foreground/background token pair to
`tests/frontend/check-contrast.mjs`; normal text must reach 4.5:1, while large text and
UI components must reach 3:1.
---

## Directory structure

```
frontend/
├── src/
│   └── app/                  # All pages and layouts live here (Next.js App Router)
│       ├── layout.tsx         # Root layout — wraps every page with <html>, <body>, fonts, and shared metadata
│       ├── page.tsx           # The home page, shown at /
│       └── globals.css        # Global CSS, mostly just the Tailwind setup directives
├── public/                    # Static files served as-is (images, icons, etc.)
├── vitest.config.mts         # Discovers ../tests/frontend/ and resolves package dependencies
├── eslint.config.mjs          # ESLint config
├── .prettierrc                # Prettier formatting rules
├── tsconfig.json              # TypeScript config
├── next.config.ts             # Next.js config
└── package.json               # Dependencies and scripts
```

## Test layout

Frontend test implementations live in `../tests/frontend/`: MIDI unit tests in
`midiUtils.test.ts` and the contrast audit in `check-contrast.mjs`. Run the
commands above from `frontend/`; dependencies remain in this package. ESLint
and TypeScript include the moved tests. Add future frontend specs, helpers, and
fixtures to the same test directory and update the verification inventory.

## Local recordings

Finished takes are saved locally and listed on the home page. Rename, delete
(with confirmation), and download MIDI per take. Storage failures keep the take
in memory with a Not saved label and a retry action; download unsaved takes
before leaving. The browser chooses the download location. See
[the library contract](../docs/recordings_library.md).

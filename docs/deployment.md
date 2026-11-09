# Deployment and Browser Support

Vercel hosts MakeShift (#89). Vercel serves pages, the AudioWorklets, the
DSP modules, 19 piano MP3 recordings and the hand model; jsDelivr serves the
MediaPipe WASM runtime at the exact version pinned in `frontend/package.json`.
Once loaded, camera, CV, audio and MIDI run on the device: playing makes no
network requests (checked by `npm run test:deployment`). Server routes only
back shared recordings: `/api/health` verifies hosted database configuration
and `/api/recordings` lists, reads, uploads and deletes shared takes
([Supabase](supabase.md)).

| Setting | Value |
| :--- | :--- |
| Vercel project | `jaddenkis-projects/make-shift`, root directory `frontend`, Node 24.x |
| Production | <https://make-shift-seven.vercel.app> (from `main`) |
| Previews | Public (Vercel Authentication off since 2026-09-30). A maintainer adds the `preview-link` label to a PR; [`preview.yml`](../.github/workflows/preview.yml) uploads the PR source to Vercel and comments the link. The label is removed after each run, so re-add it after reviewing new commits. `vercel deploy` also works locally |
| Environment variables | Synced from Infisical `makeshift` (Production to Production, Development to Preview); see below |
| CI | `frontend-ci.yml` builds with Node 20, starts `npm start` and runs `test:deployment` against it. It does not test the Vercel deployment itself |

## Environment variables

Names only; values live in Infisical ([setup and rotation](supabase.md)).

| Name | Scope | Effect |
| :--- | :--- | :--- |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Server | Enable `/api/health` and `/api/recordings`. Missing values return `503` and playing is unaffected |
| `RECORDING_UPLOADS` | Server | `1` accepts uploads on Vercel (production and preview). Without it `POST /api/recordings` returns `503`; set it only after the rate-limit migration is applied |
| `NEXT_PUBLIC_PIPELINE_DIAGNOSTICS`, `NEXT_PUBLIC_BUILD_COMMIT` | Build time, browser | Opt-in diagnostics panel and the commit shown in its report ([performance](performance.md)). Unset by default |

Env changes apply to new builds only: redeploy after changing one. Never
give a secret a `NEXT_PUBLIC_` prefix.

## Runtime assets

| Asset | Served from | Expected type |
| :--- | :--- | :--- |
| `/audio/piano-worklet.js`, `/audio/sampled-piano.js`, `/audio/synth.js`, `/audio/metronome-worklet.js` | Vercel static | `application/javascript` |
| `/audio/piano-samples/*.mp3` (19 files; 1,377,637 bytes) | Vercel static; preload before audio readiness | `audio/mpeg` |
| `/audio/piano-samples/manifest.json` | Vercel static; source commit/hashes | `application/json` |
| `/models/hand_landmarker.task` | Vercel static | `application/octet-stream` |
| `vision_wasm_internal.{js,wasm}` | jsDelivr `@mediapipe/tasks-vision@<pinned>` | `application/javascript`, `application/wasm` |

Keep `@mediapipe/tasks-vision` pinned exactly: the WASM URL uses the same
version, and a mismatch fails at model load.

## Permissions and activation

- **HTTPS is required** for camera access (`localhost` is exempt). Vercel
  serves HTTPS by default.
- **Camera:** requested on page load. Denial shows "Camera access blocked";
  a lost camera (unplugged, access revoked) shows "Camera disconnected". Both
  offer "Try again". The camera needs at least 1280x720.
- **Audio:** browsers block sound until a user gesture, so audio starts only
  from "Enable audio". A suspended context (for example after backgrounding)
  reports "Audio is unavailable" and resumes through "Enable audio" without
  replaying held notes.

## Piano startup and licensing

Piano recordings decode locally at the context's sample rate and are reused
on resume. Sample fetch/decode failures report an audio initialization error
with retry; no procedural fallback silently changes the selected sound.
Keep the [sample credits and license](../frontend/public/audio/piano-samples/NOTICE.md)
with deployed assets. First-enable download/decode time is startup overhead,
not per-note latency. See [the bank lifecycle](browser_audio.md#sampled-production-piano-and-register-balance-210).

## Compatibility checklist

Automated coverage runs only in Chromium with fake devices. Mark the other
entries only from a completed manual report in `tests/manual/`.

| Browser | Camera + CV | Audio | Status |
| :--- | :--- | :--- | :--- |
| Chrome / Edge (desktop, current) | Supported | Supported | Automated in CI (fake devices); Edge audio run locally 2026-09-24 |
| Firefox (desktop, current) | Expected | Expected | Manual check pending (5.1.1) |
| Safari 17+ (macOS) | Expected | Expected | Manual check pending (5.1.1) |
| Mobile browsers | Not targeted | Not targeted | Out of scope |

## Verifying a deployment

```sh
cd frontend
npm run build && npm start                       # or use a Vercel URL
npm run test:deployment                          # MAKE_SHIFT_URL=<url> for remote
EXPECT_DATABASE=ok MAKE_SHIFT_URL=<preview-url> npm run test:deployment
```

The script checks the pages `/`, `/calibration`, `/audio`, `/tutorial` and
`/about`, runtime asset types, camera denial and recovery, that playing makes
no network requests, and `/api/health`.

Previews are public so reviewers can open them. They use the Preview
environment secrets server-side only; no secret reaches the browser.

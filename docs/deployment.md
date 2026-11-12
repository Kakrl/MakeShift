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
| Vercel project | `kakrl/make-shift`, root directory `frontend`, Node 24.x |
| Production | <https://make-shift-chi.vercel.app> (from `main`); the [official address](#official-address-and-impersonation-response-199), hosting confirmation pending |
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

## Official address and impersonation response (#199)

A lookalike site could copy MakeShift to collect camera permission or serve
attacker-controlled downloads (Threat 2). A separate origin cannot read the
official site's `localStorage` or cookies, so the risk is users trusting the
wrong site, not data leaking from the real one.

### Official address

**<https://make-shift-chi.vercel.app>** is the only address users should be
given. It is the Vercel production alias for `kakrl/make-shift`, built from
`main`.

- **Hosting confirmation: PENDING.** Carl Xu must confirm this is the intended
  public HTTPS address (or name a team-controlled domain to replace it) before
  public promotion. Until then, treat it as the working official address.
- `makeshift.music` appeared in older docs but is not documented as attached to
  the Vercel project. Do not link it unless Carl Xu confirms the team controls
  it; if adopted, replace every link below in one PR.
- Preview URLs (`make-shift-<hash>-...vercel.app`) are temporary review builds,
  not official addresses. Do not share them with users.

User-facing links must use the exact official address: the [README](../README.md),
[tutorial](tutorial.md), [how-to](how-to.md), this page, and any link added to
the app. Test runner examples may use it as `MAKE_SHIFT_URL`. List every link
origin in those surfaces:

```sh
SURFACES="README.md docs/tutorial.md docs/how-to.md docs/deployment.md frontend/src/app"
git grep -ohE "https?://[^][ )\"'<>\`]+" -- $SURFACES \
  | sed -E 's#^(https?://[^/?#]+).*#\1#' | sort | uniq -c
```

Every link to MakeShift itself must have exactly the origin
`https://make-shift-chi.vercel.app`. Review each other origin and confirm it
is a known third party (GitHub, Vercel, Node.js, and so on), not a stand-in
for the app. This must print nothing:

```sh
git grep -ohE "https?://[^][ )\"'<>\`]+" -- $SURFACES \
  | sed -E 's#^(https?://[^/?#]+).*#\1#' | sort -u \
  | grep -vxF 'https://make-shift-chi.vercel.app' | grep -iE 'vercel\.app$|make-?shift'
```

Historical preview URLs in `tests/README.md` execution records are evidence,
not user links, so that file is not scanned.

### Ownership and cadence

| Responsibility | Owner | When |
| :--- | :--- | :--- |
| Official address, Vercel domains, reports to hosting providers/registrars | Carl Xu | Confirm before public promotion; review on any domain change |
| Official links in README, tutorials, how-to and app pages | Jadden Picardal | Every PR touching user-facing docs or links; full link check monthly |
| Lookalike search | Carl Xu (Jadden Picardal as backup) | Monthly, before each public promotion, and within 2 days of a user report |

Ongoing monitoring ownership is proposed here and needs agreement from both
owners (PENDING).

A lookalike search covers: web searches for "MakeShift piano", "MakeShift
paper piano" and "MakeShift webcam piano"; `*.vercel.app` and common
typo/hyphen variants of `make-shift-chi` (for example `makeshift-chi`,
`make-shift`, `make-shift-chi-*`); public forks of `Kakrl/MakeShift` that
publish their own deployment; and any address users report. Record the date,
searches and result (including "none found") in a comment on the monitoring
issue.

### Responding to an impersonator

1. **Collect evidence** before reporting, since sites disappear: full URL and
   domain, date/time (UTC), screenshots of the page and address bar, the
   page source or saved HTML, any download offered (hash with
   `shasum -a 256` or `sha256sum`; do not run it), the TLS certificate issuer and subject,
   `dig`/WHOIS output for the domain, and how it was found or reported.
2. **Open an issue** in `Kakrl/MakeShift` titled `security: impersonating
   site <domain>`. The issue is public, so post only defanged URLs written as
   code (`example[.]com`, query strings removed), download hashes and redacted
   screenshots. Keep raw evidence (saved HTML, downloads, full URLs, WHOIS
   output) in a private location shared with the owners below, and note in
   the issue where it is kept.
3. **Report it.** Carl Xu reports to the hosting provider (for `*.vercel.app`,
   Vercel's abuse report; otherwise the provider shown by `dig`/WHOIS), the
   domain registrar's abuse contact from WHOIS, and Google Safe Browsing
   (<https://safebrowsing.google.com/safebrowsing/report_phish/>). Note each
   report and reply in the issue.
4. **Warn users** through official channels only: a pinned issue and a notice at
   the top of the [README](../README.md) in `Kakrl/MakeShift`, and a notice on
   the official site if one is deployed. Each warning restates the official
   address and that MakeShift's only downloads are printable piano sheets and
   MIDI recordings; it never asks users to install software.
5. **Close out** when the site is down or reports are exhausted: remove
   temporary notices, keep the issue as the record.

### Limits

Consistent official links and periodic checks reduce the chance users reach a
fake site and shorten response time. They cannot stop anyone from operating a
separate domain, and searches will miss sites that are unindexed or short-lived.
HTTPS only proves the connection is encrypted to whoever controls that domain;
a padlock does not prove the site is MakeShift. Users should check the exact
address.

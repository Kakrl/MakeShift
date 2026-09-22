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

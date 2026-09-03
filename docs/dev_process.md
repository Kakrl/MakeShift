# MakeShift Repository Organization

## Repository Tree

```text
MakeShift/
├── .claude/
├── .github/
│   └── workflows/
├── backend/
│   └── src/
│       ├── API/
│       ├── audio/
│       ├── CV/
│       ├── MIDI/
│       └── __init__.py
├── docs/
│   ├── dev_process.md
│   └── sdp.md
├── frontend/
│   ├── public/
│   ├── src/
│   │   └── app/
│   │       ├── calibration/
│   │       ├── documentation/
│   │       ├── tutorial/
│   │       ├── CameraContext.tsx
│   │       ├── globals.css
│   │       ├── layout.tsx
│   │       └── page.tsx
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   ├── next.config.ts
│   └── README.md
├── tests/
├── .gitignore
├── LICENSE
├── README.md
└── requirements.txt
```
### Project Structure

References discussing horizontal / layered file structure: 
1. https://www.esveo.com/en/blog/wv/
2. https://labs.madisoft.it/folder-structure-for-big-projects-package-by-type-layer-or-feature/

MakeShift follows an approach similar to a horizontal/layered file structure with a subsystem-based organization. The main folders correspond to the project's major subsystems, including frontend, CV, MIDI, audio, and testing. This allows the different technical subsystems to be easily separated, with each subsystem containing the code relevant to its specific functionality.

Each subsystem should remain as independent as reasonably possible and expose a clearly defined interface for interacting with other subsystems. This separation allows team members to work on individual subsystems without unnecessarily affecting other parts of the project, while providing clear boundaries for communication between components.

## Branching Model

We use a fork-and-pull-request workflow:

- Each developer creates and works from their own fork of the repository.
- Feature or fix branches are created in the developer fork (for example: `feature/audio-sync`).
- Pull requests are opened from fork branches into the upstream repository `main` branch.
- All feature updates are merged through pull requests (no direct pushes to `main`).
- Feature branches are automatically deleted after their pull request is merged.

## Code Development and Review Policy

### Pull Request Requirements

- Every code change must be submitted through a pull request.
- Every feature update must be merged through the PR process.
- PRs must target the upstream `main` branch from a branch in a personal fork.
- PR descriptions should clearly explain:
  - what changed
  - why it changed
  - how it was tested

### CI and Quality Gates

- CI must pass before a PR can be merged.
- CI checks include:
  - tests passing
  - code quality/lint/cleanliness checks passing
- PRs with failing CI checks are not eligible for merge.

### Review and Approval Rules

- At least one reviewer approval is required before merge.
- The required approval must be completed on the PR before it is merged into `main`.
- The merge to `main` happens only after:
  - CI passes
  - minimum reviewer approval threshold is met

## Naming Conventions

### Branch Names

Branches live in a personal fork and follow `type/short-description`:

- `type` is one of `feature`, `fix`, `docs`, `test`, `refactor`, or `chore`.
- `short-description` is lowercase and hyphen-separated, a few words at most.

Examples:

- `feature/midi-note-on`
- `fix/calibration-restart-button`
- `docs/sprint-cadence`
- `test/midi-unit-tests`

If a branch maps to a single issue, including the issue number is encouraged:
`feature/41-midi-note-on`.

### Pull Request Titles

PR titles use the same shape, `type: short summary`:

- a lowercase `type` prefix matching the branch type
- a short, imperative summary of what the PR does

Examples:

- `feature: generate MIDI note-on events`
- `fix: calibration restart button not resetting state`
- `docs: sprint close-out and project view refresh process`

## Linking Issues to Pull Requests

Every PR should trace back to an issue on the project board.

- Put a GitHub closing keyword and the issue number in the **PR description**
  (not just the title), so the issue is linked and closed automatically when the
  PR merges into `main`: `Closes #41`.
- Use one keyword per issue if a PR finishes more than one:
  `Closes #41`, `Closes #42`.
- If a PR relates to an issue but does not finish it, reference it without a
  closing keyword so the issue stays open: `Part of #46`.
- Auto-closing still respects our review rules: the issue closes when the PR
  merges, which only happens after CI passes and a reviewer approves.
- Anything that cannot be linked to an existing issue needs an issue opened for
  it first, so the sprint views stay accurate.

Example PR description:

```text
**What changed**

added note-on event generation for the MIDI subsystem.

**Why**

first half of the note event pipeline. Closes #41, part of #46.

**How it was tested**

added unit tests under tests/, passing locally and in CI.
```

## Sprint Cadence and Project Board Upkeep

We work in 2-week sprints. Sprints start and end on **Wednesday**, since that is
when the whole team is scheduled to meet.

### Closing Out a 2-Week Chunk of Work

At the end of every sprint (each sprint-boundary Wednesday) we hold a combined
review and planning meeting:

- **Review.** As a team we walk through everything that was done over the past
  two weeks: merged PRs, work still in flight, and anything that got blocked.
- **Closing issues.** Issues are closed during this meeting by explicit team
  agreement. An issue is only closed once the team agrees its acceptance
  criteria are met and the corresponding PR has been merged into `main`
  (which already requires passing CI and at least one reviewer approval).
  Anything that is not agreed to be done stays open and is carried into the
  next sprint.
- **Planning.** In the same meeting we scope the next two weeks: we write or
  refine the issues for the upcoming sprint and assign owners, so that each
  team member leaves the meeting knowing what they are responsible for.

### Refreshing Our Views

Both project views are refreshed at the sprint boundary, in the same Wednesday
meeting, so they always reflect current state:

- **Roadmap.** Updated at the end of each 2-week cycle. We adjust dates and
  status for items completed during the sprint, and re-time any items that
  slipped, so the roadmap matches actual progress rather than the original plan.
- **Next 2 Weeks.** Refreshed at the start of each 2-week cycle. Completed
  issues drop off as they are closed during review, carried-over issues stay,
  and the newly scoped issues from planning are added in. The view should only
  ever contain work that is in scope for the current sprint.

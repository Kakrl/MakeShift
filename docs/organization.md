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
│   └── organization.md
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

## Branching Model

We use a fork-and-pull-request workflow:

- Each developer creates and works from their own fork of the repository.
- Feature or fix branches are created in the developer fork (for example: `feature/audio-sync`).
- Pull requests are opened from fork branches into the upstream repository `main` branch.
- All feature updates are merged through pull requests (no direct pushes to `main`).

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

## Sprint Cadence and Project Board Upkeep

We work in 2-week sprints. Sprints start and end on **Wednesday**, since that is
when the whole team is scheduled to meet.

### Closing Out a 2-Week Chunk of Work

At the end of every sprint (each sprint-boundary Wednesday) we hold a combined
review and planning meeting:

- **Review.** As a team we walk through everything that was done over the past
  two weeks — merged PRs, work still in flight, and anything that got blocked.
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

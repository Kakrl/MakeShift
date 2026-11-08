# How To Guide

In this guide, some explanations on how to do some tasks are done!

## How to set up and run locally

1. Fork Kakrl's repository at https://github.com/Kakrl/MakeShift
2. Using git, clone your repository onto your local machine via ``git clone [repository]`` or any command you choose
3. run ``cd frontend`` to go to the frontend repository
4. run ``node --version`` and ``npm --version`` to check if you have Node.js and npm package install
5. If you do not have Node.js and npm, go to https://nodejs.org/en/download and follow the instruction to install them for your specific machine
6. run ``npm ci`` to install dependencies
7. run ``npm run dev`` to run the frontend
8. go to the localhost (i.e. ``http://localhost:3000``) port on your browser to open the website
  - usually you will see the port running when you run ``npm run dev``; by default, it is 3000

## How to navigate Makeshift

There are several parts that make up Makeshift.

### UI

As Makeshift runs mostly on simply Typescript, most of the files will contribute to the UI in some manner, though sometimes small. Important files that combine much of the frontend are pages named ``page.tsx``. They are the pages that users will mostly interact with and stay on.

### Audio

Our audio engine and code lies within the [audio folder of the frontend](../frontend/src/app/audio/page.tsx). From there, we generate our musical samples and play them when detecting a piano press. We also hold the metronome which helps the user keep to a certain beat.

### MIDI

Our MIDI code lies within the [MIDI folder of the frontend](../frontend/src/app/midi/recordingsLibrary.ts). Our MIDI library activates when the user presses the record button the frontend. It will record the presses by the user and generate a MIDI file that can get played back or published anonymously online.

### Computer Vision

Computer vision code lies within the [CV folder of the frontend](../frontend/src/cv/liveContactPipeline.ts). The computer vision part takes in the camera input and decides where there is a press or not. Additionally, the CV section will detect where we should overlay the virtual piano. CV will tell MIDI and Audio the respective notes detected for playback and sound respectively.

### Tests

You can find the tests in ``/tests`` directory with a guide on how to create new tests in the [test's README.md](../tests/README.md). Most tests run via typescript and get run on a merge request by our CI/CD pipeline found in ``/.github/workflows``. We also have public manual tests in ``tests/manual``.

### Documentation

You can find the documentation we have accumulated within the ``/docs`` folder. There is [Makeshift's architecture](./architecture.md), explanation of different subsystems like [audio](./audio.md), our [deployment plan](./deployment.md), [dev process](./dev_process.md), [sdp](./sdp.md), and other useful docs.

## How to use mock recordings without a database

No database setup or Supabase credentials are needed to develop the shared
recordings UI. Start the frontend with `npm run dev`, then open
<http://localhost:port_number/?mock=1> and open the Shared recordings tab in the songs
dialog to see sample recordings. Use the port number printed by the dev server.

- `?mock=1` loads sample recordings.
- `?mock=empty` shows the empty state.
- `?mock=error` simulates a loading error.

Mock mode uses browser fixtures instead of the recordings API, so it does not
configure a real database. Remove `?mock=...` from the URL to use the real API. For real database access,
follow [the Supabase setup guide](supabase.md#local-setup).

## How to contribute to Makeshift!

I show a quick walk-through of the steps. In general though, clone the repository, follow the standards on how to develop in our repository, and then make a pull request for one of the maintainers to merge.

1. Fork Kakrl's repository at https://github.com/Kakrl/MakeShift if you do not have one already
2. Make an issue on the Makeshift GitHub repository for a specific problem you wish to solve or a feature to enhance
3. Make a branch that describes your target issue, like ``documentation/123-how-to`` where issue #123 is about the How-To reference guide
4. If developing with AI agents, refer them to [AGENTS.md](../AGENTS.md)
5. If developing tests, refer to [tests creation guide](../tests/README.md)
6. Develop your changes on your local branch
7. ensure your repository passes our linting and test cases by running the CI pipeline:
``npm run lint``
``npx tsc --noEmit``
``npx vitest run``
``npm run test:contrast``
``npm run build``
8. Push your changes to your fork.
9. Create a pull request from your fork onto the Makeshift fork with a summary
10. Wait for one of the maintainers of Makeshift to review and potentially merge your request!

# How-To MakeShift

This guide explains how to use MakeShift, run it locally, and contribute to its development.

## How to get a piano sheet

You need a piano sheet to use and start up the MakeShift application!

1. Open up MakeShift at [https://make-shift-chi.vercel.app](https://make-shift-chi.vercel.app).
2. Find the ``Piano Sheet`` button either at the beginning pop-up or on one of the white keys on the right of the screen.
3. Download and print the piano sheet

## How to enable sound and start playing

You have to first get through calibration to enable audio.

1. Open up MakeShift at [https://make-shift-chi.vercel.app](https://make-shift-chi.vercel.app).
2. Click the calibration button either on the pop-up or on the right side of the screen
3. Go through the different phases of calibration.
4. Finally, exit the calibration phase.
5. Get the camera to detect your MakeShift piano sheet.
6. Click on ``Enable Audio``.
7. Start playing on your paper piano.

## How to get the camera to detect your piano sheet

Sometimes, you may find it difficult to get the camera to detect your paper. Here are some steps you could take to get it recognized if you are having trouble. The markers are the four markers at the corners of the paper sheet.

- Ensure there is light in your room so that all four markers on the paper sheet are visible.
- Ensure each marker on the paper is flat and not curled (which can happen if you pick at the corners).
- Center the piano sheet and ensure that each marker of the paper piano sheet is visible in the camera.
- Do not block the markers.
- The camera will automatically search for the piano sheet markers every 10 seconds after the first success!

## How to record yourself and upload anonymously

You can only record yourself and upload after calibrating and enabling audio. Afterwards, there is a button at the bottom to record yourself. When beginning, you will get a 3-2-1 countdown timer to begin. During recording, you can pause, resume and eventually stop. You also have the option to set your time signature and BPM. After recording, you will get the option to save or delete your MIDI file. Afterwards, you can find the ``View Recordings`` button in the bottom right where you will also find the option to view others' recordings and publish your own!

## How to set up and run locally

1. Fork Kakrl's repository at https://github.com/Kakrl/MakeShift
2. Using Git, clone your repository onto your local machine via ``git clone [repository]`` or any command you choose
3. Run ``cd frontend`` to go to the frontend repository
4. Run ``node --version`` and ``npm --version`` to check if you have Node.js and npm installed
5. If you do not have Node.js and npm, go to https://nodejs.org/en/download and follow the instructions to install them for your specific machine
6. Run ``npm ci`` to install dependencies
7. Run ``npm run dev`` to run the frontend
8. Open the local server address (usually ``http://localhost:3000``) in your browser to view the website.
  - The server prints its address when you run ``npm run dev``; the default port is 3000.

## How to navigate the MakeShift repository

There are several parts that make up MakeShift and understanding where you want to work is important.

### UI

MakeShift is written mostly in TypeScript, and many frontend files contribute to the UI. Important files that combine much of the frontend are pages named ``page.tsx``. They are the pages that users will mostly interact with and stay on.

### Audio

Our audio engine and code lie within the [audio folder of the frontend](../frontend/src/app/audio/page.tsx). From there, we generate our musical samples and play them when detecting a piano press. We also hold the metronome which helps the user keep to a certain beat.

### MIDI

Our MIDI code lies within the [MIDI folder of the frontend](../frontend/src/app/midi/recordingsLibrary.ts). Our MIDI library activates when the user presses the record button in the frontend. It will record the presses by the user and generate a MIDI file that can get played back or published anonymously online.

### Computer Vision

Computer vision code lies within the [CV folder of the frontend](../frontend/src/cv/liveContactPipeline.ts). The computer vision part takes in the camera input and decides whether a press has occurred. Additionally, the CV section will detect where we should overlay the virtual piano. CV sends the detected notes to the MIDI and audio subsystems for recording and sound playback.

### Tests

You can find the tests in the ``tests/`` directory with a guide on how to create new tests in the [testing README](../tests/README.md). Most tests run via TypeScript and get run on a merge request by our CI/CD pipeline found in ``/.github/workflows``. We also have public manual tests in ``tests/manual``.

### Documentation

You can find the documentation we have accumulated within the ``/docs`` folder. There is [MakeShift's architecture](./architecture.md), explanations of different subsystems like [audio](./audio.md), our [deployment plan](./deployment.md), [dev process](./dev_process.md), [sdp](./sdp.md), and other useful docs.

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

## How to contribute to MakeShift!

I show a quick walk-through of the steps. In general, clone the repository, follow the standards on how to develop in our repository, and then make a pull request for one of the maintainers to merge.

1. Fork Kakrl's repository at https://github.com/Kakrl/MakeShift if you do not have one already
2. Make an issue on the MakeShift GitHub repository for a specific problem you wish to solve or a feature to enhance
3. Make a branch that describes your target issue, like ``documentation/123-how-to`` where issue #123 is about the How-To reference guide
4. If developing with AI agents, refer them to [AGENTS.md](../AGENTS.md)
5. If developing tests, refer to [test creation guide](../tests/README.md)
6. Develop your changes on your local branch
7. Ensure your repository passes our linting and test cases by running the CI pipeline:
- ``npm run lint``
- ``npx tsc --noEmit``
- ``npx vitest run``
- ``npm run test:contrast``
- ``npm run build``
8. Push your changes to your fork.
9. Create a pull request from your fork onto the MakeShift fork with a summary
10. Wait for one of the maintainers of MakeShift to review and potentially merge your request!

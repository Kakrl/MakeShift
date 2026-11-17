# Tutorial: MakeShift

## Overview

MakeShift is a website that turns a printed piano keyboard into
an instrument you can play using a webcam.

This tutorial takes you through setting up your keyboard,
playing notes, recording, and downloading your recording.

## Prerequisites

You will need:

- A computer with a webcam.
- Speakers or headphones.
- An internet connection.
- Access to a printer to print the MakeShift keyboard.
- A flat surface with good lighting.

## Setup / Installation

### 1. Print your keyboard

Download the [starter keyboard PDF](piano-sheet-starter.pdf).

Print it in landscape orientation at **Actual size** or **100%**,
with **Fit to page** and **Shrink to fit** disabled.

Check that the printed 50 mm ruler measures 50 mm.

If you want a larger keyboard, follow the
[printing and assembly guide](piano_sheet.md)
to add extension sheets.

### 2. Position the paper and camera

Place the printed piano sheet on a flat surface between you and your webcam,
with all four markers visible in the camera view.

Use even lighting and avoid strong shadows across the paper.

### 3. Open MakeShift

Open the [MakeShift website](https://make-shift-chi.vercel.app).
Check that the address bar shows exactly `make-shift-chi.vercel.app`; other
addresses are not run by the MakeShift team.

1. Select **Start Calibration** in the welcome window. If you have
   visited before and it does not appear, select **Calibration** instead.
2. Read the preparation instructions and select **Begin Calibration**.

Select **Allow** whenever your browser asks for camera access.

## First Workflow

### 1. Calibrate your keyboard

Calibration helps MakeShift recognize your keyboard and hands.
With the calibration screen open:

1. Choose your keyboard range and lowest note. Set the number of
   paper octaves to match your printed keyboard: one for the starter
   sheet, plus one for each extension sheet you added.
2. Follow the lighting and paper-positioning instructions.
   Keep all four markers visible during paper alignment.
3. Follow the guided captures for each hand, making sure your
   hand is visible to the camera.
4. When **Calibration saved** appears, select **Start Playing**.

Keep the camera and paper in their calibrated positions.
If you move either, you may need to repeat calibration.

### 2. Enable sound and play

Keep all four markers in the camera view and wait for MakeShift
to identify them. Look for a keyboard outline over the paper
to confirm that it has located the keyboard.

Once **Enable audio** becomes available, select it.

Press and release the printed keys to play notes. You should
hear sound and see visual feedback for detected presses.

### 3. Record your playing

1. Select the recording button.
2. Wait until the count-in finishes and recording begins.
3. Play your notes.
4. Select **Stop** when finished.
5. In the save window, name your recording, choose **Only me**
   to keep it on this device, and select **Save**.

You can also use **Pause** and **Resume** to take a break
without starting a new recording.

### 4. Download your recording

Open **My recordings**, select your recording, and choose
**Download MIDI**.

Your browser downloads a `.mid` file containing the notes
you recorded.

MIDI stores note instructions rather than recorded sound.
To hear the file in another music application, open it there
and assign an instrument.

## Expected Results

You should now be able to:

- Play notes using your printed keyboard.
- Record and save your playing.
- Download your recording as a MIDI file.

## Troubleshooting

### The camera does not appear

Check that camera access is allowed in your browser.
Close other applications using the webcam, then retry.

### MakeShift cannot identify the keyboard

Check that the whole sheet and all four markers are visible.
Improve the lighting and remove anything covering the markers.

### Enable audio or recording is unavailable

Wait for tracking to settle after calibration.

If you moved the paper or camera, restore their calibrated
positions or repeat calibration. A visible keyboard outline
alone does not guarantee that the app is ready.

### I cannot hear notes

Check your volume and audio output, and make sure you selected
**Enable audio**.

### Notes are missed or extra notes appear

Try slower presses, lift your fingers clearly between notes,
and check that your hands are visible to the camera.

### My downloaded MIDI file is silent

Open it in a music application that supports MIDI and assign
an instrument to its track. MIDI files do not contain recorded
speaker audio.

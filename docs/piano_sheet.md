# Printable piano sheets (#36)

- [Starter sheet: four markers](../output/pdf/piano-sheet-starter.pdf)
- [Extension sheet: right markers only](../output/pdf/piano-sheet-extension.pdf)

Both vector PDFs contain eight white keys, C through the next C, and five black
keys on one US Letter landscape page (279.4 x 215.9 mm). Print in landscape
at **100% / Actual size**, with **Fit to page** and **Shrink** disabled.
Measure the printed 50 mm ruler before cutting. An A4 printer can center the
Letter artwork at actual size without scaling. All artwork has at least
6 mm clearance from Letter page edges; check printer unprintable margins.

## Dimensions

White-key pitch (including the boundary line) is **23.5 mm**. One octave,
between corresponding edges or centers of the two C keys, spans **164.5 mm**;
the entire eight-key sheet spans **188 mm**. White keys are 150 mm long;
black rectangles are 13.7 mm wide and 90 mm long. This is a representative
full-size playing surface, not an exact replica of every piano. For comparison,
[DPA's piano facts](https://www.dpamicrophones.com/mic-university/background-knowledge/fast-facts-about-the-piano/)
give approximate white/black widths of 23.5/14 mm. Key length and black-key
positioning vary between instruments; this sheet uses centered black keys.

## Assemble one, two or three octaves

1. Print one starter and zero, one or two copies of the extension.
2. Trim **both side margins** of every sheet along the dashed lines and their
   continuation along the keyboard's outer edges. Keep the top and bottom
   paper strips intact: they hold the markers and cover old markers.
3. Place an extension **on top** of the preceding sheet. Align its leftmost C
   exactly over the preceding sheet's rightmost C. Match top/bottom key edges.
   The overlap is one white key, **23.5 mm**; each extension adds **164.5 mm**.
4. Ensure the extension's blank upper/lower left strips completely cover the
   preceding right markers. Use opaque paper/backing if markers show through.
   Tape from behind without covering visible markers.
5. Repeat for a third octave. Keep the assembly flat. Only four markers should
   remain visible: the starter's left pair and the final sheet's right pair.

| Octaves on paper | Print | Distinct white keys | Entire key strip width |
| :--- | :--- | :--- | :--- |
| 1 | 1 starter | 8 | 188 mm |
| 2 | 1 starter + 1 extension | 15 | 352.5 mm |
| 3 | 1 starter + 2 extensions | 22 | 517 mm |

## Marker and application compatibility

Markers remain **OpenCV DICT_4X4_50**: top left ID 0, top right ID 1,
bottom right ID 2, bottom left ID 3, with the black keys at the top.
The extension contains only IDs 1 and 2. Each marker is a 12 mm vector square
with a one-cell black border and at least 2 mm of white quiet zone, including
after side trimming.

On the starter, marker centers position the keyboard to match the existing
`keyboardGeometry.ts` coordinates exactly: x = -0.05..1.05 and y = 0.1..0.9
relative to the four-center unit square. Recalibrate after replacing paper,
changing scale, assembling sheets or moving the camera. The same IDs cannot
identify which physical print or octave count is present.

In calibration, choose **1, 2 or 3 octaves**, the starting pitch assigned to
the leftmost printed C, and the number of octaves actually assembled on paper.
The application exposes 8, 15 or 22 white-key hit regions and maps those same
keys to audio, MIDI and highlights. Black rectangles are visual references;
black-key contact/pitch mapping remains #25. Starting C choices are restricted
so the highest key never exceeds MIDI 127. If increasing the range would exceed
the limit, the starting C moves to the highest valid C automatically.

When the selected range exceeds the assembled paper, calibration warns and
blocks advancement until you add sheets or explicitly allow the full range to
extend beyond the paper. Override preserves key size and all selected pitches;
it does not squeeze extra octaves onto one sheet. Paper size is declared by the
user: identical marker IDs cannot independently prove how many pages are present.
Changing any keyboard/paper/override setting clears both saved calibration
records, releases active notes and requires a fresh calibration and audio start.

## Regeneration and verification

Install the pinned generator dependency and run from the repo root:

```sh
python -m pip install -r docs/piano_sheet_requirements.txt
python docs/generate_piano_sheets.py
```

[The source](generate_piano_sheets.py) writes deterministic, single-page PDFs
to `output/pdf/`. Marker payloads use canonical OpenCV dictionary bytes drawn
as vector cells. `Piano Sheet.png` remains a legacy reference; use the PDFs for
actual-size printing. Generation needs no marker downloads or network access.

Local verification on Windows, 2026-10-06: rendered both PDFs with Poppler and
visually inspected every page. Checked PDF dimensions, key/ruler measurements,
marker payloads/quiet zones and simulated two/three-sheet overlaps. These
checks establish file geometry, not printer scale, webcam detection quality,
intentional-contact accuracy or physical latency. Physical printing and
camera testing remain pending; no CI execution is claimed for these assets.

# Printable piano sheets (#36)

- [Starter sheet: four markers](piano-sheet-starter.pdf)
- [Extension sheet: right markers only](piano-sheet-extension.pdf)

Both vector PDFs contain eight white keys, C through the next C, and five black
keys on one US Letter landscape page (279.4 x 215.9 mm). Print in landscape
at **100% / Actual size**, with **Fit to page** and **Shrink** disabled.
Measure the printed 50 mm ruler before cutting. An A4 printer can center the
Letter artwork at actual size without scaling. The extension keyboard starts
at **x = 0 mm**, directly on the left page edge. Use borderless printing with
automatic borderless enlargement disabled, or center the Letter PDF on larger
paper at actual size and cut at the PDF's left page boundary. Do not shift the
keyboard to a printer margin or use Fit/Shrink. On A4, retain this same PDF
boundary as the assembly edge. Verify all eight keys, including the left C,
print completely. The starter's top/bottom quiet zones approach 2.2 mm from
the page edge, so check those against the printer's unprintable margins too.

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
2. Trim the starter's **both side margins** along the dashed guides, retaining
   **4 mm beyond each keyboard edge**. Trim only the extension's right margin,
   retaining **4 mm beyond its right keyboard edge** (cut at x = 192 mm).
   Its left page edge is already the assembly edge; do not remove any of its
   left C. Continue cuts straight through the page, not along keyboard edges.
   Keep the top and bottom paper strips intact: they hold the markers and
   cover old markers. Cutting flush to the right key edge clips the markers.
3. Place an extension **on top** of the preceding sheet. Align its leftmost C
   exactly over the preceding sheet's rightmost C. Match top/bottom key edges.
   The keyboard overlap is one white key, **23.5 mm**; each extension adds
   **164.5 mm**. The retained right margin makes paper overlap **27.5 mm**.
   Align key edges, not the previous sheet's paper edge.
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
The extension contains only IDs 1 and 2. Each marker is an **18 mm** vector
square (increased from 12 mm), with a one-cell black border and **3 mm** of
white quiet zone on every side, including after the prescribed trimming.
The complete marker/quiet-zone footprint is 24 x 24 mm. The 4 mm retained
margin leaves about 0.45 mm beyond that footprint. On an assembly, the old
right marker's entire footprint falls within the next extension's blank
left strip (x = 2.64..26.64 mm from its left edge).

On the starter, marker centers position the keyboard to match the existing
`keyboardGeometry.ts` coordinates exactly: x = -0.05..1.05 and y = 0.1..0.9
relative to the four-center unit square. Recalibrate after replacing paper,
changing scale, assembling sheets or moving the camera. The same IDs cannot
identify which physical print or octave count is present.
Marker centers relative to key edges are unchanged: 8.54545 mm inset from
each side, with a 170.90909 mm horizontal span and 187.5 mm vertical span.
Translating the extension artwork by -45.7 mm preserves these distances.
No application geometry or calibration schema change is needed.

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
to `docs/`. Marker payloads use canonical OpenCV dictionary bytes drawn
as vector cells. `Piano Sheet.png` remains a legacy reference; use the PDFs for
actual-size printing. Generation needs no marker downloads or network access.

Local verification on Windows, 2026-10-06: rendered both PDFs with Poppler and
visually inspected every page. Checked PDF dimensions, key/ruler measurements,
marker payloads/quiet zones and simulated two/three-sheet overlaps. These
checks establish file geometry, not printer scale, webcam detection quality,
intentional-contact accuracy or physical latency. Physical printing and
camera testing remain pending; no CI execution is claimed for these assets.

Issue #187 verification on Windows, 2026-10-13: regenerated and visually
inspected both complete pages with Poppler. Five automated cases in
[`test_piano_sheets.py`](../tests/python/test_piano_sheets.py) passed:
byte-identical regeneration, Letter dimensions, rendered key boundaries,
zero extension margin, 18 mm marker bounds, canonical OpenCV detection and
orientation, 3 mm white rings, and trimmed two-/three-sheet raster assemblies
with exactly the four exterior IDs and fully covered interior footprints.
These are synthetic file checks; physical printing and webcam detection under
recorded lighting, distance, camera resolution and angle remain **pending**.
See the [execution record](../tests/README.md#piano-sheet-verification-issue-187).

The optional verification dependencies are separate from the generator:

```sh
python -m pip install -r tests/python/piano_sheet_requirements.txt
python -m pytest tests/python/test_piano_sheets.py
```

Install Poppler (`pdftoppm`) on PATH. Missing optional tools explicitly skip
the PDF tests; the existing CI has no dedicated PDF tool installation, so
this coverage is manual automation and no CI execution is claimed.

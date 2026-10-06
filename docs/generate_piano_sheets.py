"""Generate actual-size piano PDFs: python docs/generate_piano_sheets.py.

Requires reportlab. Output is deterministic and contains vector artwork only.
Coordinates below are millimeters, measured from the page's top left.
"""

from pathlib import Path

from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

PAGE_WIDTH = 279.4
PAGE_HEIGHT = 215.9
WHITE_PITCH = 23.5
WHITE_LENGTH = 150.0
BLACK_WIDTH = 13.7
BLACK_LENGTH = 90.0
KEY_LEFT = (PAGE_WIDTH - 8 * WHITE_PITCH) / 2
KEY_TOP = (PAGE_HEIGHT - WHITE_LENGTH) / 2
KEY_RIGHT = KEY_LEFT + 8 * WHITE_PITCH
OCTAVE_SPAN = 7 * WHITE_PITCH

# Match keyboardGeometry.ts: x=-0.05..1.05, y=0.1..0.9 relative
# to the marker-center rectangle. This keeps single-sheet projection intact.
MARKER_SPAN_X = 8 * WHITE_PITCH / 1.1
MARKER_SPAN_Y = WHITE_LENGTH / 0.8
MARKER_LEFT = KEY_LEFT + 0.05 * MARKER_SPAN_X
MARKER_RIGHT = MARKER_LEFT + MARKER_SPAN_X
MARKER_TOP = KEY_TOP - 0.1 * MARKER_SPAN_Y
MARKER_BOTTOM = MARKER_TOP + MARKER_SPAN_Y
MARKER_SIZE = 12.0

# Canonical, row-major white bits (MSB first), OpenCV DICT_4X4_50 IDs 0..3.
# https://github.com/opencv/opencv/blob/4.x/modules/objdetect/src/aruco/
# predefined_dictionaries.hpp (DICT_4X4_1000_BYTES, shared first 50 entries).
MARKER_BYTES = ((181, 50), (15, 154), (51, 45), (153, 70))
OUTPUT = Path(__file__).resolve().parents[1] / "output" / "pdf"


def rectangle(pdf, x, y, width, height, fill=False):
    """Draw with top-left millimeter coordinates."""
    pdf.rect(x * mm, (PAGE_HEIGHT - y - height) * mm,
             width * mm, height * mm, stroke=not fill, fill=fill)


def line(pdf, x1, y1, x2, y2):
    pdf.line(x1 * mm, (PAGE_HEIGHT - y1) * mm,
             x2 * mm, (PAGE_HEIGHT - y2) * mm)


def label(pdf, x, y, text, size=8):
    pdf.setFont("Helvetica", size)
    pdf.drawCentredString(x * mm, (PAGE_HEIGHT - y) * mm, text)


def marker(pdf, marker_id, center_x, center_y):
    """Six-by-six cells: one black border cell plus a 4x4 payload."""
    left = center_x - MARKER_SIZE / 2
    top = center_y - MARKER_SIZE / 2
    cell = MARKER_SIZE / 6
    bits = (MARKER_BYTES[marker_id][0] << 8) | MARKER_BYTES[marker_id][1]
    # One full cell (2 mm) of white quiet zone survives side trimming.
    pdf.setFillColorRGB(1, 1, 1)
    rectangle(pdf, left - 2, top - 2, MARKER_SIZE + 4,
              MARKER_SIZE + 4, fill=True)
    pdf.setFillColorRGB(0, 0, 0)
    rectangle(pdf, left, top, MARKER_SIZE, MARKER_SIZE, fill=True)
    pdf.setFillColorRGB(1, 1, 1)
    for row in range(4):
        for column in range(4):
            if bits & (1 << (15 - row * 4 - column)):
                rectangle(pdf, left + (column + 1) * cell,
                          top + (row + 1) * cell, cell, cell, fill=True)
    pdf.setFillColorRGB(0, 0, 0)


def generate(destination, extension=False):
    pdf = canvas.Canvas(str(destination),
                        pagesize=(PAGE_WIDTH * mm, PAGE_HEIGHT * mm),
                        pageCompression=1, invariant=1)
    title = "MakeShift - " + ("right-marker extension" if extension
                             else "four-marker starter")
    pdf.setTitle(title)
    pdf.setAuthor("MakeShift")
    pdf.setLineWidth(0.2 * mm)
    rectangle(pdf, KEY_LEFT, KEY_TOP, 8 * WHITE_PITCH, WHITE_LENGTH)
    for index in range(1, 8):
        x = KEY_LEFT + index * WHITE_PITCH
        line(pdf, x, KEY_TOP, x, KEY_TOP + WHITE_LENGTH)
    for boundary in (1, 2, 4, 5, 6):
        rectangle(pdf, KEY_LEFT + boundary * WHITE_PITCH - BLACK_WIDTH / 2,
                  KEY_TOP, BLACK_WIDTH, BLACK_LENGTH, fill=True)
    for index, note in enumerate(("C", "D", "E", "F", "G", "A", "B", "C")):
        label(pdf, KEY_LEFT + (index + 0.5) * WHITE_PITCH,
              KEY_TOP + WHITE_LENGTH - 6, note, 10)

    if not extension:
        marker(pdf, 0, MARKER_LEFT, MARKER_TOP)
        marker(pdf, 3, MARKER_LEFT, MARKER_BOTTOM)
    marker(pdf, 1, MARKER_RIGHT, MARKER_TOP)
    marker(pdf, 2, MARKER_RIGHT, MARKER_BOTTOM)

    label(pdf, PAGE_WIDTH / 2, 27, title, 9)
    label(pdf, PAGE_WIDTH / 2, 190,
          "Print at 100% / Actual size - no Fit or Shrink", 8)
    label(pdf, PAGE_WIDTH / 2, 195,
          "23.5 mm white-key pitch | 164.5 mm C-to-C", 7)
    ruler_left = PAGE_WIDTH / 2 - 25
    line(pdf, ruler_left, 201, ruler_left + 50, 201)
    for x in (ruler_left, ruler_left + 50):
        line(pdf, x, 199.5, x, 202.5)
    label(pdf, PAGE_WIDTH / 2, 207, "Check this line measures 50 mm", 7)

    # Cutting at both keyboard edges removes page margins; the next sheet
    # lies ON TOP of the preceding high C and its now-interior right markers.
    pdf.setDash(1.5 * mm, 1.5 * mm)
    for x in (KEY_LEFT, KEY_RIGHT):
        line(pdf, x, 6, x, KEY_TOP - 1)
        line(pdf, x, KEY_TOP + WHITE_LENGTH + 1, x, PAGE_HEIGHT - 6)
    pdf.setDash()
    pdf.save()


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    generate(OUTPUT / "piano-sheet-starter.pdf")
    generate(OUTPUT / "piano-sheet-extension.pdf", extension=True)


if __name__ == "__main__":
    main()

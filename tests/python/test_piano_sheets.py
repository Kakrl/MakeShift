"""Verify printable assets, including real ArUco detection after overlap.

Optional tools skip explicitly: reportlab, pypdf, Pillow, OpenCV and Poppler.
Run: python -m pytest tests/python/test_piano_sheets.py
"""

import importlib.util
import shutil
import subprocess
from pathlib import Path

import pytest

cv2 = pytest.importorskip("cv2")
np = pytest.importorskip("numpy")
pytest.importorskip("reportlab")
PdfReader = pytest.importorskip("pypdf").PdfReader
Image = pytest.importorskip("PIL.Image")
ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "piano_sheets", ROOT / "docs/generate_piano_sheets.py"
)
sheets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sheets)


@pytest.fixture(scope="module")
def rendered(tmp_path_factory):
    renderer = shutil.which("pdftoppm")
    if renderer is None:
        pytest.skip("Poppler pdftoppm unavailable")
    folder = tmp_path_factory.mktemp("piano_sheets")
    images = []
    for extension, name in enumerate(("starter", "extension")):
        source = ROOT / f"docs/piano-sheet-{name}.pdf"
        generated = folder / f"{name}.pdf"
        sheets.generate(generated, extension=bool(extension))
        assert generated.read_bytes() == source.read_bytes()
        page = PdfReader(source).pages[0]
        assert len(PdfReader(source).pages) == 1
        assert float(page.mediabox.width) == pytest.approx(
            279.4 * 72 / 25.4, abs=0.001
        )
        assert float(page.mediabox.height) == pytest.approx(
            215.9 * 72 / 25.4, abs=0.001
        )
        prefix = folder / name
        subprocess.run(
            [renderer, "-r", "254", "-png", "-singlefile",
             str(source), str(prefix)], check=True, capture_output=True
        )
        images.append(Image.open(prefix.with_suffix(".png")).convert("RGB"))
    return images


def detected(image):
    dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    corners, ids, _ = cv2.aruco.ArucoDetector(dictionary).detectMarkers(
        np.array(image)
    )
    assert ids is not None
    assert len(ids) == len(set(ids.flatten()))
    return {int(identity): polygon[0]
            for identity, polygon in zip(ids.flatten(), corners, strict=True)}


@pytest.mark.parametrize("index,expected", [(0, {0, 1, 2, 3}), (1, {1, 2})])
def test_marker_payload_orientation_dimensions_and_quiet_zones(
    rendered, index, expected
):
    image = rendered[index]
    markers = detected(image)
    assert set(markers) == expected
    for identity, corners in markers.items():
        x = (sheets.MARKER_LEFT if identity in (0, 3)
             else sheets.MARKER_RIGHT) - index * sheets.KEY_LEFT
        y = sheets.MARKER_TOP if identity in (0, 1) else sheets.MARKER_BOTTOM
        # OpenCV returns canonical top-left first: verify unrotated payloads.
        assert corners[0] == pytest.approx(((x - 9) * 10, (y - 9) * 10),
                                           abs=1)
        assert corners[2] - corners[0] == pytest.approx((179, 179), abs=1)
        # Sample the full 3 mm quiet ring, avoiding antialiasing at its edges.
        left, top = round((x - 12) * 10), round((y - 12) * 10)
        patch = np.array(image)[top + 2:top + 238, left + 2:left + 238]
        assert patch.shape == (236, 236, 3)
        for strip in (patch[:26], patch[-26:], patch[:, :26], patch[:, -26:]):
            assert strip.min() == 255


def test_actual_size_keys_and_zero_extension_margin(rendered):
    for index, image in enumerate(rendered):
        row = np.array(image)[round((sheets.KEY_TOP + 130) * 10), :, 0]
        offset = 0 if index else sheets.KEY_LEFT
        for boundary in range(9):
            x = round((offset + boundary * 23.5) * 10)
            assert row[max(0, x - 1):x + 2].min() < 80
    assert sheets.OCTAVE_SPAN == 164.5
    assert sheets.WHITE_PITCH == 23.5


@pytest.mark.parametrize("octaves", [2, 3])
def test_trimmed_assemblies_cover_interior_markers(rendered, octaves):
    # 10 pixels/mm; starter retains 4 mm each side, extension 4 mm right.
    starter, extension = rendered
    strip = starter.crop((417, 0, 2377, 2159))
    addition = extension.crop((0, 0, 1920, 2159))
    assembly = Image.new("RGB", (1960 + (octaves - 1) * 1645, 2159), "white")
    assembly.paste(strip, (0, 0))
    for number in range(1, octaves):
        assembly.paste(addition, (40 + number * 1645, 0))
    markers = detected(assembly)
    assert set(markers) == {0, 1, 2, 3}
    assert len(markers) == 4
    span = markers[1][:, 0].mean() - markers[0][:, 0].mean()
    expected = (188 + (octaves - 1) * 164.5 - 2 * 188 / 22) * 10
    assert span == pytest.approx(expected, abs=1)
    for number in range(1, octaves):
        # The old right marker AND its quiet zone lie under blank paper.
        x = sheets.MARKER_RIGHT - sheets.KEY_LEFT + 4 + (number - 1) * 164.5
        for y in (sheets.MARKER_TOP, sheets.MARKER_BOTTOM):
            box = (round((x - 12) * 10), round((y - 12) * 10),
                   round((x + 12) * 10), round((y + 12) * 10))
            assert np.array(assembly.crop(box)).min() == 255

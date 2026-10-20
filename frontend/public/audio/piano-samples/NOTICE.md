# Salamander Grand Piano recordings

Author: Alexander Holm. Instrument: Yamaha C5 acoustic grand piano.

These 19 MP3 recordings are from the Salamander Grand Piano set, distributed
under [Creative Commons Attribution 3.0 Unported](https://creativecommons.org/licenses/by/3.0/).
License text: <https://creativecommons.org/licenses/by/3.0/legalcode>.
Original instrument information: <https://sfzinstruments.github.io/pianos/salamander/>.

Downloaded unchanged from the `salamander/` directory of
<https://github.com/Tonejs/audio/tree/efd8296360f9526e379bfbe5c1698ff54d6a1d34/salamander>.
`SOURCE_README.txt` retains that distribution's original README.
`manifest.json` pins the source commit, compressed sizes and SHA-256 hashes.
The recordings total 1,377,637 bytes. No runtime CDN or third-party service is used.

MakeShift decodes locally at the AudioContext rate, preserves stereo, normalizes
by the first 500 ms RMS, skips near-silent leading frames with a 1 ms margin,
and applies the selected +6 dB bass curve and fixed polyphony headroom.
Pitch interpolation and note-off envelopes modify playback. The original
recordings remain unchanged. The subset uses one recorded dynamic layer;
the original instrument's additional velocity layers, release noises,
resonance and pedal behavior are not included.

## Piano Sheet

The piano sheet covers one octave. To help with automatic detection of the piano sheet and a visualization of the keyboard, each corner of the piece of paper has an ArUco board. ArUco boards help with pose estimation and can help (with some geometric transformations) put that paper into a virtual space. 

To combine pieces of paper, you can overlap a low and high C to get two octaves.

### ArUco board

The markers are part of the { 4x4 (50, 100, 250, 1000 )} set. The ids range from [0,3]. They were generated at https://chev.me/arucogen/. 

If you make the paper horizontal with the black keys on top, the top-left corner has id:0, top-right id:1, bottom-right id:2, and bottom-left id:3.
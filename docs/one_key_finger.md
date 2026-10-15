# One key per finger

Each finger can press one key at a time. Different fingers can press the same
key.

## How it should work

1. Use the current press logic.
2. When a finger first presses a key, store that key's index on its `Finger`
   object. The `Finger` owns this key assignment for the press lifecycle.
3. While the finger is pressing, keep checking which key is under it.
4. If it is still over the same key, keep pressing it.
5. If it moves over another key but is still in the gray boundary, keep
   pressing the current key.
6. If it moves over another key and leaves the gray boundary, switch to the
   new key.
7. When the finger releases, clear its key index. Its next press starts with
   the current press logic again.

The gray boundary only affects a finger that is already pressing a key. It
does not change how hovering fingers are tracked. A key pressed by multiple
fingers stays active until all those fingers release it.

## Action steps

### 1. Define the gray boundary

- Key polygons are projected into camera pixels. The gray band is 15% of each
  key's projected width, measured inward from every polygon edge. This scales
  with the projected keyboard and stays separate from the 8-pixel overlap
  tolerance.
- `classifyKeyRegion` in `collision.ts` classifies a point as interior,
  boundary, or outside. `keyBoundary.test.ts` covers scaled geometry, shared
  edges, invalid points, and usable interiors across one to three octaves.

**Done:** geometry classification and focused tests are in place. The width is
a starting value for later camera testing and tuning.

### 2. Give `Finger` key ownership

- `Finger` now has a `keyIndex` field.
- It is assigned when the existing contact logic first makes the finger
  active, and kept through pressed and releasing states, including release
  grace.
- It is cleared when contact becomes inactive or unavailable, or when the
  finger or pipeline resets.
- `fingerState.test.ts` covers assignment, retention, and clearing.

**Done:** the finger's key index follows its contact lifecycle without being
stored in a second ownership map. On a new press it starts from the existing
overlap result; Step 3 applies the gray-boundary rule during an active press.

### 3. Apply the boundary rule during a press

- `liveContactPipeline.ts` keeps the current press logic for a finger without
  an assigned key.
- An active finger keeps its current key while in the gray band. The pipeline
  preserves active contact when the overlap list changes.
- The finger switches keys only after entering another key's interior.
- `liveContactPipeline.test.ts` covers boundary jitter, switching, and normal
  hover behavior.

**Done:** one finger owns one key; overlap changes do not reset its contact,
and it switches only in another key's interior.

### 4. Connect key ownership to output

- `MarkerTrackingOverlay.tsx` now reads each active key from `Finger.keyIndex`
  rather than treating every polygon overlap as pressed.
- Multiple fingers still aggregate to one active key. The key stays active
  until all of them release it, and the strongest finger velocity is kept.
- Integration tests cover one fingertip overlapping two keys, one finger
  moving to another key, and multiple fingers sharing a key.

**Done:** output and highlights use `Finger.keyIndex`; pipeline tests cover
gray-band retention and switching.

### 5. Record and verify the change

- Update the affected row in `tests/verification_test_inventory.md` for any
  new or changed test file.
- Run the applicable frontend checks from `AGENTS.md` and record the results.

**Done when:** implementation, tests, inventory, and verification evidence
agree.

Steps 1 through 5 are complete. Physical camera behavior remains to be
verified separately.

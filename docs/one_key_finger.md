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
stored in a second ownership map. This step seeds it from the first existing
overlap result; Step 3 will apply the gray-boundary rule.

### 3. Apply the boundary rule during a press

- In `liveContactPipeline.ts`, keep the current press logic for a finger with
  no assigned key.
- For a finger with an assigned key, keep that key while the fingertip is in
  the gray band.
- When the fingertip enters another key's interior, update the finger's key
  index to that key.
- Make sure a single finger contributes at most one key at any time.
- Add pipeline tests for staying on a key, boundary jitter, switching to
  another key, and release grace.

**Done when:** one finger cannot activate two keys, and it does not switch
while in the gray band.

### 4. Connect key ownership to output

- Update `MarkerTrackingOverlay.tsx` to read the active key from each
  `Finger`, rather than treating every polygon overlap as pressed.
- Preserve key aggregation: multiple fingers may contribute to the same key,
  and the key stays active until all of them release it.
- Preserve velocity selection when multiple fingers contribute to one key.
- Add integration coverage for two fingers on the same key and for one finger
  switching keys.

**Done when:** key press and release events match the per-finger assignments.

### 5. Record and verify the change

- Update the affected row in `tests/verification_test_inventory.md` for any
  new or changed test file.
- Run the applicable frontend checks from `AGENTS.md` and record the results.

**Done when:** implementation, tests, inventory, and verification evidence
agree.

This describes planned behavior. It is not implemented yet.

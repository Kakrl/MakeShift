/** A press this close to a note's start, early or late, counts as a hit. */
export const HIT_WINDOW_MS = 150;

export type ScoredNote = Readonly<{ midi: number; startMs: number }>;

export type ScoreSnapshot = Readonly<{
  hits: number;
  misses: number;
  total: number;
  /** Whole percent: hits over every note plus every press that matched none. */
  score: number;
}>;

const PENDING = 0;
const HIT = 1;
const MISSED = 2;

/**
 * Matches presses to expected notes on the song clock. A press hits the
 * nearest unmatched note of its pitch inside the window; any other press is
 * a miss, and a note nobody hit by the end of its window is a miss. A
 * late-delivered press still hits a note its timestamp falls inside.
 */
export function createScorer(notes: readonly ScoredNote[], windowMs = HIT_WINDOW_MS) {
  const expected = [...notes].sort((a, b) => a.startMs - b.startMs);
  const status = new Uint8Array(expected.length);
  let stray = 0;

  function expire(positionMs: number) {
    for (let index = 0; index < expected.length; index++) {
      if (expected[index].startMs + windowMs >= positionMs) break;
      if (status[index] === PENDING) status[index] = MISSED;
    }
  }

  return {
    /** Returns whether the press hit an expected note. */
    press(midi: number, positionMs: number): boolean {
      expire(positionMs);
      let best = -1;
      let bestDistance = Infinity;
      for (let index = 0; index < expected.length; index++) {
        const note = expected[index];
        if (note.startMs - windowMs > positionMs) break;
        if (status[index] === HIT || note.midi !== midi) continue;
        const distance = Math.abs(note.startMs - positionMs);
        if (distance <= windowMs && distance < bestDistance) {
          best = index;
          bestDistance = distance;
        }
      }
      if (best < 0) {
        stray++;
        return false;
      }
      status[best] = HIT;
      return true;
    },

    snapshot(positionMs: number): ScoreSnapshot {
      expire(positionMs);
      let hits = 0;
      let missed = 0;
      for (const value of status) {
        if (value === HIT) hits++;
        else if (value === MISSED) missed++;
      }
      const attempts = expected.length + stray;
      return {
        hits,
        misses: missed + stray,
        total: expected.length,
        score: attempts === 0 ? 0 : Math.round((100 * hits) / attempts),
      };
    },

    reset() {
      status.fill(PENDING);
      stray = 0;
    },
  };
}

export type Scorer = ReturnType<typeof createScorer>;

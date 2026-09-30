import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  LiveSession,
  TRACKING_TIMEOUT_MS,
  CALIBRATION_TIMEOUT_MS,
} from "../../frontend/src/events/liveSession";
import type { BrowserAudio } from "../../frontend/src/app/audio/audioEngine";
import { CURRENT_LAYOUT, SHEET_ID } from "../../frontend/src/cv/calibration";

const calibration = () => ({
  version: 1,
  coordinates: "unmirrored-frame-pixels/marker-unit-square",
  sheet: SHEET_ID,
  camera: { deviceId: "camera", width: 1000, height: 1000, facingMode: "" },
  layout: { ...CURRENT_LAYOUT },
  corners: [
    { x: 100, y: 100 },
    { x: 900, y: 100 },
    { x: 900, y: 900 },
    { x: 100, y: 900 },
  ],
  contact: {
    model: "landmark-reference-v1",
    hover: [Array(21).fill({ x: 0.5, y: 0.4, z: 0 })],
    rest: [Array(21).fill({ x: 0.5, y: 0.5, z: 0 })],
  },
});
let now: number;
let gate: LiveSession;
let invalidate: () => void;
let detach: () => void;
let audio: {
  status: string;
  initialize: ReturnType<typeof vi.fn>;
  noteOn: ReturnType<typeof vi.fn>;
  noteOff: ReturnType<typeof vi.fn>;
  releaseAll: ReturnType<typeof vi.fn>;
  subscribeInvalidation: (fn: () => void) => () => void;
};
beforeEach(() => {
  vi.useFakeTimers();
  now = 1000;
  audio = {
    status: "idle",
    initialize: vi.fn(async () => {
      audio.status = "ready";
    }),
    noteOn: vi.fn(() => ({ session: 1, press: 1 })),
    noteOff: vi.fn(() => true),
    releaseAll: vi.fn(() => invalidate()),
    subscribeInvalidation: (fn) => {
      invalidate = fn;
      return () => {};
    },
  };
  gate = new LiveSession(audio as unknown as BrowserAudio, () => now);
  detach = gate.attach();
});
afterEach(() => {
  detach();
  vi.useRealTimers();
});
function observe() {
  const saved = calibration();
  gate.observeCalibration(saved, saved.camera, saved.corners);
  gate.observeTracking();
}
async function play() {
  observe();
  expect(await gate.prepare()).toBe(true);
  return gate.play()!;
}
function note(id: string, sequence = 1) {
  return {
    version: 1,
    sessionId: id,
    type: "note-on",
    sequence,
    timestampMs: now,
    pressId: sequence,
    pitch: 60,
    velocity: 0.8,
  };
}

it.each([null, true, {}, { ...calibration(), version: 2 }])(
  "rejects invalid calibration %j",
  async (value) => {
    const saved = calibration();
    gate.observeCalibration(value, saved.camera, saved.corners);
    gate.observeTracking();
    expect(await gate.prepare()).toBe(false);
    expect(gate.play()).toBeNull();
    expect(audio.initialize).not.toHaveBeenCalled();
  },
);
it("rejects camera mismatch and requires successful tracking", async () => {
  const saved = calibration();
  gate.observeCalibration(
    saved,
    { ...saved.camera, deviceId: "other" },
    saved.corners,
  );
  gate.observeTracking();
  expect(await gate.prepare()).toBe(false);
  gate = new LiveSession(audio as unknown as BrowserAudio, () => now);
  gate.observeCalibration(saved, saved.camera, saved.corners);
  expect(await gate.prepare()).toBe(false);
  gate.stop();
});
it("transitions stopped -> starting -> ready -> playing -> stopped with fresh identities", async () => {
  observe();
  const states: string[] = [];
  gate.subscribe(() => states.push(gate.status.state));
  expect(gate.play()).toBeNull();
  expect(await gate.prepare()).toBe(true);
  const old = gate.play()!;
  expect(gate.receive(note(old))).toBe("accepted");
  gate.stop();
  gate.stop();
  expect(audio.releaseAll).toHaveBeenCalledTimes(1);
  expect(gate.receive(note(old, 2))).toBe("stale");
  expect(states).toEqual(["starting", "ready", "playing", "stopped"]);
  expect(await gate.prepare()).toBe(true);
  const next = gate.play()!;
  expect(next).not.toBe(old);
  expect(gate.receive(note(old, 2))).toBe("stale");
  expect(gate.receive(note(next))).toBe("accepted");
});
it.each(["stop", "calibration", "tracking", "hidden"])(
  "cancels pending startup on %s",
  async (reason) => {
    observe();
    let resolve!: () => void;
    audio.initialize.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const pending = gate.prepare();
    expect(await gate.prepare()).toBe(false);
    if (reason === "stop") gate.stop();
    if (reason === "calibration") gate.observeCalibration(null, null, null);
    if (reason === "tracking") gate.trackingFailed();
    if (reason === "hidden") gate.setHidden(true);
    audio.status = "ready";
    resolve();
    expect(await pending).toBe(false);
    expect(gate.play()).toBeNull();
    expect(gate.sessionId).toBeNull();
  },
);
it.each(["calibration", "tracking", "audio", "hidden", "timeout"])(
  "releases held notes on %s and never auto resumes",
  async (reason) => {
    const id = await play();
    gate.receive(note(id));
    if (reason === "calibration") gate.observeCalibration(true, null, null);
    if (reason === "tracking") gate.trackingFailed();
    if (reason === "audio") {
      audio.status = "suspended";
      invalidate();
    }
    if (reason === "hidden") gate.setHidden(true);
    if (reason === "timeout") {
      now += TRACKING_TIMEOUT_MS;
      vi.advanceTimersByTime(TRACKING_TIMEOUT_MS);
    }
    expect(gate.status.state).toBe("interrupted");
    expect(audio.releaseAll).toHaveBeenCalledTimes(1);
    gate.setHidden(false);
    observe();
    expect(gate.receive(note(id, 2))).toBe("stale");
    expect(gate.play()).toBeNull();
    expect(await gate.prepare()).toBe(true);
    expect(gate.play()).not.toBe(id);
  },
);
it("checks freshness on dispatch even when the watchdog is delayed", async () => {
  const id = await play();
  now += TRACKING_TIMEOUT_MS;
  expect(gate.receive(note(id))).toBe("interrupted");
  expect(audio.noteOn).not.toHaveBeenCalled();
});
it("fails closed on audio rejection and malformed current-session events", async () => {
  let id = await play();
  audio.noteOn.mockReturnValueOnce(null);
  expect(gate.receive(note(id))).toBe("interrupted");
  expect(gate.status.state).toBe("interrupted");
  id = await play();
  expect(gate.receive({ ...note(id), velocity: 10 })).toBe("invalid");
  expect(gate.status.state).toBe("interrupted");
});
it("offers retry after startup failure", async () => {
  observe();
  audio.initialize.mockRejectedValueOnce(new Error("denied"));
  expect(await gate.prepare()).toBe(false);
  expect(gate.status.state).toBe("error");
  expect(gate.status.message).toContain("retry");
  expect(await gate.prepare()).toBe(true);
  expect(gate.play()).not.toBeNull();
});
it("changed calibration retires a live session even when the new result is valid", async () => {
  await play();
  const saved = calibration();
  saved.contact.rest[0][0] = { x: 0.5, y: 0.6, z: 0 };
  gate.observeCalibration(saved, saved.camera, saved.corners);
  expect(gate.status.state).toBe("interrupted");
  expect(gate.sessionId).toBeNull();
});
it("teardown cancels timers, retires notes and ignores late input", async () => {
  const id = await play();
  gate.receive(note(id));
  detach();
  expect(gate.receive(note(id, 2))).toBe("stale");
  expect(audio.releaseAll).toHaveBeenCalledTimes(1);
});

it("fresh observations cannot conceal an expired interval when the timer was delayed", async () => {
  const id = await play();
  gate.receive(note(id));
  now += TRACKING_TIMEOUT_MS;
  observe();
  expect(gate.status.state).toBe("interrupted");
  expect(gate.status.canStart).toBe(true);
  expect(gate.sessionId).toBeNull();
  expect(audio.releaseAll).toHaveBeenCalledTimes(1);
});
it("fresh calibration cannot keep an unresponsive hand detector alive", async () => {
  const id = await play();
  gate.receive(note(id));
  const saved = calibration();
  for (let i = 0; i < 4; i++) {
    now += 100;
    gate.observeCalibration(saved, saved.camera, saved.corners);
    vi.advanceTimersByTime(100);
  }
  now += 100;
  vi.advanceTimersByTime(100);
  expect(gate.status.state).toBe("interrupted");
  expect(audio.releaseAll).toHaveBeenCalledTimes(1);
});


it("named note methods pair presses and reject obsolete identities after restart", async () => {
  const old = await play();
  expect(gate.noteOn(old, 1, 60, 0.8)).toBe("accepted");
  expect(gate.noteOff(old, 1, 60)).toBe("accepted");
  expect(audio.noteOn).toHaveBeenCalledWith(60, 0.8);
  expect(audio.noteOff).toHaveBeenCalledWith({ session: 1, press: 1 });
  gate.stop();
  const next = await play();
  expect(gate.noteOn(old, 2, 64, 0.8)).toBe("stale");
  expect(gate.noteOff(old, 1, 60)).toBe("stale");
  expect(gate.noteOn(next, 1, 64, 0.8)).toBe("accepted");
  expect(gate.noteOff(next, 1, 64)).toBe("accepted");
});

it("named note methods retain readiness and malformed-input checks", async () => {
  let id = await play();
  expect(gate.noteOn(id, 1, 60, 10)).toBe("invalid");
  expect(audio.noteOn).not.toHaveBeenCalled();
  id = await play();
  expect(gate.noteOn(id, 1, 60, 0.8)).toBe("accepted");
  now += TRACKING_TIMEOUT_MS;
  expect(gate.noteOff(id, 1, 60)).toBe("interrupted");
  expect(audio.releaseAll).toHaveBeenCalled();
});

it("fresh hand tracking allows ten-second marker cadence but cannot hide marker expiry", async () => {
  const id = await play();
  gate.noteOn(id, 1, 60, 0.8);
  for (let elapsed = 100; elapsed < CALIBRATION_TIMEOUT_MS; elapsed += 100) {
    now += 100;
    vi.advanceTimersByTime(100);
    gate.observeTracking();
    expect(gate.status.state).toBe("playing");
  }
  now += 100;
  vi.advanceTimersByTime(100);
  expect(gate.status.state).toBe("interrupted");
  expect(audio.releaseAll).toHaveBeenCalledTimes(1);
  observe();
  expect(gate.status.canStart).toBe(true);
  expect(gate.noteOn(id, 2, 64, 0.8)).toBe("stale");
});

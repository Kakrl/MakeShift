import { MessageChannel } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AudioClock,
  parseNoteEvent,
  toMainTime,
  toRecordingMilliseconds,
} from "../../frontend/src/events/noteEvents";
import { Delivery, NoteSession } from "../../frontend/src/events/noteSession";

const on = (
  sessionId = "session",
  sequence = 1,
  pressId = 1,
  timestampMs = 100,
) =>
  ({
    version: 1,
    type: "note-on",
    sessionId,
    sequence,
    pressId,
    timestampMs,
    pitch: 60,
    velocity: 0.5,
  }) as const;

function fixture() {
  vi.useFakeTimers();
  let time = 100;
  const audio = vi.fn<(delivery: Delivery) => boolean>(() => true);
  const session = new NoteSession(audio, () => time);
  const id = session.start();
  const observer = vi.fn();
  session.subscribe(observer);
  return {
    session,
    id,
    audio,
    observer,
    setTime: (value: number) => {
      time = value;
    },
  };
}
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("versioned musical boundary", () => {
  it("copies and freezes all three event types, ignoring extra fields", () => {
    const raw = { ...on(), pitch: 60 as number, extra: "not forwarded" };
    const parsed = parseNoteEvent(raw);
    raw.pitch = 61;
    expect(parsed).toEqual(on());
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(parseNoteEvent({ ...on(), type: "note-off" })).toEqual({
      version: 1,
      type: "note-off",
      sessionId: "session",
      sequence: 1,
      timestampMs: 100,
      pressId: 1,
      pitch: 60,
    });
    expect(parseNoteEvent({ ...on(), type: "release-all" })).toEqual({
      version: 1,
      type: "release-all",
      sessionId: "session",
      sequence: 1,
      timestampMs: 100,
    });
  });
  it.each([
    null,
    [],
    {},
    { ...on(), version: 2 },
    { ...on(), type: "reset" },
    { ...on(), sessionId: "" },
    { ...on(), sessionId: "x".repeat(129) },
    { ...on(), sequence: 0 },
    { ...on(), sequence: 1.1 },
    { ...on(), sequence: Number.MAX_SAFE_INTEGER + 1 },
    { ...on(), pressId: 0 },
    { ...on(), pressId: "1" },
    { ...on(), pitch: -1 },
    { ...on(), pitch: 128 },
    { ...on(), pitch: 60.5 },
    { ...on(), velocity: 0 },
    { ...on(), velocity: 1.1 },
    { ...on(), velocity: NaN },
    { ...on(), timestampMs: Infinity },
    { ...on(), timestampMs: -1 },
  ])("rejects malformed data %#", (value) => {
    expect(parseNoteEvent(value)).toBeNull();
  });
});

describe("ordered session delivery", () => {
  it("dispatches audio before deferred observers, without React; separates event and receive times", () => {
    const f = fixture();
    f.setTime(150);
    expect(f.session.receive(on(f.id))).toBe("accepted");
    expect(f.audio).toHaveBeenCalledWith({
      event: on(f.id),
      receivedAtMs: 150,
    });
    expect(f.observer).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(f.observer).toHaveBeenCalledWith({
      event: on(f.id),
      receivedAtMs: 150,
    });
  });
  it("releases one of two fingers on the same pitch and allows a new press", () => {
    const f = fixture();
    f.session.receive(on(f.id));
    f.session.receive(on(f.id, 2, 2));
    expect(f.session.activePressCount).toBe(2);
    expect(f.session.receive({ ...on(f.id, 3), type: "note-off" })).toBe(
      "accepted",
    );
    expect(f.session.activePressCount).toBe(1);
    expect(f.session.receive(on(f.id, 4, 3))).toBe("accepted");
    expect(f.session.activePressCount).toBe(2);
  });
  it("ignores duplicate delivery and retires reused press identities", () => {
    const f = fixture();
    f.session.receive(on(f.id));
    expect(f.session.receive(on(f.id))).toBe("duplicate");
    expect(f.audio).toHaveBeenCalledTimes(1);
    f.session.receive({ ...on(f.id, 2), type: "note-off" });
    expect(f.session.receive(on(f.id, 3))).toBe("interrupted");
    expect(f.session.sessionId).toBeNull();
  });
  it.each([
    "gap",
    "time-regression",
    "future",
    "wrong-pitch",
    "unknown-press",
    "malformed",
  ])(
    "fails closed on %s, never discarding a possibly necessary release",
    (mode) => {
      const f = fixture();
      f.session.receive(on(f.id));
      f.setTime(110);
      const event = {
        ...on(f.id, 2, 2),
        pitch: 60 as number,
        velocity: 0.5 as number,
        type: "note-on" as string,
      };
      if (mode === "gap") event.sequence = 3;
      if (mode === "time-regression") event.timestampMs = 99;
      if (mode === "future") event.timestampMs = 111;
      if (mode === "wrong-pitch") {
        event.type = "note-off";
        event.pressId = 1;
        event.pitch = 61;
      }
      if (mode === "unknown-press") event.type = "note-off";
      if (mode === "malformed") event.velocity = NaN;
      expect(f.session.receive(event)).toBe(
        mode === "malformed" ? "invalid" : "interrupted",
      );
      expect(f.session.activePressCount).toBe(0);
      expect(f.audio.mock.calls.at(-1)?.[0].event.type).toBe("release-all");
      vi.runAllTimers();
      expect(f.observer.mock.calls.map(([d]) => d.event.type)).toEqual([
        "note-on",
        "release-all",
      ]);
    },
  );
  it.each(["stop", "interrupt", "reset", "release-all"])(
    "retires identity on %s and rejects stale input after restart",
    (operation) => {
      const f = fixture();
      f.session.receive(on(f.id));
      if (operation === "release-all")
        f.session.receive({ ...on(f.id, 2), type: "release-all" });
      else if (operation === "reset") f.session.reset();
      else if (operation === "stop") f.session.stop();
      else f.session.interrupt();
      const next = f.session.start();
      expect(next).not.toBe(f.id);
      expect(f.session.receive(on(f.id, 3, 2))).toBe("stale");
      expect(f.session.receive(on(next))).toBe("accepted");
      vi.runAllTimers();
      const delivered = f.observer.mock.calls.map(
        ([delivery]) => delivery.event,
      );
      expect(delivered.filter((e) => e.type === "note-on")).toEqual([
        on(f.id),
        on(next),
      ]);
      expect(delivered.findIndex((e) => e.type === "release-all")).toBe(1);
      expect(delivered.at(-1)).toEqual(on(next));
    },
  );
  it("protects audio from throwing observers and unsubscribes", () => {
    const f = fixture();
    const broken = vi.fn(() => {
      throw new Error("MIDI failed");
    });
    const unsubscribe = f.session.subscribe(broken);
    const last = vi.fn();
    f.session.subscribe(last);
    f.session.receive(on(f.id));
    expect(() => vi.runAllTimers()).not.toThrow();
    expect(last).toHaveBeenCalledTimes(1);
    unsubscribe();
    f.session.receive(on(f.id, 2, 2));
    vi.runAllTimers();
    expect(broken).toHaveBeenCalledTimes(1);
    expect(last).toHaveBeenCalledTimes(2);
  });
  it("interrupts when audio rejects input or throws", () => {
    for (const throws of [false, true]) {
      const f = fixture();
      f.audio.mockImplementation(() => {
        if (throws) throw new Error("device");
        return false;
      });
      expect(f.session.receive(on(f.id))).toBe("interrupted");
      expect(f.session.sessionId).toBeNull();
      expect(f.session.activePressCount).toBe(0);
    }
  });
  it("bounds observer backlog and active presses, ending with a terminal notification", () => {
    const f = fixture();
    for (let i = 1; i <= 129; i++) f.session.receive(on(f.id, i, i));
    expect(f.session.sessionId).toBeNull();
    const next = f.session.start();
    for (let i = 1; i <= 257; i++) {
      f.session.receive({
        ...on(next, i, Math.ceil(i / 2)),
        type: i % 2 ? "note-on" : "note-off",
      });
    }
    expect(f.session.sessionId).toBeNull();
    vi.runAllTimers();
    expect(
      f.observer.mock.calls.every(([d]) => d.event.type === "release-all"),
    ).toBe(true);
  });
  it("preserves already accepted history before an observer-triggered interruption", () => {
    const f = fixture();
    const seen: Delivery[] = [];
    f.session.subscribe((d) => {
      seen.push(d);
      if (d.event.type === "note-on") f.session.interrupt();
    });
    f.session.receive(on(f.id));
    f.session.receive(on(f.id, 2, 2));
    vi.runAllTimers();
    expect(seen.map((d) => d.event.type)).toEqual([
      "note-on",
      "note-on",
      "release-all",
    ]);
  });
});

describe("clock conversion", () => {
  it("normalizes worker offsets once and preserves source time despite delayed delivery", () => {
    expect(toMainTime(30, 1_000_020, 1_000_000)).toBe(50);
    expect(toMainTime(70, 999_980, 1_000_000)).toBe(50);
    const f = fixture();
    f.setTime(200);
    expect(
      f.session.receive(on(f.id, 1, 1, 80), {
        sourceOriginMs: 1020,
        mainOriginMs: 1000,
      }),
    ).toBe("accepted");
    expect(f.audio.mock.calls[0][0]).toEqual({
      event: on(f.id),
      receivedAtMs: 200,
    });
  });
  it("maps milliseconds to audio seconds with no extra delay and reanchors after suspension", () => {
    const clock = new AudioClock();
    expect(() => clock.toSeconds(100, 1)).toThrow("suspended");
    clock.resume(1000, 2);
    expect(clock.toSeconds(1020, 2.01)).toBeCloseTo(2.02);
    expect(clock.toSeconds(1020, 2.2)).toBe(2.2);
    clock.suspend();
    expect(() => clock.toSeconds(1020, 2.2)).toThrow("suspended");
    clock.resume(5000, 2.2);
    expect(clock.toSeconds(5020, 2.2)).toBeCloseTo(2.22);
  });
  it("maps MIDI elapsed time explicitly, including excluded pauses", () => {
    expect(toRecordingMilliseconds(1400, 1000)).toBe(400);
    expect(toRecordingMilliseconds(1400, 1000, 250)).toBe(150);
    expect(toRecordingMilliseconds(900, 1000)).toBe(0);
    expect(toRecordingMilliseconds(1010, 1000)).toBe(10);
    expect(toRecordingMilliseconds(1400, 1300)).toBe(100);
  });
  it("rejects invalid offsets and clock inputs", () => {
    expect(() => toMainTime(1, NaN, 0)).toThrow();
    expect(() => toMainTime(0, 0, 1)).toThrow();
    expect(() => toRecordingMilliseconds(100, 0, -1)).toThrow();
    const clock = new AudioClock();
    expect(() => clock.resume(Infinity, 0)).toThrow();
    clock.resume(0, 0);
    expect(() => clock.toSeconds(NaN, 0)).toThrow();
    const f = fixture();
    expect(
      f.session.receive(on(f.id), { sourceOriginMs: NaN, mainOriginMs: 1 }),
    ).toBe("invalid");
    expect(f.session.sessionId).toBeNull();
  });
});

describe("ordinary message transport", () => {
  it("validates structured-cloned messages on a real MessagePort and preserves FIFO", async () => {
    const delivered: Delivery[] = [];
    const session = new NoteSession(
      (d) => {
        delivered.push(d);
        return true;
      },
      () => 100,
    );
    const id = session.start();
    const { port1, port2 } = new MessageChannel();
    try {
      await new Promise<void>((resolve, reject) => {
        port2.on("message", (value) => {
          try {
            expect(session.receive(value)).toBe("accepted");
            if (value.sequence === 3) resolve();
          } catch (error) {
            reject(error);
          }
        });
        port1.postMessage(on(id));
        port1.postMessage({ ...on(id, 2), type: "note-off" });
        port1.postMessage({ ...on(id, 3), type: "release-all" });
      });
      expect(delivered.map((d) => d.event.type)).toEqual([
        "note-on",
        "note-off",
        "release-all",
      ]);
      expect(session.activePressCount).toBe(0);
    } finally {
      port1.close();
      port2.close();
      session.stop();
    }
  });
});

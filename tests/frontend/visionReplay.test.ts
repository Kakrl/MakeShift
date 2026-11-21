import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { VisionReplay } from "../../frontend/src/cv/visionReplay";

let replay: VisionReplay;
let worker: {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onmessageerror: (() => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
};
const send = (data: unknown) => worker.onmessage?.({ data });
function reply(keys = [0, 1, 12]) {
  const request = worker.postMessage.mock.calls.at(-1)![0];
  send({ type: "frame", id: request.id, epoch: 0, processMs: 15,
    result: { width: 2, height: 2, pressedKeys: keys } });
}
beforeEach(() => {
  vi.useFakeTimers();
  worker = { onmessage: null, onerror: null, onmessageerror: null,
    postMessage: vi.fn(), terminate: vi.fn() };
  replay = new VisionReplay(() => worker as unknown as Worker);
});
afterEach(() => { replay.dispose(); vi.useRealTimers(); });
it("waits for worker readiness, transfers ordered frames, and preserves chromatic offsets", async () => {
  const rgba = new Uint8ClampedArray(16);
  const first = replay.process(rgba, 2, 2, 1, true);
  expect(worker.postMessage).not.toHaveBeenCalled();
  send({ type: "ready" }); await Promise.resolve();
  expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ setReference: true, id: 1 }), [rgba.buffer]);
  reply(); await expect(first).resolves.toMatchObject({ result: { pressedKeys: [0, 1, 12] }, processMs: 15 });
  const second = replay.process(new Uint8ClampedArray(16), 2, 2, 1, false);
  await Promise.resolve();
  expect(worker.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ setReference: false, id: 2 }), expect.any(Array));
  reply([]); await expect(second).resolves.toMatchObject({ result: { pressedKeys: [] } });
});
it("rejects overlapping submissions without overwriting the pending frame", async () => {
  send({ type: "ready" });
  const first = replay.process(new Uint8ClampedArray(16), 2, 2, 1, true);
  await Promise.resolve();
  await expect(replay.process(new Uint8ClampedArray(16), 2, 2, 1, false)).rejects.toThrow("pending frame");
  reply([]); await first;
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
});
it.each(["worker-error", "message-error", "timeout", "wrong-id", "dispose"])("rejects pending replay on %s and terminates once", async mode => {
  send({ type: "ready" });
  const pending = replay.process(new Uint8ClampedArray(16), 2, 2, 1, true);
  const rejection = expect(pending).rejects.toThrow();
  await Promise.resolve();
  if (mode === "worker-error") worker.onerror?.();
  if (mode === "message-error") worker.onmessageerror?.();
  if (mode === "timeout") await vi.advanceTimersByTimeAsync(30_000);
  if (mode === "wrong-id") send({ type: "frame", id: 99, epoch: 0 });
  if (mode === "dispose") replay.dispose();
  await rejection; replay.dispose(); expect(worker.terminate).toHaveBeenCalledTimes(1);
});
it("reports a startup failure even before the first submission", async () => {
  send({ type: "error", message: "WASM unavailable" });
  await expect(replay.process(new Uint8ClampedArray(16), 2, 2, 1, true)).rejects.toThrow("WASM unavailable");
});
it("rejects malformed key snapshots", async () => {
  send({ type: "ready" });
  const pending = replay.process(new Uint8ClampedArray(16), 2, 2, 1, true);
  await Promise.resolve(); reply([1, 1]);
  await expect(pending).rejects.toThrow("invalid keys"); expect(worker.terminate).toHaveBeenCalledOnce();
});

import loadVision from "./makeshift-vision.mjs";

let model;
const fail = (error) =>
  self.postMessage({
    type: "error",
    message: error instanceof Error ? error.message : "Vision failed",
  });
self.onmessage = ({ data }) => {
  try {
    if (!model) throw new Error("Vision is not ready");
    if (data.type === "reset") {
      model.reset();
      return;
    }
    if (data.type !== "frame") throw new Error("Unknown Vision worker request");
    if (data.setReference) model.setReference();
    const started = performance.now();
    const result = model.processFrame({
      rgba: data.rgba,
      width: data.width,
      height: data.height,
      octaves: data.octaves,
    });
    self.postMessage({
      type: "frame",
      id: data.id,
      epoch: data.epoch,
      result,
      processMs: performance.now() - started,
    });
  } catch (error) {
    // The main thread retires this worker and releases the musical session.
    model?.destroy();
    model = undefined;
    fail(error);
  }
};
loadVision()
  .then((api) => {
    model = api.createVision();
    self.postMessage({ type: "ready" });
  })
  .catch(fail);

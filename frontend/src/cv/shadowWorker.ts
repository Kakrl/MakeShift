import {
  observeShadow,
  type ShadowWorkerRequest,
  type ShadowWorkerResponse,
} from "./shadowHeuristics";

// Keep worker scope types local instead of adding conflicting DOM/WebWorker libs.
const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<ShadowWorkerRequest>) => void) | null;
  postMessage: (
    message: ShadowWorkerResponse,
    transfer: Transferable[],
  ) => void;
};

workerScope.onmessage = ({ data }) => {
  const observations = data.fingers.map(
    ({ id, point, previous, keyOverlap }) => ({
      id,
      keyOverlap,
      observation: observeShadow(data.imageData, point, data.radius, previous, {
        createMask: id === data.previewFingerId,
      }),
    }),
  );
  const transfer: Transferable[] = [];
  for (const { observation } of observations) {
    if (observation.mask) transfer.push(observation.mask.data.buffer);
    if (observation.contour.boundary) {
      transfer.push(observation.contour.boundary.buffer as ArrayBuffer);
    }
  }
  workerScope.postMessage(
    { observations, frameAtMs: data.frameAtMs },
    transfer,
  );
};

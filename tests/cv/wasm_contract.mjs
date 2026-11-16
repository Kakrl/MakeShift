// Shared contract/parity assertions, run in Node and in a real browser module worker.
export async function checkContract(loadVision, manifest, readBytes, setTime) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const rejects = (fn, message) => {
    let threw = false;
    try { fn(); } catch (error) { threw = error instanceof Error; }
    assert(threw, message);
  };
  const normalize = (expected) => {
    expected.referenceReady = Boolean(expected.referenceReady);
    expected.homographyReady = Boolean(expected.homographyReady);
    expected.referenceScan.reason ||= null;
    expected.geometry ??= null;
    expected.fingertips.forEach((t) => { t.pressed = Boolean(t.pressed); });
    return expected;
  };
  const compare = (a, b, path = '') => {
    if (typeof a === 'number' && typeof b === 'number') {
      const drawing = /outline|Outline|whiteKeyPolygons/.test(path);
      const tolerance = drawing ? 1 : path.includes('geometry') ? 0.001 : 0.000001;
      assert(Number.isFinite(a) && Math.abs(a - b) <= tolerance, `${path}: ${a} != ${b}`);
    } else if (a && b && typeof a === 'object' && typeof b === 'object') {
      assert(Array.isArray(a) === Array.isArray(b), `${path}: array mismatch`);
      assert(JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort()), `${path}: keys differ`);
      for (const key of Object.keys(b)) compare(a[key], b[key], `${path}.${key}`);
    } else assert(a === b, `${path}: ${a} != ${b}`);
  };
  const api = await loadVision();
  const model = api.createVision();
  const independent = api.createVision();
  let frames = 0, pixels = 0, saved, savedText, savedPlane, savedPlaneCopy;
  const times = [];
  const wallNow = Date.now.bind(Date);
  try {
    rejects(() => model.processFrame(null), 'Reject missing frame');
    rejects(() => model.processFrame({ width: 2, height: 2, octaves: 1, rgba: new Uint8Array(4) }), 'Reject byte length');
    rejects(() => model.processFrame({ width: 1, height: 1, octaves: 1, rgba: new Uint16Array(4) }), 'Reject pixel type');
    rejects(() => model.processFrame({ width: 4097, height: 1, octaves: 1, rgba: new Uint8Array(0) }), 'Reject frame limit');
    rejects(() => model.processFrame({ width: 1, height: 1, octaves: 4, rgba: new Uint8Array(4) }), 'Reject octave count');
    for (const step of manifest.steps) {
      if (step.action !== 'frame') { model[step.action](); continue; }
      setTime(step.time);
      const bytes = await readBytes(step.file);
      // Check clamped and offset typed-array inputs, without detaching caller storage.
      const storage = new Uint8Array(bytes.length + 8);
      storage.set(bytes, 4);
      const rgba = frames % 2 ? new Uint8ClampedArray(storage.buffer, 4, bytes.length) : storage.subarray(4, 4 + bytes.length);
      const input = { rgba, width: step.width, height: step.height, octaves: step.octaves };
      const started = wallNow();
      const actual = model.processFrame(input);
      times.push(wallNow() - started);
      compare(actual, normalize(step.expected), `frame${frames}`);
      assert(rgba.byteLength === bytes.length, 'Input array remains owned by caller');
      if (!saved && actual.referenceReady) { saved = actual; savedText = JSON.stringify(actual); }
      if (saved) assert(JSON.stringify(saved) === savedText, 'Returned result survives subsequent calls');
      const diagnostics = model.getDiagnostics();
      if (step.diagnostics !== undefined) {
        assert(diagnostics !== null && diagnostics.width === step.analysisWidth &&
          diagnostics.height === step.analysisHeight, 'Diagnostic dimensions match native');
        for (const [field, suffix, floats] of [
          ['fingerMask', 'mask', false], ['valid', 'valid', false], ['rawDrop', 'raw', true], ['score', 'score', true],
        ]) {
          const expected = await readBytes(`${step.diagnostics}.${suffix}`);
          const plane = diagnostics[field];
          assert(plane.length * (floats ? 4 : 1) === expected.length, `Diagnostic ${field} length`);
          const view = new DataView(expected.buffer, expected.byteOffset, expected.byteLength);
          for (let i = 0; i < plane.length; i++) {
            const value = floats ? view.getFloat32(i * 4, true) : expected[i];
            assert(Math.abs(plane[i] - value) <= (floats ? 0.001 : 0), `Diagnostic ${field}[${i}]: ${plane[i]} != ${value}`);
          }
          pixels += plane.length;
        }
        if (!savedPlane) { savedPlane = diagnostics.fingerMask; savedPlaneCopy = savedPlane.slice(); }
        diagnostics.fingerMask.fill(7);
        assert(model.getDiagnostics().fingerMask[0] !== 7, 'Diagnostics are copies, not WASM heap views');
      } else assert(diagnostics === null, 'Capture/unready frames have no stale diagnostics');
      if (savedPlane && savedPlaneCopy) {
        // The first diagnostic snapshot was intentionally mutated above; its caller-owned data stays valid.
        assert(savedPlane.length === savedPlaneCopy.length && savedPlane[0] === 7, 'Old diagnostic snapshot survives calls');
      }
      if (actual.referenceReady) {
        const other = independent.processFrame(input);
        assert(!other.referenceReady && other.fingertips.length === 0, 'Instances have independent references');
      }
      frames++;
    }
    independent.destroy(); independent.destroy();
    rejects(() => independent.reset(), 'Destroyed instance rejects reset');
    rejects(() => independent.setReference(), 'Destroyed instance rejects capture');
    rejects(() => independent.getDiagnostics(), 'Destroyed instance rejects diagnostic access');
    for (let i = 0; i < 20; i++) { const instance = api.createVision(); instance.destroy(); }
    return { frames, comparedPlaneSamples: pixels, maxProcessMs: Math.max(...times) };
  } finally { model.destroy(); independent.destroy(); }
}

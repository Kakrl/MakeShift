import createKernel from './makeshift-vision-core.mjs';

/** Load one WASM runtime; each createVision() owns independent reference/press state. */
export default async function loadVision({ wasmURL, wasmBinary } = {}) {
  const module = await createKernel({
    locateFile: (name) => name.endsWith('.wasm') && wasmURL
      ? String(wasmURL) : new URL(name, import.meta.url).href,
    ...(wasmBinary === undefined ? {} : { wasmBinary }),
  });
  return {
    createVision() {
      let binding = new module.VisionBinding();
      let failed = false;
      const requireAlive = () => {
        if (!binding) throw new Error('Vision instance was destroyed');
      };
      return {
        setReference() {
          requireAlive();
          if (failed) throw new Error('Reset Vision after a processing failure');
          binding.setReference();
        },
        processFrame(frame) {
          requireAlive();
          if (failed) throw new Error('Reset Vision after a processing failure');
          const { rgba, width, height, octaves } = frame ?? {};
          if (!Number.isInteger(width) || !Number.isInteger(height) ||
              width < 1 || height < 1 || width > module.maximumFrameSide || height > module.maximumFrameSide ||
              ![1, 2, 3].includes(octaves)) {
            throw new TypeError(`Expected 1..${module.maximumFrameSide} frame dimensions and 1..3 octaves`);
          }
          if (!(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) ||
              rgba.length !== width * height * 4) {
            throw new TypeError('Expected tightly packed RGBA8 bytes matching frame dimensions');
          }
          let result;
          try { result = binding.processFrame(rgba, width, height, octaves); }
          catch (error) { failed = true; throw new Error('Vision processing failed', { cause: error }); }
          if (result.error) { failed = true; throw new Error(result.error); }
          return result;
        },
        getDiagnostics() {
          requireAlive();
          if (failed) throw new Error('Reset Vision after a processing failure');
          return binding.diagnostics();
        },
        reset() { requireAlive(); binding.reset(); failed = false; },
        destroy() { if (binding) { binding.delete(); binding = null; } },
      };
    },
  };
}

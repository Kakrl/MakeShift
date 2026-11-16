import loadVision from '/dist/makeshift-vision.mjs';
import { checkContract } from '/tests/wasm_contract.mjs';
onmessage = async () => {
  let time = 0;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => time });
  try {
    const manifest = await (await fetch('/fixtures/manifest.json')).json();
    const result = await checkContract(loadVision, manifest,
      async (name) => new Uint8Array(await (await fetch(`/fixtures/${name}`)).arrayBuffer()),
      (value) => { time = value; });
    postMessage({ status: 'PASS', runtime: 'browser module worker', ...result });
  } catch (error) { postMessage({ status: 'FAIL', error: error.stack || String(error) }); }
};

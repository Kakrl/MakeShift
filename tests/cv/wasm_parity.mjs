import { spawnSync } from 'node:child_process';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkContract } from './wasm_contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = await mkdtemp(path.join(tmpdir(), 'makeshift-wasm-parity-'));
const oracle = process.env.VISION_NATIVE_ORACLE ?? path.join(root, 'build/vision/wasm_parity_native');
const native = spawnSync(oracle, [directory], { encoding: 'utf8' });
if (native.status !== 0) throw new Error(native.stderr || native.error?.message || 'Native oracle failed');
const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
const { default: load } = await import(pathToFileURL(path.join(root, 'backend/src/CV/wasm/dist/makeshift-vision.mjs')));
const binary = await readFile(path.join(root, 'backend/src/CV/wasm/dist/makeshift-vision-core.wasm'));
const original = Object.getOwnPropertyDescriptor(performance, 'now');
let time = 0;
Object.defineProperty(performance, 'now', { configurable: true, value: () => time });
try {
  const result = await checkContract(() => load({ wasmBinary: binary }), manifest,
    async (name) => new Uint8Array(await readFile(path.join(directory, name))), (value) => { time = value; });
  console.log(JSON.stringify({ status: 'PASS', runtime: 'Node', ...result, evidence: directory }));
} finally {
  if (original) Object.defineProperty(performance, 'now', original); else delete performance.now;
}
// Browser check is separate so it can be invoked when a browser is available.
console.log(`Browser fixtures: ${directory}`);

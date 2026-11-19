import { spawnSync } from 'node:child_process';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'frontend/package.json'));
const { chromium } = require('playwright');
const directory = await mkdtemp(path.join(tmpdir(), 'makeshift-wasm-browser-'));
const native = spawnSync(process.env.VISION_NATIVE_ORACLE ?? path.join(root, 'build/vision/wasm_parity_native'),
  [directory], { encoding: 'utf8' });
if (native.status !== 0) throw new Error(native.stderr || native.error?.message || 'Native oracle failed');
const roots = { dist: path.join(root, 'backend/src/CV/wasm/dist'), tests: path.join(root, 'tests/cv'), fixtures: directory };
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/') { response.end('<!doctype html><title>Vision WASM contract test</title>'); return; }
    const [, group, name] = new URL(request.url, 'http://localhost').pathname.split('/');
    if (!roots[group] || !name || name === '..' || !/^[\w.-]+$/.test(name)) { response.writeHead(404).end(); return; }
    const bytes = await readFile(path.join(roots[group], name));
    response.setHeader('Content-Type', name.endsWith('.mjs') ? 'text/javascript' :
      name.endsWith('.wasm') ? 'application/wasm' : name.endsWith('.json') ? 'application/json' : 'application/octet-stream');
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.VISION_BROWSER_CHANNEL ?? 'chrome' });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(() => new Promise((resolve, reject) => {
    const worker = new Worker('/tests/wasmParity.worker.mjs', { type: 'module' });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Worker parity timed out')); }, 120000);
    worker.onmessage = (event) => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
    worker.onerror = (event) => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
    worker.postMessage('run');
  }));
  if (result.status !== 'PASS') throw new Error(result.error);
  console.log(JSON.stringify({ ...result, browser: browser.version(), evidence: directory }));
} finally { if (browser) await browser.close(); await new Promise((resolve) => server.close(resolve)); }

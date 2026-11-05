// Native-port parity runner. Uses the unchanged frontend source as the oracle.
// Run from root: node tests/cv/frontend_baseline_parity.cjs OUTPUT [INPUT_DIR]
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, 'frontend/node_modules/typescript'));
const sharp = require(path.join(root, 'frontend/node_modules/sharp'));
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { measureShadowDifference } = require(path.join(root, 'frontend/src/cv/shadowHeatmap.ts'));
const { identifyFilteredFingertips } = require(path.join(root, 'frontend/src/cv/fingertipCandidates.ts'));
const { measureMonotoneShadowPaths, LIVE_SHADOW_DFS_SETTINGS } = require(path.join(root, 'frontend/src/cv/shadowTipEvidence.ts'));
const out = process.argv[2] && path.resolve(process.argv[2]);
if (!out || !fs.existsSync(out) || !fs.statSync(out).isDirectory()) throw Error('Supply an existing results folder; generated files are replaced');
const hashes = {};
for (const file of ['shadowHeatmap', 'fingertipCandidates', 'shadowTipEvidence', 'homography']) {
  hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, `frontend/src/cv/${file}.ts`))).digest('hex');
}
function fixture() {
  const width = 80, height = 100, data = new Uint8ClampedArray(width * height * 4).fill(230);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const reference = { width, height, data: data.slice() }, current = { width, height, data };
  const paint = (x, y, rgb = [150, 150, 150]) => data.set([...rgb, 255], (y * width + x) * 4);
  const finger = () => { for (let x = 30; x <= 49; x++) for (let y = 10; y <= 60; y++) paint(x, y, [150, 95, 75]); };
  return { current, reference, paint, finger };
}
async function check(name, current, reference) {
  const currentPath = path.join(out, `${name}-current.png`), referencePath = path.join(out, `${name}-reference.png`);
  for (const [image, dest] of [[current, currentPath], [reference, referencePath]])
    await sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: 4 } }).png().toFile(dest);
  const difference = measureShadowDifference(current, reference);
  const estimate = identifyFilteredFingertips(difference);
  const paths = estimate.candidates.map(tip => measureMonotoneShadowPaths(difference, estimate.mask, tip, undefined, LIVE_SHADOW_DFS_SETTINGS));
  const expected = {
    current: currentPath, reference: referencePath,
    difference: Object.fromEntries(['lumaDrop', 'colorShift', 'multiplier', 'attenuation', 'residualReference', 'residualCurrent'].map(k =>
      [k, Array.from(difference[k], n => Number.isFinite(n) ? n : -999)])),
    valid: [...difference.valid], projectionValid: [...difference.projectionValid], mask: [...estimate.mask],
    candidates: estimate.candidates, paths,
  };
  // FileStorage reads numeric booleans; omit null witness fields.
  const json = JSON.stringify(expected, (key, value) => {
    if (value === null) return undefined;
    if (key === 'patternMatch') return undefined;
    if (key === 'widthWitness' && value === null) return undefined;
    if (typeof value === 'boolean') return Number(value);
    if (key === 'levels') return value.map(level => ({ ...level, decision: level.patternMatch === null ? -1 : Number(level.patternMatch) }));
    return value;
  });
  const file = path.join(out, `${name}.json`); fs.writeFileSync(file, json);
  const result = spawnSync(path.join(root, 'build/mog2/baseline_tests'), [file], { encoding: 'utf8' });
  if (result.status !== 0) throw Error(`${name}: ${result.stdout}${result.stderr}`);
  const counts = paths.flatMap(p => p.levels.map(l => l.patternMatch));
  console.log(`PASS ${name}: ${estimate.candidates.length} candidates; ${counts.filter(v => v === true).length} matches / ${counts.filter(v => v === false).length} rejections / ${counts.filter(v => v === null).length} unknowns`);
  return { name, candidates: estimate.candidates.length, decisions: counts };
}
async function main() {
  const results = [];
  for (const name of ['empty', 'clear', 'thin', 'four-wide', 'five-wide', 'downward', 'both-targets', 'unknown', 'black', 'alpha', 'curved']) {
    const f = fixture();
    if (name !== 'empty') f.finger();
    if (['thin', 'four-wide', 'five-wide', 'downward', 'both-targets', 'unknown'].includes(name)) {
      for (let y = 52; y <= 60; y++) f.paint(29, y);
    }
    if (['five-wide', 'downward', 'both-targets', 'unknown'].includes(name)) for (let x = 25; x <= 29; x++) f.paint(x, 54);
    if (name === 'four-wide') for (let x = 26; x <= 29; x++) f.paint(x, 54);
    if (name === 'downward') for (let y = 61; y <= 64; y++) f.paint(40, y, [200, 200, 200]);
    if (name === 'both-targets') for (let y = 60; y <= 64; y++) f.paint(29, y);
    if (name === 'unknown') f.reference.data[(54 * 80 + 28) * 4 + 3] = 0;
    if (name === 'black') f.paint(29, 60, [0, 0, 0]);
    if (name === 'alpha') f.current.data[(60 * 80 + 40) * 4 + 3] = 0;
    if (name === 'curved') {
      f.current.data.set(f.reference.data);
      for (let x = 30; x <= 49; x++) for (let y = 10; y <= 60 - Math.abs(x - 40); y++) f.paint(x, y, [150, 95, 75]);
    }
    results.push(await check(name, f.current, f.reference));
  }
  if (process.argv[3]) {
    const input = path.resolve(process.argv[3]);
    const decode = async file => {
      const image = sharp(file), meta = await image.metadata();
      const scale = Math.min(1, 640 / Math.max(meta.width, meta.height));
      const width = Math.round(meta.width * scale), height = Math.round(meta.height * scale);
      const data = await image.resize(width, height).ensureAlpha().raw().toBuffer();
      return { width, height, data: new Uint8ClampedArray(data) };
    };
    const reference = await decode(path.join(input, 'background.png'));
    let i = 0;
    for (const file of fs.readdirSync(input).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).sort()) {
      results.push({ ...await check(`real-${String(i++).padStart(3, '0')}`, await decode(path.join(input, file)), reference), source: file });
    }
  }
  const runner = path.join(root, 'build/mog2/shadow_images');
  const corners = path.join(out, 'corners.json');
  fs.writeFileSync(corners, JSON.stringify({ source: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 100 }, { x: 0, y: 100 }] }));
  const run = (args, succeeds) => {
    const result = spawnSync(runner, args, { encoding: 'utf8' });
    if ((result.status === 0) !== succeeds) throw Error(`Runner status ${result.status}: ${result.stdout}${result.stderr}`);
  };
  const smoke = out;
  const args = [`--image=${path.join(out, 'five-wide-current.png')}`, `--reference=${path.join(out, 'five-wide-reference.png')}`, `--output=${smoke}`, `--corners=${corners}`, '--residual=0.12'];
  run(args, true);
  for (const file of ['index.html', 'source.png', 'reference.png', 'boundary.png', 'valid.png', 'shadow-compatible.png', 'darkening.png', 'candidates.png', 'results.json', 'measurements.yml.gz',
    'original.png', 'original-results.png', 'comparison.png', 'heatmap-darkening.png', 'heatmap-residual.png', 'heatmap-color-shift.png', 'heatmap-shadow.png', 'shadow-classes.png', 'dfs-5.png', 'dfs-20.png', 'dfs-40.png', 'dfs-60.png', 'dfs-comparison.png'])
    if (!fs.existsSync(path.join(smoke, file))) throw Error(`Missing runner artifact ${file}`);
  const reportFile = path.join(smoke, 'results.json'), reportBytes = fs.readFileSync(reportFile);
  const report = JSON.parse(reportBytes);
  const settingsCheck = spawnSync(path.join(root, 'build/mog2/baseline_tests'), ['--report-settings', reportFile], { encoding: 'utf8' });
  if (settingsCheck.status !== 0) throw Error(`Report settings mismatch: ${settingsCheck.stdout}${settingsCheck.stderr}`);
  if (report.candidates.length !== 1 || Math.abs(report.candidates[0].sheet.x - 0.5) > 1e-10 ||
      Math.abs(report.candidates[0].sheet.y - 0.6) > 1e-10 || report.candidates[0].levels.some(l => l.decision !== 1)) throw Error('Runner projection/decisions');
  fs.writeFileSync(reportFile, 'stale report');
  run(args, true);
  if (!fs.readFileSync(reportFile).equals(reportBytes)) throw Error('Rerun did not replace stale report');
  run([...args, '--residual=0.9'], true);
  const relaxed = JSON.parse(fs.readFileSync(reportFile));
  if (relaxed.maximumResidual !== 0.9 || relaxed.candidates.length !== 0) throw Error('Residual override not applied to geometry/report');
  if (!(await sharp(path.join(smoke, 'boundary.png')).raw().toBuffer()).every(v => v === 0)) throw Error('Residual override mask');
  if (!fs.readFileSync(path.join(smoke, 'index.html'), 'utf8').includes('<=0.9')) throw Error('Residual legend override');
  run(args, true);
  run([...args, '--dark-shadows-only=true'], true);
  const restricted = JSON.parse(fs.readFileSync(reportFile));
  if (!restricted.darkShadowsOnly || restricted.maximumSearchCurrentLuma !== 110 ||
      restricted.candidates.length !== report.candidates.length ||
      restricted.candidates.some(c => c.levels.some(l => l.decision !== 0))) throw Error('Dark-only CLI restriction');
  run(args, true);
  run([...args, '--residual=-1'], false);
  run([...args, '--max-side=-1'], false);
  run(args.map(a => a.startsWith('--image=') ? '--image=missing-native-baseline.png' : a), false);
  run(args.map(a => a.startsWith('--corners=') ? '--corners=missing-native-corners.json' : a), false);
  const invalidOutput = path.join(out, 'mismatch-output');
  const tiny = path.join(out, 'tiny.png');
  await sharp({ create: { width: 10, height: 10, channels: 4, background: 'white' } }).png().toFile(tiny);
  run([`--image=${tiny}`, args[1], `--output=${invalidOutput}`], false);
  if (fs.existsSync(invalidOutput)) throw Error('Invalid input created output');
  const pixel = async (folder, file, x, y) => [...await sharp(path.join(folder, file)).extract({ left: x, top: y, width: 1, height: 1 }).removeAlpha().raw().toBuffer()];
  const equalPixel = async (folder, file, x, y, expected) => {
    const value = await pixel(folder, file, x, y);
    if (value.some((v, i) => v !== expected[i])) throw Error(`${file}: expected ${expected}, got ${value}`);
  };
  await equalPixel(smoke, 'heatmap-darkening.png', 0, 0, [0, 0, 0]);
  await equalPixel(smoke, 'shadow-classes.png', 40, 40, [0, 0, 100]);
  await equalPixel(smoke, 'shadow-classes.png', 29, 54, [128, 128, 128]);
  const classes = fixture(); classes.finger();
  classes.paint(10, 10, [110, 110, 110]); classes.paint(11, 10, [111, 111, 111]);
  const classInput = path.join(out, 'classification-current.png');
  await sharp(Buffer.from(classes.current.data), { raw: { width: 80, height: 100, channels: 4 } }).png().toFile(classInput);
  run([`--image=${classInput}`, args[1], `--output=${smoke}`], true);
  await equalPixel(smoke, 'shadow-classes.png', 10, 10, [180, 0, 180]);
  await equalPixel(smoke, 'shadow-classes.png', 11, 10, [128, 128, 128]);
  run(args, true);
  await equalPixel(smoke, 'heatmap-shadow.png', 40, 40, [0, 0, 0]); // Filter-rejected finger.
  await equalPixel(smoke, 'heatmap-residual.png', 29, 54, [0, 0, 0]); // Proportional neutral shadow.
  if ((await pixel(smoke, 'heatmap-shadow.png', 29, 54)).every(v => v === 0)) throw Error('Missing neutral shadow heatmap');
  const self = out;
  run([args[1].replace('--reference=', '--image='), args[1], `--output=${self}`], true);
  if (JSON.parse(fs.readFileSync(path.join(self, 'results.json'))).candidates.length !== 0) throw Error('Self-reference proposals');
  const unknownOutput = out;
  run([`--image=${path.join(out, 'alpha-current.png')}`, args[1], `--output=${unknownOutput}`], true);
  await equalPixel(unknownOutput, 'heatmap-darkening.png', 40, 60, [128, 128, 128]);
  await equalPixel(unknownOutput, 'heatmap-residual.png', 40, 60, [128, 128, 128]);
  await equalPixel(unknownOutput, 'shadow-classes.png', 40, 60, [0, 0, 0]);
  const scaled = out, nativeCurrent = path.join(out, 'native-current.png'), nativeReference = path.join(out, 'native-reference.png');
  await sharp(path.join(out, 'five-wide-current.png')).resize(160, 200, { kernel: 'nearest' }).toFile(nativeCurrent);
  await sharp(path.join(out, 'five-wide-reference.png')).resize(160, 200, { kernel: 'nearest' }).toFile(nativeReference);
  run([`--image=${nativeCurrent}`, `--reference=${nativeReference}`, `--output=${scaled}`, '--max-side=100'], true);
  for (const [file, width, height] of [['original.png', 160, 200], ['original-results.png', 160, 200], ['source.png', 80, 100], ['comparison.png', 240, 492], ['dfs-comparison.png', 160, 328]]) {
    const meta = await sharp(path.join(scaled, file)).metadata();
    if (meta.width !== width || meta.height !== height) throw Error(`${file}: wrong diagnostic dimensions`);
  }
  const originalPixels = await sharp(nativeCurrent).removeAlpha().raw().toBuffer();
  if (!(await sharp(path.join(scaled, 'original.png')).raw().toBuffer()).equals(originalPixels)) throw Error('Original pixels changed');
  if ((await sharp(path.join(scaled, 'original-results.png')).raw().toBuffer()).equals(originalPixels)) throw Error('Missing native annotation');
  const html = fs.readFileSync(path.join(smoke, 'index.html'), 'utf8');
  if (html.indexOf('src="comparison.png"') > html.indexOf('src="heatmap-darkening.png"')) throw Error('Combined report order');
  console.log('PASS image runner: artifacts, homography, decisions, self-reference, overwrite, invalid inputs, heatmap semantics, native originals and combined layout');
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ sourceHashes: hashes, resize: 'sharp shared-input parity only; not browser/OpenCV decode parity', runnerSmoke: 'passed', results }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

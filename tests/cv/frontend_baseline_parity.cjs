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
    const selected = args.some(a => a.startsWith('--finger-method=')) ? args : [...args, '--finger-method=projection'];
    const result = spawnSync(runner, selected, { encoding: 'utf8' });
    if ((result.status === 0) !== succeeds) throw Error(`Runner status ${result.status}: ${result.stdout}${result.stderr}`);
  };
  const smoke = out;
  const args = [`--image=${path.join(out, 'five-wide-current.png')}`, `--reference=${path.join(out, 'five-wide-reference.png')}`, `--output=${smoke}`, `--corners=${corners}`, '--residual=0.12'];
  const expectedPngs = ['source.png', 'shadow-classes.png', 'shadow-compatible.png', 'candidates.png', 'comparison.png'];
  const inputPngs = new Set(fs.readdirSync(smoke).filter(f => f.endsWith('.png') && !expectedPngs.includes(f)));
  for (const file of ['heatmap-darkening.png', 'mid-shadow.png', 'color-hsv-comparison.png', 'color-rgb-current-1.png', 'measurements.yml.gz'])
    fs.writeFileSync(path.join(smoke, file), 'retired generated output');
  const unrelated = path.join(smoke, 'review-notes.png');
  fs.writeFileSync(unrelated, 'unrelated review evidence');
  inputPngs.add('review-notes.png');
  run(args, true);
  const generated = fs.readdirSync(smoke).filter(f => f.endsWith('.png') && !inputPngs.has(f)).sort();
  if (JSON.stringify(generated) !== JSON.stringify([...expectedPngs].sort())) throw Error(`Unexpected exported PNG set: ${generated}`);
  if (fs.readFileSync(unrelated, 'utf8') !== 'unrelated review evidence') throw Error('Unrelated evidence removed');
  if (fs.existsSync(path.join(smoke, 'measurements.yml.gz'))) throw Error('Raw measurements still exported');
  for (const file of ['index.html', 'results.json', ...expectedPngs])
    if (!fs.existsSync(path.join(smoke, file))) throw Error(`Missing runner artifact ${file}`);
  const reportFile = path.join(smoke, 'results.json'), reportBytes = fs.readFileSync(reportFile);
  const report = JSON.parse(reportBytes);
  if (report.fingerMethod !== 'projection') throw Error('Legacy finger mode not preserved');
  const temporaryDefault = spawnSync(runner, args, { encoding: 'utf8' });
  if (temporaryDefault.status !== 0) throw Error(temporaryDefault.stderr);
  const crReport = JSON.parse(fs.readFileSync(reportFile));
  if (crReport.fingerMethod !== 'cr-otsu' || crReport.otsuRadius !== 2 || crReport.candidates.length !== 1) throw Error('Temporary Cr/Otsu default');
  const crDefaultsCheck = spawnSync(path.join(root, 'build/mog2/baseline_tests'), ['--report-settings', reportFile], { encoding: 'utf8' });
  if (crDefaultsCheck.status !== 0) throw Error(`Cr default not inherited: ${crDefaultsCheck.stdout}${crDefaultsCheck.stderr}`);
  if (!fs.readFileSync(path.join(smoke, 'index.html'), 'utf8').includes('Finger mask: cr-otsu')) throw Error('Cr mask provenance missing');
  run([...args, '--finger-method=cr', '--cr-threshold=255'], true);
  if (JSON.parse(fs.readFileSync(reportFile)).candidates.length !== 0) throw Error('Cr threshold override');
  run([...args, '--finger-method=bad'], false);
  run([...args, '--finger-method=cr', '--cr-threshold=-1'], false);
  run([...args, '--finger-method=cr', '--cr-threshold=256'], false);
  run([...args, '--finger-method=cr-otsu', '--otsu-radius=3'], false);
  run([...args, '--finger-method=cr-otsu', '--otsu-radius=0'], false);
  run(args, true);
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
  if (relaxed.candidates.length !== 0) throw Error('Residual override mask');
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
  const comparisonPixel = async (row, column, x, y) => {
    const meta = await sharp(path.join(smoke, 'source.png')).metadata();
    return pixel(smoke, 'comparison.png', column * meta.width + x, row * (meta.height + 64) + 64 + y);
  };
  const comparisonTiles = {
    'heatmap-darkening.png': [1, 0], 'heatmap-residual.png': [1, 1],
    'heatmap-shadow.png': [2, 1], 'subtraction.png': [3, 0],
    'subtraction-r.png': [3, 1], 'subtraction-g.png': [3, 2], 'subtraction-b.png': [4, 0],
  };
  const equalPanel = async (file, x, y, expected) => {
    const [row, col] = comparisonTiles[file];
    const actual = await comparisonPixel(row, col, x, y);
    if (String(actual) !== String(expected)) throw Error(`${file} panel: expected ${expected}, got ${actual}`);
  };
  const equalColorPixel = async (folder, space, row, channel, x, y, expected) => {
    if (row !== 'change') throw Error('Only channel-change panels are retained');
    const index = ['rgb', 'hsv', 'lab', 'ycrcb', 'normalized-rgb', 'cmy', 'ryb'].indexOf(space);
    const value = await comparisonPixel(5 + index, channel - 1, x, y);
    if (String(value) !== String(expected)) throw Error(`${space} change: expected ${expected}, got ${value}`);
  };
  await equalPanel('heatmap-darkening.png', 0, 0, [0, 0, 0]);
  await equalPanel('subtraction.png', 40, 40, [80, 135, 155]);
  await equalPanel('subtraction-r.png', 40, 40, [80, 0, 0]);
  await equalPanel('subtraction-g.png', 40, 40, [0, 135, 0]);
  await equalPanel('subtraction-b.png', 40, 40, [0, 0, 155]);
  await equalPanel('subtraction.png', 0, 0, [0, 0, 0]);
  await equalColorPixel(smoke, 'rgb', 'change', 2, 40, 40, [135, 135, 135]);
  await equalColorPixel(smoke, 'cmy', 'change', 1, 40, 40, [80, 80, 80]);
  await equalColorPixel(smoke, 'ycrcb', 'change', 2, 40, 40, [116, 116, 116]);
  await equalColorPixel(smoke, 'ycrcb', 'change', 3, 40, 40, [77, 77, 77]);
  await equalPixel(smoke, 'shadow-classes.png', 40, 40, [0, 0, 100]);
  await equalPixel(smoke, 'shadow-classes.png', 29, 54, [145, 85, 42]);
  const classes = fixture(); classes.finger();
  classes.paint(10, 10, [110, 110, 110]); classes.paint(11, 10, [111, 111, 111]);
  classes.paint(12, 10, [250, 200, 240]); // Brighter channels clamp, never wrap or absdiff.
  classes.paint(13, 10, [0, 0, 0]);
  classes.paint(14, 10, [255, 0, 0]);
  classes.paint(15, 10, [255, 9, 0]);
  classes.paint(16, 10, [210, 210, 210]); // Exactly20 darkening: excluded.
  classes.paint(17, 10, [209, 209, 209]); // Above20: eligible in all-shadow mode.
  classes.paint(18, 10, [0, 0, 255]); // Strong Cb change clips only the display.
  classes.paint(19, 10, [225, 225, 225]); // Exactly5 darkening: heatmap floor.
  classes.paint(20, 10, [224, 224, 224]); // Above5: visible before DFS cutoffs.
  classes.paint(21, 10, [100, 100, 200]); // Low Cr change, but residual rejected.
  const colorReference = fixture().reference;
  colorReference.data.set([255, 0, 9, 255], (10 * 80 + 15) * 4);
  const colorReferencePath = path.join(out, 'color-test-reference.png');
  await sharp(Buffer.from(colorReference.data), { raw: { width: 80, height: 100, channels: 4 } }).png().toFile(colorReferencePath);
  const classInput = path.join(out, 'classification-current.png');
  await sharp(Buffer.from(classes.current.data), { raw: { width: 80, height: 100, channels: 4 } }).png().toFile(classInput);
  run([`--image=${classInput}`, `--reference=${colorReferencePath}`, `--output=${smoke}`], true);
  await equalPixel(smoke, 'shadow-classes.png', 10, 10, [180, 0, 180]);
  await equalPixel(smoke, 'shadow-classes.png', 11, 10, [145, 85, 42]);
  await equalPanel('subtraction.png', 12, 10, [0, 30, 0]);
  await equalColorPixel(smoke, 'hsv', 'change', 1, 15, 10, [6, 6, 6]);
  await equalColorPixel(smoke, 'ycrcb', 'change', 2, 14, 10, [255, 255, 255]);
  await equalColorPixel(smoke, 'ycrcb', 'change', 3, 18, 10, [255, 255, 255]);
  run([`--image=${classInput}`, `--reference=${colorReferencePath}`, `--output=${smoke}`, '--finger-method=cr', '--dark-shadows-only=true'], true);
  if (String(await comparisonPixel(2, 2, 40, 40)) !== '0,0,100') throw Error('Cr finger overlay must be blue');
  if (String(await comparisonPixel(2, 1, 40, 40)) !== '0,0,100') throw Error('Finger region must be shown blue in shadow comparison');
  if ((await comparisonPixel(2, 1, 11, 10)).every(v => v === 0)) throw Error('Filtered heatmap incorrectly applies brightness110 gate');
  if (String(await comparisonPixel(2, 1, 11, 10)) !== String(await comparisonPixel(2, 0, 11, 10))) throw Error('Filtered heatmap values changed outside Cr mask');
  if ((await comparisonPixel(2, 1, 19, 10)).some(v => v !== 0)) throw Error('Masked heatmap floor must be5');
  if ((await comparisonPixel(2, 1, 20, 10)).every(v => v === 0)) throw Error('Masked heatmap incorrectly applies DFS cutoff20');
  if ((await comparisonPixel(2, 1, 21, 10)).every(v => v === 0)) throw Error('Cr shadow heatmap must restore residual-rejected non-fingers');
  if ((await comparisonPixel(1, 2, 21, 10)).every(v => v === 0)) throw Error('Actual DFS shadows must restore residual-rejected non-fingers');
  if ((await comparisonPixel(1, 2, 11, 10)).some(v => v !== 0)) throw Error('Actual DFS shadow panel must apply luma110');
  if ((await comparisonPixel(1, 2, 16, 10)).some(v => v !== 0)) throw Error('Actual DFS shadow panel must apply strict cutoff20');
  if (String(await comparisonPixel(1, 2, 40, 40)) !== '0,0,100') throw Error('Actual DFS shadow panel fingers must be blue');
  if (String(await comparisonPixel(1, 1, 40, 40)) !== String(await comparisonPixel(8, 1, 40, 40))) throw Error('Main Cr-change view differs from Cr grid');
  const crShadowReport = JSON.parse(fs.readFileSync(reportFile));
  if (crShadowReport.shadowMethod !== 'cr-mask-darkening' || crShadowReport.shadowResidualApplied) throw Error('Cr shadow provenance missing');
  if (String(await comparisonPixel(2, 2, 10, 10)) !== '180,0,180') throw Error('Dark shadow class must be magenta at luma110');
  if (String(await comparisonPixel(2, 2, 11, 10)) !== '145,85,42') throw Error('Mid shadow class must be brown at luma111');
  if (String(await comparisonPixel(2, 2, 21, 10)) !== '180,0,180') throw Error('Cr classes must retain dark shadows rejected by the old residual filter');
  run([`--image=${classInput}`, `--reference=${colorReferencePath}`, `--output=${smoke}`, '--finger-method=cr'], true);
  if ((await comparisonPixel(2, 1, 16, 10)).every(v => v === 0)) throw Error('Masked heatmap should display darkening20');
  if ((await comparisonPixel(2, 1, 17, 10)).every(v => v === 0)) throw Error('Masked heatmap excludes valid shadow');
  run(args, true);
  await equalPanel('heatmap-shadow.png', 40, 40, [0, 0, 100]); // Finger overlay.
  await equalPanel('heatmap-residual.png', 29, 54, [0, 0, 0]); // Proportional neutral shadow.
  if ((await comparisonPixel(2, 1, 29, 54)).every(v => v === 0)) throw Error('Missing neutral shadow heatmap');
  const self = out;
  run([args[1].replace('--reference=', '--image='), args[1], `--output=${self}`], true);
  if (JSON.parse(fs.readFileSync(path.join(self, 'results.json'))).candidates.length !== 0) throw Error('Self-reference proposals');
  const unknownOutput = out;
  run([`--image=${path.join(out, 'alpha-current.png')}`, args[1], `--output=${unknownOutput}`], true);
  await equalPanel('heatmap-darkening.png', 40, 60, [128, 128, 128]);
  await equalPanel('heatmap-residual.png', 40, 60, [128, 128, 128]);
  await equalPixel(unknownOutput, 'shadow-classes.png', 40, 60, [0, 0, 0]);
  if (String(await comparisonPixel(2, 1, 40, 60)) !== '128,128,128') throw Error('Masked shadow unknown must be gray');
  const otsu = fixture();
  for (let y = 10; y <= 60; y++)
    for (let x = 30; x <= 49; x++) otsu.paint(x, y, [150, 120, 120]);
  for (let y = 58; y <= 60; y++) otsu.paint(29, y, [150, 130, 130]);
  for (let y = 59; y <= 60; y++) otsu.paint(28, y, [150, 130, 130]);
  const otsuCurrent = path.join(out, 'otsu-current.png');
  await sharp(Buffer.from(otsu.current.data), { raw: { width: 80, height: 100, channels: 4 } }).png().toFile(otsuCurrent);
  run([`--image=${otsuCurrent}`, args[1], `--output=${smoke}`, '--finger-method=cr-otsu', '--cr-threshold=13', '--otsu-radius=2'], true);
  const otsuReport = JSON.parse(fs.readFileSync(reportFile));
  if (!otsuReport.otsuEnabled || otsuReport.otsuRadius !== 2 || !otsuReport.otsuRegions.some(r => r.addedPixels > 0)) throw Error('Otsu provenance/growth missing');
  if ((await comparisonPixel(2, 0, 29, 60)).every(v => v === 0)) throw Error('Original Cr shadow missing before refinement');
  if (String(await comparisonPixel(2, 0, 40, 40)) !== '0,0,100') throw Error('Original Cr fingers must be blue');
  if (String(await comparisonPixel(2, 1, 40, 40)) !== '0,0,100') throw Error('Original fingers must stay blue after Otsu');
  if (String(await comparisonPixel(2, 1, 29, 60)) !== '255,0,180') throw Error('New Otsu shadow view must show additions pink');
  if (String(await comparisonPixel(2, 2, 29, 60)) !== '0,0,100') throw Error('Class view shows all selected finger pixels blue');
  if (String(await comparisonPixel(1, 2, 29, 60)) !== '255,0,180') throw Error('DFS shadow overlay must show Otsu additions pink');
  if (String(await comparisonPixel(2, 0, 27, 60)) !== String(await comparisonPixel(2, 1, 27, 60))) throw Error('Otsu changed shadow beyond expansion radius');
  const scaled = out, nativeCurrent = path.join(out, 'native-current.png'), nativeReference = path.join(out, 'native-reference.png');
  await sharp(path.join(out, 'five-wide-current.png')).resize(160, 200, { kernel: 'nearest' }).toFile(nativeCurrent);
  await sharp(path.join(out, 'five-wide-reference.png')).resize(160, 200, { kernel: 'nearest' }).toFile(nativeReference);
  run([`--image=${nativeCurrent}`, `--reference=${nativeReference}`, `--output=${scaled}`, '--max-side=100'], true);
  for (const [file, width, height] of [['source.png', 80, 100], ['shadow-classes.png', 80, 100], ['shadow-compatible.png', 80, 100], ['candidates.png', 80, 100], ['comparison.png', 240, 1968]]) {
    const meta = await sharp(path.join(scaled, file)).metadata();
    if (meta.width !== width || meta.height !== height) throw Error(`${file}: wrong diagnostic dimensions`);
  }
  const sourcePixels = await sharp(path.join(out, 'five-wide-current.png')).removeAlpha().raw().toBuffer();
  if (!(await sharp(path.join(scaled, 'source.png')).raw().toBuffer()).equals(sourcePixels)) throw Error('Analysis source pixels changed');
  if ((await sharp(path.join(scaled, 'candidates.png')).raw().toBuffer()).equals(sourcePixels)) throw Error('Missing candidate annotations');
  const html = fs.readFileSync(path.join(smoke, 'index.html'), 'utf8');
  if (html.indexOf('src="comparison.png"') > html.indexOf('src="source.png"')) throw Error('Combined report order');
  for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g))
    if (!fs.existsSync(path.join(smoke, match[1]))) throw Error(`Broken report link ${match[1]}`);
  // A retired filename that is also an actual input must be preserved.
  const inputReference = path.join(out, 'reference.png');
  fs.copyFileSync(path.join(out, 'five-wide-reference.png'), inputReference);
  run([args[0], `--reference=${inputReference}`, `--output=${out}`], true);
  if (!fs.existsSync(inputReference)) throw Error('Retired-output cleanup removed an input reference');
  console.log('PASS image runner: five PNG outputs, retired-output cleanup/input preservation, links, homography, decisions, overwrite, invalid inputs and comparison semantics');
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ sourceHashes: hashes, resize: 'sharp shared-input parity only; not browser/OpenCV decode parity', runnerSmoke: 'passed', results }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

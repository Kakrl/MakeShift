// Assemble existing native candidate PNGs; no detection or report regeneration.
const fs = require('node:fs/promises');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { randomUUID } = require('node:crypto');

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: 'string', default: path.join(__dirname, 'test-results') },
      output: { type: 'string' },
      columns: { type: 'string', default: '8' },
      scale: { type: 'string', default: '1' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(`Usage: node backend/gather_candidates.cjs [options]

Gather NNN/candidates.png in numeric order into one labeled PNG.
  --input PATH    Results folder (default: backend/test-results beside script)
  --output PATH   Output PNG (default: INPUT/all-candidates.png; replaces it)
  --columns N     Grid columns (default: 8)
  --scale N       Image scale, greater than 0 through 1 (default: 1, full size)

Explicit paths are relative to your current directory.
Requires Node and sharp from the installed frontend dependencies.`);
    return;
  }
  const columns = Number(values.columns), scale = Number(values.scale);
  if (!Number.isSafeInteger(columns) || columns < 1 || columns > 1000)
    throw Error('--columns must be an integer from 1 through 1000');
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1)
    throw Error('--scale must be greater than 0 and at most 1');

  const sharp = require('../frontend/node_modules/sharp');
  sharp.cache(false);
  sharp.concurrency(2);
  const input = path.resolve(values.input);
  const output = path.resolve(values.output || path.join(input, 'all-candidates.png'));
  const cases = [];
  for (const entry of (await fs.readdir(input, { withFileTypes: true }))
    .filter(e => e.isDirectory() && /^\d{3}$/.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const filename = path.join(input, entry.name, 'candidates.png');
    try {
      await fs.access(filename);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (filename === output) throw Error('Output must not replace a testcase candidate image');
    const metadata = await sharp(filename).metadata();
    cases.push({
      name: entry.name, filename,
      width: Math.max(1, Math.round(metadata.width * scale)),
      height: Math.max(1, Math.round(metadata.height * scale)),
    });
  }
  if (!cases.length) throw Error(`No NNN/candidates.png files found in ${input}`);

  const count = Math.min(columns, cases.length);
  const gap = 20, labelHeight = 64;
  const tileWidth = Math.max(...cases.map(c => c.width));
  const rowHeights = [];
  for (let i = 0; i < cases.length; i += count)
    rowHeights.push(Math.max(...cases.slice(i, i + count).map(c => c.height)) + labelHeight);
  const width = gap + count * (tileWidth + gap);
  const height = gap + rowHeights.reduce((sum, h) => sum + h + gap, 0);
  const layers = [];
  let top = gap;
  for (let i = 0; i < cases.length; i++) {
    if (i && i % count === 0) top += rowHeights[i / count - 1] + gap;
    const c = cases[i], left = gap + (i % count) * (tileWidth + gap);
    const label = Buffer.from(`<svg width="${tileWidth}" height="${labelHeight}"><rect width="100%" height="100%" fill="#202020"/><text x="20" y="44" font-family="sans-serif" font-size="36" fill="white">Testcase ${c.name}</text></svg>`);
    layers.push({ input: label, left, top });
    const image = scale === 1 ? c.filename
      : await sharp(c.filename).resize(c.width, c.height).png().toBuffer();
    layers.push({ input: image, left, top: top + labelHeight });
  }
  console.log(`Combining ${cases.length} candidate images: ${count} columns, ${width}x${height} pixels...`);
  // Finish encoding before replacing any previous overview.
  const temporary = path.join(path.dirname(output), `.candidates-${randomUUID()}.png`);
  try {
    await sharp({
      create: { width, height, channels: 3, background: '#303030' },
      limitInputPixels: false,
    }).composite(layers).png().toFile(temporary);
    await fs.rename(temporary, output);
  } finally {
    await fs.unlink(temporary).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  const stats = await fs.stat(output);
  console.log(`Saved ${output} (${(stats.size / 1e6).toFixed(1)} MB)`);
}

main().catch(error => {
  console.error(`Candidate overview: ${error.message}`);
  process.exitCode = 1;
});

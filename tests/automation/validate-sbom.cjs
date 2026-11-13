const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

// A structural smoke check, not full CycloneDX schema validation.
function validateSbom(bom) {
  assert.equal(bom?.bomFormat, 'CycloneDX', 'Expected CycloneDX output');
  assert.equal(typeof bom.specVersion, 'string', 'Missing specVersion');
  assert.ok(bom.specVersion.length > 0, 'Empty specVersion');
  assert.ok(Array.isArray(bom.components), 'Missing components array');
  assert.ok(bom.components.length > 0, 'SBOM contains no dependencies');
  for (const component of bom.components) {
    assert.ok(
      typeof component?.name === 'string' && component.name.trim().length > 0,
      'Every dependency must have a name',
    );
  }
  return bom.components.length;
}

if (require.main === module) {
  const count = validateSbom(JSON.parse(readFileSync(process.argv[2], 'utf8')));
  console.info(`Validated CycloneDX SBOM: ${count} components`);
}

module.exports = { validateSbom };

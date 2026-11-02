const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateSbom } = require('./validate-sbom.cjs');

const validBom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  components: [{ type: 'library', name: 'example', version: '1.0.0' }],
};

test('accepts CycloneDX dependencies and returns their count', () => {
  assert.equal(validateSbom(validBom), 1);
});

test('rejects a missing BOM or incorrect format', () => {
  for (const bom of [null, {}, { ...validBom, bomFormat: 'SPDX' }]) {
    assert.throws(() => validateSbom(bom), /Expected CycloneDX/);
  }
});

test('rejects missing or empty specification versions', () => {
  for (const specVersion of [undefined, '', 1.6]) {
    assert.throws(() => validateSbom({ ...validBom, specVersion }));
  }
});

test('rejects missing, malformed, or empty dependency lists', () => {
  for (const components of [undefined, {}, []]) {
    assert.throws(() => validateSbom({ ...validBom, components }));
  }
});

test('rejects unnamed dependencies, including after a valid dependency', () => {
  for (const component of [null, {}, { name: '' }, { name: ' ' }]) {
    assert.throws(
      () => validateSbom({
        ...validBom,
        components: [...validBom.components, component],
      }),
      /Every dependency must have a name/,
    );
  }
});

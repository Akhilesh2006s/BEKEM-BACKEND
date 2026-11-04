const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateProductionConfig } = require('./utils/productionConfig');
const { corsOriginCallback } = require('./utils/corsOrigins');

describe('production authentication and origin configuration', () => {
  const valid = { NODE_ENV: 'production', JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40), CORS_ORIGIN: 'https://app.example.test', DOCUMENT_STORAGE_PATH: require('os').tmpdir() };
  it('requires distinct strong secrets and explicit HTTPS frontend origins', () => {
    assert.doesNotThrow(() => validateProductionConfig(valid));
    assert.throws(() => validateProductionConfig({ ...valid, JWT_ACCESS_SECRET: 'short' }), /distinct JWT/);
    assert.throws(() => validateProductionConfig({ ...valid, JWT_REFRESH_SECRET: valid.JWT_ACCESS_SECRET }), /distinct JWT/);
    assert.throws(() => validateProductionConfig({ ...valid, CORS_ORIGIN: 'http://localhost:5173' }), /HTTPS frontend/);
    assert.throws(() => validateProductionConfig({ ...valid, CORS_ORIGIN: '*' }), /HTTPS frontend/);
    assert.throws(() => validateProductionConfig({ ...valid, DOCUMENT_STORAGE_PATH: 'relative/path' }), /DOCUMENT_STORAGE_PATH/);
  });
  it('does not allow local or unrelated origins in production', () => {
    const old = { NODE_ENV: process.env.NODE_ENV, CORS_ORIGIN: process.env.CORS_ORIGIN, CORS_ALLOW_VERCEL_PREVIEWS: process.env.CORS_ALLOW_VERCEL_PREVIEWS };
    try {
      process.env.NODE_ENV = 'production'; process.env.CORS_ORIGIN = 'https://app.example.test'; process.env.CORS_ALLOW_VERCEL_PREVIEWS = 'true';
      let approved;
      corsOriginCallback('https://app.example.test', (_err, result) => { approved = result; });
      assert.equal(approved, 'https://app.example.test');
      corsOriginCallback('http://localhost:5173', (_err, result) => { approved = result; });
      assert.equal(approved, false);
      corsOriginCallback('https://unrelated.vercel.app', (_err, result) => { approved = result; });
      assert.equal(approved, false);
    } finally {
      for (const [key, value] of Object.entries(old)) value === undefined ? delete process.env[key] : process.env[key] = value;
    }
  });
  it('uses the configured document-storage directory for both document types', () => {
    const path = require('path');
    const { spawnSync } = require('child_process');
    const root = path.join(require('os').tmpdir(), 'bekem-example-storage');
    const result = spawnSync(process.execPath, ['-e', "console.log(JSON.stringify([require('./src/services/grnFileService').UPLOAD_ROOT,require('./src/services/vendorFileService').UPLOAD_ROOT]))"],
      { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', env: { ...process.env, DOCUMENT_STORAGE_PATH: root } });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [path.join(root, 'grn'), path.join(root, 'msme')]);
  });
});

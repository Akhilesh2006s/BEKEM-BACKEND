/**
 * GST portal lookup — mock provider integration tests.
 */
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { setupTestDb, teardownTestDb, loginAs, getApp } = require('./test/helpers');
const { resetSandboxTokenCache } = require('./services/vendorGstLookupProvider');

describe('GST portal vendor lookup', () => {
  let app;
  let coordToken;
  const prev = {};

  before(async () => {
    prev.provider = process.env.GST_LOOKUP_PROVIDER;
    prev.enabled = process.env.VENDOR_GST_LOOKUP_ENABLED;
    process.env.GST_LOOKUP_PROVIDER = 'mock';
    process.env.VENDOR_GST_LOOKUP_ENABLED = 'true';
    resetSandboxTokenCache();

    await setupTestDb();
    app = getApp();
    coordToken = await loginAs('coordinator@bekem.com');
  });

  beforeEach(() => {
    resetSandboxTokenCache();
  });

  after(async () => {
    if (prev.provider === undefined) delete process.env.GST_LOOKUP_PROVIDER;
    else process.env.GST_LOOKUP_PROVIDER = prev.provider;
    if (prev.enabled === undefined) delete process.env.VENDOR_GST_LOOKUP_ENABLED;
    else process.env.VENDOR_GST_LOOKUP_ENABLED = prev.enabled;
    await teardownTestDb();
  });

  it('returns disabled message when lookup is not configured', async () => {
    process.env.VENDOR_GST_LOOKUP_ENABLED = 'false';
    const res = await request(app)
      .get('/api/vendors/gst-lookup/preview')
      .set('Authorization', `Bearer ${coordToken}`)
      .query({ gstNumber: '29AAAAA0000A1Z5' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.available, false);
    assert.match(res.body.data.message, /GST_LOOKUP_API_KEY|Connect GST portal/i);
    process.env.VENDOR_GST_LOOKUP_ENABLED = 'true';
  });

  it('fetches vendor details from mock GST registry', async () => {
    const res = await request(app)
      .get('/api/vendors/gst-lookup/preview')
      .set('Authorization', `Bearer ${coordToken}`)
      .query({ gstNumber: '29AAAAA0000A1Z5' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.available, true);
    assert.ok(res.body.data.name);
    assert.ok(res.body.data.address);
    assert.strictEqual(res.body.data.panNumber, 'AAAAA0000A');
    assert.strictEqual(res.body.data.gstDetails?.source, 'GST_PORTAL');
  });

  it('returns not-found for invalid mock GSTIN prefix', async () => {
    const res = await request(app)
      .get('/api/vendors/gst-lookup/preview')
      .set('Authorization', `Bearer ${coordToken}`)
      .query({ gstNumber: '99AAAAA0000A1Z5' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.data.available, false);
    assert.match(res.body.data.message, /record found|not found/i);
  });

  it('rejects invalid GSTIN format', async () => {
    const res = await request(app)
      .get('/api/vendors/gst-lookup/preview')
      .set('Authorization', `Bearer ${coordToken}`)
      .query({ gstNumber: 'INVALID' });
    assert.strictEqual(res.status, 400);
  });
});

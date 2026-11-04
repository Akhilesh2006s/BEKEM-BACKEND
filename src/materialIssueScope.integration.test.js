const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { setupTestDb, teardownTestDb, loginAs, getApp } = require('./test/helpers');
const { MaterialRequest, MaterialIssue, Site, User } = require('./models');

describe('Material issue project scope', () => {
  let app, storeToken, otherPmToken, coordinatorToken, issue, otherIndent;
  before(async () => {
    await setupTestDb(); app = getApp();
    storeToken = await loginAs('storeincharge@bekem.com');
    otherPmToken = await loginAs('pm2@bekem.com');
    coordinatorToken = await loginAs('coordinator@bekem.com');
    const store = await User.findOne({ role: 'STORE_INCHARGE' });
    const own = await MaterialRequest.findOne({ siteId: store.assignedSiteId }).lean();
    const materialId = own.items?.[0]?.materialId || own.materialId;
    issue = await MaterialIssue.create({ issueNumber: 'TEST-SCOPE-ISSUE', materialRequestId: own._id,
      siteId: own.siteId, items: [{ materialId, quantity: 1 }], issuedByUserId: store._id,
      issueType: 'WORK_ISSUE', issuedToType: 'EMPLOYEE', issuedToName: 'Synthetic recipient' });
    const other = await Site.findOne({ projectId: { $nin: store.assignedProjectIds } }).lean();
    assert.ok(other, 'test needs another project site');
    const clone = { ...own, siteId: other._id, projectId: other.projectId, status: 'MATERIAL_RECEIVED', indentNumber: 'TEST-SCOPE-FOREIGN' };
    delete clone._id;
    const inserted = await MaterialRequest.collection.insertOne(clone);
    otherIndent = { id: inserted.insertedId, materialId };
  });
  after(async () => { await teardownTestDb(); });
  it('allows an authorized Store and Coordinator to view their issue', async () => {
    for (const token of [storeToken, coordinatorToken]) {
      const res = await request(app).get(`/api/material-issues/${issue._id}`).set('Authorization', `Bearer ${token}`);
      assert.equal(res.status, 200);
    }
  });
  it('does not disclose an issue in another PM project', async () => {
    const res = await request(app).get(`/api/material-issues/${issue._id}`).set('Authorization', `Bearer ${otherPmToken}`);
    assert.equal(res.status, 404);
  });
  it('does not allow Store to issue an indent outside its project', async () => {
    const res = await request(app).post('/api/material-issues').set('Authorization', `Bearer ${storeToken}`).send({
      materialRequestId: otherIndent.id.toString(), items: [{ materialId: otherIndent.materialId.toString(), quantity: 1 }],
      reason: 'already_approved', issueType: 'WORK_ISSUE', issuedToName: 'Synthetic recipient',
    });
    assert.equal(res.status, 404);
    assert.equal(await MaterialIssue.countDocuments({ materialRequestId: otherIndent.id }), 0);
  });
  it('limits legacy receipt-document downloads to authorized sites', async () => {
    const { UPLOAD_ROOT } = require('./services/grnFileService');
    const name = `test-${crypto.randomBytes(12).toString('hex')}.pdf`;
    const file = path.join(UPLOAD_ROOT, name);
    fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
    fs.writeFileSync(file, 'synthetic receipt');
    try {
      const own = await MaterialRequest.findById(issue.materialRequestId);
      own.storeStockReceivedAttachments.push({ name: 'synthetic.pdf', fileType: 'application/pdf', category: 'INVOICE', url: `/api/files/grn/${name}` });
      await own.save();
      for (const token of [storeToken, coordinatorToken]) {
        const res = await request(app).get(`/api/files/grn/${name}`).set('Authorization', `Bearer ${token}`);
        assert.equal(res.status, 200);
      }
      const denied = await request(app).get(`/api/files/grn/${name}`).set('Authorization', `Bearer ${otherPmToken}`);
      assert.equal(denied.status, 404);
    } finally {
      fs.unlinkSync(file);
    }
  });
});

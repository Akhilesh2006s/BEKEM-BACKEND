const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestDb, teardownTestDb } = require('./test/helpers');
const { User, StatusHistory, MaterialRequest } = require('./models');
const {
  getDayBounds,
  getPmDailyApprovedTotal,
  checkPmCanApprove,
} = require('./services/pmApprovalCapService');

describe('PM daily approval cap calendar reset', () => {
  before(async () => {
    await setupTestDb();
  });

  after(async () => {
    await teardownTestDb();
  });

  it('getDayBounds is the org calendar day, not a rolling 24h window', () => {
    // 22 Aug 2026 10:24 IST = 04:54 UTC — yesterday 12:10 IST must be outside today's window.
    const now = new Date('2026-08-22T04:54:00.000Z');
    const { dayStr, start, end, endExclusive } = getDayBounds(now, 'Asia/Kolkata');
    assert.strictEqual(dayStr, '2026-08-22');
    assert.strictEqual(start.toISOString(), '2026-08-21T18:30:00.000Z');
    assert.strictEqual(endExclusive.toISOString(), '2026-08-22T18:30:00.000Z');
    assert.ok(end.getTime() === endExclusive.getTime() - 1);

    const yesterdayApproval = new Date('2026-08-21T06:40:00.000Z'); // 12:10 IST 21 Aug
    assert.ok(
      yesterdayApproval < start,
      'yesterday 12:10 IST must not fall in today\'s IST window'
    );
    assert.ok(now >= start && now < endExclusive);
  });

  it('yesterday\'s PM local approvals do not consume today\'s cap', async () => {
    const pmUser = await User.findOne({ email: 'pm@bekem.com' });
    const mr = await MaterialRequest.findOne({ indentRequestType: { $ne: 'BELOW_5000' } });
    assert.ok(pmUser && mr);

    const { start, endExclusive } = getDayBounds();
    await StatusHistory.deleteMany({
      entityType: 'MaterialRequest',
      actorUserId: pmUser._id,
      timestamp: { $gte: start, $lt: endExclusive },
    });

    await MaterialRequest.findByIdAndUpdate(mr._id, {
      estimatedValue: 5000,
      indentRequestType: 'ABOVE_5000',
    });

    const yesterday = new Date(start.getTime() - 60 * 60 * 1000);
    await StatusHistory.create({
      entityType: 'MaterialRequest',
      entityId: mr._id,
      fromStatus: 'FORWARDED_TO_PM',
      toStatus: 'ALLOCATED',
      actorUserId: pmUser._id,
      note: 'Yesterday local close — must not count today',
      timestamp: yesterday,
    });

    const total = await getPmDailyApprovedTotal(pmUser._id);
    assert.strictEqual(total, 0);

    const pending = {
      estimatedValue: 4000,
      indentRequestType: 'ABOVE_5000',
    };
    const capCheck = await checkPmCanApprove(pmUser._id, pending);
    assert.strictEqual(capCheck.wouldExceed, false);
    assert.strictEqual(capCheck.dailyApprovedTotal, 0);
    assert.ok(capCheck.remaining >= 4000);
  });

  it('today\'s PM local close does count against today\'s cap', async () => {
    const pmUser = await User.findOne({ email: 'pm@bekem.com' });
    const mr = await MaterialRequest.findOne({ indentRequestType: { $ne: 'BELOW_5000' } });
    assert.ok(pmUser && mr);

    const { start, endExclusive } = getDayBounds();
    await StatusHistory.deleteMany({
      entityType: 'MaterialRequest',
      actorUserId: pmUser._id,
      timestamp: { $gte: start, $lt: endExclusive },
    });

    await MaterialRequest.findByIdAndUpdate(mr._id, {
      estimatedValue: 3500,
      indentRequestType: 'ABOVE_5000',
    });

    await StatusHistory.create({
      entityType: 'MaterialRequest',
      entityId: mr._id,
      fromStatus: 'FORWARDED_TO_PM',
      toStatus: 'ALLOCATED',
      actorUserId: pmUser._id,
      note: 'PM closed at PM level today',
      timestamp: new Date(),
    });

    const total = await getPmDailyApprovedTotal(pmUser._id);
    assert.strictEqual(total, 3500);

    const capCheck = await checkPmCanApprove(pmUser._id, {
      estimatedValue: 2000,
      indentRequestType: 'ABOVE_5000',
    });
    assert.strictEqual(capCheck.wouldExceed, true);
  });
});

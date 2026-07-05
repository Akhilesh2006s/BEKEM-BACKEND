const { PurchaseOrder, DeliveryAlert, Notification, User } = require('../models');
const { hasReachedStage } = require('./poTimelineService');

async function processOverdueDeliveries() {
  const now = new Date();
  const overduePos = await PurchaseOrder.find({
    status: 'APPROVED',
    expectedDeliveryDate: { $lt: now, $ne: null },
    fulfillmentStatus: { $ne: 'closed_complete' },
  }).lean();

  let created = 0;
  for (const po of overduePos) {
    const received = await hasReachedStage(po._id, 'received');
    if (received) continue;

    const existing = await DeliveryAlert.findOne({
      purchaseOrderId: po._id,
      resolvedAt: null,
    });
    if (existing) continue;

    const alert = await DeliveryAlert.create({
      purchaseOrderId: po._id,
      expectedDeliveryDate: po.expectedDeliveryDate,
    });
    created += 1;

    const executives = await User.find({ role: 'EXECUTIVE', isActive: true }).select('_id').lean();
    const coordinators = await User.find({ role: 'COORDINATOR', isActive: true }).select('_id').lean();
    const recipients = [...executives, ...coordinators];

    const title = 'Pending delivery overdue';
    const body = `PO ${po.poNumber} expected delivery ${new Date(po.expectedDeliveryDate).toLocaleDateString('en-IN')} has not been received.`;

    for (const u of recipients) {
      const dup = await Notification.findOne({
        userId: u._id,
        relatedEntityType: 'PurchaseOrder',
        relatedEntityId: po._id,
        title,
        isRead: false,
      });
      if (dup) continue;

      await Notification.create({
        userId: u._id,
        title,
        body,
        relatedEntityType: 'PurchaseOrder',
        relatedEntityId: po._id,
      });
    }

    await DeliveryAlert.updateOne(
      { _id: alert._id },
      { $set: { notificationSentAt: new Date() } }
    );
  }

  return { checked: overduePos.length, alertsCreated: created };
}

async function getUnresolvedDeliveryAlerts(user) {
  const alerts = await DeliveryAlert.find({ resolvedAt: null })
    .populate('purchaseOrderId', 'poNumber expectedDeliveryDate projectId amount vendorId')
    .sort({ alertCreatedAt: -1 })
    .limit(50)
    .lean();

  return alerts.map((a) => ({
    id: a._id.toString(),
    poId: a.purchaseOrderId?._id?.toString(),
    poNumber: a.purchaseOrderId?.poNumber,
    expectedDeliveryDate: a.expectedDeliveryDate?.toISOString?.(),
    alertCreatedAt: a.alertCreatedAt?.toISOString?.(),
  }));
}

module.exports = { processOverdueDeliveries, getUnresolvedDeliveryAlerts };

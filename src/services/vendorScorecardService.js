const { PurchaseOrder, VendorReview } = require('../models');

async function getVendorScorecard(vendorId) {
  const [pos, reviews] = await Promise.all([
    PurchaseOrder.find({ vendorId }).sort({ createdAt: -1 }),
    VendorReview.find({ vendorId })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('ratedByUserId', 'name'),
  ]);

  const approved = pos.filter((p) => p.status === 'APPROVED');
  const rejected = pos.filter((p) => p.status === 'REJECTED');
  const totalSpend = approved.reduce((s, p) => s + (p.amount || 0), 0);

  const reviewAvg =
    reviews.length > 0
      ? reviews.reduce((s, r) => s + (r.deliveryScore + r.qualityScore) / 2, 0) / reviews.length
      : null;

  const fulfillmentPct =
    approved.length + rejected.length > 0
      ? Math.round((approved.length / (approved.length + rejected.length)) * 100)
      : 100;

  return {
    metrics: {
      poCount: pos.length,
      approvedCount: approved.length,
      rejectedCount: rejected.length,
      totalSpend,
      onTimeDeliveryPct: fulfillmentPct,
      compositeRating: reviewAvg,
    },
    recentOrders: approved.slice(0, 5).map((p) => ({
      id: p._id.toString(),
      poNumber: p.poNumber,
      amount: p.amount,
      status: p.status,
      createdAt: p.createdAt?.toISOString?.(),
    })),
    reviews: reviews.map((r) => ({
      id: r._id.toString(),
      deliveryScore: r.deliveryScore,
      qualityScore: r.qualityScore,
      note: r.note,
      ratedByName: r.ratedByUserId?.name || 'Unknown',
      createdAt: r.createdAt?.toISOString?.(),
    })),
  };
}

async function addVendorReview(vendorId, userId, { deliveryScore, qualityScore, note }) {
  const review = await VendorReview.create({
    vendorId,
    ratedByUserId: userId,
    deliveryScore,
    qualityScore,
    note: note || '',
  });

  const reviews = await VendorReview.find({ vendorId });
  const avg =
    reviews.reduce((s, r) => s + (r.deliveryScore + r.qualityScore) / 2, 0) / reviews.length;

  const { Vendor } = require('../models');
  await Vendor.findByIdAndUpdate(vendorId, { rating: Math.round(avg * 10) / 10 });

  return review;
}

module.exports = { getVendorScorecard, addVendorReview };

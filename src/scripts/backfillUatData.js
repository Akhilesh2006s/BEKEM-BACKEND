/**
 * UAT backfill: fix PO refs/email status + ensure transactional demo data exists.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { connectMongo } = require('../db/connectMongo');
const { PurchaseOrder, MaterialRequest } = require('../models');
const { sanitizeProcurementRef } = require('../services/procurementReferenceService');
const { seedTransactionalDemo } = require('./seedTransactionalDemo');

async function backfill() {
  await connectMongo();
  console.log('Connected — running UAT backfill…');

  const pos = await PurchaseOrder.find({
    $or: [
      { procurementRef: { $regex: /\s/ } },
      { status: 'APPROVED', emailStatus: 'pending' },
    ],
  }).lean();

  let refFixed = 0;
  let emailFixed = 0;

  for (const po of pos) {
    const updates = {};

    if (po.procurementRef && /\s/.test(po.procurementRef)) {
      updates.procurementRef = sanitizeProcurementRef(po.procurementRef);
      refFixed += 1;
    }

    if (po.status === 'APPROVED' && po.emailStatus === 'pending') {
      updates.emailStatus = 'queued';
      if (!po.approvalDispatchedAt) {
        updates.approvalDispatchedAt = po.finalApprovedAt || po.updatedAt || new Date();
      }
      emailFixed += 1;
    }

    if (Object.keys(updates).length) {
      await PurchaseOrder.updateOne({ _id: po._id }, { $set: updates });
    }
  }

  console.log(`✅ Ref/email backfill: ${refFixed} refs sanitized, ${emailFixed} email statuses updated.`);

  const mrCount = await MaterialRequest.countDocuments();
  const poCount = await PurchaseOrder.countDocuments();
  if (mrCount === 0 || poCount === 0) {
    console.log(`⚠️ Transactional data sparse (MR=${mrCount}, PO=${poCount}) — seeding UAT demo…`);
    const tx = await seedTransactionalDemo({ force: true });
    console.log(`✅ UAT transactions: ${tx.summary}`);
  } else {
    const uatPo = await PurchaseOrder.countDocuments({ poNumber: { $regex: '^PO-UAT-DEMO-' } });
    if (uatPo === 0) {
      console.log('No UAT demo POs found — adding transactional demo alongside existing data…');
      const tx = await seedTransactionalDemo({ force: true });
      console.log(`✅ UAT transactions: ${tx.summary}`);
    } else {
      console.log(`UAT demo already present (${uatPo} PO-UAT-DEMO-* records).`);
    }
  }

  await mongoose.disconnect();
}

if (require.main === module) {
  backfill().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { backfill };

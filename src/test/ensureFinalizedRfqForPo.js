/**
 * Ensure PR has a FINALIZED RFQ with priced vendor quotations (required before PO).
 */
async function ensureFinalizedRfqForPo(app, execToken, purchaseRequestId, options = {}) {
  const request = require('supertest');
  const { Vendor, RFQ, PurchaseRequest, MaterialRequest } = require('../models');
  const { getIndentLineItems } = require('../services/materialRequestHelpers');
  const { ensureRfqAndQuotations } = require('../services/procurementService');
  const {
    rates,
    whyWeChoseThisVendor = 'L1',
    selectedVendorIndex,
    vendorSelectionReason,
  } = options;

  const pr = await PurchaseRequest.findById(purchaseRequestId).populate('projectId');
  if (!pr) throw new Error('Purchase request not found');

  let materialIds = [];
  if (pr.materialRequestId) {
    const mr = await MaterialRequest.findById(pr.materialRequestId);
    if (mr) {
      materialIds = getIndentLineItems(mr)
        .map((i) => (i.materialId?._id || i.materialId)?.toString())
        .filter(Boolean);
    }
  }

  let rfq = await RFQ.findOne({ purchaseRequestId });
  if (!rfq) {
    // Force-include materials so stock-covered indents still get an RFQ in tests
    if (materialIds.length) {
      const preview = await request(app)
        .post('/api/rfqs/wizard/preview')
        .set('Authorization', `Bearer ${execToken}`)
        .send({ purchaseRequestId, includeMaterialIds: materialIds });
      if (preview.status === 200) {
        rfq = await RFQ.findOne({ purchaseRequestId });
      }
    }
    if (!rfq) {
      const projectCode = pr.projectId?.code || 'HO';
      const created = await ensureRfqAndQuotations(pr, projectCode, pr.createdByUserId, materialIds, {
        creationNote: 'RFQ created for test PO gate',
      });
      rfq = created.rfq;
    }
  }
  if (!rfq) throw new Error('RFQ not created');

  const vendors = await Vendor.find({ isActive: { $ne: false } }).limit(3);
  if (vendors.length < 3) throw new Error('need at least 3 vendors');

  const quoteRates = rates || vendors.map((_, i) => 1000 + i * 50);
  await request(app)
    .put(`/api/rfqs/${rfq._id}/quotations`)
    .set('Authorization', `Bearer ${execToken}`)
    .send({
      quotations: vendors.map((v, i) => ({
        vendorId: v._id.toString(),
        rate: quoteRates[i],
        gstPercent: 18,
        paymentTerms: 'Net 30',
        deliveryTerms: 'Site delivery',
      })),
    });

  const lowestIdx = quoteRates.indexOf(Math.min(...quoteRates));
  const pickIdx = selectedVendorIndex != null ? selectedVendorIndex : lowestIdx;
  const selectedVendorId = vendors[pickIdx]._id.toString();
  const isNonL1 = pickIdx !== lowestIdx;

  const finalizeBody = {
    selectedVendorId,
    whyWeChoseThisVendor,
  };
  if (isNonL1) {
    finalizeBody.vendorSelectionReason =
      vendorSelectionReason || 'Non-L1 selected for test coverage';
  }

  rfq = await RFQ.findById(rfq._id);
  if (rfq.status !== 'FINALIZED') {
    const fin = await request(app)
      .post(`/api/rfqs/${rfq._id}/finalize`)
      .set('Authorization', `Bearer ${execToken}`)
      .send(finalizeBody);
    if (fin.status !== 200) {
      throw new Error(`RFQ finalize failed: ${fin.status} ${JSON.stringify(fin.body)}`);
    }
  }

  return {
    rfqId: rfq._id.toString(),
    vendorIds: vendors.map((v) => v._id.toString()),
    selectedVendorId,
    l1VendorId: vendors[lowestIdx]._id.toString(),
  };
}

module.exports = { ensureFinalizedRfqForPo };

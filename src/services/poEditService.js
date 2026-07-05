const { Material, GoodsReceiptNote } = require('../models');
const { validatePoLinePayload } = require('./poLineCalculation');
const { getCumulativeReceivedByLine } = require('./grnFulfillmentService');

const EDITABLE_STATUSES = new Set([
  'DRAFT',
  'PM_PENDING',
  'COORDINATOR_PENDING',
  'CHAIRMAN_PENDING',
  'PENDING_REVIEW',
  'PENDING_APPROVAL',
]);

const COORDINATOR_EDIT_STATUSES = new Set([...EDITABLE_STATUSES, 'APPROVED']);
const CHAIRMAN_EDIT_STATUSES = new Set(['CHAIRMAN_PENDING', 'PENDING_APPROVAL', 'APPROVED']);

const EWAY_INVOICE_THRESHOLD_INR = 50000;

function canEditPurchaseOrder(role, po) {
  if (!po) return false;
  if (role === 'COORDINATOR') return COORDINATOR_EDIT_STATUSES.has(po.status);
  if (role === 'CHAIRMAN') return CHAIRMAN_EDIT_STATUSES.has(po.status);
  return false;
}

async function getPoEditGrnWarnings(po, body) {
  if (!Array.isArray(body.lineItems) || !body.lineItems.length) return [];

  const grnCount = await GoodsReceiptNote.countDocuments({
    purchaseOrderId: po._id,
    status: { $nin: ['DRAFT', 'REJECTED'] },
  });
  if (!grnCount) return [];

  const cumulative = await getCumulativeReceivedByLine(po._id);
  const warnings = [];

  for (let i = 0; i < body.lineItems.length; i++) {
    const row = body.lineItems[i];
    const existingLine = po.lineItems[i];
    if (!existingLine) continue;

    const key = existingLine._id?.toString() || existingLine.materialId?.toString() || `idx-${i}`;
    const received = cumulative[key] || cumulative[existingLine.materialId?.toString()] || 0;
    if (received <= 0) continue;

    const newQty = row.quantity != null ? Number(row.quantity) : Number(existingLine.quantity);
    const newRate = row.rate != null ? Number(row.rate) : Number(existingLine.rate);
    const qtyChanged = Math.abs(newQty - Number(existingLine.quantity)) > 0.0001;
    const rateChanged = Math.abs(newRate - Number(existingLine.rate)) > 0.0001;

    if (qtyChanged || rateChanged) {
      warnings.push({
        lineIndex: i,
        poLineId: existingLine._id?.toString(),
        description: existingLine.description,
        cumulativeReceived: received,
        message:
          `Line "${existingLine.description}" already has ${received} units recorded across GRNs. ` +
          'Changing quantity or rate may invalidate recorded receipts.',
      });
    }
  }

  return warnings;
}

async function updatePurchaseOrderDraft(po, body, { acknowledgeGrnWarnings = false } = {}) {
  const isApprovedCorrection = po.status === 'APPROVED';
  if (!EDITABLE_STATUSES.has(po.status) && !isApprovedCorrection) {
    const err = new Error('PO cannot be edited in its current status');
    err.statusCode = 400;
    throw err;
  }

  if (Array.isArray(body.lineItems) && body.lineItems.length) {
    const warnings = await getPoEditGrnWarnings(po, body);
    if (warnings.length && !acknowledgeGrnWarnings) {
      const err = new Error('Edits may conflict with recorded GRNs');
      err.statusCode = 409;
      err.warnings = warnings;
      throw err;
    }
  }

  if (body.paymentTerms != null) po.paymentTerms = body.paymentTerms;
  if (body.billingAddress != null) po.billingAddress = body.billingAddress;
  if (body.billingAddressType != null) po.billingAddressType = body.billingAddressType;
  if (body.deliveryAddress != null) po.deliveryAddress = body.deliveryAddress;
  if (body.deliveryAddressType != null) po.deliveryAddressType = body.deliveryAddressType;
  if (body.deliveryAddressOtherText != null) po.deliveryAddressOtherText = body.deliveryAddressOtherText;
  if (body.referenceNote != null) po.referenceNote = body.referenceNote;
  if (body.expectedDeliveryDate != null) {
    po.expectedDeliveryDate = body.expectedDeliveryDate ? new Date(body.expectedDeliveryDate) : undefined;
  }

  if (Array.isArray(body.lineItems) && body.lineItems.length) {
    const lineItems = [];
    let subtotal = 0;
    for (let i = 0; i < body.lineItems.length; i++) {
      const row = body.lineItems[i];
      let mat = null;
      if (row.materialId) {
        mat = await Material.findById(row.materialId);
      }
      const gstPercent =
        row.gstPercent != null ? Number(row.gstPercent) : mat?.gstRate ?? 18;
      const computed = validatePoLinePayload(
        { ...row, gstPercent, materialId: row.materialId },
        i
      );
      lineItems.push({
        description:
          row.description ||
          (mat ? (mat.description ? `${mat.name} — ${mat.description}` : mat.name) : 'Item'),
        materialId: row.materialId,
        itemCode: mat?.code || row.itemCode || '',
        hsnCode: row.hsnCode || mat?.hsnCode || '',
        quantity: Number(row.quantity),
        rate: Number(row.rate),
        gstPercent,
        amount: computed.amount,
      });
      subtotal += computed.grandTotal;
    }
    po.lineItems = lineItems;
    po.amount = subtotal;
  }

  await po.save();
  return po;
}

function computeGrnInvoiceValue(items) {
  return (items || []).reduce(
    (sum, item) => sum + Number(item.quantityReceived || 0) * Number(item.invoiceUnitPrice || 0),
    0
  );
}

function validateGrnTransportFields(invoiceValue, { vehicleNo, vehicleNumber, ewayBillNumber }) {
  if (invoiceValue <= EWAY_INVOICE_THRESHOLD_INR) return null;
  const vehicle = (vehicleNo || vehicleNumber || '').trim();
  const eway = (ewayBillNumber || '').trim();
  if (!vehicle || !eway) {
    const err = new Error(
      'Vehicle number and E-Way Bill number are required when invoice value exceeds ₹50,000'
    );
    err.statusCode = 400;
    return err;
  }
  return null;
}

module.exports = {
  updatePurchaseOrderDraft,
  EDITABLE_STATUSES,
  COORDINATOR_EDIT_STATUSES,
  CHAIRMAN_EDIT_STATUSES,
  canEditPurchaseOrder,
  getPoEditGrnWarnings,
  computeGrnInvoiceValue,
  validateGrnTransportFields,
  EWAY_INVOICE_THRESHOLD_INR,
};

const mongoose = require('mongoose');

/** FIFO stock lot created from each GRN line (Req 55–57). */
const stockBatchSchema = new mongoose.Schema(
  {
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
    materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'Material', required: true },
    grnId: { type: mongoose.Schema.Types.ObjectId, ref: 'GoodsReceiptNote', default: null },
    grnNumber: { type: String, default: '' },
    receivedAt: { type: Date, required: true, default: Date.now },
    qtyReceived: { type: Number, required: true, min: 0 },
    qtyRemaining: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

stockBatchSchema.index({ siteId: 1, materialId: 1, receivedAt: 1 });
stockBatchSchema.index({ siteId: 1, materialId: 1, qtyRemaining: 1 });

module.exports = mongoose.model('StockBatch', stockBatchSchema);

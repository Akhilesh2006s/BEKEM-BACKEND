const express = require('express');
const { authenticate } = require('../middleware/auth');
const {
  indentAgingReport,
  openPoReport,
  grnRegisterReport,
  issueRegisterReport,
  projectMaterialCostReport,
  threeWayExceptionsReport,
  apAgingReport,
  pipelineMisReport,
  approvalTrailReport,
  shortageReport,
  priceCompareReport,
  gstRegisterReport,
  docCompletenessReport,
  spendByVendorReport,
  branchTransferReport,
  rfqPipelineReport,
  grnPaymentRecoReport,
  cancelledProcurementReport,
  workOrderCostReport,
  stockMovementReport,
} = require('../services/reportsService');

const router = express.Router();
router.use(authenticate);

async function run(handler, req, res, next) {
  try {
    const rows = await handler(req.user, req.query);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}

router.get('/indent-aging', (req, res, next) => run(indentAgingReport, req, res, next));
router.get('/open-po', (req, res, next) => run(openPoReport, req, res, next));
router.get('/grn-register', (req, res, next) => run(grnRegisterReport, req, res, next));
router.get('/issue-register', (req, res, next) => run(issueRegisterReport, req, res, next));
router.get('/project-material-cost', (req, res, next) =>
  run(projectMaterialCostReport, req, res, next)
);
router.get('/three-way', (req, res, next) => run(threeWayExceptionsReport, req, res, next));
router.get('/ap-aging', (req, res, next) => run(apAgingReport, req, res, next));
router.get('/pipeline', (req, res, next) => run(pipelineMisReport, req, res, next));
router.get('/approval-trail', (req, res, next) => run(approvalTrailReport, req, res, next));
router.get('/shortage', (req, res, next) => run(shortageReport, req, res, next));
router.get('/price-compare', (req, res, next) => run(priceCompareReport, req, res, next));
router.get('/gst-register', (req, res, next) => run(gstRegisterReport, req, res, next));
router.get('/doc-completeness', (req, res, next) => run(docCompletenessReport, req, res, next));
router.get('/spend-vendor', (req, res, next) => run(spendByVendorReport, req, res, next));
router.get('/branch-transfer-register', (req, res, next) =>
  run(branchTransferReport, req, res, next)
);
router.get('/rfq-pipeline', (req, res, next) => run(rfqPipelineReport, req, res, next));
router.get('/grn-payment-reco', (req, res, next) => run(grnPaymentRecoReport, req, res, next));
router.get('/cancelled-procurement', (req, res, next) =>
  run(cancelledProcurementReport, req, res, next)
);
router.get('/wo-cost', (req, res, next) => run(workOrderCostReport, req, res, next));
router.get('/stock-movement', (req, res, next) => run(stockMovementReport, req, res, next));

module.exports = router;

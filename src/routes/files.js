const express = require('express');
const path = require('path');
const { authenticate } = require('../middleware/auth');
const { UPLOAD_ROOT: MSME_UPLOAD_ROOT } = require('../services/vendorFileService');
const { UPLOAD_ROOT: GRN_UPLOAD_ROOT } = require('../services/grnFileService');

const router = express.Router();

router.use(authenticate);

router.get('/msme/:fileName', (req, res, next) => {
  try {
    const fileName = path.basename(req.params.fileName);
    const fullPath = path.join(MSME_UPLOAD_ROOT, fileName);
    res.sendFile(fullPath, (err) => {
      if (err) next();
    });
  } catch (err) {
    next(err);
  }
});

router.get('/grn/:fileName', async (req, res, next) => {
  try {
    const fileName = path.basename(req.params.fileName);
    const { GoodsReceiptNote, MaterialIssue, MaterialRequest } = require('../models');
    const { resolveRegisterSiteFilter, applySiteFilterToQuery } = require('../services/registerScopeService');
    const scope = await resolveRegisterSiteFilter(req.user);
    const filter = { 'attachments.url': `/api/files/grn/${fileName}` };
    if (!applySiteFilterToQuery(filter, scope)) return res.sendStatus(404);
    const requestFilter = { 'storeStockReceivedAttachments.url': `/api/files/grn/${fileName}` };
    if (!applySiteFilterToQuery(requestFilter, scope)) return res.sendStatus(404);
    const [grn, issue, indent] = await Promise.all([
      GoodsReceiptNote.exists(filter), MaterialIssue.exists(filter), MaterialRequest.exists(requestFilter),
    ]);
    if (!grn && !issue && !indent) return res.sendStatus(404);
    const fullPath = path.join(GRN_UPLOAD_ROOT, fileName);
    res.sendFile(fullPath, (err) => {
      if (err) next();
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

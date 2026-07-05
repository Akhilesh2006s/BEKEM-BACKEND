const express = require('express');
const path = require('path');
const { authenticate } = require('../middleware/auth');
const { UPLOAD_ROOT } = require('../services/vendorFileService');

const router = express.Router();

router.use(authenticate);

router.get('/msme/:fileName', (req, res, next) => {
  try {
    const fileName = path.basename(req.params.fileName);
    const fullPath = path.join(UPLOAD_ROOT, fileName);
    res.sendFile(fullPath, (err) => {
      if (err) next();
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

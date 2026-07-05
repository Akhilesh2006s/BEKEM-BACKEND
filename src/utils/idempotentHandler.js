const { withIdempotency, sendIdempotent } = require('../services/idempotencyService');

async function handleIdempotent(req, res, scope, handler, next) {
  try {
    const outcome = await withIdempotency(req, scope, handler);
    return sendIdempotent(res, outcome);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ statusCode: err.statusCode, message: err.message });
    }
    next(err);
  }
}

module.exports = { handleIdempotent };

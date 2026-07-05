const { handleIdempotent } = require('./idempotentHandler');

/** @deprecated Use handleIdempotent */
async function handleIdempotentJson(req, res, scope, handler, next) {
  return handleIdempotent(req, res, scope, handler, next);
}

module.exports = { handleIdempotentJson, handleIdempotent };

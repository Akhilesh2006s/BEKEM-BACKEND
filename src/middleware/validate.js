const { validationResult } = require('express-validator');

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      statusCode: 400,
      message: errors.array().map((e) => e.msg),
      error: 'Validation Error',
    });
  }
  next();
}

function errorHandler(err, req, res, _next) {
  console.error(err);
  const status = err.statusCode || 500;
  res.status(status).json({
    statusCode: status,
    message: err.message || 'Internal server error',
    error: err.name || 'Error',
  });
}

module.exports = { validate, errorHandler };

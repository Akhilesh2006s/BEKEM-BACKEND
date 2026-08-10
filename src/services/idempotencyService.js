const { IdempotencyRecord } = require('../models');

const TTL_MS = 24 * 60 * 60 * 1000;
const inFlight = new Map();

function readIdempotencyKey(req) {
  const header = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
  const bodyKey = req.body?.idempotencyKey;
  const key = (header || bodyKey || '').toString().trim();
  return key || null;
}

async function getCachedResponse(key, userId, scope) {
  const row = await IdempotencyRecord.findOne({ key, userId, scope }).lean();
  if (!row) return null;
  return { statusCode: row.statusCode, body: row.responseBody };
}

async function storeResponse(key, userId, scope, statusCode, responseBody) {
  const expiresAt = new Date(Date.now() + TTL_MS);
  await IdempotencyRecord.findOneAndUpdate(
    { key, userId, scope },
    { statusCode, responseBody, expiresAt },
    { upsert: true, new: true }
  );
}

/**
 * Run a mutating handler once per idempotency key. Without a key, runs normally.
 */
async function withIdempotency(req, scope, handler) {
  const key = readIdempotencyKey(req);
  if (!key) {
    const result = await handler();
    return { replayed: false, ...result };
  }

  const cached = await getCachedResponse(key, req.user._id, scope);
  if (cached) {
    return { replayed: true, statusCode: cached.statusCode, body: cached.body };
  }

  const flightKey = `${req.user._id}:${scope}:${key}`;
  const existingFlight = inFlight.get(flightKey);
  if (existingFlight) {
    const result = await existingFlight;
    return { replayed: true, ...result };
  }

  const execution = (async () => {
    const result = await handler();
    const statusCode = result.statusCode ?? 200;
    const body = result.body ?? result;
    await storeResponse(key, req.user._id, scope, statusCode, body);
    return { statusCode, body };
  })();
  inFlight.set(flightKey, execution);

  try {
    const { statusCode, body } = await execution;
    return { replayed: false, statusCode, body };
  } finally {
    inFlight.delete(flightKey);
  }
}

function sendIdempotent(res, { replayed, statusCode, body }) {
  if (replayed) res.setHeader('X-Idempotent-Replayed', 'true');
  return res.status(statusCode).json(body);
}

module.exports = {
  readIdempotencyKey,
  withIdempotency,
  sendIdempotent,
};

/**
 * Build allowed CORS origins from env.
 * Accepts comma-separated list. Paths (e.g. /login) and trailing slashes are stripped.
 */
function normalizeOrigin(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return url.origin;
  } catch {
    return trimmed.replace(/\/+$/, '').replace(/\/(login|index\.html).*$/i, '') || null;
  }
}

function getAllowedOrigins() {
  const defaults = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://bekem-frontend-zeta.vercel.app',
  ];
  const fromEnv = String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);
  return [...new Set([...defaults, ...fromEnv])];
}

/** Local Vite often binds 5174+ when 5173 is taken. */
function isLocalViteOrigin(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return false;
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    return port >= 5173 && port <= 5199;
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin) {
  const allowed = getAllowedOrigins();
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (allowed.includes(normalized)) return true;
  if (isLocalViteOrigin(normalized)) return true;
  if (
    process.env.CORS_ALLOW_VERCEL_PREVIEWS === 'true' &&
    /\.vercel\.app$/i.test(normalized)
  ) {
    return true;
  }
  return false;
}

/** cors package origin callback — reflects request origin when allowed. */
function corsOriginCallback(origin, callback) {
  // Non-browser clients (no Origin header)
  if (!origin) return callback(null, true);
  const normalized = normalizeOrigin(origin);
  if (normalized && isAllowedOrigin(normalized)) {
    return callback(null, normalized);
  }
  console.warn(
    `[CORS] blocked origin: ${origin} (allowed: ${getAllowedOrigins().join(', ')}, local Vite 5173–5199)`
  );
  return callback(null, false);
}

function socketCorsConfig() {
  return {
    origin: (origin, callback) => corsOriginCallback(origin, callback),
    credentials: true,
  };
}

function expressCorsConfig() {
  return {
    origin: corsOriginCallback,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'X-Idempotency-Key',
    ],
  };
}

module.exports = {
  normalizeOrigin,
  getAllowedOrigins,
  corsOriginCallback,
  socketCorsConfig,
  expressCorsConfig,
};

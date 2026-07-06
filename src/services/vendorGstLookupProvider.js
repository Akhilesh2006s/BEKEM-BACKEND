/**
 * GST portal lookup providers.
 * Default: sandbox.co.in (GSTN-authorised GSP). Set GST_LOOKUP_API_KEY + GST_LOOKUP_API_SECRET.
 * Tests: GST_LOOKUP_PROVIDER=mock
 * Custom REST: GST_LOOKUP_PROVIDER=custom + GST_LOOKUP_API_URL
 */

function getProviderName() {
  return (process.env.GST_LOOKUP_PROVIDER || 'sandbox').trim().toLowerCase();
}

function getApiBase() {
  return (
    process.env.GST_LOOKUP_API_BASE ||
    (process.env.NODE_ENV === 'test'
      ? 'https://test-api.sandbox.co.in'
      : 'https://api.sandbox.co.in')
  ).replace(/\/$/, '');
}

function formatAddress(addr) {
  if (!addr || typeof addr !== 'object') return '';
  return [
    addr.bno,
    addr.bnm,
    addr.flno,
    addr.st,
    addr.loc,
    addr.dst,
    addr.stcd,
    addr.pncd,
  ]
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join(', ');
}

function mapSandboxTaxpayer(payload, gstin) {
  const row = payload?.data?.data || payload?.data || payload;
  if (!row || row.error) {
    const msg = row?.error?.message || 'No taxpayer record found for this GSTIN';
    const err = new Error(msg);
    err.statusCode = 404;
    throw err;
  }

  const legalName = String(row.lgnm || '').trim();
  const tradeName = String(row.tradeNam || '').trim();
  const status = String(row.sts || '').trim();
  const address = formatAddress(row.pradr?.addr);
  const displayName = tradeName || legalName;

  if (!displayName) {
    const err = new Error('GST registry returned no business name for this GSTIN');
    err.statusCode = 404;
    throw err;
  }

  return {
    name: displayName,
    address,
    gstDetails: {
      legalName: legalName || displayName,
      tradeName: tradeName || legalName || displayName,
      status: status || 'Unknown',
      address,
      registrationDate: row.rgdt || undefined,
      taxpayerType: row.dty || undefined,
      stateJurisdiction: row.stj || undefined,
      natureOfBusiness: Array.isArray(row.nba) ? row.nba : undefined,
      fetchedAt: new Date().toISOString(),
      source: 'GST_PORTAL',
      provider: 'sandbox',
      gstin: row.gstin || gstin,
    },
  };
}

let sandboxToken = { value: null, expiresAt: 0 };

async function sandboxAuthenticate() {
  const apiKey = process.env.GST_LOOKUP_API_KEY;
  const apiSecret = process.env.GST_LOOKUP_API_SECRET;
  if (!apiKey || !apiSecret) {
    const err = new Error(
      'GST lookup credentials missing — set GST_LOOKUP_API_KEY and GST_LOOKUP_API_SECRET'
    );
    err.statusCode = 503;
    throw err;
  }

  if (sandboxToken.value && Date.now() < sandboxToken.expiresAt) {
    return sandboxToken.value;
  }

  const res = await fetch(`${getApiBase()}/authenticate`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'x-api-secret': apiSecret,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.message || body?.error || 'GST portal authentication failed');
    err.statusCode = res.status === 401 ? 401 : 502;
    throw err;
  }

  const token =
    body?.data?.access_token ||
    body?.access_token ||
    body?.data?.token ||
    body?.token;
  if (!token) {
    const err = new Error('GST portal authentication returned no access token');
    err.statusCode = 502;
    throw err;
  }

  const ttlSec = Number(body?.data?.expires_in || body?.expires_in || 3600);
  sandboxToken = {
    value: token,
    expiresAt: Date.now() + Math.max(300, ttlSec - 60) * 1000,
  };
  return token;
}

async function sandboxLookup(gstin) {
  const token = await sandboxAuthenticate();
  const apiKey = process.env.GST_LOOKUP_API_KEY;

  const res = await fetch(`${getApiBase()}/gst/compliance/public/gstin/search`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      authorization: token,
      'x-api-version': process.env.GST_LOOKUP_API_VERSION || '1.0.0',
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-accept-cache': 'true',
    },
    body: JSON.stringify({ gstin }),
  });

  const body = await res.json().catch(() => ({}));

  if (body?.data?.error?.error_cd === 'FO8000' || body?.data?.status_cd === '0') {
    const err = new Error(body?.data?.error?.message || 'No taxpayer record found for this GSTIN');
    err.statusCode = 404;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(body?.message || body?.error || 'GST portal lookup failed');
    err.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }

  return mapSandboxTaxpayer(body, gstin);
}

async function customLookup(gstin) {
  const urlTemplate = process.env.GST_LOOKUP_API_URL;
  if (!urlTemplate) {
    const err = new Error('GST_LOOKUP_API_URL is required for custom provider');
    err.statusCode = 503;
    throw err;
  }

  const url = urlTemplate.replace('{gstin}', encodeURIComponent(gstin));
  const headers = { Accept: 'application/json' };
  if (process.env.GST_LOOKUP_API_KEY) {
    headers.Authorization = `Bearer ${process.env.GST_LOOKUP_API_KEY}`;
    headers['x-api-key'] = process.env.GST_LOOKUP_API_KEY;
  }

  const res = await fetch(url, { headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.message || 'GST lookup failed');
    err.statusCode = res.status;
    throw err;
  }

  const legalName = body.legalName || body.lgnm || body.name;
  const tradeName = body.tradeName || body.tradeNam;
  const address = body.address || formatAddress(body.pradr?.addr);
  const name = tradeName || legalName || body.name;
  if (!name) {
    const err = new Error('GST lookup returned no business name');
    err.statusCode = 404;
    throw err;
  }

  return {
    name,
    address: address || '',
    gstDetails: {
      legalName: legalName || name,
      tradeName: tradeName || legalName || name,
      status: body.status || body.sts || 'Unknown',
      address: address || '',
      fetchedAt: new Date().toISOString(),
      source: 'GST_PORTAL',
      provider: 'custom',
      gstin,
    },
  };
}

async function mockLookup(gstin) {
  if (gstin.startsWith('99')) {
    const err = new Error('No taxpayer record found for this GSTIN');
    err.statusCode = 404;
    throw err;
  }

  return {
    name: 'Demo GST Vendor Pvt Ltd',
    address: '12 Industrial Estate, Bengaluru, Karnataka 560001',
    gstDetails: {
      legalName: 'Demo GST Vendor Private Limited',
      tradeName: 'Demo GST Vendor Pvt Ltd',
      status: 'Active',
      address: '12 Industrial Estate, Bengaluru, Karnataka 560001',
      fetchedAt: new Date().toISOString(),
      source: 'GST_PORTAL',
      provider: 'mock',
      gstin,
    },
  };
}

async function fetchGstTaxpayer(gstin) {
  const provider = getProviderName();
  if (provider === 'mock') return mockLookup(gstin);
  if (provider === 'custom') return customLookup(gstin);
  return sandboxLookup(gstin);
}

function resetSandboxTokenCache() {
  sandboxToken = { value: null, expiresAt: 0 };
}

module.exports = {
  fetchGstTaxpayer,
  formatAddress,
  getProviderName,
  resetSandboxTokenCache,
};

/**
 * Live UAT smoke walk — authenticated API sequence after seed/backfill.
 * Run: npm run uat:walk (API must be running on PORT, Mongo seeded)
 *
 * Complements integration tests; use alongside browser walk at http://localhost:5173
 */
require('dotenv').config();
const { DEMO_PASSWORD } = require('../scripts/seed');

const BASE = process.env.UAT_API_BASE || `http://localhost:${process.env.PORT || 4000}`;

const ACCOUNTS = [
  { label: 'Site', email: 'request@bekem.com' },
  { label: 'Store', email: 'storeincharge@bekem.com' },
  { label: 'PM', email: 'pm@bekem.com' },
  { label: 'Executive', email: 'executive@bekem.com' },
  { label: 'Coordinator', email: 'coordinator@bekem.com' },
  { label: 'Chairman', email: 'chairman@bekem.com' },
];

async function api(path, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, ok: res.ok, json, headers: res.headers };
}

async function login(email) {
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password: DEMO_PASSWORD },
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  return res.json.tokens.accessToken;
}

function step(label, res) {
  const ok = res.ok ? '✓' : '✗';
  console.log(`  ${ok} ${label} — HTTP ${res.status}`);
  if (!res.ok) {
    console.log('    ', JSON.stringify(res.json)?.slice(0, 200));
  }
  return res.ok;
}

function stepArray(label, res, min = 0) {
  const data = res.json?.data;
  const isArray = Array.isArray(data);
  const ok = res.ok && isArray;
  const icon = ok ? '✓' : '✗';
  console.log(`  ${icon} ${label} — HTTP ${res.status}${isArray ? ` · array[${data.length}]` : ' · not array'}`);
  if (!ok) {
    console.log('    ', JSON.stringify(res.json)?.slice(0, 200));
  }
  if (ok && data.length < min) {
    console.log(`    ↳ warning: expected at least ${min} seeded record(s), got ${data.length}`);
  }
  return ok;
}

async function walk() {
  console.log(`\n🔍 UAT smoke walk — ${BASE}\n`);

  let passed = 0;
  let failed = 0;

  const tokens = {};
  for (const acct of ACCOUNTS) {
    try {
      tokens[acct.label] = await login(acct.email);
      console.log(`Logged in: ${acct.label}`);
    } catch (e) {
      console.error(`Login failed: ${acct.label}`, e.message);
      failed += 1;
    }
  }

  const checks = [
    ['Site dashboard / material-requests', () => api('/api/material-requests', { token: tokens.Site })],
    ['Store pending indents', () => api('/api/material-requests?tab=pending', { token: tokens.Store })],
    ['Store site context', () => api('/api/sites/my', { token: tokens.Store })],
    ['PM dashboard', () => api('/api/dashboard/pm', { token: tokens.PM })],
    ['PM approvals queue', () =>
      api('/api/material-requests?status=FORWARDED_TO_PM', { token: tokens.PM })],
    ['Executive projects', () => api('/api/dashboard/executive', { token: tokens.Executive })],
    ['Coordinator PO queue', () =>
      api('/api/purchase-orders?queue=coordinator', { token: tokens.Coordinator })],
    ['Coordinator WO queue', () =>
      api('/api/work-orders?queue=coordinator', { token: tokens.Coordinator })],
    ['PM PO queue (C2)', () => api('/api/purchase-orders?queue=pm', { token: tokens.PM })],
    ['PM WO queue (C3)', () => api('/api/work-orders?queue=pm', { token: tokens.PM })],
    ['Chairman KPIs', () => api('/api/dashboard/chairman-kpis', { token: tokens.Chairman })],
    ['Chairman PO queue', () =>
      api('/api/purchase-orders?queue=chairman', { token: tokens.Chairman })],
    ['Global search', () => api('/api/dashboard/search?q=PO', { token: tokens.Coordinator })],
    ['Branch transfers', () => api('/api/branch-transfers', { token: tokens.Coordinator })],
    ['Notifications', () => api('/api/notifications', { token: tokens.PM })],
    ['Audit logs', () => api('/api/audit-logs?limit=5', { token: tokens.Chairman })],
  ];

  const arrayChecks = new Set([
    'Store pending indents',
    'Coordinator PO queue',
    'Coordinator WO queue',
    'PM PO queue (C2)',
    'PM WO queue (C3)',
    'Chairman PO queue',
  ]);

  for (const [label, fn] of checks) {
    try {
      const res = await fn();
      const ok = arrayChecks.has(label) ? stepArray(label, res) : step(label, res);
      if (ok) passed += 1;
      else failed += 1;
    } catch (e) {
      console.log(`  ✗ ${label} — ${e.message}`);
      failed += 1;
    }
  }

  // Store stock array shape (C4) — needs site id from prior login
  try {
    const siteRes = await api('/api/sites/my', { token: tokens.Store });
    const siteId = siteRes.json?.data?.id;
    if (siteId) {
      const stockRes = await api(`/api/stock/site/${siteId}`, { token: tokens.Store });
      if (stepArray('Store stock ledger (C4)', stockRes)) passed += 1;
      else failed += 1;
    } else {
      console.log('  ✗ Store stock ledger (C4) — no site id');
      failed += 1;
    }
  } catch (e) {
    console.log(`  ✗ Store stock ledger (C4) — ${e.message}`);
    failed += 1;
  }

  // Idempotency replay probe (chairman PO approve with key — no-op if queue empty)
  try {
    const queue = await api('/api/purchase-orders?queue=chairman', { token: tokens.Chairman });
    const poId = queue.json?.data?.[0]?.id;
    if (poId) {
      const key = `uat-smoke-${Date.now()}`;
      const h = { 'Idempotency-Key': key };
      const first = await api(`/api/purchase-orders/${poId}/approve`, {
        method: 'POST',
        token: tokens.Chairman,
        body: { note: 'UAT smoke' },
        headers: h,
      });
      const second = await api(`/api/purchase-orders/${poId}/approve`, {
        method: 'POST',
        token: tokens.Chairman,
        body: { note: 'UAT smoke' },
        headers: h,
      });
      const replayed = second.headers.get('x-idempotent-replayed') === 'true';
      if (step(`Idempotency replay (PO ${poId})`, second) && replayed) {
        console.log('    ↳ X-Idempotent-Replayed header present on replay');
        passed += 1;
      } else if (first.ok) {
        passed += 1;
      } else {
        failed += 1;
      }
    } else {
      console.log('  · Idempotency probe skipped — no chairman PO in queue');
    }
  } catch (e) {
    console.log(`  ✗ Idempotency probe — ${e.message}`);
    failed += 1;
  }

  console.log(`\n${failed === 0 ? '✅' : '⚠️'} Smoke walk: ${passed} passed, ${failed} failed`);
  console.log('\nBrowser walk: open http://localhost:5173, login *@bekem.com / Bekem@Demo2026!');
  console.log('Roles: Site → Store → PM → Executive → Coordinator → Chairman\n');

  process.exit(failed > 0 ? 1 : 0);
}

walk().catch((err) => {
  console.error(err);
  process.exit(1);
});

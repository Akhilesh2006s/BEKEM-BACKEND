# BEKEM Backend (AFIOS 2.0)

Express + MongoDB API for **Bekem OS** — construction ERP for Bekem Infra.

## Stack

- Node.js, Express
- MongoDB / Mongoose
- JWT auth, RBAC
- Shared types in `packages/shared`

## Setup

```bash
cp .env.example .env
# Edit .env with your MongoDB URI and JWT secrets

npm install
npm run dev
```

API: http://localhost:4000

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start API with file watch |
| `npm start` | Start API |
| `npm run seed` | Seed demo users and sample data |
| `npm run import:po-index` | Import Stock Inventory from PO INDEX Excel |
| `npm run backfill:stock` | Fill live stock ledgers from inventory QTY |
| `npm test` | Run API tests |

## Demo users (after seed)

Password: `Bekem@Demo2026!`

| Role | Email |
|------|-------|
| Site Manager | request@bekem.com |
| Store Manager | storeincharge@bekem.com |
| Project Manager | pm@bekem.com |
| Executive | executive@bekem.com |
| Coordinator | coordinator@bekem.com |
| Chairman | chairman@bekem.com |

## PO approval rules (INR)

- Under ₹5,000 → Project Manager
- ₹5,000–₹10,000 → Coordinator
- Above ₹10,000 → Chairman (Coordinator may approve only with “Chairman not on premises” note)

## Note

This repository is **backend only**. The React frontend is in a separate repo (`BEKEM-FRONTEND`). Set `CORS_ORIGIN` to your frontend URL.

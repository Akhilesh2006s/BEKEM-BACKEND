# Bekem OS — Consolidated UAT Requirements (1–60)

**Source:** Client UAT / procurement meetings  
**Last updated:** 8 July 2026 (continuation meeting — Requirements 41–60 added)  
**Scope:** Complete procurement lifecycle  
Indent → RFQ → Quotation → PO → GRN → Store Issue → Inventory → Stock Aging → Reporting

---

## Status legend (implementation tracking)

Use when updating this doc after builds:

| Status | Meaning |
|--------|---------|
| `OPEN` | Spec accepted; not yet implemented / verified |
| `PARTIAL` | Partly in product |
| `DONE` | Implemented and UAT-verified |
| `N/A` | Deferred / out of current phase |

---

# Part A — Requirements 1–40 (existing baseline)

Captured from the enterprise 40-point UAT checklist.

| # | Requirement | Area |
|---|-------------|------|
| 1 | Fixed material categories; **Others** → mandatory Remarks | Material Master |
| 2 | Store Issue type: **Work Issue** / **Contract Issue** only | Material Issue |
| 3 | Auto-grouping of reports / statements / lists by category | Reporting |
| 4 | One GRN per invoice; sequential numbering per PO (GRN-1, GRN-2…) | GRN |
| 5 | GRN landscape table with specified columns (Item, Ordered, Received, Balance, Unit, PO rate, Invoice rate, Total) | GRN |
| 6 | Balance qty auto-calculated | GRN |
| 7 | Only PO Rate + editable Invoice Rate (no duplicate PO fields) | GRN |
| 8 | Auto-highlight price increase/decrease vs PO rate (green/red) | GRN |
| 9 | Qty > ordered or rate ≠ PO → auto **Hold** → Coordinator → then allocation | GRN / Approvals |
| 10 | Prefer **ON HOLD** over reject; only critical cases to Chairman | GRN / Approvals |
| 11 | Mandatory Invoice + Challan uploads; Photos optional | GRN |
| 12 | Remove driver name / vehicle number from GRN | GRN |
| 13 | Invoice > ₹50,000 → mandatory E-Way Bill else hold + Coordinator approval | GRN |
| 14 | Auto PO term: E-Way Bill mandatory above ₹50,000 | PO |
| 15 | 9 standard terms + Additional Terms textbox | PO |
| 16 | Existing stock still requires PM approval; store cannot issue independently | Approvals / Stock |
| 17 | PM mobile approval with Face ID / fingerprint | Mobile |
| 18 | Dashboard statuses: Pending / Approved / Completed / All | Dashboards |
| 19 | Branch transfer: request → HO approval → transfer | Branch Transfer |
| 20 | Store available + company-wide + project-wise stock | Stock / PO |
| 21 | Item search → instant stock, location, transfer-or-procure hint | Indent |
| 22 | Default procurement = PO; branch transfer only if selected | Executive |
| 23 | Executive dashboard search (project / employee / material) + suggest | Executive |
| 24 | Executive RFQ process (receive → RFQ → share → quotes → compare → PO) | RFQ |
| 25 | Standard RFQ doc (items/qty/unit/terms/number) + Download / Email / WhatsApp | RFQ |
| 26 | Default 3 vendors + Add Vendor; each with rate / GST / terms / delivery | Quotation |
| 27 | Auto L1 detection; non-L1 selection requires reason | Quotation / PO |
| 28 | Purchase history: min / max / previous rate / current quote | PO |
| 29 | One PO or multiple vendor POs (split by vendor) | PO |
| 30 | GST % / GST amount / final amount auto-displayed | PO / Quotation |
| 31 | GST number → auto-fetch vendor name / details / address | Vendors |
| 32 | Role permissions: Exec create/draft, Coordinator modify+approve, Chairman final | RBAC |
| 33 | PM limit dynamic / configurable (not hardcoded ₹5,000) | Admin / PM |
| 34 | Misc purchases (grocery / mess / office / emergency), with/without PO | Misc |
| 35 | Monthly misc transaction reports for audit | Misc / Reporting |
| 36 | Individual role-based logins (no common login) | Auth |
| 37 | Approved By: name + designation + date (not generic status) | Audit |
| 38 | Desktop landscape / compact tables; separate mobile UI | UX |
| 39 | Stock + history + previous rates on one screen while creating PO | PO |
| 40 | Full executive workflow chain including hold-on-variation | End-to-end |

---

# Part B — Requirements 41–60 (continuation meeting, 8 Jul 2026)

Additional UAT changes. Status default: **OPEN**.

---

## 41. Indent Listing Table Standardization

**Area:** Indent / UX  
**Status:** `DONE`

All Indent screens must use the same compact table structure.

**Columns:**

- Indent Number
- Indent Date
- Purpose
- Category
- Raised By
- Status

**Rules:**

- Reduce unnecessary columns.
- Show more records without scrolling.
- Clicking an Indent opens complete details.

---

## 42. Remove Duplicate Dashboard Sections

**Area:** Dashboards  
**Status:** `DONE`

**Current (issue):** Pending Indents / Completed Indents / All Indents — duplicate information.

**Required filters only:**

- Pending
- Completed
- Rejected
- All

Reduce dashboard clutter.

---

## 43. Remove “Verified Delivery”

**Area:** GRN / Store  
**Status:** `DONE`

**Remove current flow:** Verify Delivery → Generate GRN  

**New flow:**

```
Material Received → Submit → GRN Generated Automatically
```

No separate “Verify Delivery” screen.

---

## 44. GRN Generation Flow

**Area:** GRN  
**Status:** `DONE`

```
PO → Material Received → Submit → GRN Number Auto Generated
```

No extra verification process beyond Material Received + Submit.

---

## 45. PO → GRN Linking

**Area:** GRN / Traceability  
**Status:** `DONE`

Every GRN must maintain references to:

- Indent Number
- PO Number
- Vendor

Complete traceability across Indent → PO → GRN.

---

## 46. Multiple GRNs per PO

**Area:** GRN  
**Status:** `DONE`

One PO may have multiple deliveries. Each delivery / invoice gets its own GRN.

**Example:**

```
PO-001
  ├─ Invoice-1 → GRN-001
  ├─ Invoice-2 → GRN-002
  └─ Invoice-3 → GRN-003
```

---

## 47. Material Receipt Listing

**Area:** GRN / Listing  
**Status:** `DONE`

Material Receipt screen columns:

- GRN Number
- PO Number
- Indent Number
- Vendor
- Material Receipt Date
- Status

Remove unnecessary columns.

---

## 48. Store Material Issue Table Redesign

**Area:** Material Issue  
**Status:** `DONE`

**Columns:**

- Item Code
- Item Description
- Available Quantity
- Issued Quantity
- Balance Quantity
- Unit

**Remove:** Requested Quantity

---

## 49. Material Issue Date

**Area:** Material Issue  
**Status:** `DONE`

Instead of PO Date, display **Material Issue Date** — the actual date the store issued the material.

---

## 50. Material Issue Type

**Area:** Material Issue  
**Status:** `DONE`

Keep only two Issue Types:

- Work Issue
- Contract Issue

Remove all other issue classifications.

---

## 51. Issue To Logic

**Area:** Material Issue  
**Status:** `DONE`

| Issue Type | Mandatory field |
|------------|-----------------|
| Work Issue | Employee Name |
| Contract Issue | Contractor Name |

Dynamic fields appear based on selection.

---

## 52. Contractor Acknowledgement

**Area:** Material Issue  
**Status:** `DONE`

For Contract Issues — **optional:** Upload Signed Acknowledgement  
Used for contractor billing reconciliation.

---

## 53. Material Issue Registers

**Area:** Store / Registers  
**Status:** `DONE`

Introduce three registers:

### Inward Register
Shows all GRNs received.

### Outward Register
Shows all Material Issues.

### Stock Register
```
Current Stock = Total Inward − Total Outward
```

---

## 54. Stock Inventory Improvements

**Area:** Inventory  
**Status:** `DONE`

Inventory columns:

- Item Code
- Item Description
- Unit
- Total Received
- Total Issued
- Current Balance

No HSN / GST information on this screen.

---

## 55. FIFO Stock Consumption

**Area:** Inventory / Issue  
**Status:** `DONE`

Material issuing follows **FIFO** (First In First Out).

- Always consume oldest stock first.
- No manual batch selection.

---

## 56. Stock Aging Analysis

**Area:** Inventory / Aging  
**Status:** `DONE`

Every GRN batch maintains aging:

```
Aging (Days) = Current Date − GRN Receipt Date
```

**Display:**

- Batch-wise Aging
- Current Balance
- Days in Store

FIFO based.

---

## 57. Stock Aging Report

**Area:** Reporting  
**Status:** `DONE`

Stock Aging Report columns:

- Item
- Batch
- GRN
- Received Date
- Available Quantity
- Aging (Days)

Purpose: identify idle inventory.

---

## 58. Executive & Coordinator Status Labels

**Area:** Status / UX  
**Status:** `DONE`

Replace confusing labels (e.g. “Accepted at Store”) with next-approver labels:

- Pending at PM
- Pending at Executive
- Pending at Coordinator
- Pending at Chairman

Status must always indicate the **next approver**.

---

## 59. RFQ Comparison UI Enhancement

**Area:** RFQ / Quotation  
**Status:** `DONE`

Instead of dropdown-based comparison, display per-item expandable tables:

```
Each Item
  └─ Expandable table
       Vendor 1 / Vendor 2 / Vendor 3 / Vendor 4…
       Rate | GST | Final Cost
```

More compact and easier to compare.

---

## 60. Multi-Vendor PO Generation

**Area:** PO / RFQ  
**Status:** `DONE`

After RFQ comparison, allow **Generate Separate POs**:

```
Item A → Vendor A → PO-1
Item B → Vendor B → PO-2
Item C → Vendor C → PO-3
```

Each selected vendor automatically receives a separate Purchase Order including:

- Registered Office Address
- Delivery Address
- Vendor Details
- Material List
- Payment Terms
- “Why We Chose This Vendor” Remarks

---

# Lifecycle coverage (60 requirements)

| Stage | Requirement IDs |
|-------|-----------------|
| Indent & categories | 1, 3, 21, 41, 42, 58 |
| Dashboards & status | 18, 23, 42, 58 |
| RFQ & quotation | 24–28, 59, 60 |
| PO & GST / terms | 14, 15, 22, 29–32, 39, 60 |
| GRN / material receipt | 4–13, 40, 43–47 |
| Store issue | 2, 16, 48–52 |
| Inventory / FIFO / aging | 20, 53–57 |
| Branch / misc / mobile / auth | 17, 19, 33–37 |
| Desktop / desktop tables | 5, 38, 41, 47, 48, 54 |

---

# Continuation notes

- Requirements **41–60** do not replace **1–40**; they extend them.
- Overlaps to reconcile during implementation:
  - **2 ↔ 50** (Issue Types — already baseline; 50 reaffirm / purge extras)
  - **4 / 46** (multi-GRN per PO — reinforce one-GRN-per-invoice)
  - **29 ↔ 60** (split / multi-vendor PO generation)
  - **18 ↔ 42** (dashboard filters — 42 adds **Rejected**, may refine labels)
  - **43 / 44** supersede any separate Verify Delivery step ahead of GRN

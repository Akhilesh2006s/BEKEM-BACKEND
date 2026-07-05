const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  buildProcurementRef,
  buildDraftProcurementRef,
  sanitizeProcurementRef,
  parseProcurementRef,
} = require('./services/procurementReferenceService');

describe('procurement reference format (UAT H1/H3)', () => {
  it('builds official ref without spaces or vendor suffix', () => {
    const ref = buildProcurementRef({
      projectCode: 'AMR',
      vendorCode: 'SRE',
      poSeq: 2,
      financialYear: '26-27',
    });
    assert.strictEqual(ref, 'BEKEM-AMR/SRE/0002/26-27');
    assert.ok(!ref.includes(' '));
  });

  it('sanitizes legacy spaced references', () => {
    const raw = 'BEKEM -AMR /SRE /0002-2 /26-27';
    const clean = sanitizeProcurementRef(raw);
    assert.strictEqual(clean, 'BEKEM-AMR/SRE/0002-2/26-27');
    const parsed = parseProcurementRef(clean);
    assert.strictEqual(parsed.projectCode, 'AMR');
    assert.strictEqual(parsed.vendorCode, 'SRE');
    assert.strictEqual(parsed.poSeq, '0002');
  });

  it('builds draft ref with same FY token as final', () => {
    const draft = buildDraftProcurementRef({
      projectCode: 'AMR',
      draftSeq: 4,
      financialYear: '26-27',
    });
    assert.strictEqual(draft, 'BEKEM-DRAFT/AMR/0004/26-27');
    assert.ok(draft.includes('26-27'));
    assert.ok(!draft.includes('FY26-27'));
  });
});

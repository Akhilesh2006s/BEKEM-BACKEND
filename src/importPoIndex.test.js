const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const writeXlsxFile = require('write-excel-file/node').default;
const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');
const { readInventoryRows } = require('./scripts/importPoIndex');

describe('PO index workbook reader', () => {
  it('reads rows, blank cells, dates and cached formula results without touching a database', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bekem-import-'));
    const filename = path.join(directory, 'synthetic.xlsx');
    try {
      const cells = Array(29).fill(null);
      cells[0] = 1;
      cells[1] = 'Synthetic project';
      cells[3] = { type: Date, value: new Date('2026-01-02T00:00:00.000Z'), format: 'yyyy-mm-dd' };
      cells[4] = 'Synthetic supplier';
      cells[5] = 'TEST-PO-1';
      cells[8] = 'Synthetic item';
      cells[9] = 2;
      cells[12] = 150;
      const buffer = await writeXlsxFile([['Heading'], ['Columns'], cells], { sheet: 'Stock Inventory' }).toBuffer();
      const archive = unzipSync(new Uint8Array(buffer));
      const sheetPath = 'xl/worksheets/sheet1.xml';
      const originalXml = strFromU8(archive[sheetPath]);
      const formulaXml = originalXml.replace(/(<c\b[^>]*r="M3"[^>]*>)(<v>150<\/v>)/, '$1<f>100+50</f>$2');
      assert.notEqual(formulaXml, originalXml, 'test workbook must contain a cached formula');
      archive[sheetPath] = strToU8(formulaXml);
      fs.writeFileSync(filename, zipSync(archive));
      const rows = await readInventoryRows(filename);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].project, 'Synthetic project');
      assert.equal(rows[0].poNo, 'TEST-PO-1');
      assert.equal(rows[0].itemDescription, 'Synthetic item');
      assert.equal(rows[0].qty, 2);
      assert.equal(rows[0].unitRate, 150);
      assert.equal(rows[0].recordDate.toISOString(), '2026-01-02T00:00:00.000Z');
    } finally {
      if (fs.existsSync(filename)) fs.unlinkSync(filename);
      fs.rmdirSync(directory);
    }
  });
});

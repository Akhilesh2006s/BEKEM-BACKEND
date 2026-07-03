const { MaterialRequest } = require('../models');

function currentFinancialYearLabel() {
  const now = new Date();
  const year = now.getFullYear();
  const fyStart = now.getMonth() >= 3 ? year : year - 1;
  const fyEnd = fyStart + 1;
  return `${String(fyStart).slice(-2)}-${String(fyEnd).slice(-2)}`;
}

async function generateIndentNumber(projectCode) {
  const fy = currentFinancialYearLabel();
  const prefix = `IND/FY${fy}/${projectCode}/`;
  const last = await MaterialRequest.findOne({
    indentNumber: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` },
  })
    .sort({ indentNumber: -1 })
    .select('indentNumber');

  let seq = 1;
  if (last) {
    const parts = last.indentNumber.split('/');
    seq = parseInt(parts[parts.length - 1], 10) + 1;
  }

  return `${prefix}${String(seq).padStart(6, '0')}`;
}

module.exports = { generateIndentNumber, currentFinancialYearLabel };

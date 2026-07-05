function round2(n) {
  return Math.round(n * 100) / 100;
}

/** lineTotal = qty × unitPrice; tax = lineTotal × gst%; grandTotal = lineTotal + tax */
function computePoLineTotals(quantity, rate, gstPercent = 18) {
  const qty = Number(quantity) || 0;
  const unitPrice = Number(rate) || 0;
  const gst = Number(gstPercent) || 0;
  const lineTotal = round2(qty * unitPrice);
  const tax = round2(lineTotal * (gst / 100));
  const grandTotal = round2(lineTotal + tax);
  return { lineTotal, tax, grandTotal, amount: lineTotal };
}

function validatePoLinePayload(row, index = 0) {
  const qty = Number(row.quantity);
  const rate = Number(row.rate);
  const gstPercent = row.gstPercent != null ? Number(row.gstPercent) : 18;

  if (!Number.isFinite(qty) || qty <= 0) {
    throw Object.assign(new Error(`Line ${index + 1}: quantity must be greater than 0`), {
      statusCode: 400,
    });
  }
  if (!Number.isFinite(rate) || rate < 0) {
    throw Object.assign(new Error(`Line ${index + 1}: unit price is invalid`), { statusCode: 400 });
  }
  if (row.materialName || row.material_name) {
    throw Object.assign(
      new Error(`Line ${index + 1}: materialName is not allowed — select from Material Master`),
      { statusCode: 400 }
    );
  }
  if (!row.materialId) {
    throw Object.assign(new Error(`Line ${index + 1}: materialId is required`), { statusCode: 400 });
  }

  const computed = computePoLineTotals(qty, rate, gstPercent);
  if (row.amount != null) {
    const clientAmount = round2(Number(row.amount));
    if (Math.abs(clientAmount - computed.lineTotal) > 0.02) {
      throw Object.assign(
        new Error(
          `Line ${index + 1}: line total mismatch (expected ${computed.lineTotal}, got ${clientAmount})`
        ),
        { statusCode: 400 }
      );
    }
  }
  return computed;
}

module.exports = { computePoLineTotals, validatePoLinePayload, round2 };

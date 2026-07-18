const PDFDocument = require('pdfkit');

function streamPdf(res, filename, build) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.pipe(res);
  build(doc);
  doc.end();
}

function header(doc, title, subtitle) {
  doc.fontSize(18).fillColor('#1A4FA0').text('Bekem OS', { align: 'left' });
  doc.moveDown(0.3);
  doc.fontSize(14).fillColor('#0F172A').text(title);
  if (subtitle) {
    doc.fontSize(10).fillColor('#64748B').text(subtitle);
  }
  doc.moveDown(1);
  doc.strokeColor('#E2E8F0').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.8);
}

function row(doc, label, value) {
  doc.fontSize(10).fillColor('#64748B').text(label, { continued: true, width: 140 });
  doc.fillColor('#0F172A').text(String(value ?? '—'));
}

function generateAuditLogPdf(logs, filters) {
  return (res) => {
    streamPdf(res, 'audit-log.pdf', (doc) => {
      const filterParts = [];
      if (filters.entityType) filterParts.push(`Entity: ${filters.entityType}`);
      if (filters.action) filterParts.push(`Action: ${filters.action}`);
      if (filters.from) filterParts.push(`From: ${filters.from}`);
      if (filters.to) filterParts.push(`To: ${filters.to}`);
      header(doc, 'Audit Log Export', filterParts.join(' · ') || 'All records');

      doc.fontSize(9).fillColor('#64748B');
      logs.forEach((log, i) => {
        if (doc.y > 720) doc.addPage();
        doc
          .fillColor('#0F172A')
          .text(`${i + 1}. ${log.action}`, { continued: false });
        doc
          .fillColor('#64748B')
          .text(
            `   ${log.timestamp} · ${log.actorName || 'System'} · ${log.entityType} ${log.entityId || ''}`
          );
        doc.moveDown(0.4);
      });

      if (logs.length === 0) {
        doc.fillColor('#64748B').text('No audit records match the selected filters.');
      }
    });
  };
}

function buildPurchaseOrderPdfContent(doc, po) {
  const { buildAllPoTerms } = require('../constants/poTerms');
  const pageWidth = 595;
  const margin = 50;
  const contentWidth = pageWidth - margin * 2;
  const rightColX = 380;
  const rightColW = 165;

  const poNo = po.poNumber || po.draftRef || '—';
  const poDate = po.createdAt
    ? new Date(po.createdAt).toLocaleDateString('en-IN')
    : new Date().toLocaleDateString('en-IN');

  let y = margin;

  doc.fontSize(16).fillColor('#1A4FA0').text('BEKEM INFRA PROJECTS PVT. LTD.', margin, y, {
    width: contentWidth,
    align: 'center',
  });
  y += 22;
  doc.fontSize(14).fillColor('#0F172A').text('PURCHASE ORDER', margin, y, {
    width: contentWidth,
    align: 'center',
  });
  y += 28;

  doc.fontSize(9).fillColor('#0F172A');
  doc.text(`PO No.: ${poNo}`, rightColX, margin + 4, { width: rightColW, align: 'right' });
  doc.text(`PO Date: ${poDate}`, rightColX, margin + 18, { width: rightColW, align: 'right' });
  if (po.referenceNote) {
    doc.text(`Reference: ${po.referenceNote}`, rightColX, margin + 32, {
      width: rightColW,
      align: 'right',
    });
  }

  doc.fontSize(10).fillColor('#1A4FA0').text('To,', margin, y);
  y += 14;
  doc.fontSize(10).fillColor('#0F172A').text(po.vendor?.name || '—', margin, y, { width: contentWidth - 180 });
  y += 14;

  doc.fontSize(9).fillColor('#334155');
  if (po.vendor?.address) {
    const addrH = doc.heightOfString(po.vendor.address, { width: contentWidth - 180 });
    doc.text(po.vendor.address, margin, y, { width: contentWidth - 180 });
    y += addrH + 4;
  }
  if (po.vendor?.gstNumber) {
    doc.text(`GST No.: ${po.vendor.gstNumber}`, margin, y);
    y += 12;
  }
  if (po.vendor?.email) {
    doc.text(`Email: ${po.vendor.email}`, margin, y);
    y += 12;
  }
  if (po.vendor?.contactPerson) {
    doc.text(
      `Kind Attn.: ${po.vendor.contactPerson}${po.vendor.phone ? ` (${po.vendor.phone})` : ''}`,
      margin,
      y,
      { width: contentWidth - 180 }
    );
    y += 14;
  }

  y += 8;
  const tableLeft = margin;
  const tableWidth = contentWidth;
  const colSno = tableLeft;
  const colDesc = tableLeft + 32;
  const colQty = tableLeft + 290;
  const colRate = tableLeft + 340;
  const colAmount = tableLeft + 400;
  const colDescW = colQty - colDesc - 6;
  const colQtyW = colRate - colQty - 4;
  const colRateW = colAmount - colRate - 4;
  const colAmountW = tableLeft + tableWidth - colAmount;

  doc.fontSize(8).fillColor('#FFFFFF');
  doc.rect(tableLeft, y, tableWidth, 18).fill('#1A4FA0');
  doc.fillColor('#FFFFFF');
  doc.text('S.No', colSno + 4, y + 5, { width: 26 });
  doc.text('Description', colDesc + 2, y + 5, { width: colDescW });
  doc.text('Qty', colQty + 2, y + 5, { width: colQtyW });
  doc.text('Rate (Rs.)', colRate + 2, y + 5, { width: colRateW });
  doc.text('Amount (Rs.)', colAmount + 2, y + 5, { width: colAmountW });
  y += 22;

  const items = po.lineItems?.length
    ? po.lineItems
    : [{ description: 'As per indent', quantity: 1, rate: po.amount, amount: po.amount }];

  let subtotal = 0;
  items.forEach((item, idx) => {
    const desc = item.description || '—';
    const rowH = Math.max(16, doc.heightOfString(desc, { width: colDescW }) + 4);

    if (y + rowH > 720) {
      doc.addPage();
      y = margin;
    }

    doc.fontSize(8).fillColor('#0F172A');
    doc.text(String(idx + 1), colSno + 4, y, { width: 26 });
    doc.text(desc, colDesc + 2, y, { width: colDescW });
    doc.text(String(item.quantity ?? '—'), colQty + 2, y, { width: colQtyW });
    doc.text((item.rate ?? 0).toLocaleString('en-IN'), colRate + 2, y, { width: colRateW });
    doc.text((item.amount ?? 0).toLocaleString('en-IN'), colAmount + 2, y, { width: colAmountW });
    subtotal += item.amount || 0;
    y += rowH;
  });

  const gstBase = subtotal || po.amount || 0;
  const gst = Math.round(gstBase * 0.18);
  const grandTotal = gstBase + gst;

  y += 10;
  const labelX = colRate - 20;
  const labelW = colAmount - labelX - 8;
  const valueX = colAmount;
  const valueW = tableLeft + tableWidth - colAmount;
  const rowGap = 16;

  doc.fontSize(9).fillColor('#0F172A').font('Helvetica');
  doc.text('Sub Total:', labelX, y, { width: labelW, align: 'right' });
  doc.text(gstBase.toLocaleString('en-IN'), valueX, y, { width: valueW, align: 'right' });
  y += rowGap;

  doc.text('Add GST @ 18%:', labelX, y, { width: labelW, align: 'right' });
  doc.text(gst.toLocaleString('en-IN'), valueX, y, { width: valueW, align: 'right' });
  y += rowGap;

  doc.font('Helvetica-Bold');
  doc.text('Grand Total:', labelX, y, { width: labelW, align: 'right' });
  doc.text(grandTotal.toLocaleString('en-IN'), valueX, y, { width: valueW, align: 'right' });
  doc.font('Helvetica');
  y += rowGap + 8;

  if (y > 640) {
    doc.addPage();
    y = margin;
  }

  doc.fontSize(9).fillColor('#1A4FA0').text('Terms & Conditions', margin, y);
  y += 14;
  const terms = buildAllPoTerms(po);
  terms.forEach((term, i) => {
    const lineH = doc.heightOfString(`${i + 1}. ${term}`, { width: contentWidth });
    if (y + lineH > 700) {
      doc.addPage();
      y = margin;
    }
    doc.fontSize(8).fillColor('#334155').text(`${i + 1}. ${term}`, margin, y, { width: contentWidth });
    y += lineH + 4;
  });

  y += 12;
  if (y > 620) {
    doc.addPage();
    y = margin;
  }

  const footerColW = 168;
  const footerGap = 8;
  const buyerX = margin;
  const consigneeX = margin + footerColW + footerGap;
  const signX = margin + (footerColW + footerGap) * 2;

  doc.fontSize(8).fillColor('#1A4FA0').text("BUYER'S ADDRESS", buyerX, y);
  doc.fontSize(8).fillColor('#1A4FA0').text('CONSIGNEE ADDRESS', consigneeX, y);
  doc.fontSize(8).fillColor('#1A4FA0').text('For BEKEM INFRA PROJECTS PVT. LTD.', signX, y, {
    width: footerColW,
  });
  y += 12;

  doc.fontSize(7).fillColor('#334155');
  const buyerText = po.billingAddress || '—';
  const consigneeText = po.deliveryAddress || '—';
  const buyerH = doc.heightOfString(buyerText, { width: footerColW });
  const consigneeH = doc.heightOfString(consigneeText, { width: footerColW });
  doc.text(buyerText, buyerX, y, { width: footerColW, lineGap: 2 });
  doc.text(consigneeText, consigneeX, y, { width: footerColW, lineGap: 2 });
  doc.text('Authorised Signatory', signX, y + 36, { width: footerColW });

  y += Math.max(buyerH, consigneeH, 48) + 8;
  doc.y = y;
}

function generatePurchaseOrderPdf(po) {
  return (res) => {
    streamPdf(res, `${po.poNumber || po.draftRef || 'purchase-order'}.pdf`, (doc) => {
      buildPurchaseOrderPdfContent(doc, po);
    });
  };
}

function generatePurchaseOrderPdfBuffer(po) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    buildPurchaseOrderPdfContent(doc, po);
    doc.end();
  });
}

function generateBudgetPdf(rows, generatedAt) {
  return (res) => {
    streamPdf(res, 'budget-vs-actual.pdf', (doc) => {
      header(doc, 'Budget vs Actual', `Generated ${generatedAt}`);

      doc.fontSize(10).fillColor('#64748B');
      doc.text('Project', 50, doc.y, { width: 120, continued: true });
      doc.text('Budget', { width: 90, continued: true });
      doc.text('Spent', { width: 90, continued: true });
      doc.text('Deploy %', { width: 60, continued: true });
      doc.text('Health', { width: 60 });
      doc.moveDown(0.5);

      (rows || []).forEach((r) => {
        if (doc.y > 720) doc.addPage();
        doc.fillColor('#0F172A');
        doc.text(r.code, 50, doc.y, { width: 120, continued: true });
        doc.text(`₹${(r.budgetTotal || 0).toLocaleString('en-IN')}`, { width: 90, continued: true });
        doc.text(`₹${(r.budgetSpent || 0).toLocaleString('en-IN')}`, { width: 90, continued: true });
        doc.text(`${r.deployPct}%`, { width: 60, continued: true });
        doc.text(String(r.healthScore ?? '—'), { width: 60 });
        doc.moveDown(0.3);
      });

      if (!rows?.length) {
        doc.fillColor('#64748B').text('No project budget data available.');
      }
    });
  };
}

const WO_STATUS_LABELS = {
  DRAFT: 'Draft',
  COORDINATOR_PENDING: 'Pending coordinator verification',
  CHAIRMAN_PENDING: 'Pending chairman approval',
  PENDING_ACCEPTANCE: 'Awaiting contractor acceptance',
  ACCEPTED: 'Accepted by contractor',
  IN_PROGRESS: 'In progress',
  CLOSED: 'Closed',
  REJECTED: 'Rejected',
};

function generateWorkOrderPdf(wo, timeline) {
  return (res) => {
    streamPdf(res, `${wo.woNumber || 'work-order'}.pdf`, (doc) => {
      header(doc, 'Work Order', wo.woNumber);
      row(doc, 'Status', WO_STATUS_LABELS[wo.status] || wo.status);
      row(doc, 'Contractor', wo.vendor?.name);
      row(doc, 'Scope', wo.scope);
      row(doc, 'Contract value', `₹${(wo.contractValue || 0).toLocaleString('en-IN')}`);
      row(doc, 'Quantity', `${wo.completedQuantity ?? 0} / ${wo.totalQuantity ?? 0} ${wo.quantityUnit || ''}`);
      row(doc, 'Progress', `${wo.progressPercent ?? 0}%`);
      if (wo.purchaseOrder?.poNumber) row(doc, 'Purchase order', wo.purchaseOrder.poNumber);
      if (wo.project?.code) row(doc, 'Project', `${wo.project.code} — ${wo.project.name || ''}`);
      if (wo.site?.name) row(doc, 'Site', wo.site.name);
      row(doc, 'Created', wo.createdAt ? new Date(wo.createdAt).toLocaleString() : '—');

      if (wo.milestones?.length) {
        doc.moveDown(1);
        doc.fontSize(12).fillColor('#0F172A').text('Milestones');
        doc.moveDown(0.5);
        wo.milestones.forEach((ms) => {
          if (doc.y > 720) doc.addPage();
          doc.fontSize(9).fillColor('#64748B').text(`• ${ms.name}: ${ms.status}`);
        });
      }

      if (wo.materialIssues?.length) {
        doc.moveDown(1);
        doc.fontSize(12).fillColor('#0F172A').text('Materials issued');
        doc.moveDown(0.5);
        wo.materialIssues.forEach((issue) => {
          if (doc.y > 720) doc.addPage();
          doc
            .fontSize(9)
            .fillColor('#64748B')
            .text(`• ${issue.materialName}: ${issue.quantity} ${issue.materialUnit || ''}`);
        });
      }

      doc.moveDown(1);
      doc.fontSize(12).fillColor('#0F172A').text('Status timeline');
      doc.moveDown(0.5);
      (timeline || []).forEach((entry) => {
        if (doc.y > 720) doc.addPage();
        doc
          .fontSize(9)
          .fillColor('#64748B')
          .text(
            `${entry.timestamp} · ${entry.fromStatus || '—'} → ${entry.toStatus} · ${entry.actorName || 'System'}${entry.note ? ` — ${entry.note}` : ''}`
          );
      });
    });
  };
}

function generateMaterialIssuePdf(issue) {
  return (res) => {
    streamPdf(res, `${issue.issueNumber || 'issue-slip'}.pdf`, (doc) => {
      header(doc, 'Material Issue Slip', issue.issueNumber);

      row(doc, 'Indent', issue.materialRequest?.indentNumber || '—');
      row(doc, 'Site', issue.site?.name || '—');
      if (issue.site?.chainageLabel) row(doc, 'Chainage', issue.site.chainageLabel);
      row(doc, 'Issued by', issue.issuedBy?.name || '—');
      row(doc, 'Date', issue.createdAt ? new Date(issue.createdAt).toLocaleString('en-IN') : '—');
      if (issue.note) row(doc, 'Note', issue.note);

      doc.moveDown(1);
      doc.fontSize(11).fillColor('#0F172A').text('Items issued');
      doc.moveDown(0.5);

      const colX = [50, 220, 320, 400, 480];
      doc.fontSize(9).fillColor('#64748B');
      doc.text('Description', colX[0], doc.y, { width: 160 });
      doc.text('HSN', colX[1], doc.y - doc.currentLineHeight(), { width: 80 });
      doc.text('Qty', colX[2], doc.y - doc.currentLineHeight(), { width: 60 });
      doc.text('Unit', colX[3], doc.y - doc.currentLineHeight(), { width: 60 });
      doc.moveDown(0.6);
      doc.strokeColor('#E2E8F0').moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.4);

      (issue.items || []).forEach((item) => {
        if (doc.y > 700) doc.addPage();
        const mat = item.material || {};
        doc.fontSize(9).fillColor('#0F172A');
        doc.text(mat.name || 'Material', colX[0], doc.y, { width: 160 });
        doc.text(mat.hsnCode || '—', colX[1], doc.y - doc.currentLineHeight(), { width: 80 });
        doc.text(String(item.quantity), colX[2], doc.y - doc.currentLineHeight(), { width: 60 });
        doc.text(mat.unit || '—', colX[3], doc.y - doc.currentLineHeight(), { width: 60 });
        doc.moveDown(0.5);
      });

      doc.moveDown(1.5);
      doc.fontSize(8).fillColor('#64748B').text('Received by (signature): _________________________', {
        align: 'left',
      });
      doc.moveDown(2);
      doc.text('Date: _________________________');
    });
  };
}

function buildRfqPdfContent(doc, detail) {
  header(doc, 'REQUEST FOR QUOTATION', detail.rfqNumber);
  if (detail.vendorName) row(doc, 'Vendor', detail.vendorName);
  row(doc, 'Project', detail.projectCode ? `${detail.projectCode} — ${detail.projectName || ''}` : '—');
  if (detail.indentNumber) row(doc, 'Indent', detail.indentNumber);
  if (detail.dueDate) row(doc, 'Due date', new Date(detail.dueDate).toLocaleDateString('en-IN'));
  if (detail.paymentTerms) row(doc, 'Payment terms', detail.paymentTerms);
  if (detail.transportation) row(doc, 'Transportation', detail.transportation);
  if (detail.deliveryTime || detail.deliveryTerms) {
    row(doc, 'Delivery time', detail.deliveryTime || detail.deliveryTerms);
  }
  if (detail.make) row(doc, 'Make', detail.make);
  doc.moveDown(0.5);

  doc.fontSize(11).fillColor('#0F172A').text('Items');
  doc.moveDown(0.4);
  const colX = [50, 280, 380, 460];
  doc.fontSize(9).fillColor('#64748B');
  doc.text('Item', colX[0], doc.y, { width: 220 });
  doc.text('Qty', colX[1], doc.y - doc.currentLineHeight(), { width: 80 });
  doc.text('Unit', colX[2], doc.y - doc.currentLineHeight(), { width: 60 });
  doc.moveDown(0.5);
  doc.strokeColor('#E2E8F0').moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.4);

  (detail.items || []).forEach((item, i) => {
    if (doc.y > 700) doc.addPage();
    doc.fontSize(9).fillColor('#0F172A');
    doc.text(`${i + 1}. ${item.name}`, colX[0], doc.y, { width: 220 });
    doc.text(String(item.quantity), colX[1], doc.y - doc.currentLineHeight(), { width: 80 });
    doc.text(item.unit || 'Nos', colX[2], doc.y - doc.currentLineHeight(), { width: 60 });
    doc.moveDown(0.5);
  });

  doc.moveDown(1);
  doc.fontSize(11).fillColor('#0F172A').text('Terms & Conditions');
  doc.moveDown(0.4);
  (detail.termsAndConditions || []).forEach((term, i) => {
    if (doc.y > 720) doc.addPage();
    doc.fontSize(9).fillColor('#334155').text(`${i + 1}. ${term}`);
    doc.moveDown(0.25);
  });
}

function generateRfqPdf(detail) {
  return (res) => {
    const base = (detail.rfqNumber || 'RFQ').replace(/[/\\?%*:|"<>]/g, '-');
    const vendorSuffix = detail.vendorName
      ? `-${detail.vendorName.replace(/[/\\?%*:|"<>]/g, '-').slice(0, 40)}`
      : '';
    const filename = `${base}${vendorSuffix}.pdf`;
    streamPdf(res, filename, (doc) => buildRfqPdfContent(doc, detail));
  };
}

function generateRfqPdfBuffer(detail) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    buildRfqPdfContent(doc, detail);
    doc.end();
  });
}

module.exports = {
  generateAuditLogPdf,
  generatePurchaseOrderPdf,
  generatePurchaseOrderPdfBuffer,
  generateBudgetPdf,
  generateWorkOrderPdf,
  generateMaterialIssuePdf,
  generateRfqPdf,
  generateRfqPdfBuffer,
};

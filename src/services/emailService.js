const nodemailer = require('nodemailer');

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER);
}

function createTransport() {
  if (!smtpConfigured()) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS || '',
    },
  });
}

async function sendPoToVendor(po, vendor, { pdfBuffer } = {}) {
  if (!vendor?.email) {
    return { sent: false, reason: 'Vendor has no email address' };
  }

  const poNo = po.poNumber || po.draftRef || 'PO';
  const subject = `Purchase Order ${poNo} — BEKEM INFRA PROJECTS PVT. LTD.`;
  const text = [
    `Dear ${vendor.contactPerson || vendor.name},`,
    '',
    `Please find our official Purchase Order ${poNo} attached for your action.`,
    '',
    `Amount: Rs. ${(po.amount || 0).toLocaleString('en-IN')}`,
    `Payment terms: ${po.paymentTerms || 'As per PO'}`,
    '',
    'Delivery address:',
    po.deliveryAddress || 'As per PO document',
    '',
    'Kindly acknowledge receipt and confirm dispatch schedule.',
    '',
    'For BEKEM INFRA PROJECTS PVT. LTD.',
    'Procurement Department',
  ].join('\n');

  const attachments = pdfBuffer
    ? [
        {
          filename: `${poNo.replace(/[/\\?%*:|"<>]/g, '-')}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ]
    : [];

  const transport = createTransport();
  if (!transport) {
    console.log(`[PO EMAIL — dev mode] To: ${vendor.email}\nSubject: ${subject}\n${text}`);
    if (pdfBuffer) {
      console.log(`[PO EMAIL — dev mode] Attachment: ${attachments[0].filename} (${pdfBuffer.length} bytes)`);
    }
    return { sent: true, mode: 'log', to: vendor.email };
  }

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: vendor.email,
    subject,
    text,
    attachments,
  });

  return { sent: true, mode: 'smtp', to: vendor.email };
}

async function sendRfqToVendor(rfqDetail, vendor, { pdfBuffer } = {}) {
  if (!vendor?.email) {
    return { sent: false, reason: 'Vendor has no email address' };
  }

  const rfqNo = rfqDetail.rfqNumber || 'RFQ';
  const subject = `Request for Quotation ${rfqNo} — BEKEM INFRA PROJECTS PVT. LTD.`;
  const itemLines = (rfqDetail.items || [])
    .map((i, idx) => `${idx + 1}. ${i.name} — ${i.quantity} ${i.unit}`)
    .join('\n');
  const termsLines = (rfqDetail.termsAndConditions || [])
    .map((t, i) => `${i + 1}. ${t}`)
    .join('\n');
  const text = [
    `Dear ${vendor.contactPerson || vendor.name},`,
    '',
    `Please submit your quotation against RFQ ${rfqNo}.`,
    '',
    'Items:',
    itemLines,
    '',
    'Terms & Conditions:',
    termsLines,
    '',
    'Kindly respond before the due date mentioned in the attached RFQ.',
    '',
    'For BEKEM INFRA PROJECTS PVT. LTD.',
    'Procurement Department',
  ].join('\n');

  const attachments = pdfBuffer
    ? [
        {
          filename: `${rfqNo.replace(/[/\\?%*:|"<>]/g, '-')}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ]
    : [];

  const transport = createTransport();
  if (!transport) {
    console.log(`[RFQ EMAIL — dev mode] To: ${vendor.email}\nSubject: ${subject}\n${text}`);
    return { sent: true, mode: 'log', to: vendor.email };
  }

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: vendor.email,
    subject,
    text,
    attachments,
  });

  return { sent: true, mode: 'smtp', to: vendor.email };
}

module.exports = { sendPoToVendor, sendRfqToVendor, smtpConfigured };

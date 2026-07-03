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

async function sendPoToVendor(po, vendor) {
  if (!vendor?.email) {
    return { sent: false, reason: 'Vendor has no email address' };
  }

  const poNo = po.poNumber || po.draftRef || 'PO';
  const subject = `Purchase Order ${poNo} — BEKEM INFRA PROJECTS PVT. LTD.`;
  const text = [
    `Dear ${vendor.contactPerson || vendor.name},`,
    '',
    `Please find our official Purchase Order ${poNo} for your action.`,
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

  const transport = createTransport();
  if (!transport) {
    console.log(`[PO EMAIL — dev mode] To: ${vendor.email}\nSubject: ${subject}\n${text}`);
    return { sent: true, mode: 'log', to: vendor.email };
  }

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: vendor.email,
    subject,
    text,
  });

  return { sent: true, mode: 'smtp', to: vendor.email };
}

module.exports = { sendPoToVendor, smtpConfigured };

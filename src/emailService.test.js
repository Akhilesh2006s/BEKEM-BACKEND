const { it } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const { sendPoToVendor } = require('./services/emailService');

it('constructs the PO email through the configured transport without external delivery', async () => {
  const saved = { host: process.env.SMTP_HOST, user: process.env.SMTP_USER, from: process.env.SMTP_FROM };
  const original = nodemailer.createTransport;
  let message;
  try {
    process.env.SMTP_HOST = 'synthetic.invalid';
    process.env.SMTP_USER = 'test@example.invalid';
    process.env.SMTP_FROM = 'test@example.invalid';
    nodemailer.createTransport = () => ({ sendMail: async (payload) => { message = payload; return {}; } });
    const result = await sendPoToVendor({ poNumber: 'TEST-PO', amount: 100, paymentTerms: 'Test' },
      { email: 'supplier@example.invalid', name: 'Synthetic supplier' }, { pdfBuffer: Buffer.from('synthetic') });
    assert.equal(result.sent, true);
    assert.equal(result.mode, 'smtp');
    assert.equal(message.to, 'supplier@example.invalid');
    assert.match(message.subject, /TEST-PO/);
    assert.equal(message.attachments.length, 1);
    assert.equal(message.attachments[0].content.toString(), 'synthetic');
  } finally {
    nodemailer.createTransport = original;
    for (const [key, value] of Object.entries({ SMTP_HOST: saved.host, SMTP_USER: saved.user, SMTP_FROM: saved.from })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

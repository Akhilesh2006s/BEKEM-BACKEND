const { Address } = require('../models');
const {
  BEKEM_BUYER_ADDRESS,
  BEKEM_BUYER_GST,
  BEKEM_WORKSHOP_ADDRESS,
  BEKEM_GLOBAL_WAREHOUSE_ADDRESS,
} = require('../constants/bekemAddresses');

const DEFAULT_ADDRESSES = [
  {
    type: 'registered_office',
    label: 'Registered Office',
    lines: BEKEM_BUYER_ADDRESS,
    gstNumber: BEKEM_BUYER_GST,
  },
  {
    type: 'workshop',
    label: 'Central Workshop',
    lines: BEKEM_WORKSHOP_ADDRESS,
  },
  {
    type: 'global',
    label: 'Global Warehouse',
    lines: BEKEM_GLOBAL_WAREHOUSE_ADDRESS,
  },
];

async function ensureDefaultAddresses() {
  for (const addr of DEFAULT_ADDRESSES) {
    const existing = await Address.findOne({ type: addr.type, isActive: true });
    if (!existing) {
      await Address.create(addr);
    }
  }
}

module.exports = { ensureDefaultAddresses, DEFAULT_ADDRESSES };

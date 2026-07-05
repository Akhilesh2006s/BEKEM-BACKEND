const { Address, Project } = require('../models');
const {
  BEKEM_BUYER_ADDRESS,
  BEKEM_WORKSHOP_ADDRESS,
  BEKEM_GLOBAL_WAREHOUSE_ADDRESS,
} = require('../constants/bekemAddresses');
const { buildConsigneeAddress } = require('./consigneeAddressService');

async function resolveBillingAddress({ billingAddressType, projectId, overrideText }) {
  if (overrideText?.trim()) return overrideText.trim();
  if (billingAddressType === 'project_billing' && projectId) {
    const project = await Project.findById(projectId).populate('billingAddressId');
    if (project?.billingAddressId?.lines) {
      return project.billingAddressId.lines;
    }
    return null;
  }
  const registered = await Address.findOne({ type: 'registered_office', isActive: true });
  return registered?.lines || BEKEM_BUYER_ADDRESS;
}

async function resolveDeliveryAddress({
  deliveryAddressType,
  deliveryAddressOtherText,
  mr,
  overrideText,
}) {
  if (overrideText?.trim()) return overrideText.trim();
  switch (deliveryAddressType) {
    case 'workshop':
      return BEKEM_WORKSHOP_ADDRESS;
    case 'global':
      return BEKEM_GLOBAL_WAREHOUSE_ADDRESS;
    case 'other':
      return String(deliveryAddressOtherText || '').trim() || 'Other delivery location (not specified)';
    case 'site':
    default:
      return mr ? await buildConsigneeAddress(mr) : '';
  }
}

module.exports = { resolveBillingAddress, resolveDeliveryAddress };

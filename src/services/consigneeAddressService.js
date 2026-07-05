const { UserRole } = require('@afios/shared');
const { User, Site } = require('../models');

async function buildConsigneeAddress(mr) {
  const site = mr.siteId?._id ? mr.siteId : mr.siteId ? await Site.findById(mr.siteId) : null;
  const siteId = site?._id || mr.siteId;
  const storeUser = siteId
    ? await User.findOne({ role: UserRole.STORE_INCHARGE, assignedSiteId: siteId })
    : null;

  const lines = ['BEKEM INFRA PROJECTS PVT. LTD.'];
  if (site) {
    lines.push(site.name);
    if (site.chainageLabel) lines.push(site.chainageLabel);
  }
  if (storeUser) {
    const phone = storeUser.phone || storeUser.contactInfo || '';
    lines.push(`Store Manager: ${storeUser.name}${phone ? ` — ${phone}` : ''}`);
  }
  return lines.join('\n');
}

module.exports = { buildConsigneeAddress };

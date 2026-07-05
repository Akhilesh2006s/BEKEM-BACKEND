/** Bekem buyer (billing) address — appears on PO as Buyer's Address */
const BEKEM_BUYER_ADDRESS = `BEKEM INFRA PROJECTS PVT. LTD.
Villa No. 10, TMR Blossoms, Lakshmi Ganapati Layout,
Yelahanka, Kogilu Main Road, Agrahara,
Bangalore, Karnataka — 560 064
GST No.: 29AADCB5671Q1ZY`;

const BEKEM_BUYER_GST = '29AADCB5671Q1ZY';

const BEKEM_WORKSHOP_ADDRESS = `BEKEM INFRA PROJECTS PVT. LTD. — Central Workshop
Yelahanka Industrial Area, Bangalore, Karnataka — 560 064`;

const BEKEM_GLOBAL_WAREHOUSE_ADDRESS = `BEKEM INFRA PROJECTS PVT. LTD. — Global Warehouse
Kogilu Main Road, Agrahara, Bangalore, Karnataka — 560 064`;

const DEFAULT_PO_TERMS = [
  'Delivery: As per project schedule',
  'P & F Charges: Inclusive in the above price',
  'Freight: Inclusive in the above price',
  'Test Certificates: Must be sent along with the material',
  'Payment: 100% payment within 30 days from the date of supply',
];

module.exports = {
  BEKEM_BUYER_ADDRESS,
  BEKEM_BUYER_GST,
  BEKEM_WORKSHOP_ADDRESS,
  BEKEM_GLOBAL_WAREHOUSE_ADDRESS,
  DEFAULT_PO_TERMS,
};

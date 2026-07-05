/**
 * Import PO INDEX Excel — Stock Inventory sheet into MongoDB,
 * then sync Projects, Vendors, Materials for Coordinator admin.
 * Usage: node src/scripts/importPoIndex.js [path-to-xlsx]
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const XLSX = require('xlsx');
const { connectMongo } = require('../db/connectMongo');
const { StockInventoryRecord } = require('../models');
const { syncMasterDataFromInventory } = require('../services/syncMasterDataFromInventory');

const DEFAULT_PATH = path.resolve(
  __dirname,
  '../../../../data/PO INDEX - BEKEM INFRA -2025-26.xlsx'
);

function excelSerialToDate(serial) {
  if (serial == null || serial === '') return null;
  if (serial instanceof Date) return serial;
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 1) return null;
  const utcDays = Math.floor(n - 25569);
  return new Date(utcDays * 86400 * 1000);
}

function num(val) {
  if (val == null || val === '') return 0;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function str(val) {
  if (val == null) return '';
  return String(val).trim();
}

function parseRow(row) {
  const poSlNo = num(row[0]);
  const poNo = str(row[5]);
  const project = str(row[1]);
  if (!poSlNo && !poNo) return null;
  if (!project && !poNo) return null;

  return {
    poSlNo: poSlNo || undefined,
    project,
    indentNo: str(row[2]),
    recordDate: excelSerialToDate(row[3]),
    supplier: str(row[4]),
    poNo,
    poDate: excelSerialToDate(row[6]),
    itemCode: str(row[7]),
    itemDescription: str(row[8]),
    qty: num(row[9]),
    units: str(row[10]),
    poQty: str(row[11]),
    unitRate: num(row[12]),
    basicTotal: num(row[13]),
    gst: num(row[14]),
    netTotal: num(row[15]),
    deliveryDate: excelSerialToDate(row[16]),
    advancePaid: num(row[17]),
    invoiceNumber: str(row[18]),
    invoiceDate: excelSerialToDate(row[19]),
    qtyReceived: num(row[20]),
    qtyBalance: num(row[21]),
    qtyAvailable: str(row[22]),
    invoiceAmount: num(row[23]),
    deliveryLocation: str(row[24]),
    transport: str(row[25]),
    materialReceived: str(row[26]),
    invoiceEntry: str(row[27]),
    purpose: str(row[28]),
    financialYear: '25-26',
    sourceSheet: 'Stock Inventory',
  };
}

async function importAndSyncPoIndex(filePath = DEFAULT_PATH) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`PO INDEX file not found: ${filePath}`);
  }

  console.log('Reading:', filePath);

  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheet = wb.Sheets['Stock Inventory'];
  if (!sheet) {
    throw new Error('Sheet "Stock Inventory" not found');
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const dataRows = rows.slice(2).map(parseRow).filter(Boolean);

  console.log(`Parsed ${dataRows.length} inventory rows`);

  await StockInventoryRecord.deleteMany({ financialYear: '25-26', sourceSheet: 'Stock Inventory' });

  const BATCH = 2000;
  let inserted = 0;
  for (let i = 0; i < dataRows.length; i += BATCH) {
    const batch = dataRows.slice(i, i + BATCH);
    await StockInventoryRecord.insertMany(batch, { ordered: false });
    inserted += batch.length;
    console.log(`Inserted ${inserted}/${dataRows.length}`);
  }

  console.log('Syncing projects, vendors, materials (clearing old demo POs/products)…');
  const sync = await syncMasterDataFromInventory({ financialYear: '25-26', clearProcurement: true });
  console.log(
    `Master data: ${sync.projects} projects, ${sync.vendors} vendors, ${sync.materials} materials, ${sync.sites} sites`
  );
  if (sync.samplePoFormat) {
    console.log(`New PO format example: ${sync.samplePoFormat}`);
  }

  return { inserted, ...sync };
}

async function main() {
  const filePath = process.argv[2] || DEFAULT_PATH;
  await connectMongo();
  const result = await importAndSyncPoIndex(filePath);
  console.log(`Done. ${result.inserted} inventory records synced.`);
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { importAndSyncPoIndex, DEFAULT_PATH };

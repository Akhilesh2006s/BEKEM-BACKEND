const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');
const { createApp } = require('../app');
const { User, Material, Site, Project, StockLedger } = require('../models');
const { seedDatabase, DEMO_PASSWORD } = require('../scripts/seed');

let mongoServer;
let app;

async function setupTestDb() {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await seedDatabase();
  const { loadOrgSettings } = require('../services/orgSettingsService');
  await loadOrgSettings();
  const { app: testApp } = createApp();
  app = testApp;
}

async function teardownTestDb() {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
}

async function loginAs(email) {
  const res = await request(app).post('/api/auth/login').send({
    email,
    password: DEMO_PASSWORD,
  });
  return res.body.tokens.accessToken;
}

async function getSeedContext() {
  const site = await Site.findOne();
  const material = await Material.findOne();
  const project = await Project.findOne();
  const { IndentCategory } = require('../models');
  const indentCategory = await IndentCategory.findOne({ isActive: true }).sort({ sortOrder: 1 });
  return { site, material, project, indentCategory };
}

async function createTestIndentBody(materialId, patch = {}) {
  const { indentCategory } = await getSeedContext();
  return {
    indentRequestType: 'ABOVE_5000',
    requestedByName: 'Test Requester',
    purpose: 'UAT test reason',
    indentCategoryId: indentCategory._id.toString(),
    items: [{ materialId: materialId.toString(), quantityRequested: 1 }],
    ...patch,
  };
}

module.exports = { setupTestDb, teardownTestDb, loginAs, getSeedContext, createTestIndentBody, getApp: () => app };

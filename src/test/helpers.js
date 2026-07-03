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
  return { site, material, project };
}

module.exports = { setupTestDb, teardownTestDb, loginAs, getSeedContext, getApp: () => app };

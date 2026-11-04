const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer, MongoMemoryReplSet } = require('mongodb-memory-server');
const { connectMongo } = require('./db/connectMongo');

describe('Safe production MongoDB startup', () => {
  let replica, standalone;
  const previous = {};
  before(async () => {
    for (const key of ['MONGO_URI', 'MONGO_URI_DIRECT', 'NODE_ENV']) previous[key] = process.env[key];
    replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
    standalone = await MongoMemoryServer.create();
  });
  after(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect();
    if (replica) await replica.stop();
    if (standalone) await standalone.stop();
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  });
  it('connects to a transaction-capable deployment without rewriting workflow data', async () => {
    await mongoose.connect(replica.getUri());
    const transfers = mongoose.connection.db.collection('branchtransfers');
    const record = await transfers.insertOne({ transferNumber: 'TEST-STARTUP-SAFETY', status: 'DISPATCHED' });
    await mongoose.disconnect();
    process.env.MONGO_URI = replica.getUri();
    delete process.env.MONGO_URI_DIRECT;
    process.env.NODE_ENV = 'production';
    await connectMongo();
    const afterConnect = await mongoose.connection.db.collection('branchtransfers').findOne({ _id: record.insertedId });
    assert.equal(afterConnect.status, 'DISPATCHED');
    await mongoose.disconnect();
  });
  it('rejects a standalone database in production', async () => {
    process.env.MONGO_URI = standalone.getUri();
    delete process.env.MONGO_URI_DIRECT;
    process.env.NODE_ENV = 'production';
    await assert.rejects(connectMongo(), /must support transactions/);
    assert.equal(mongoose.connection.readyState, 0);
  });
});

require('dotenv').config();
const { connectMongo } = require('./db/connectMongo');
const { createApp } = require('./app');
const { ensureDefaultAddresses } = require('./services/addressBootstrapService');
const { ensureMaterialCategories } = require('./services/materialCategoryService');
const { syncProjectGrnCounterFromExisting } = require('./services/grnCounterService');
const { Project } = require('./models');

const PORT = process.env.PORT || 4000;
const { app, server } = createApp();

async function start() {
  try {
    await connectMongo();
    await ensureDefaultAddresses();
    await ensureMaterialCategories();
    const projects = await Project.find().select('_id');
    for (const p of projects) {
      await syncProjectGrnCounterFromExisting(p._id);
    }
    console.log('Connected to MongoDB');

    const { processOverdueDeliveries } = require('./services/deliveryAlertService');
    const runDeliveryAlerts = async () => {
      try {
        const result = await processOverdueDeliveries();
        if (result.alertsCreated > 0) {
          console.log(`[delivery-alerts] created ${result.alertsCreated} alert(s)`);
        }
      } catch (err) {
        console.error('[delivery-alerts] job failed:', err.message);
      }
    };
    await runDeliveryAlerts();
    setInterval(runDeliveryAlerts, 60 * 60 * 1000);

    server.listen(PORT, () => {
      console.log(`Bekem OS API running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

module.exports = { app, server, start };

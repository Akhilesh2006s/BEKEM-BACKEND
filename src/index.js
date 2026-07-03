require('dotenv').config();
const { connectMongo } = require('./db/connectMongo');
const { createApp } = require('./app');

const PORT = process.env.PORT || 4000;
const { app, server } = createApp();

async function start() {
  try {
    await connectMongo();
    console.log('Connected to MongoDB');
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

const http = require('http');

const express = require('express');

const cors = require('cors');

const { Server } = require('socket.io');



const { auditMiddleware } = require('./middleware/audit');

const { errorHandler } = require('./middleware/validate');

const notificationService = require('./services/notificationService');



const authRoutes = require('./routes/auth');

const materialRequestRoutes = require('./routes/materialRequests');

const materialRoutes = require('./routes/materials');

const stockRoutes = require('./routes/stock');

const notificationRoutes = require('./routes/notifications');

const timelineRoutes = require('./routes/timeline');

const projectRoutes = require('./routes/projects');

const siteRoutes = require('./routes/sites');

const purchaseRequestRoutes = require('./routes/purchaseRequests');

const purchaseOrderRoutes = require('./routes/purchaseOrders');

const vendorRoutes = require('./routes/vendors');

const auditLogRoutes = require('./routes/auditLogs');
const dashboardRoutes = require('./routes/dashboard');
const delegationRoutes = require('./routes/delegations');
const exportRoutes = require('./routes/exports');
const userRoutes = require('./routes/users');
const workOrderRoutes = require('./routes/workOrders');
const goodsReceiptRoutes = require('./routes/goodsReceipts');
const materialIssueRoutes = require('./routes/materialIssues');
const branchTransferRoutes = require('./routes/branchTransfers');
const procurementDecisionRoutes = require('./routes/procurementDecisions');
const incidentRoutes = require('./routes/incidents');
const fileRoutes = require('./routes/files');



function mountApiRoutes(app, prefix) {

  const { authenticate } = require('./middleware/auth');
  const { listMaterialCategories } = require('./services/materialCategoryService');

  app.get(`${prefix}/material-categories`, authenticate, async (req, res, next) => {
    try {
      const rows = await listMaterialCategories();
      res.json({ data: rows.map((c) => ({ id: c._id.toString(), name: c.name })) });
    } catch (err) {
      next(err);
    }
  });

  app.use(`${prefix}/auth`, authRoutes);

  app.use(`${prefix}/material-requests`, materialRequestRoutes);

  app.use(`${prefix}/materials`, materialRoutes);

  app.use(`${prefix}/stock`, stockRoutes);

  app.use(`${prefix}/notifications`, notificationRoutes);

  app.use(`${prefix}/timeline`, timelineRoutes);

  app.use(`${prefix}/projects`, projectRoutes);

  app.use(`${prefix}/sites`, siteRoutes);

  app.use(`${prefix}/purchase-requests`, purchaseRequestRoutes);

  app.use(`${prefix}/purchase-orders`, purchaseOrderRoutes);

  app.use(`${prefix}/vendors`, vendorRoutes);
  app.use(`${prefix}/files`, fileRoutes);

  app.use(`${prefix}/audit-logs`, auditLogRoutes);
  app.use(`${prefix}/dashboard`, dashboardRoutes);
  app.use(`${prefix}/delegations`, delegationRoutes);
  app.use(`${prefix}/exports`, exportRoutes);
  app.use(`${prefix}/users`, userRoutes);
  app.use(`${prefix}/work-orders`, workOrderRoutes);
  app.use(`${prefix}/goods-receipts`, goodsReceiptRoutes);
  app.use(`${prefix}/delivery-verifications`, require('./routes/deliveryVerifications'));
  app.use(`${prefix}/material-issues`, materialIssueRoutes);
  app.use(`${prefix}/branch-transfers`, branchTransferRoutes);
  app.use(`${prefix}/procurement-decisions`, procurementDecisionRoutes);
  app.use(`${prefix}/rfqs`, require('./routes/rfqs'));
  app.use(`${prefix}/incidents`, incidentRoutes);
  app.use(`${prefix}/finance`, require('./routes/finance'));
  app.use(`${prefix}/admin/org-settings`, require('./routes/orgSettings'));

}



function createApp() {

  const app = express();

  const server = http.createServer(app);



  const { expressCorsConfig, socketCorsConfig } = require('./utils/corsOrigins');

  const io = new Server(server, {
    cors: socketCorsConfig(),
  });

  notificationService.setSocketIo(io);

  app.use(cors(expressCorsConfig()));

  app.use(express.json());

  app.use(auditMiddleware);



  const health = (_req, res) => res.json({ status: 'ok', service: 'bekem-os-api' });

  app.get('/health', health);

  app.get('/api/health', health);

  app.get('/api/v1/health', health);



  mountApiRoutes(app, '/api');

  mountApiRoutes(app, '/api/v1');



  app.use(errorHandler);



  return { app, server, io };

}



module.exports = { createApp };



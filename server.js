/**
 * Case Closed Pro - Server
 * Complete setup with Dashboard + Scorecards + Access Control
 */

const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ════════════════════════════════════════════════════
// MIDDLEWARE
// ════════════════════════════════════════════════════

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ════════════════════════════════════════════════════
// DATABASE CONNECTION
// ════════════════════════════════════════════════════

const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'cclosed',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// ════════════════════════════════════════════════════
// AUTHENTICATION MIDDLEWARE
// ════════════════════════════════════════════════════

const requireAuth = (req, res, next) => {
  // Check if user is authenticated
  // This is a placeholder - implement your auth logic
  if (req.headers.authorization || req.user) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// ════════════════════════════════════════════════════
// SCORECARD ACCESS CONTROL
// ════════════════════════════════════════════════════

const {
  requireScorecardAccess,
  requirePermission,
  attachUserRole,
  PERMISSIONS
} = require('./backend/backend_access_control');

// Apply user role to all requests
app.use(attachUserRole);

// ════════════════════════════════════════════════════
// EXECUTIVE DASHBOARD ROUTES
// ════════════════════════════════════════════════════

const dashboardRoutes = require('./backend/routes/dashboard_api_endpoints');
app.use('/api', dashboardRoutes);

// ════════════════════════════════════════════════════
// SCORECARD API ROUTES
// ════════════════════════════════════════════════════

app.get('/api/scorecards',
  requireScorecardAccess,
  requirePermission(PERMISSIONS.VIEW_SCORECARD),
  async (req, res) => {
    try {
      // Return scorecard data
      res.json({ message: 'Scorecards endpoint' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

app.get('/api/scorecards/:attorneyId',
  requireScorecardAccess,
  requirePermission(PERMISSIONS.VIEW_SCORECARD),
  async (req, res) => {
    try {
      const { attorneyId } = req.params;
      // Return specific attorney scorecard
      res.json({ message: `Scorecard for attorney ${attorneyId}` });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

app.get('/api/analytics/scorecards',
  requireScorecardAccess,
  requirePermission(PERMISSIONS.ACCESS_ANALYTICS),
  async (req, res) => {
    try {
      // Return scorecard analytics
      res.json({ message: 'Scorecard analytics' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

app.post('/api/scorecards/:id/export',
  requireScorecardAccess,
  requirePermission(PERMISSIONS.EXPORT_SCORECARD),
  async (req, res) => {
    try {
      // Export scorecard
      res.json({ message: 'Export scorecard' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

// ════════════════════════════════════════════════════
// STATIC ROUTES (HTML Pages)
// ════════════════════════════════════════════════════

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/scorecards', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ════════════════════════════════════════════════════
// ERROR HANDLING
// ════════════════════════════════════════════════════

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ════════════════════════════════════════════════════
// START SERVER
// ════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`✅ Case Closed Pro running on http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`📋 Scorecards: http://localhost:${PORT}/scorecards`);
});

module.exports = app;

/* ════════════════════════════════════════════════════
   SCORECARD ACCESS CONTROL MIDDLEWARE
   Role-Based Permission System - Backend
   ════════════════════════════════════════════════════ */

// ROLE DEFINITIONS
const ROLES = {
  CLAIMS_LEADER: 'claims_leader',      // Can view all scorecards
  FIRM_PARTNER: 'firm_partner',        // Can view all scorecards (firm leadership)
  FIRM_ADMIN: 'firm_admin',            // Can view all scorecards + manage permissions
  ATTORNEY: 'attorney',                // BLOCKED from viewing scorecards
  PARALEGAL: 'paralegal',              // BLOCKED from viewing scorecards
  GUEST: 'guest'                       // BLOCKED from everything
};

// PERMISSION LEVELS
const PERMISSIONS = {
  VIEW_SCORECARD: 'view_scorecard',
  VIEW_OWN_SCORECARD: 'view_own_scorecard',      // Not used - scorecards hidden from attorneys
  EDIT_SCORECARD: 'edit_scorecard',
  DELETE_SCORECARD: 'delete_scorecard',
  MANAGE_PERMISSIONS: 'manage_permissions',
  EXPORT_SCORECARD: 'export_scorecard',
  ACCESS_ANALYTICS: 'access_analytics'
};

// ROLE TO PERMISSIONS MAPPING
const ROLE_PERMISSIONS = {
  [ROLES.CLAIMS_LEADER]: [
    PERMISSIONS.VIEW_SCORECARD,
    PERMISSIONS.ACCESS_ANALYTICS,
    PERMISSIONS.EXPORT_SCORECARD
  ],
  [ROLES.FIRM_PARTNER]: [
    PERMISSIONS.VIEW_SCORECARD,
    PERMISSIONS.ACCESS_ANALYTICS,
    PERMISSIONS.EXPORT_SCORECARD
  ],
  [ROLES.FIRM_ADMIN]: [
    PERMISSIONS.VIEW_SCORECARD,
    PERMISSIONS.EDIT_SCORECARD,
    PERMISSIONS.ACCESS_ANALYTICS,
    PERMISSIONS.EXPORT_SCORECARD,
    PERMISSIONS.MANAGE_PERMISSIONS
  ],
  [ROLES.ATTORNEY]: [
    // Empty - no scorecard access
  ],
  [ROLES.PARALEGAL]: [
    // Empty - no scorecard access
  ],
  [ROLES.GUEST]: [
    // Empty - no access
  ]
};

/* ════════════════════════════════════════════════════
   MIDDLEWARE: Check if user has permission
   ════════════════════════════════════════════════════ */

function requirePermission(permission) {
  return (req, res, next) => {
    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User not authenticated',
        code: 'AUTH_REQUIRED'
      });
    }

    // Get user's role from database or session
    const userRole = req.user.role;
    
    if (!userRole) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'User has no role assigned',
        code: 'NO_ROLE'
      });
    }

    // Get permissions for this role
    const permissions = ROLE_PERMISSIONS[userRole] || [];

    // Check if user has required permission
    if (!permissions.includes(permission)) {
      logAccessDenied(req.user.id, req.path, userRole, permission);
      
      return res.status(403).json({
        error: 'Forbidden',
        message: `Your role (${userRole}) does not have permission to ${permission}`,
        code: 'PERMISSION_DENIED',
        userRole
      });
    }

    // Log successful authorization
    logAccessGranted(req.user.id, req.path, userRole, permission);

    // User has permission - proceed
    next();
  };
}

/* ════════════════════════════════════════════════════
   MIDDLEWARE: Scorecard-Specific Access Control
   ════════════════════════════════════════════════════ */

function requireScorecardAccess(req, res, next) {
  const userRole = req.user?.role;

  // DENIED ROLES - attorneys can never see scorecards
  const deniedRoles = [ROLES.ATTORNEY, ROLES.PARALEGAL, ROLES.GUEST];
  
  if (deniedRoles.includes(userRole)) {
    logAccessDenied(req.user.id, '/api/scorecards', userRole, 'VIEW_SCORECARD');
    
    return res.status(403).json({
      error: 'Access Denied',
      message: 'Attorneys are not permitted to view performance scorecards',
      code: 'SCORECARD_RESTRICTED',
      userRole,
      reason: 'This data is confidential and available only to leadership'
    });
  }

  // ALLOWED ROLES - claims leaders and firm leadership
  const allowedRoles = [ROLES.CLAIMS_LEADER, ROLES.FIRM_PARTNER, ROLES.FIRM_ADMIN];
  
  if (!allowedRoles.includes(userRole)) {
    logAccessDenied(req.user.id, '/api/scorecards', userRole, 'VIEW_SCORECARD');
    
    return res.status(403).json({
      error: 'Access Denied',
      message: 'Your role does not have access to scorecards',
      code: 'INSUFFICIENT_ROLE'
    });
  }

  logAccessGranted(req.user.id, '/api/scorecards', userRole, 'VIEW_SCORECARD');
  next();
}

/* ════════════════════════════════════════════════════
   MIDDLEWARE: Prevent Self-Scoring (if attorney somehow gets here)
   ════════════════════════════════════════════════════ */

function preventSelfScoring(req, res, next) {
  const targetAttorneyId = req.params.attorneyId || req.body.attorneyId;
  const userRole = req.user?.role;
  const userId = req.user?.id;

  // Attorneys cannot view their own scores
  if (userRole === ROLES.ATTORNEY && userId === targetAttorneyId) {
    logAccessDenied(userId, req.path, userRole, 'VIEW_OWN_SCORECARD');
    
    return res.status(403).json({
      error: 'Access Denied',
      message: 'Attorneys cannot view their own performance scorecards',
      code: 'SELF_SCORE_BLOCKED',
      reason: 'Scorecards are for leadership review only'
    });
  }

  next();
}

/* ════════════════════════════════════════════════════
   AUDIT LOGGING
   ════════════════════════════════════════════════════ */

function logAccessGranted(userId, endpoint, role, permission) {
  const timestamp = new Date().toISOString();
  console.log(`[SCORECARD ACCESS GRANTED] ${timestamp} | User: ${userId} | Role: ${role} | Endpoint: ${endpoint} | Permission: ${permission}`);
  
  // In production, save to audit table
  // db.query(
  //   `INSERT INTO scorecard_access_log (user_id, endpoint, role, permission, status, timestamp) 
  //    VALUES (?, ?, ?, ?, 'granted', ?)`,
  //   [userId, endpoint, role, permission, timestamp]
  // );
}

function logAccessDenied(userId, endpoint, role, permission) {
  const timestamp = new Date().toISOString();
  console.log(`[SCORECARD ACCESS DENIED] ${timestamp} | User: ${userId} | Role: ${role} | Endpoint: ${endpoint} | Permission: ${permission}`);
  
  // In production, save to audit table
  // db.query(
  //   `INSERT INTO scorecard_access_log (user_id, endpoint, role, permission, status, timestamp) 
  //    VALUES (?, ?, ?, ?, 'denied', ?)`,
  //   [userId, endpoint, role, permission, timestamp]
  // );
}

/* ════════════════════════════════════════════════════
   PROTECTED API ENDPOINTS
   ════════════════════════════════════════════════════ */

// EXPRESS EXAMPLE USAGE:

/*
// GET all attorney scorecards (Claims leaders only)
app.get('/api/scorecards',
  requireScorecardAccess,
  requirePermission(PERMISSIONS.VIEW_SCORECARD),
  (req, res) => {
    const userRole = req.user.role;
    
    // Get all attorney scorecards
    const scorecards = calculateAllScores();
    
    res.json({
      success: true,
      scorecards,
      viewedBy: userRole,
      timestamp: new Date().toISOString()
    });
  }
);

// GET specific attorney scorecard
app.get('/api/scorecards/:attorneyId',
  requireScorecardAccess,
  requirePermission(PERMISSIONS.VIEW_SCORECARD),
  preventSelfScoring,
  (req, res) => {
    const { attorneyId } = req.params;
    const scorecard = calculateScore(attorneyId);
    
    res.json({
      success: true,
      scorecard,
      accessedBy: req.user.id,
      accessedByRole: req.user.role
    });
  }
);

// GET scorecard analytics
app.get('/api/analytics/scorecard',
  requireScorecardAccess,
  requirePermission(PERMISSIONS.ACCESS_ANALYTICS),
  (req, res) => {
    const analytics = calculateAnalytics();
    res.json({ success: true, analytics });
  }
);

// EXPORT scorecard (PDF/CSV)
app.post('/api/scorecards/:attorneyId/export',
  requireScorecardAccess,
  requirePermission(PERMISSIONS.EXPORT_SCORECARD),
  (req, res) => {
    const { attorneyId } = req.params;
    const { format } = req.body; // 'pdf' or 'csv'
    
    const scorecard = calculateScore(attorneyId);
    const exported = exportScorecard(scorecard, format);
    
    res.attachment(`scorecard_${attorneyId}.${format}`);
    res.send(exported);
  }
);
*/

/* ════════════════════════════════════════════════════
   USER AUTHENTICATION & ROLE ASSIGNMENT
   ════════════════════════════════════════════════════ */

// Get user from database/session and attach role
async function attachUserRole(req, res, next) {
  try {
    const userId = req.session?.userId || req.headers['x-user-id'];
    
    if (!userId) {
      return res.status(401).json({ error: 'No user ID provided' });
    }

    // Query database for user
    const user = await db.query(
      'SELECT id, email, first_name, last_name, role FROM users WHERE id = ?',
      [userId]
    );

    if (!user || user.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Attach user to request
    req.user = user[0];
    next();
  } catch (error) {
    res.status(500).json({ error: 'Server error', message: error.message });
  }
}

/* ════════════════════════════════════════════════════
   DATABASE SCHEMA FOR ROLES
   ════════════════════════════════════════════════════ */

/*
-- Users table with roles
CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(255) UNIQUE NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  password_hash VARCHAR(255),
  role ENUM('claims_leader', 'firm_partner', 'firm_admin', 'attorney', 'paralegal', 'guest') DEFAULT 'guest',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_role (role)
);

-- Audit log for scorecard access
CREATE TABLE scorecard_access_log (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  endpoint VARCHAR(255),
  role VARCHAR(50),
  permission VARCHAR(100),
  status ENUM('granted', 'denied') DEFAULT 'denied',
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(45),
  user_agent TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_user_id (user_id),
  INDEX idx_status (status),
  INDEX idx_timestamp (timestamp)
);

-- Role permissions mapping (for future extensibility)
CREATE TABLE role_permissions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  role VARCHAR(50),
  permission VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_role_permission (role, permission)
);

-- Insert base permissions
INSERT INTO role_permissions (role, permission) VALUES
('claims_leader', 'view_scorecard'),
('claims_leader', 'access_analytics'),
('claims_leader', 'export_scorecard'),
('firm_partner', 'view_scorecard'),
('firm_partner', 'access_analytics'),
('firm_partner', 'export_scorecard'),
('firm_admin', 'view_scorecard'),
('firm_admin', 'edit_scorecard'),
('firm_admin', 'access_analytics'),
('firm_admin', 'export_scorecard'),
('firm_admin', 'manage_permissions');
*/

/* ════════════════════════════════════════════════════
   EXPORT FUNCTIONS
   ════════════════════════════════════════════════════ */

module.exports = {
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  requirePermission,
  requireScorecardAccess,
  preventSelfScoring,
  attachUserRole,
  logAccessGranted,
  logAccessDenied
};

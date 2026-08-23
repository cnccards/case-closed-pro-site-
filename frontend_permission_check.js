/* ════════════════════════════════════════════════════
   FRONTEND PERMISSION CHECKING
   Scorecard UI Access Control
   ════════════════════════════════════════════════════ */

// ALLOWED ROLES - who can see scorecards
const SCORECARD_ALLOWED_ROLES = [
  'claims_leader',
  'firm_partner',
  'firm_admin'
];

// DENIED ROLES - who cannot see scorecards
const SCORECARD_DENIED_ROLES = [
  'attorney',
  'paralegal',
  'guest'
];

/* ════════════════════════════════════════════════════
   CHECK USER PERMISSION AT LOAD TIME
   ════════════════════════════════════════════════════ */

async function checkScorecardAccess() {
  try {
    // Fetch user info from backend
    const response = await fetch('/api/user', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error('Failed to fetch user info');
    }

    const user = await response.json();
    
    // Check if user can view scorecards
    const canView = user.canViewScorecards;
    const userRole = user.role;

    // DENIED: User is an attorney or other restricted role
    if (!canView || SCORECARD_DENIED_ROLES.includes(userRole)) {
      renderAccessDenied(user);
      return false;
    }

    // ALLOWED: User is claims leader or firm leadership
    if (SCORECARD_ALLOWED_ROLES.includes(userRole)) {
      renderScorecardUI(user);
      return true;
    }

    // Unknown role
    renderUnknownRole(user);
    return false;
  } catch (error) {
    console.error('Error checking scorecard access:', error);
    renderError(error);
    return false;
  }
}

/* ════════════════════════════════════════════════════
   RENDER DENIED ACCESS MESSAGE
   ════════════════════════════════════════════════════ */

function renderAccessDenied(user) {
  const html = `
    <div class="wrap">
      <div class="hero" style="text-align: center; padding: 60px 40px;">
        <div style="font-size: 64px; margin-bottom: 20px;">🔒</div>
        <h1 class="hero-title" style="background: none; -webkit-text-fill-color: unset; color: var(--red);">Access Denied</h1>
        <p class="hero-sub" style="color: var(--dim); font-size: 16px; margin-top: 20px;">
          <strong>Attorney scorecards are confidential</strong> and only available to claims leadership and firm partners.
        </p>
      </div>

      <div class="card" style="max-width: 600px; margin: 40px auto;">
        <div class="section">
          <div class="section-label">Your Current Role</div>
          <div style="font-size: 14px; font-weight: 700; margin-bottom: 8px; color: var(--red);">
            ${formatRole(user.role)}
          </div>
          <div style="font-size: 12px; color: var(--muted); line-height: 1.6;">
            Your role does not have access to attorney performance scorecards. 
            This data is restricted to:<br>
            <br>
            ✅ Claims Leaders<br>
            ✅ Firm Partners<br>
            ✅ Firm Administrators<br>
            <br>
            If you believe this is an error, please contact your firm administrator.
          </div>
        </div>
      </div>

      <div class="card" style="max-width: 600px; margin: 40px auto; background: #F0FDF4; border-left: 3px solid var(--green);">
        <div class="section">
          <div class="section-label">Why Are Scorecards Restricted?</div>
          <div style="font-size: 12px; color: var(--dim); line-height: 1.8;">
            <p>Performance scorecards contain confidential evaluation data and strategic insights about attorney performance. This information is:</p>
            <ul style="margin: 12px 0 0 0; padding-left: 20px;">
              <li>Used for management and coaching decisions</li>
              <li>Sensitive business information</li>
              <li>Only appropriate for leadership access</li>
              <li>Protected from unauthorized access</li>
            </ul>
          </div>
        </div>
      </div>

      <div style="text-align: center; padding: 40px; color: var(--muted); font-size: 12px;">
        <p>For questions about scorecard access, contact your firm administrator.</p>
      </div>
    </div>
  `;

  document.body.innerHTML = html;
}

/* ════════════════════════════════════════════════════
   RENDER SCORECARD UI (If access granted)
   ════════════════════════════════════════════════════ */

function renderScorecardUI(user) {
  // User has access - load the normal scorecard interface
  
  // Add user role indicator
  const roleIndicator = document.createElement('div');
  roleIndicator.style.cssText = `
    position: fixed;
    top: 0;
    right: 0;
    padding: 12px 16px;
    background: linear-gradient(135deg, #2563EB, #1D4ED8);
    color: white;
    font-size: 11px;
    font-weight: 700;
    z-index: 9999;
    text-transform: uppercase;
    letter-spacing: 0.8px;
  `;
  roleIndicator.textContent = `🔐 ${formatRole(user.role)}`;
  document.body.appendChild(roleIndicator);

  console.log(`✅ Scorecard access granted for ${user.firstName} ${user.lastName} (${user.role})`);
}

/* ════════════════════════════════════════════════════
   RENDER ERROR MESSAGES
   ════════════════════════════════════════════════════ */

function renderUnknownRole(user) {
  const html = `
    <div class="wrap">
      <div class="hero" style="text-align: center; padding: 60px 40px;">
        <div style="font-size: 64px; margin-bottom: 20px;">❓</div>
        <h1 class="hero-title" style="background: none; -webkit-text-fill-color: unset; color: var(--gold);">Unable to Determine Access</h1>
        <p class="hero-sub" style="color: var(--dim); font-size: 16px; margin-top: 20px;">
          Your role could not be determined. Please contact your administrator.
        </p>
      </div>
    </div>
  `;
  document.body.innerHTML = html;
}

function renderError(error) {
  const html = `
    <div class="wrap">
      <div class="hero" style="text-align: center; padding: 60px 40px;">
        <div style="font-size: 64px; margin-bottom: 20px;">⚠️</div>
        <h1 class="hero-title" style="background: none; -webkit-text-fill-color: unset; color: var(--red);">Error Loading Scorecards</h1>
        <p class="hero-sub" style="color: var(--dim); font-size: 16px; margin-top: 20px;">
          An error occurred while checking your access permissions.
        </p>
      </div>
      <div class="card" style="max-width: 600px; margin: 40px auto; background: #FFE8E8;">
        <div class="section">
          <div style="font-size: 12px; color: var(--red); font-family: monospace; white-space: pre-wrap;">
            ${error.message}
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.innerHTML = html;
}

/* ════════════════════════════════════════════════════
   HELPER: Format role name for display
   ════════════════════════════════════════════════════ */

function formatRole(role) {
  const roleNames = {
    'claims_leader': 'Claims Leader',
    'firm_partner': 'Firm Partner',
    'firm_admin': 'Firm Admin',
    'attorney': 'Attorney',
    'paralegal': 'Paralegal',
    'guest': 'Guest'
  };
  return roleNames[role] || role;
}

/* ════════════════════════════════════════════════════
   SECURE API CALLS - Wrap with permission checks
   ════════════════════════════════════════════════════ */

async function fetchScorecards() {
  try {
    const response = await fetch('/api/scorecards', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include'
    });

    if (response.status === 403) {
      const error = await response.json();
      console.error('Access denied:', error.message);
      throw new Error(`Access denied: ${error.message}`);
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching scorecards:', error);
    throw error;
  }
}

async function fetchScorecardForAttorney(attorneyId) {
  try {
    const response = await fetch(`/api/scorecards/${attorneyId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include'
    });

    if (response.status === 403) {
      const error = await response.json();
      console.error('Access denied:', error.message);
      throw new Error(`Access denied: ${error.message}`);
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Error fetching scorecard for attorney ${attorneyId}:`, error);
    throw error;
  }
}

async function exportScorecard(attorneyId, format) {
  try {
    const response = await fetch(`/api/scorecards/${attorneyId}/export`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ format }),
      credentials: 'include'
    });

    if (response.status === 403) {
      const error = await response.json();
      console.error('Export access denied:', error.message);
      throw new Error(`Export denied: ${error.message}`);
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.blob();
  } catch (error) {
    console.error(`Error exporting scorecard for attorney ${attorneyId}:`, error);
    throw error;
  }
}

/* ════════════════════════════════════════════════════
   INITIALIZE ON PAGE LOAD
   ════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  checkScorecardAccess();
});

/* ════════════════════════════════════════════════════
   EXPORT FUNCTIONS
   ════════════════════════════════════════════════════ */

window.scorecardPermissions = {
  checkAccess: checkScorecardAccess,
  fetchScorecards,
  fetchScorecardForAttorney,
  exportScorecard,
  ALLOWED_ROLES: SCORECARD_ALLOWED_ROLES,
  DENIED_ROLES: SCORECARD_DENIED_ROLES
};

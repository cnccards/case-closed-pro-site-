/* ════════════════════════════════════════════════════
   EXECUTIVE DASHBOARD - Premium Version
   All 6 Sections: Firm at Glance, Financial, Portfolio, 
   Attorney Performance, Risk & Alerts, Detailed Reports
   ════════════════════════════════════════════════════ */

import React, { useState, useEffect } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

const ExecutiveDashboard = () => {
  const [dashboardData, setDashboardData] = useState(null);
  const [selectedView, setSelectedView] = useState('overview');
  const [timeRange, setTimeRange] = useState('ytd');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, [timeRange]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/dashboard?period=${timeRange}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await response.json();
      setDashboardData(data);
    } catch (error) {
      console.error('Error fetching dashboard:', error);
    }
    setLoading(false);
  };

  if (loading || !dashboardData) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Loading executive dashboard...</div>;
  }

  return (
    <div style={styles.container}>
      {/* HEADER */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Executive Dashboard</h1>
          <p style={styles.subtitle}>Complete legal portfolio overview & performance metrics</p>
        </div>
        <div style={styles.headerControls}>
          <select 
            value={timeRange} 
            onChange={(e) => setTimeRange(e.target.value)}
            style={styles.select}
          >
            <option value="mtd">This Month</option>
            <option value="ytd">Year to Date</option>
            <option value="12m">Last 12 Months</option>
            <option value="all">All Time</option>
          </select>
          <button style={styles.exportBtn} onClick={() => exportDashboard()}>📥 Export Report</button>
        </div>
      </div>

      {/* VIEW SELECTOR */}
      <div style={styles.viewSelector}>
        <button 
          onClick={() => setSelectedView('overview')}
          style={{...styles.viewBtn, ...(selectedView === 'overview' ? styles.viewBtnActive : {})}}
        >
          Overview
        </button>
        <button 
          onClick={() => setSelectedView('financial')}
          style={{...styles.viewBtn, ...(selectedView === 'financial' ? styles.viewBtnActive : {})}}
        >
          Financial
        </button>
        <button 
          onClick={() => setSelectedView('portfolio')}
          style={{...styles.viewBtn, ...(selectedView === 'portfolio' ? styles.viewBtnActive : {})}}
        >
          Portfolio
        </button>
        <button 
          onClick={() => setSelectedView('attorneys')}
          style={{...styles.viewBtn, ...(selectedView === 'attorneys' ? styles.viewBtnActive : {})}}
        >
          Attorneys
        </button>
        <button 
          onClick={() => setSelectedView('risk')}
          style={{...styles.viewBtn, ...(selectedView === 'risk' ? styles.viewBtnActive : {})}}
        >
          Risk & Alerts
        </button>
        <button 
          onClick={() => setSelectedView('reports')}
          style={{...styles.viewBtn, ...(selectedView === 'reports' ? styles.viewBtnActive : {})}}
        >
          Reports
        </button>
      </div>

      {/* SECTION 1: FIRM AT A GLANCE */}
      {selectedView === 'overview' && (
        <div>
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>📊 Firm at a Glance</h2>
            
            <div style={styles.kpiGrid}>
              <KPICard 
                label="Portfolio Value" 
                value={`$${(dashboardData.firmSummary.totalValue / 1000000).toFixed(1)}M`}
                trend="+12% YoY"
                color="#2563EB"
              />
              <KPICard 
                label="Revenue (YTD)" 
                value={`$${(dashboardData.firmSummary.revenueYTD / 1000).toFixed(0)}K`}
                trend="+8% vs target"
                color="#047857"
              />
              <KPICard 
                label="Cases Open" 
                value={dashboardData.firmSummary.openCases}
                trend={`${dashboardData.firmSummary.casesInTrial} in trial`}
                color="#B45309"
              />
              <KPICard 
                label="Win Rate" 
                value={`${dashboardData.firmSummary.winRate}%`}
                trend="vs 65% avg"
                color="#047857"
              />
              <KPICard 
                label="Reserve Accuracy" 
                value={`${dashboardData.firmSummary.reserveAccuracy}%`}
                trend="Within 5%"
                color="#2563EB"
              />
              <KPICard 
                label="At-Risk Matters" 
                value={dashboardData.firmSummary.riskMatters}
                trend="Needs review"
                color="#B91C1C"
              />
            </div>

            <div style={styles.gridDouble}>
              {/* Revenue Trend */}
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>Revenue Trend (12 Months)</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={dashboardData.revenueTrend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip formatter={(value) => `$${value}K`} />
                    <Legend />
                    <Line type="monotone" dataKey="revenue" stroke="#2563EB" name="Revenue" />
                    <Line type="monotone" dataKey="target" stroke="#047857" name="Target" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Cases by Status */}
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>Cases by Status</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={dashboardData.casesByStatus}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={renderCustomLabel}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      <Cell fill="#2563EB" />
                      <Cell fill="#047857" />
                      <Cell fill="#B45309" />
                      <Cell fill="#7C3AED" />
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Key Team Members */}
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>🏆 Top Performers</h3>
              <div style={styles.teamGrid}>
                {dashboardData.topAttorneys.map((atty, i) => (
                  <div key={i} style={styles.teamCard}>
                    <div style={styles.teamAvatar}>{atty.initials}</div>
                    <div style={styles.teamInfo}>
                      <div style={styles.teamName}>{atty.name}</div>
                      <div style={styles.teamRole}>{atty.title}</div>
                      <div style={styles.teamMetric}>LES: {atty.les}/100</div>
                      <div style={styles.teamMetric}>Win Rate: {atty.winRate}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: FINANCIAL DASHBOARD */}
      {selectedView === 'financial' && (
        <div>
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>💰 Financial Dashboard</h2>

            <div style={styles.kpiGrid}>
              <KPICard 
                label="Revenue Billed" 
                value={`$${(dashboardData.financial.billed / 1000).toFixed(0)}K`}
                trend="Current period"
                color="#047857"
              />
              <KPICard 
                label="Realization Rate" 
                value={`${dashboardData.financial.realization}%`}
                trend="vs 90% target"
                color={dashboardData.financial.realization >= 90 ? '#047857' : '#B91C1C'}
              />
              <KPICard 
                label="Unbilled Time" 
                value={`$${(dashboardData.financial.unbilled / 1000).toFixed(0)}K`}
                trend="Ready to bill"
                color="#2563EB"
              />
              <KPICard 
                label="Gross Margin" 
                value={`${dashboardData.financial.margin}%`}
                trend="vs 35% goal"
                color="#047857"
              />
              <KPICard 
                label="Collections" 
                value={`${dashboardData.financial.collectionRate}%`}
                trend="Outstanding"
                color="#B45309"
              />
              <KPICard 
                label="DSO" 
                value={`${dashboardData.financial.dso} days`}
                trend="Days sales out"
                color="#2563EB"
              />
            </div>

            <div style={styles.gridDouble}>
              {/* Billing by Attorney */}
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>Revenue by Attorney</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={dashboardData.financialByAttorney}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} />
                    <YAxis />
                    <Tooltip formatter={(value) => `$${value}K`} />
                    <Bar dataKey="billed" fill="#2563EB" name="Billed" />
                    <Bar dataKey="realized" fill="#047857" name="Realized" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Expense Breakdown */}
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>Margin Analysis</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={dashboardData.marginBreakdown}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={renderCustomLabel}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      <Cell fill="#047857" />
                      <Cell fill="#B45309" />
                      <Cell fill="#6B7280" />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Billing Pipeline */}
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>Billing Pipeline (Next 90 Days)</h3>
              <div style={styles.pipelineTable}>
                <div style={styles.pipelineRow}>
                  <div style={styles.pipelineLabel}>Ready to Bill (This Week)</div>
                  <div style={styles.pipelineValue}>$127K</div>
                  <div style={styles.pipelineBar}>
                    <div style={{...styles.pipelineFill, width: '90%', backgroundColor: '#047857'}}></div>
                  </div>
                </div>
                <div style={styles.pipelineRow}>
                  <div style={styles.pipelineLabel}>Pending (Next 30 Days)</div>
                  <div style={styles.pipelineValue}>$245K</div>
                  <div style={styles.pipelineBar}>
                    <div style={{...styles.pipelineFill, width: '73%', backgroundColor: '#2563EB'}}></div>
                  </div>
                </div>
                <div style={styles.pipelineRow}>
                  <div style={styles.pipelineLabel}>Projected (30-90 Days)</div>
                  <div style={styles.pipelineValue}>$189K</div>
                  <div style={styles.pipelineBar}>
                    <div style={{...styles.pipelineFill, width: '56%', backgroundColor: '#B45309'}}></div>
                  </div>
                </div>
                <div style={styles.pipelineRow}>
                  <div style={styles.pipelineLabel}>At Risk (Dispute)</div>
                  <div style={styles.pipelineValue}>$34K</div>
                  <div style={styles.pipelineBar}>
                    <div style={{...styles.pipelineFill, width: '10%', backgroundColor: '#B91C1C'}}></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: PORTFOLIO OVERVIEW */}
      {selectedView === 'portfolio' && (
        <div>
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>🎯 Portfolio Overview</h2>

            <div style={styles.gridDouble}>
              {/* Cases by Type */}
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>Cases by Type</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={dashboardData.casesByType}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="type" angle={-45} textAnchor="end" height={80} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" fill="#2563EB" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Cases by Value */}
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>Portfolio Value Distribution</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={dashboardData.casesByValue}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={renderCustomLabel}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {dashboardData.casesByValue.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={['#2563EB', '#047857', '#B45309', '#7C3AED', '#0891B2'][index % 5]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Case Stage Pipeline */}
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>Case Stage Pipeline</h3>
              <div style={styles.stageContainer}>
                {dashboardData.casesPipeline.map((stage, i) => (
                  <div key={i} style={styles.stageBox}>
                    <div style={styles.stageName}>{stage.name}</div>
                    <div style={styles.stageCount}>{stage.count}</div>
                    <div style={styles.stageValue}>${(stage.value / 1000).toFixed(0)}K</div>
                    <div style={{...styles.stageBar, width: '100%', backgroundColor: '#E5E7EB'}}>
                      <div style={{...styles.stageBar, width: `${(stage.count / 15) * 100}%`, backgroundColor: '#2563EB'}}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Clients */}
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>Top 10 Clients by Portfolio Value</h3>
              <div style={styles.clientTable}>
                {dashboardData.topClients.map((client, i) => (
                  <div key={i} style={styles.clientRow}>
                    <span style={styles.clientRank}>#{i + 1}</span>
                    <span style={styles.clientName}>{client.name}</span>
                    <span style={styles.clientMatters}>{client.matterCount} matters</span>
                    <span style={styles.clientValue}>${(client.value / 1000).toFixed(0)}K</span>
                    <div style={styles.clientBar}>
                      <div style={{...styles.clientBarFill, width: `${(client.value / dashboardData.topClients[0].value) * 100}%`}}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 4: ATTORNEY PERFORMANCE */}
      {selectedView === 'attorneys' && (
        <div>
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>👥 Attorney Performance</h2>

            <div style={styles.gridDouble}>
              {/* Win Rate Comparison */}
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>Win Rate by Attorney</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={dashboardData.attorneyWinRates}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} />
                    <YAxis />
                    <Tooltip formatter={(value) => `${value}%`} />
                    <Bar dataKey="winRate" fill="#047857" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Days to Resolution */}
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>Average Days to Resolution</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={dashboardData.attorneyDaysOpen}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} />
                    <YAxis />
                    <Tooltip formatter={(value) => `${value} days`} />
                    <Bar dataKey="days" fill="#B45309" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Attorney Leaderboard */}
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>⭐ Attorney Leaderboard (LES Scores)</h3>
              <div style={styles.leaderboard}>
                {dashboardData.attorneyScores.map((atty, i) => (
                  <div key={i} style={{...styles.leaderboardRow, backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F9FAFB'}}>
                    <div style={styles.leaderboardRank}>#{i + 1}</div>
                    <div style={styles.leaderboardName}>{atty.name}</div>
                    <div style={styles.leaderboardGrade} style={{color: getGradeColor(atty.grade)}}>{atty.grade}</div>
                    <div style={styles.leaderboardScore}>{atty.les}/100</div>
                    <div style={styles.leaderboardCases}>{atty.cases} cases</div>
                    <div style={styles.leaderboardRevenue}>${(atty.revenue / 1000).toFixed(0)}K</div>
                  </div>
                ))}
              </div>
            </div>

            {/* New Business Generation */}
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>New Business (Last 90 Days)</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={dashboardData.newBusinessByAttorney}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} />
                  <YAxis />
                  <Tooltip formatter={(value) => `${value} matters`} />
                  <Bar dataKey="newMatters" fill="#2563EB" name="New Matters" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 5: RISK & ALERTS */}
      {selectedView === 'risk' && (
        <div>
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>⚠️ Risk & Alerts</h2>

            {/* Critical Alerts */}
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>🚨 Critical Alerts</h3>
              <div style={styles.alertsList}>
                {dashboardData.criticalAlerts.map((alert, i) => (
                  <div key={i} style={{...styles.alertBox, borderLeftColor: alert.severity === 'critical' ? '#B91C1C' : alert.severity === 'warning' ? '#B45309' : '#2563EB'}}>
                    <div style={styles.alertSeverity}>{alert.icon}</div>
                    <div style={styles.alertContent}>
                      <div style={styles.alertTitle}>{alert.title}</div>
                      <div style={styles.alertMessage}>{alert.message}</div>
                      <div style={styles.alertTime}>{alert.time}</div>
                    </div>
                    <button style={styles.alertAction}>Review →</button>
                  </div>
                ))}
              </div>
            </div>

            <div style={styles.gridDouble}>
              {/* High-Stakes Matters */}
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>High-Stakes Matters on Trial</h3>
                <div style={styles.highStakesTable}>
                  {dashboardData.highStakesMatters.map((matter, i) => (
                    <div key={i} style={styles.highStakesRow}>
                      <div style={styles.highStakesCode}>{matter.code}</div>
                      <div style={styles.highStakesInfo}>
                        <div style={styles.highStakesClient}>{matter.client}</div>
                        <div style={styles.highStakesType}>{matter.type}</div>
                      </div>
                      <div style={styles.highStakesValue}>${(matter.value / 1000).toFixed(0)}K</div>
                      <div style={{...styles.riskBadge, backgroundColor: '#FFE8E8', color: '#B91C1C'}}>⚠️ Trial</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Aging Matters */}
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>Aging Matters (6+ Months Open)</h3>
                <div style={styles.agingTable}>
                  {dashboardData.agingMatters.map((matter, i) => (
                    <div key={i} style={styles.agingRow}>
                      <div style={styles.agingDays}>{matter.daysOpen} days</div>
                      <div style={styles.agingInfo}>
                        <div style={styles.agingName}>{matter.matter}</div>
                        <div style={styles.agingClient}>{matter.client}</div>
                      </div>
                      <div style={styles.agingAttorney}>{matter.attorney}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Reserve Issues */}
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>Reserve Accuracy Concerns</h3>
              <div style={styles.reserveTable}>
                {dashboardData.reserveIssues.map((issue, i) => (
                  <div key={i} style={{...styles.reserveRow, backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F9FAFB'}}>
                    <div style={styles.reserveStatus}>{issue.status}</div>
                    <div style={styles.reserveMatter}>{issue.matter}</div>
                    <div style={styles.reserveReserved}>Reserved: ${(issue.reserved / 1000).toFixed(0)}K</div>
                    <div style={styles.reserveActual}>Actual: ${(issue.actual / 1000).toFixed(0)}K</div>
                    <div style={styles.reserveVariance}>{issue.variance}%</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 6: DETAILED REPORTS */}
      {selectedView === 'reports' && (
        <div>
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>📋 Detailed Reports</h2>

            {/* Matter List */}
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>All Matters</h3>
              <div style={styles.tableControls}>
                <input type="text" placeholder="Search matters..." style={styles.searchInput} />
                <select style={styles.filterSelect}>
                  <option>All Status</option>
                  <option>Open</option>
                  <option>Trial</option>
                  <option>Closed</option>
                </select>
              </div>
              <div style={styles.matterTable}>
                <div style={styles.matterHeaderRow}>
                  <div style={{flex: 1}}>Matter ID</div>
                  <div style={{flex: 2}}>Client</div>
                  <div style={{flex: 1}}>Attorney</div>
                  <div style={{flex: 1}}>Type</div>
                  <div style={{flex: 1}}>Value</div>
                  <div style={{flex: 1}}>Status</div>
                  <div style={{flex: 1}}>Days</div>
                </div>
                {dashboardData.allMatters.map((matter, i) => (
                  <div key={i} style={{...styles.matterRow, backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F9FAFB'}}>
                    <div style={{flex: 1}}><strong>{matter.id}</strong></div>
                    <div style={{flex: 2}}>{matter.client}</div>
                    <div style={{flex: 1}}>{matter.attorney}</div>
                    <div style={{flex: 1}}>{matter.type}</div>
                    <div style={{flex: 1}}>${(matter.value / 1000).toFixed(0)}K</div>
                    <div style={{flex: 1}}><span style={{...styles.statusBadge, backgroundColor: getStatusColor(matter.status)}}>{matter.status}</span></div>
                    <div style={{flex: 1}}>{matter.daysOpen}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ════════════════════════════════════════════════════
   COMPONENT: KPI Card
   ════════════════════════════════════════════════════ */

const KPICard = ({ label, value, trend, color }) => (
  <div style={{...styles.kpiCard, borderLeftColor: color}}>
    <div style={styles.kpiLabel}>{label}</div>
    <div style={{...styles.kpiValue, color}}>{value}</div>
    <div style={styles.kpiTrend}>{trend}</div>
  </div>
);

/* ════════════════════════════════════════════════════
   HELPER FUNCTIONS
   ════════════════════════════════════════════════════ */

function renderCustomLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * Math.PI / 180);
  const y = cy + radius * Math.sin(-midAngle * Math.PI / 180);

  return (
    <text x={x} y={y} fill="white" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={12} fontWeight="bold">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

function getGradeColor(grade) {
  const colors = {
    'A+': '#047857',
    'A': '#2563EB',
    'A-': '#0891B2',
    'B+': '#B45309',
    'B': '#B45309',
    'C': '#B91C1C'
  };
  return colors[grade] || '#6B7280';
}

function getStatusColor(status) {
  const colors = {
    'Open': '#E0E7FF',
    'Trial': '#FEF9E7',
    'Closed': '#F0FDF4',
    'Settlement': '#DDF4FF'
  };
  return colors[status] || '#F3F4F6';
}

function exportDashboard() {
  alert('Export functionality - will generate PDF report');
  // TODO: Implement PDF export
}

/* ════════════════════════════════════════════════════
   STYLES
   ════════════════════════════════════════════════════ */

const styles = {
  container: {
    padding: '20px',
    backgroundColor: '#F3F4F6',
    minHeight: '100vh'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '30px',
    backgroundColor: '#FFFFFF',
    padding: '20px',
    borderRadius: '12px',
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
  },
  title: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#1F2937',
    margin: '0 0 6px 0'
  },
  subtitle: {
    fontSize: '13px',
    color: '#6B7280',
    margin: '0'
  },
  headerControls: {
    display: 'flex',
    gap: '12px'
  },
  select: {
    padding: '8px 12px',
    border: '1px solid #E5E7EB',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  exportBtn: {
    padding: '8px 16px',
    background: 'linear-gradient(135deg, #2563EB, #1D4ED8)',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontWeight: '700',
    fontSize: '12px',
    cursor: 'pointer'
  },
  viewSelector: {
    display: 'flex',
    gap: '8px',
    marginBottom: '20px',
    flexWrap: 'wrap'
  },
  viewBtn: {
    padding: '10px 16px',
    background: '#FFFFFF',
    border: '1px solid #E5E7EB',
    borderRadius: '6px',
    fontSize: '11px',
    fontWeight: '700',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  viewBtnActive: {
    background: '#2563EB',
    color: 'white',
    borderColor: '#2563EB'
  },
  section: {
    marginBottom: '30px'
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: '700',
    marginBottom: '20px',
    color: '#1F2937'
  },
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '16px',
    marginBottom: '24px'
  },
  kpiCard: {
    background: '#FFFFFF',
    border: '1px solid #E5E7EB',
    borderLeft: '4px solid #2563EB',
    borderRadius: '8px',
    padding: '16px',
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
  },
  kpiLabel: {
    fontSize: '11px',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    fontWeight: '700',
    marginBottom: '6px'
  },
  kpiValue: {
    fontSize: '24px',
    fontWeight: '700',
    marginBottom: '4px'
  },
  kpiTrend: {
    fontSize: '10px',
    color: '#047857',
    fontWeight: '600'
  },
  gridDouble: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
    gap: '20px',
    marginBottom: '20px'
  },
  card: {
    background: '#FFFFFF',
    border: '1px solid #E5E7EB',
    borderRadius: '10px',
    padding: '20px',
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
  },
  cardTitle: {
    fontSize: '14px',
    fontWeight: '700',
    marginBottom: '16px',
    color: '#1F2937'
  },
  teamGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '12px'
  },
  teamCard: {
    display: 'flex',
    gap: '12px',
    padding: '12px',
    backgroundColor: '#F9FAFB',
    borderRadius: '8px',
    border: '1px solid #E5E7EB'
  },
  teamAvatar: {
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #2563EB, #1D4ED8)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '700',
    fontSize: '14px',
    flexShrink: 0
  },
  teamInfo: {
    flex: 1
  },
  teamName: {
    fontSize: '12px',
    fontWeight: '700',
    color: '#1F2937'
  },
  teamRole: {
    fontSize: '10px',
    color: '#6B7280'
  },
  teamMetric: {
    fontSize: '9px',
    color: '#2563EB',
    fontWeight: '600',
    marginTop: '2px'
  },
  pipelineTable: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  pipelineRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  pipelineLabel: {
    fontSize: '12px',
    fontWeight: '600',
    width: '150px',
    color: '#1F2937'
  },
  pipelineValue: {
    fontSize: '13px',
    fontWeight: '700',
    color: '#2563EB',
    width: '80px'
  },
  pipelineBar: {
    flex: 1,
    height: '8px',
    backgroundColor: '#E5E7EB',
    borderRadius: '4px',
    overflow: 'hidden'
  },
  pipelineFill: {
    height: '100%'
  },
  stageContainer: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: '12px'
  },
  stageBox: {
    backgroundColor: '#F9FAFB',
    border: '1px solid #E5E7EB',
    borderRadius: '8px',
    padding: '12px',
    textAlign: 'center'
  },
  stageName: {
    fontSize: '10px',
    color: '#6B7280',
    fontWeight: '700',
    marginBottom: '4px',
    textTransform: 'uppercase'
  },
  stageCount: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: '4px'
  },
  stageValue: {
    fontSize: '10px',
    color: '#2563EB',
    fontWeight: '700',
    marginBottom: '8px'
  },
  stageBar: {
    height: '6px',
    borderRadius: '3px'
  },
  clientTable: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  clientRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px',
    backgroundColor: '#F9FAFB',
    borderRadius: '6px',
    fontSize: '11px'
  },
  clientRank: {
    fontWeight: '700',
    color: '#2563EB',
    width: '32px'
  },
  clientName: {
    fontWeight: '600',
    flex: 1
  },
  clientMatters: {
    color: '#6B7280',
    width: '80px'
  },
  clientValue: {
    fontWeight: '700',
    color: '#047857',
    width: '60px'
  },
  clientBar: {
    width: '100px',
    height: '4px',
    backgroundColor: '#E5E7EB',
    borderRadius: '2px',
    overflow: 'hidden'
  },
  clientBarFill: {
    height: '100%',
    backgroundColor: '#2563EB'
  },
  leaderboard: {
    border: '1px solid #E5E7EB',
    borderRadius: '8px',
    overflow: 'hidden'
  },
  leaderboardRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px',
    gap: '12px',
    borderBottom: '1px solid #E5E7EB',
    fontSize: '11px'
  },
  leaderboardRank: {
    fontWeight: '700',
    color: '#2563EB',
    width: '32px'
  },
  leaderboardName: {
    fontWeight: '600',
    flex: 1
  },
  leaderboardGrade: {
    fontWeight: '700',
    width: '48px'
  },
  leaderboardScore: {
    fontWeight: '700',
    color: '#1F2937',
    width: '60px'
  },
  leaderboardCases: {
    color: '#6B7280',
    width: '60px'
  },
  leaderboardRevenue: {
    fontWeight: '700',
    color: '#047857',
    width: '60px'
  },
  alertsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  alertBox: {
    display: 'flex',
    gap: '12px',
    padding: '12px',
    backgroundColor: '#F9FAFB',
    border: '1px solid #E5E7EB',
    borderLeftWidth: '3px',
    borderRadius: '6px'
  },
  alertSeverity: {
    fontSize: '18px',
    flexShrink: 0
  },
  alertContent: {
    flex: 1
  },
  alertTitle: {
    fontSize: '11px',
    fontWeight: '700',
    color: '#1F2937'
  },
  alertMessage: {
    fontSize: '10px',
    color: '#6B7280',
    marginTop: '2px'
  },
  alertTime: {
    fontSize: '9px',
    color: '#9CA3AF',
    marginTop: '4px'
  },
  alertAction: {
    padding: '4px 8px',
    background: 'transparent',
    border: '1px solid #E5E7EB',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: '700',
    cursor: 'pointer',
    color: '#2563EB'
  },
  highStakesTable: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  highStakesRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px',
    backgroundColor: '#F9FAFB',
    borderRadius: '6px'
  },
  highStakesCode: {
    fontWeight: '700',
    color: '#2563EB',
    width: '60px'
  },
  highStakesInfo: {
    flex: 1
  },
  highStakesClient: {
    fontSize: '11px',
    fontWeight: '600'
  },
  highStakesType: {
    fontSize: '9px',
    color: '#6B7280'
  },
  highStakesValue: {
    fontWeight: '700',
    color: '#047857',
    width: '60px'
  },
  riskBadge: {
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '9px',
    fontWeight: '700'
  },
  agingTable: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  agingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px',
    backgroundColor: '#F9FAFB',
    borderRadius: '6px'
  },
  agingDays: {
    fontWeight: '700',
    color: '#B91C1C',
    width: '60px'
  },
  agingInfo: {
    flex: 1
  },
  agingName: {
    fontSize: '11px',
    fontWeight: '600'
  },
  agingClient: {
    fontSize: '9px',
    color: '#6B7280'
  },
  agingAttorney: {
    fontSize: '10px',
    color: '#6B7280'
  },
  reserveTable: {
    border: '1px solid #E5E7EB',
    borderRadius: '8px',
    overflow: 'hidden'
  },
  reserveRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px',
    gap: '12px',
    borderBottom: '1px solid #E5E7EB',
    fontSize: '10px'
  },
  reserveStatus: {
    fontWeight: '700',
    width: '60px'
  },
  reserveMatter: {
    flex: 1,
    fontWeight: '600'
  },
  reserveReserved: {
    color: '#6B7280',
    width: '100px'
  },
  reserveActual: {
    color: '#6B7280',
    width: '100px'
  },
  reserveVariance: {
    fontWeight: '700',
    color: '#B91C1C',
    width: '60px'
  },
  tableControls: {
    display: 'flex',
    gap: '12px',
    marginBottom: '12px'
  },
  searchInput: {
    flex: 1,
    padding: '8px 12px',
    border: '1px solid #E5E7EB',
    borderRadius: '6px',
    fontSize: '12px'
  },
  filterSelect: {
    padding: '8px 12px',
    border: '1px solid #E5E7EB',
    borderRadius: '6px',
    fontSize: '12px'
  },
  matterTable: {
    border: '1px solid #E5E7EB',
    borderRadius: '8px',
    overflow: 'hidden'
  },
  matterHeaderRow: {
    display: 'flex',
    padding: '12px',
    backgroundColor: '#F3F4F6',
    fontWeight: '700',
    fontSize: '10px',
    borderBottom: '1px solid #E5E7EB',
    textTransform: 'uppercase',
    letterSpacing: '0.8px'
  },
  matterRow: {
    display: 'flex',
    padding: '12px',
    fontSize: '10px',
    borderBottom: '1px solid #E5E7EB',
    alignItems: 'center'
  },
  statusBadge: {
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '9px',
    fontWeight: '700',
    color: 'white'
  }
};

export default ExecutiveDashboard;

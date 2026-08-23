/* ── ENHANCED SCORECARD VIEW V3 ────────────────────────
   ULTIMATE VERSION: All 14 enhancements
   - Historical trends, specialization badges, goals tracking
   - Risk indicators, case outcomes, billing metrics
   - Mentor network, adjuster satisfaction, and more
   ════════════════════════════════════════════════════ */

const FIRST_NAMES = ['Marcus', 'Elena', 'David', 'Priya', 'James', 'Sophia', 'Isabella', 'Alexander', 'Victoria', 'Nicholas', 'Amelia', 'Benjamin', 'Charlotte', 'Daniel', 'Olivia'];
const LAST_NAMES = ['Richardson', 'Chen', 'O\'Brien', 'Patel', 'Williams', 'Anderson', 'Thompson', 'Martinez', 'Garcia', 'Rodriguez'];

function generateRandomAttorneyNames(count = 12) {
  const names = [];
  const used = new Set();
  while (names.length < count) {
    const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
    const name = `${first} ${last}`;
    if (!used.has(name)) {
      names.push(name);
      used.add(name);
    }
  }
  return names;
}

function getAvatarColor(name) {
  const colors = ['#2563EB', '#047857', '#B45309', '#B91C1C', '#7C3AED', '#0891B2', '#D97706', '#6366F1'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getInitials(name) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase();
}

function scorecardV(){
  const allScores = ATTY.map(a => {
    const aCases = CASES.filter(c => c.attorney === a);
    const aOpen = aCases.filter(c => c.status !== 'Closed');
    const aClosed = aCases.filter(c => c.status === 'Closed');
    
    // === LES SCORE CALCULATION ===
    const winRate = aClosed.length ? 
      aClosed.filter(c => (c.exposure.settlementAmount || 0) < (c.exposure.demandAmount || c.value)).length / aClosed.length : 0;
    const settledCases = aClosed.filter(c => c.exposure.settlementAmount);
    const settlementRatio = settledCases.length ? 
      settledCases.reduce((s, c) => s + (c.exposure.settlementAmount / (c.insurance.reserveAmount||c.value)), 0) / settledCases.length : 0;
    const dismissalRate = aClosed.length ? aClosed.filter(c => c.status === 'Closed').length / aClosed.length : 0;
    const outcomeScore = (winRate * 15) + (Math.min(settlementRatio, 1) * 12) + (dismissalRate * 8);
    
    const avgDays = aClosed.length ? 
      aClosed.reduce((s, c) => s + daysOpen(c), 0) / aClosed.length : 0;
    const speedScore = Math.max(12 - (avgDays / 180) * 12, 0);
    const reserveAccuracy = aClosed.length ?
      aClosed.reduce((s, c) => s + Math.max(1 - Math.abs(1 - ((c.billing.totalBilled||0) / (c.insurance.reserveAmount||1))), 0), 0) / aClosed.length : 0;
    const efficiencyScore = speedScore + (reserveAccuracy * 8) + 5;
    
    const activeClosed = aOpen.length / (aClosed.length || 1);
    const balanceScore = 8 - (Math.abs(activeClosed - 0.75) * 4);
    const cciAvg = aOpen.length ? Math.round(aOpen.reduce((s, c) => s + cci(c), 0) / aOpen.length) : 50;
    const complexSuccess = aOpen.filter(c => cci(c) >= 70).length / (aOpen.length || 1);
    const portfolioScore = Math.max(balanceScore, 2) + (complexSuccess * 7) + ((cciAvg / 100) * 5);
    
    const newMatters = aCases.filter(c => new Date(c.filed) > new Date(Date.now() - 90*864e5)).length;
    const newScore = Math.min((newMatters / 5) * 8, 8);
    const satisfaction = aCases.length ? 
      Math.round(aCases.reduce((s, c) => s + (c.clientSatisfaction || 8), 0) / aCases.length * 10) : 80;
    const growthScore = newScore + (satisfaction / 100 * 7) + 5;
    
    const les = Math.round((outcomeScore * 0.35) + (efficiencyScore * 0.25) + (portfolioScore * 0.20) + (growthScore * 0.20));
    const grade = les >= 90 ? 'A+' : les >= 85 ? 'A' : les >= 80 ? 'A-' : les >= 75 ? 'B+' : les >= 70 ? 'B' : 'C';
    const gradeColor = les >= 85 ? '#047857' : les >= 75 ? '#B45309' : '#B91C1C';
    
    // === NEW V3 FEATURES ===
    
    // 1. Historical trend (simulate 12 months)
    const trend = [72, 74, 76, 75, 78, 80, 82, 81, 83, 85, 87, 88];
    
    // 2. Specialization badges
    const specializations = detectSpecializations(aCases, cciAvg, winRate, settlementRatio);
    
    // 3. Case outcome distribution
    const outcomes = {
      won: aClosed.filter(c => (c.exposure.settlementAmount || 0) < (c.exposure.demandAmount || c.value)).length,
      settled: settledCases.length,
      dismissed: aClosed.filter(c => !c.exposure.settlementAmount && !c.exposure.demandAmount).length,
      lost: aClosed.filter(c => (c.exposure.settlementAmount || c.value) > (c.exposure.demandAmount || c.value)).length
    };
    
    // 4. Risk indicators
    const risks = detectRisks(les, aClosed.length, avgDays, satisfaction, aOpen.length);
    
    // 5. Goals tracking
    const goals = [
      { label: 'LES Target', target: 85, current: les, unit: '', type: 'score' },
      { label: 'Settlement Rate', target: 80, current: Math.round(settlementRatio * 100), unit: '%', type: 'percent' },
      { label: 'Days to Resolution', target: 150, current: Math.round(avgDays), unit: 'days', type: 'inverse' },
      { label: 'New Business', target: 5, current: newMatters, unit: 'matters', type: 'number' }
    ];
    
    // 6. Matter types
    const matterTypes = calculateMatterTypes(aCases);
    
    // 7. Reserve accuracy
    const reserveData = calculateReserveAccuracy(aClosed);
    
    // 8. Adjusters preference
    const adjusterPreferences = getAdjusterPreferences(aCases);
    
    // 9. Billing metrics
    const billingMetrics = calculateBillingMetrics(aClosed);
    
    // 10. Mentor network
    const mentorNetwork = getMentorNetwork(a);
    
    // Quick wins
    const closedWithFeedback = aClosed.filter(c => c.claimsFeedback);
    const latestFeedback = closedWithFeedback.length > 0 ? closedWithFeedback[closedWithFeedback.length - 1].claimsFeedback : null;
    const adjusterSatisfaction = calculateAdjusterSatisfaction(aCases);
    const recentCases = aClosed.slice(-3).reverse();
    const nextMilestone = getNextMilestone(les);
    
    // Comparison to firm average
    const allLES = ATTY.map(att => {
      const ac = CASES.filter(c => c.attorney === att);
      const aclosed = ac.filter(c => c.status === 'Closed');
      return Math.round((Math.random() * 40) + 60); // Simulated for demo
    });
    const firmAvgLES = Math.round(allLES.reduce((s, sc) => s + sc, 0) / allLES.length);
    const comparison = les - firmAvgLES;
    
    return {
      name: a,
      initials: getInitials(a),
      avatarColor: getAvatarColor(a),
      cases: aCases.length,
      open: aOpen.length,
      closed: aClosed.length,
      les, grade, gradeColor,
      components: {
        outcome: Math.round(outcomeScore),
        efficiency: Math.round(efficiencyScore),
        portfolio: Math.round(portfolioScore),
        growth: Math.round(growthScore)
      },
      metrics: {
        winRate: Math.round(winRate * 100),
        avgDaysOpen: Math.round(avgDays),
        cciAvg,
        satisfaction,
        newMatters,
        partnerRating: RATINGS[a] || 75
      },
      // V3 ADDITIONS
      trend,
      specializations,
      outcomes,
      risks,
      goals,
      matterTypes,
      reserveData,
      adjusterPreferences,
      billingMetrics,
      mentorNetwork,
      claimsFeedback: latestFeedback,
      adjusterSatisfaction,
      recentCases,
      nextMilestone,
      comparison,
      firmAvgLES
    };
  });
  
  const firmAvgLES = Math.round(allScores.reduce((s, sc) => s + sc.les, 0) / allScores.length);
  const firmAvgGrade = firmAvgLES >= 90 ? 'A+' : firmAvgLES >= 85 ? 'A' : firmAvgLES >= 80 ? 'A-' : firmAvgLES >= 75 ? 'B+' : firmAvgLES >= 70 ? 'B' : 'C';
  
  allScores.sort((a, b) => b.les - a.les);
  
  let h = '<div class="wrap">';
  
  // Hero header
  h += '<div class="hero">';
  h += '<div class="hero-l">';
  h += '<div class="hero-eyebrow">Attorney Performance</div>';
  h += '<h1 class="hero-title">Litigation Excellence Index V3</h1>';
  h += '<p class="hero-sub">Complete performance analytics including historical trends, specializations, goals, risks, and mentor network. Firm average: '+firmAvgGrade+' ('+firmAvgLES+'/100)</p>';
  h += '</div>';
  h += '</div>';
  
  // Firm-wide metrics
  h += '<div class="kpi-grid">';
  h += '<div class="kpi"><div class="kpi-bar" style="background:var(--pri2)"></div><div class="kpi-l">Attorneys</div><div class="kpi-v">'+ATTY.length+'</div><div class="kpi-sub">Ranked in real-time</div></div>';
  h += '<div class="kpi"><div class="kpi-bar" style="background:var(--pri)"></div><div class="kpi-l">Firm Avg LES</div><div class="kpi-v">'+firmAvgLES+'</div><div class="kpi-sub">Letter grade: '+firmAvgGrade+'</div></div>';
  h += '<div class="kpi"><div class="kpi-bar" style="background:var(--green)"></div><div class="kpi-l">Top Performer</div><div class="kpi-v">'+allScores[0].grade+'</div><div class="kpi-sub">'+allScores[0].name+'</div></div>';
  h += '<div class="kpi"><div class="kpi-bar" style="background:var(--gold)"></div><div class="kpi-l">Active Matters</div><div class="kpi-v">'+CASES.filter(c=>c.status!=='Closed').length+'</div><div class="kpi-sub">Under management</div></div>';
  h += '</div>';
  
  // View toggle
  h += '<div class="card" style="padding:12px 14px;margin-bottom:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;">';
  h += '<div style="display:flex;gap:6px;background:var(--surf2);border:1px solid var(--line);border-radius:8px;padding:3px;flex-wrap:wrap;">';
  h += '<button class="tab-btn '+(S.scoreView==='cards'||!S.scoreView?'on':'')+'" onclick="st({scoreView:\'cards\'})">Full Profile</button>';
  h += '<button class="tab-btn '+(S.scoreView==='table'?'on':'')+'" onclick="st({scoreView:\'table\'})">Table View</button>';
  h += '<button class="tab-btn '+(S.scoreView==='analytics'?'on':'')+'" onclick="st({scoreView:\'analytics\'})">Analytics</button>';
  h += '</div>';
  h += '</div>';
  
  // FULL PROFILE VIEW (default)
  if (S.scoreView !== 'table' && S.scoreView !== 'analytics') {
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(520px,1fr));gap:16px;">';
    
    allScores.forEach((sc, idx) => {
      const color = sc.gradeColor;
      
      h += '<div class="card" style="padding:0;overflow:hidden;border-left:5px solid '+color+';display:grid;grid-template-rows:auto 1fr;">';
      
      // HEADER
      h += '<div style="background:linear-gradient(135deg,'+color+'08,'+color+'02);padding:16px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">';
      h += '<div style="flex:1;display:flex;gap:12px;align-items:center;">';
      h += '<div class="avatar" style="background-color:'+sc.avatarColor+';width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:18px;flex-shrink:0;">'+sc.initials+'</div>';
      h += '<div>';
      h += '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px;"><div style="font-size:18px;font-weight:700;color:var(--ink);">'+esc(sc.name)+'</div><span style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1.3px;font-weight:700;background:#fff;padding:2px 7px;border-radius:4px;">#'+(idx+1)+'</span></div>';
      h += '<div style="font-size:11px;color:var(--muted);">'+sc.cases+' matters · '+sc.open+' active · '+sc.closed+' closed</div>';
      h += '</div></div>';
      h += '<div style="text-align:right;"><div style="font-size:48px;font-weight:700;color:'+color+';line-height:1;">'+sc.grade+'</div><div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:1px;">'+sc.les+'/100</div></div>';
      h += '</div>';
      
      // SCROLLABLE CONTENT
      h += '<div style="padding:0;overflow-y:auto;max-height:900px;">';
      
      // RISK ALERTS
      if (sc.risks && sc.risks.length > 0) {
        h += '<div style="padding:12px 16px;background:#FEF2F2;border-bottom:1px solid var(--line);">';
        h += '<div style="font-size:9px;color:var(--red);text-transform:uppercase;letter-spacing:1.4px;font-weight:700;margin-bottom:8px;">⚠️ Risk Alerts</div>';
        sc.risks.forEach(risk => {
          h += '<div style="font-size:10px;color:var(--red);margin-bottom:6px;padding:4px 0;border-left:2px solid var(--red);padding-left:8px;">'+risk.icon+' '+risk.label+'</div>';
        });
        h += '</div>';
      }
      
      // SPECIALIZATIONS
      if (sc.specializations && sc.specializations.length > 0) {
        h += '<div style="padding:12px 16px;background:var(--surf2);border-bottom:1px solid var(--line);">';
        h += '<div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1.4px;font-weight:700;margin-bottom:6px;">⭐ Specializations</div>';
        sc.specializations.forEach(spec => {
          h += '<div style="display:inline-block;margin-right:8px;margin-bottom:6px;padding:4px 10px;background:white;border:1px solid '+color+';border-radius:20px;font-size:10px;font-weight:600;color:'+color+';">'+spec.badge+' '+spec.value+'</div>';
        });
        h += '</div>';
      }
      
      // COMPARISON TO FIRM AVG
      h += '<div style="padding:12px 16px;border-bottom:1px solid var(--line);">';
      h += '<div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1.4px;font-weight:700;margin-bottom:8px;">📊 vs Firm Average</div>';
      const compColor = sc.comparison > 0 ? 'var(--green)' : sc.comparison < 0 ? 'var(--red)' : 'var(--dim)';
      const compSign = sc.comparison > 0 ? '+' : '';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;"><span style="font-size:11px;">LES Score</span><span style="font-weight:700;color:'+compColor+';">'+compSign+sc.comparison+' points</span></div>';
      h += '</div>';
      
      // SCORE COMPONENTS
      h += '<div style="padding:12px 16px;border-bottom:1px solid var(--line);background:var(--surf2);">';
      h += '<div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1.4px;font-weight:700;margin-bottom:10px;">Score Components</div>';
      h += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">';
      const components = [
        {label:'Outcomes', value:sc.components.outcome, max:35, icon:'🎯'},
        {label:'Efficiency', value:sc.components.efficiency, max:25, icon:'⚡'},
        {label:'Portfolio', value:sc.components.portfolio, max:20, icon:'📊'},
        {label:'Growth', value:sc.components.growth, max:20, icon:'📈'}
      ];
      components.forEach(comp => {
        const pct = (comp.value / comp.max) * 100;
        h += '<div style="text-align:center;"><div style="width:50px;height:50px;border-radius:50%;background:var(--surf3);margin:0 auto 6px;display:flex;align-items:center;justify-content:center;font-size:16px;">'+Math.round(pct)+'%</div><div style="font-size:9px;font-weight:700;color:var(--ink);">'+comp.label+'</div></div>';
      });
      h += '</div></div>';
      
      // GOALS TRACKING
      if (sc.goals) {
        h += '<div style="padding:12px 16px;border-bottom:1px solid var(--line);">';
        h += '<div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1.4px;font-weight:700;margin-bottom:10px;">🎯 2024 Goals</div>';
        sc.goals.forEach(goal => {
          const progress = Math.min((goal.current / goal.target) * 100, 100);
          const status = progress >= 100 ? '✅' : progress >= 75 ? '⏳' : '❌';
          h += '<div style="margin-bottom:8px;"><div style="display:flex;justify-content:space-between;margin-bottom:2px;"><span style="font-size:10px;">'+goal.label+'</span><span style="font-size:10px;font-weight:700;">'+goal.current+'/'+goal.target+' '+goal.unit+'</span></div>';
          h += '<div style="height:6px;background:var(--surf3);border-radius:3px;overflow:hidden;"><div style="width:'+progress+'%;height:100%;background:'+color+';"></div></div></div>';
        });
        h += '</div>';
      }
      
      // CASE OUTCOME DISTRIBUTION
      if (sc.outcomes) {
        h += '<div style="padding:12px 16px;border-bottom:1px solid var(--line);background:var(--surf2);">';
        h += '<div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1.4px;font-weight:700;margin-bottom:10px;">📋 Case Outcomes</div>';
        const total = sc.outcomes.won + sc.outcomes.settled + sc.outcomes.dismissed + sc.outcomes.lost;
        h += '<div style="display:flex;justify-content:space-between;font-size:10px;">';
        h += '<div><span style="color:var(--green);font-weight:700;">'+sc.outcomes.won+'</span> Won</div>';
        h += '<div><span style="color:var(--pri);font-weight:700;">'+sc.outcomes.settled+'</span> Settled</div>';
        h += '<div><span style="color:var(--gold);font-weight:700;">'+sc.outcomes.dismissed+'</span> Dismissed</div>';
        h += '<div><span style="color:var(--red);font-weight:700;">'+sc.outcomes.lost+'</span> Lost</div>';
        h += '</div></div>';
      }
      
      // MATTER TYPES
      if (sc.matterTypes) {
        h += '<div style="padding:12px 16px;border-bottom:1px solid var(--line);">';
        h += '<div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1.4px;font-weight:700;margin-bottom:8px;">📑 Matter Types</div>';
        sc.matterTypes.forEach(mt => {
          h += '<div style="margin-bottom:6px;font-size:10px;display:flex;justify-content:space-between;"><span>'+mt.type+'</span><span style="font-weight:700;">'+mt.count+' ('+mt.pct+'%)</span></div>';
        });
        h += '</div>';
      }
      
      // KEY METRICS
      h += '<div style="padding:12px 16px;border-bottom:1px solid var(--line);">';
      h += '<div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1.4px;font-weight:700;margin-bottom:9px;">📊 Key Metrics</div>';
      h += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:9px;font-size:10px;">';
      h += '<div><span style="color:var(--dim);">Win Rate</span><div style="font-weight:700;color:var(--green);font-size:13px;">'+sc.metrics.winRate+'%</div></div>';
      h += '<div><span style="color:var(--dim);">Avg Days</span><div style="font-weight:700;color:var(--gold);font-size:13px;">'+sc.metrics.avgDaysOpen+'</div></div>';
      h += '<div><span style="color:var(--dim);">CCI Avg</span><div style="font-weight:700;color:'+cciColor(sc.metrics.cciAvg)+';font-size:13px;">'+sc.metrics.cciAvg+'</div></div>';
      h += '<div><span style="color:var(--dim);">Client Sat</span><div style="font-weight:700;color:var(--pri2);font-size:13px;">'+sc.metrics.satisfaction+'%</div></div>';
      h += '<div><span style="color:var(--dim);">New Matters</span><div style="font-weight:700;color:var(--pri);font-size:13px;">'+sc.metrics.newMatters+'</div></div>';
      h += '<div><span style="color:var(--dim);">Partner Rating</span><div style="font-weight:700;color:var(--pri2);font-size:13px;">'+sc.metrics.partnerRating+'</div></div>';
      h += '</div></div>';
      
      // ADJUSTERS SATISFACTION
      if (sc.adjusterSatisfaction) {
        h += '<div style="padding:12px 16px;border-bottom:1px solid var(--line);background:var(--surf2);">';
        h += '<div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1.4px;font-weight:700;margin-bottom:6px;">😊 Adjusters Satisfaction</div>';
        h += '<div style="font-size:13px;font-weight:700;color:var(--gold);">⭐ '+sc.adjusterSatisfaction.overall.toFixed(1)+'/5</div>';
        h += '<div style="font-size:9px;color:var(--muted);margin-top:4px;">Responsiveness: '+sc.adjusterSatisfaction.responsiveness+'/5 • Communication: '+sc.adjusterSatisfaction.communication+'/5</div>';
        h += '</div>';
      }
      
      // BILLING METRICS
      if (sc.billingMetrics) {
        h += '<div style="padding:12px 16px;border-bottom:1px solid var(--line);">';
        h += '<div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1.4px;font-weight:700;margin-bottom:8px;">💰 Billing Metrics</div>';
        h += '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;font-size:10px;">';
        h += '<div><span style="color:var(--dim);">Realization</span><div style="font-weight:700;color:var(--green);">'+sc.billingMetrics.realization+'%</div></div>';
        h += '<div><span style="color:var(--dim);">Avg Rate</span><div style="font-weight:700;">$'+sc.billingMetrics.avgRate+'/hr</div></div>';
        h += '<div><span style="color:var(--dim);">Rev/Matter</span><div style="font-weight:700;">$'+sc.billingMetrics.revenuePerMatter+'</div></div>';
        h += '<div><span style="color:var(--dim);">Margin</span><div style="font-weight:700;color:var(--green);">'+sc.billingMetrics.margin+'%</div></div>';
        h += '</div></div>';
      }
      
      // CLAIMS FEEDBACK
      if (sc.claimsFeedback) {
        h += '<div style="padding:12px 16px;border-bottom:1px solid var(--line);background:'+color+'06;border-left:3px solid '+color+';margin:0;">';
        h += '<div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1.4px;font-weight:700;margin-bottom:8px;">💬 Latest Claims Feedback</div>';
        h += '<div style="font-size:10px;color:var(--ink);line-height:1.4;font-style:italic;">&quot;'+esc(sc.claimsFeedback.comment)+'&quot;</div>';
        h += '<div style="font-size:9px;color:var(--muted);margin-top:6px;">— '+esc(sc.claimsFeedback.claimsAdjuster)+' ('+sc.claimsFeedback.date+')</div>';
        h += '</div>';
      }
      
      // MENTOR NETWORK
      if (sc.mentorNetwork && (sc.mentorNetwork.mentors.length > 0 || sc.mentorNetwork.mentees.length > 0)) {
        h += '<div style="padding:12px 16px;border-bottom:1px solid var(--line);background:var(--surf2);">';
        h += '<div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1.4px;font-weight:700;margin-bottom:8px;">👥 Mentor Network</div>';
        if (sc.mentorNetwork.mentors.length > 0) {
          h += '<div style="font-size:9px;margin-bottom:6px;"><strong>Mentored by:</strong> '+sc.mentorNetwork.mentors.join(', ')+'</div>';
        }
        if (sc.mentorNetwork.mentees.length > 0) {
          h += '<div style="font-size:9px;"><strong>Mentoring:</strong> '+sc.mentorNetwork.mentees.join(', ')+'</div>';
        }
        h += '</div>';
      }
      
      h += '</div></div>'; // end scrollable + card
    });
    
    h += '</div>'; // end grid
  }
  
  // TABLE VIEW
  if (S.scoreView === 'table') {
    h += '<div class="card"><div class="sh"><span>Comprehensive Performance Table</span></div>';
    h += '<div style="overflow-x:auto;"><table><thead><tr><th>#</th><th>Attorney</th><th>LES</th><th>Grade</th><th>Win %</th><th>Avg Days</th><th>Cases</th><th>Rating</th><th>Specializations</th></tr></thead><tbody>';
    allScores.forEach((sc, idx) => {
      h += '<tr style="'+(idx < 3 ? 'background:#ECFDF5;' : '')+'">';
      h += '<td style="font-weight:700;color:var(--muted);">'+(idx+1)+'</td>';
      h += '<td style="font-weight:700;">'+esc(sc.name)+'</td>';
      h += '<td style="font-weight:700;color:'+sc.gradeColor+';">'+sc.les+'</td>';
      h += '<td><span style="background:'+sc.gradeColor+'18;color:'+sc.gradeColor+';font-weight:700;padding:2px 8px;border-radius:4px;">'+sc.grade+'</span></td>';
      h += '<td style="color:var(--green);font-weight:600;">'+sc.metrics.winRate+'%</td>';
      h += '<td>'+sc.metrics.avgDaysOpen+' days</td>';
      h += '<td>'+sc.cases+'</td>';
      h += '<td>'+sc.metrics.partnerRating+'</td>';
      h += '<td style="font-size:9px;">'+sc.specializations.map(s => s.badge).join(', ')+'</td>';
      h += '</tr>';
    });
    h += '</tbody></table></div></div>';
  }
  
  // ANALYTICS VIEW
  if (S.scoreView === 'analytics') {
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:16px;">';
    
    // Firm distribution
    h += '<div class="card"><div class="sh"><span>Performance Distribution</span></div>';
    const tiers = {
      'A+ (90+)': allScores.filter(s => s.les >= 90).length,
      'A (85-89)': allScores.filter(s => s.les >= 85 && s.les < 90).length,
      'B+ (75-84)': allScores.filter(s => s.les >= 75 && s.les < 85).length,
      'B/C (<75)': allScores.filter(s => s.les < 75).length
    };
    Object.entries(tiers).forEach(([tier, count]) => {
      const colors = {'A+ (90+)': '#047857', 'A (85-89)': '#1D4ED8', 'B+ (75-84)': '#B45309', 'B/C (<75)': '#B91C1C'};
      const pct = (count / ATTY.length) * 100;
      h += '<div style="margin-bottom:12px;"><div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span style="font-size:11px;font-weight:600;">'+tier+'</span><span style="font-size:11px;font-weight:700;color:'+colors[tier]+';">'+count+'</span></div>';
      h += '<div style="background:var(--surf3);height:8px;border-radius:4px;overflow:hidden;"><div style="width:'+pct+'%;height:100%;background:'+colors[tier]+';" title="'+pct.toFixed(0)+'%"></div></div></div>';
    });
    h += '</div>';
    
    // Risk summary
    h += '<div class="card"><div class="sh"><span>⚠️ Active Risk Alerts</span></div>';
    const allRisks = allScores.filter(s => s.risks && s.risks.length > 0);
    if (allRisks.length === 0) {
      h += '<div style="padding:16px;text-align:center;color:var(--dim);font-size:12px;">✅ No active risk alerts</div>';
    } else {
      allRisks.forEach(sc => {
        h += '<div style="padding:8px;background:var(--surf2);border-left:3px solid var(--red);border-radius:4px;margin-bottom:8px;font-size:10px;"><strong>'+esc(sc.name)+'</strong>: '+sc.risks[0].label+'</div>';
      });
    }
    h += '</div>';
    
    h += '</div>';
  }
  
  h += '</div>';
  return h;
}

// HELPER FUNCTIONS FOR V3

function detectSpecializations(cases, cciAvg, winRate, settlementRatio) {
  const specs = [];
  
  // Specialize by matter type
  const types = {};
  cases.forEach(c => {
    types[c.matterType] = (types[c.matterType] || 0) + 1;
  });
  const topType = Object.entries(types).sort((a, b) => b[1] - a[1])[0];
  if (topType && topType[1] >= 5) {
    specs.push({ badge: topType[0], value: topType[1] + ' cases' });
  }
  
  // Settlement expert
  if (settlementRatio >= 0.80) {
    specs.push({ badge: '💰 Settlement Expert', value: '80%+ rate' });
  }
  
  // Complex matter handler
  if (cciAvg >= 70) {
    specs.push({ badge: '🔥 Complex Handler', value: 'CCI ' + cciAvg });
  }
  
  return specs;
}

function detectRisks(les, closedCount, avgDays, satisfaction, activeCount) {
  const risks = [];
  
  if (les < 60) risks.push({ icon: '🚨', label: 'Critical Performance - Below 60' });
  if (les < 70 && les >= 60) risks.push({ icon: '⚠️', label: 'Performance Needs Attention' });
  if (avgDays > 200) risks.push({ icon: '⏱️', label: 'Extended Resolution Time' });
  if (satisfaction < 60) risks.push({ icon: '😟', label: 'Low Client Satisfaction' });
  if (activeCount > 15) risks.push({ icon: '📦', label: 'Heavy Workload (' + activeCount + ' active)' });
  if (closedCount === 0) risks.push({ icon: '⏳', label: 'No Closed Cases Yet' });
  
  return risks.slice(0, 3); // Show max 3
}

function calculateMatterTypes(cases) {
  const types = {};
  cases.forEach(c => {
    const type = c.matterType || 'Other';
    types[type] = (types[type] || 0) + 1;
  });
  
  const total = cases.length;
  return Object.entries(types).map(([type, count]) => ({
    type,
    count,
    pct: Math.round((count / total) * 100)
  })).sort((a, b) => b.count - a.count).slice(0, 4);
}

function calculateReserveAccuracy(closedCases) {
  if (closedCases.length === 0) return null;
  
  const accurate = closedCases.filter(c => {
    const ratio = (c.billing.totalBilled || 0) / (c.insurance.reserveAmount || 1);
    return ratio >= 0.95 && ratio <= 1.05;
  }).length;
  
  return {
    accurate,
    total: closedCases.length,
    accuracy: Math.round((accurate / closedCases.length) * 100)
  };
}

function getAdjusterPreferences(cases) {
  const adjusters = {};
  cases.forEach(c => {
    if (c.claimsAdjuster) {
      adjusters[c.claimsAdjuster] = (adjusters[c.claimsAdjuster] || 0) + 1;
    }
  });
  
  return Object.entries(adjusters)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
}

function calculateBillingMetrics(closedCases) {
  if (closedCases.length === 0) return null;
  
  const totalBilled = closedCases.reduce((s, c) => s + (c.billing.totalBilled || 0), 0);
  const totalReserved = closedCases.reduce((s, c) => s + (c.insurance.reserveAmount || 0), 0);
  
  return {
    realization: Math.round((totalBilled / totalReserved) * 100),
    avgRate: Math.round(Math.random() * 200) + 250, // Simulated
    revenuePerMatter: Math.round(totalBilled / closedCases.length),
    margin: Math.round(Math.random() * 20) + 30 // Simulated
  };
}

function getMentorNetwork(attorneyName) {
  // Simulated data - in production, query from database
  const pairs = [
    { mentor: 'Patricia Thompson', mentee: 'Marcus Richardson' },
    { mentor: 'Patricia Thompson', mentee: 'Elena Patel' },
    { mentor: 'Michael Warren', mentee: 'James Thompson' }
  ];
  
  const mentors = pairs.filter(p => p.mentee === attorneyName).map(p => p.mentor);
  const mentees = pairs.filter(p => p.mentor === attorneyName).map(p => p.mentee);
  
  return { mentors, mentees };
}

function calculateAdjusterSatisfaction(cases) {
  const feedbackItems = cases.filter(c => c.claimsFeedback).length;
  if (feedbackItems === 0) return null;
  
  return {
    overall: 4.6,
    responsiveness: 4.8,
    communication: 4.5,
    professionalism: 4.7
  };
}

function getNextMilestone(les) {
  if (les >= 90) return 'A+ (90+) - Elite Status Achieved!';
  if (les >= 85) return 'A- (80-85) - 1-3 points to A+';
  if (les >= 80) return 'A (85-89) - Target next tier';
  if (les >= 75) return 'B+ (75-84) - Improve outcomes for A';
  return 'B+ (75+) - Focus on core performance areas';
}

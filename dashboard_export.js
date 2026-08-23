/* ════════════════════════════════════════════════════
   DASHBOARD EXPORT UTILITIES
   PDF and CSV report generation for executive dashboard
   ════════════════════════════════════════════════════ */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// ════════════════════════════════════════════════════
// PDF EXPORT
// ════════════════════════════════════════════════════

class DashboardPDFExporter {
  constructor(dashboardData, options = {}) {
    this.data = dashboardData;
    this.options = {
      title: options.title || 'Executive Dashboard Report',
      period: options.period || 'Year to Date',
      generatedDate: new Date().toLocaleDateString(),
      ...options
    };
  }

  generate(outputPath) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'Letter',
          margin: 40,
          bufferPages: true
        });

        const file = fs.createWriteStream(outputPath);
        doc.pipe(file);

        this.addCoverPage(doc);
        this.addFirmSummarySection(doc);
        this.addFinancialSection(doc);
        this.addPortfolioSection(doc);
        this.addAttorneyPerformanceSection(doc);
        this.addRiskAlertsSection(doc);
        this.addFooter(doc);

        doc.end();

        file.on('finish', () => {
          resolve(outputPath);
        });

        file.on('error', reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  addCoverPage(doc) {
    // Background color
    doc.rect(0, 0, 612, 792).fill('#F3F4F6');

    // Logo/Header
    doc.fillColor('#2563EB').fontSize(36).text('CASE CLOSED PRO', { align: 'center' });
    doc.moveDown(1);

    // Title
    doc.fillColor('#1F2937').fontSize(28).text(this.options.title, { align: 'center' });
    doc.moveDown(0.5);

    // Period
    doc.fillColor('#6B7280').fontSize(14).text(this.options.period, { align: 'center' });
    doc.moveDown(3);

    // Key metrics preview
    doc.fillColor('#1F2937').fontSize(12).text('Executive Summary', { underline: true });
    doc.fontSize(10).text(`Portfolio Value: $${(this.data.firmSummary.totalValue / 1000000).toFixed(1)}M`);
    doc.text(`Revenue YTD: $${(this.data.firmSummary.revenueYTD / 1000).toFixed(0)}K`);
    doc.text(`Open Cases: ${this.data.firmSummary.openCases}`);
    doc.text(`Win Rate: ${this.data.firmSummary.winRate}%`);
    doc.moveDown(2);

    // Generated date
    doc.fillColor('#6B7280').fontSize(9).text(`Report Generated: ${this.options.generatedDate}`, {
      align: 'center'
    });

    // Page break
    doc.addPage();
  }

  addFirmSummarySection(doc) {
    this.addSectionTitle(doc, '📊 FIRM AT A GLANCE');

    const kpis = [
      { label: 'Portfolio Value', value: `$${(this.data.firmSummary.totalValue / 1000000).toFixed(1)}M` },
      { label: 'Revenue (YTD)', value: `$${(this.data.firmSummary.revenueYTD / 1000).toFixed(0)}K` },
      { label: 'Open Cases', value: this.data.firmSummary.openCases },
      { label: 'Win Rate', value: `${this.data.firmSummary.winRate}%` },
      { label: 'Reserve Accuracy', value: `${this.data.firmSummary.reserveAccuracy}%` },
      { label: 'At-Risk Matters', value: this.data.firmSummary.riskMatters }
    ];

    this.addKPITable(doc, kpis);
    doc.moveDown(1);

    // Top attorneys
    doc.fillColor('#1F2937').fontSize(12).text('Top Performers', { underline: true });
    doc.moveDown(0.3);

    this.data.topAttorneys.forEach((atty, i) => {
      doc.fontSize(9).text(
        `${i + 1}. ${atty.name} - LES: ${atty.les}/100 | Win Rate: ${atty.winRate}%`,
        { indent: 10 }
      );
    });

    doc.addPage();
  }

  addFinancialSection(doc) {
    this.addSectionTitle(doc, '💰 FINANCIAL DASHBOARD');

    const kpis = [
      { label: 'Revenue Billed', value: `$${(this.data.financial.billed / 1000).toFixed(0)}K` },
      { label: 'Realization Rate', value: `${this.data.financial.realization}%` },
      { label: 'Unbilled Time', value: `$${(this.data.financial.unbilled / 1000).toFixed(0)}K` },
      { label: 'Gross Margin', value: `${this.data.financial.margin}%` },
      { label: 'Collection Rate', value: `${this.data.financial.collectionRate}%` },
      { label: 'Days Sales Outstanding', value: `${this.data.financial.dso} days` }
    ];

    this.addKPITable(doc, kpis);
    doc.moveDown(1);

    // Revenue by attorney table
    doc.fillColor('#1F2937').fontSize(12).text('Revenue by Attorney (Top 5)', { underline: true });
    doc.moveDown(0.3);

    const headers = ['Attorney', 'Billed', 'Realized', 'Realization %'];
    const rows = this.data.financialByAttorney.slice(0, 5).map(atty => [
      atty.name,
      `$${(atty.billed / 1000).toFixed(0)}K`,
      `$${(atty.realized / 1000).toFixed(0)}K`,
      `${((atty.realized / atty.billed) * 100).toFixed(0)}%`
    ]);

    this.addTable(doc, headers, rows);
    doc.addPage();
  }

  addPortfolioSection(doc) {
    this.addSectionTitle(doc, '🎯 PORTFOLIO OVERVIEW');

    doc.fillColor('#1F2937').fontSize(12).text('Cases by Type', { underline: true });
    doc.moveDown(0.3);

    this.data.casesByType.slice(0, 8).forEach((type, i) => {
      doc.fontSize(9).text(`${type.type}: ${type.count} cases`, { indent: 10 });
    });
    doc.moveDown(1);

    doc.fillColor('#1F2937').fontSize(12).text('Case Pipeline', { underline: true });
    doc.moveDown(0.3);

    const stageHeaders = ['Stage', 'Count', 'Portfolio Value'];
    const stageRows = this.data.casesPipeline.map(stage => [
      stage.name,
      stage.count.toString(),
      `$${(stage.value / 1000).toFixed(0)}K`
    ]);

    this.addTable(doc, stageHeaders, stageRows);
    doc.moveDown(1);

    doc.fillColor('#1F2937').fontSize(12).text('Top 10 Clients', { underline: true });
    doc.moveDown(0.3);

    const clientHeaders = ['Rank', 'Client', 'Matters', 'Value'];
    const clientRows = this.data.topClients.slice(0, 10).map((client, i) => [
      (i + 1).toString(),
      client.name,
      client.matterCount.toString(),
      `$${(client.value / 1000).toFixed(0)}K`
    ]);

    this.addTable(doc, clientHeaders, clientRows);
    doc.addPage();
  }

  addAttorneyPerformanceSection(doc) {
    this.addSectionTitle(doc, '👥 ATTORNEY PERFORMANCE');

    doc.fillColor('#1F2937').fontSize(12).text('Leaderboard (LES Scores)', { underline: true });
    doc.moveDown(0.3);

    const headers = ['Rank', 'Attorney', 'Grade', 'LES', 'Cases', 'Revenue'];
    const rows = this.data.attorneyScores.slice(0, 10).map((atty, i) => [
      (i + 1).toString(),
      atty.name,
      atty.grade,
      `${atty.les}/100`,
      atty.cases.toString(),
      `$${(atty.revenue / 1000).toFixed(0)}K`
    ]);

    this.addTable(doc, headers, rows);
    doc.moveDown(1);

    doc.fillColor('#1F2937').fontSize(12).text('Win Rate Comparison', { underline: true });
    doc.moveDown(0.3);

    this.data.attorneyWinRates.slice(0, 8).forEach(atty => {
      const bar = '█'.repeat(Math.round(atty.winRate / 5));
      doc.fontSize(9).text(`${atty.name.padEnd(20)} ${bar} ${atty.winRate}%`);
    });

    doc.addPage();
  }

  addRiskAlertsSection(doc) {
    this.addSectionTitle(doc, '⚠️ RISK & ALERTS');

    doc.fillColor('#B91C1C').fontSize(12).text('Critical Alerts', { underline: true });
    doc.moveDown(0.3);

    this.data.criticalAlerts.forEach(alert => {
      doc.fontSize(8).text(`${alert.icon} [${alert.severity.toUpperCase()}]`, { indent: 10 });
      doc.fontSize(9).text(alert.title, { indent: 20, bold: true });
      doc.fontSize(8).text(alert.message, { indent: 20, width: 450 });
      doc.moveDown(0.2);
    });

    doc.moveDown(1);
    doc.fillColor('#1F2937').fontSize(12).text('High-Stakes Matters on Trial', { underline: true });
    doc.moveDown(0.3);

    this.data.highStakesMatters.forEach(matter => {
      doc.fontSize(9).text(`${matter.code}: ${matter.client} - $${(matter.value / 1000).toFixed(0)}K`, {
        indent: 10
      });
    });

    doc.moveDown(1);
    doc.fillColor('#1F2937').fontSize(12).text('Aging Matters (180+ Days)', { underline: true });
    doc.moveDown(0.3);

    this.data.agingMatters.slice(0, 5).forEach(matter => {
      doc.fontSize(9).text(`${matter.matter} - ${matter.daysOpen} days`, { indent: 10 });
    });
  }

  addFooter(doc) {
    doc.fontSize(8).fillColor('#9CA3AF').text(
      `© ${new Date().getFullYear()} Case Closed Pro | Confidential - Executive Use Only`,
      { align: 'center' }
    );
  }

  addSectionTitle(doc, title) {
    doc.fillColor('#2563EB').fontSize(14).text(title, { underline: true });
    doc.moveDown(0.5);
  }

  addKPITable(doc, kpis) {
    const kpiChunks = [];
    for (let i = 0; i < kpis.length; i += 2) {
      kpiChunks.push(kpis.slice(i, i + 2));
    }

    kpiChunks.forEach(chunk => {
      chunk.forEach(kpi => {
        doc.fontSize(9).text(`${kpi.label}:`, { bold: true, indent: 10 });
        doc.fontSize(11).text(kpi.value, { indent: 20, color: '#2563EB', bold: true });
      });
      doc.moveDown(0.3);
    });
  }

  addTable(doc, headers, rows) {
    const columnWidths = this.calculateColumnWidths(headers.length);
    const startX = doc.x;
    const startY = doc.y;

    // Headers
    doc.fillColor('#E5E7EB').rect(startX, startY, 450, 20).fill();
    doc.fillColor('#1F2937').fontSize(9);
    headers.forEach((header, i) => {
      doc.text(header, startX + 5 + columnWidths[i] * i, startY + 5, {
        width: columnWidths[i] - 10,
        align: 'left'
      });
    });

    // Rows
    let y = startY + 25;
    rows.forEach((row, rowIndex) => {
      if (y > 700) {
        doc.addPage();
        y = 40;
      }

      if (rowIndex % 2 === 0) {
        doc.fillColor('#F9FAFB').rect(startX, y - 3, 450, 18).fill();
      }

      doc.fillColor('#1F2937').fontSize(8);
      row.forEach((cell, i) => {
        doc.text(cell, startX + 5 + columnWidths[i] * i, y, {
          width: columnWidths[i] - 10,
          align: 'left'
        });
      });

      y += 20;
    });

    doc.y = y + 10;
  }

  calculateColumnWidths(columnCount) {
    const totalWidth = 450;
    return Array(columnCount).fill(totalWidth / columnCount);
  }
}

// ════════════════════════════════════════════════════
// CSV EXPORT
// ════════════════════════════════════════════════════

class DashboardCSVExporter {
  constructor(dashboardData) {
    this.data = dashboardData;
  }

  generateMattersCSV() {
    let csv = 'ID,Client,Attorney,Type,Value,Status,Days Open,Filing Date\n';

    this.data.allMatters.forEach(matter => {
      csv += `"${matter.id}","${matter.client}","${matter.attorney}","${matter.type}",${matter.value},"${matter.status}",${matter.daysOpen},\n`;
    });

    return csv;
  }

  generateFinancialCSV() {
    let csv = 'Attorney,Billed,Realized,Realization %,New Matters,LES Score\n';

    // Merge attorney data from multiple sources
    const attorneyMap = new Map();

    this.data.financialByAttorney.forEach(atty => {
      if (!attorneyMap.has(atty.name)) {
        attorneyMap.set(atty.name, {});
      }
      attorneyMap.get(atty.name).billed = atty.billed;
      attorneyMap.get(atty.name).realized = atty.realized;
    });

    this.data.attorneyScores.forEach(atty => {
      if (!attorneyMap.has(atty.name)) {
        attorneyMap.set(atty.name, {});
      }
      attorneyMap.get(atty.name).les = atty.les;
      attorneyMap.get(atty.name).cases = atty.cases;
    });

    this.data.newBusinessByAttorney.forEach(atty => {
      if (!attorneyMap.has(atty.name)) {
        attorneyMap.set(atty.name, {});
      }
      attorneyMap.get(atty.name).newMatters = atty.newMatters;
    });

    // Write rows
    attorneyMap.forEach((data, name) => {
      const billed = data.billed || 0;
      const realized = data.realized || 0;
      const realization = billed > 0 ? ((realized / billed) * 100).toFixed(0) : 0;

      csv += `"${name}",${billed},${realized},${realization}%,${data.newMatters || 0},${data.les || 'N/A'}\n`;
    });

    return csv;
  }

  generateSummaryCSV() {
    const lines = [
      ['EXECUTIVE DASHBOARD SUMMARY', this.getFormattedDate()],
      [],
      ['FIRM AT A GLANCE'],
      ['Metric', 'Value'],
      ['Portfolio Value', `$${(this.data.firmSummary.totalValue / 1000000).toFixed(1)}M`],
      ['Revenue YTD', `$${(this.data.firmSummary.revenueYTD / 1000).toFixed(0)}K`],
      ['Open Cases', this.data.firmSummary.openCases],
      ['Win Rate', `${this.data.firmSummary.winRate}%`],
      ['Reserve Accuracy', `${this.data.firmSummary.reserveAccuracy}%`],
      [],
      ['FINANCIAL METRICS'],
      ['Metric', 'Value'],
      ['Revenue Billed', `$${(this.data.financial.billed / 1000).toFixed(0)}K`],
      ['Realization Rate', `${this.data.financial.realization}%`],
      ['Gross Margin', `${this.data.financial.margin}%`],
      ['Collections', `${this.data.financial.collectionRate}%`],
      [],
      ['RISK ALERTS'],
      ['Icon', 'Severity', 'Title', 'Message']
    ];

    this.data.criticalAlerts.forEach(alert => {
      lines.push([alert.icon, alert.severity, alert.title, alert.message]);
    });

    return lines.map(line => line.map(cell => `"${cell}"`).join(',')).join('\n');
  }

  getFormattedDate() {
    const now = new Date();
    return now.toLocaleDateString() + ' ' + now.toLocaleTimeString();
  }
}

// ════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════

module.exports = {
  DashboardPDFExporter,
  DashboardCSVExporter,
  exportDashboardPDF: async (dashboardData, outputPath, options) => {
    const exporter = new DashboardPDFExporter(dashboardData, options);
    return exporter.generate(outputPath);
  },
  exportDashboardCSV: (dashboardData, type = 'matters') => {
    const exporter = new DashboardCSVExporter(dashboardData);
    if (type === 'financial') return exporter.generateFinancialCSV();
    if (type === 'summary') return exporter.generateSummaryCSV();
    return exporter.generateMattersCSV();
  }
};

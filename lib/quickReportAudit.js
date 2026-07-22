const COUNT_TOLERANCE = 1;
const PERCENT_TOLERANCE = 0.25;

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nearlyEqual(left, right, tolerance = COUNT_TOLERANCE) {
  return Math.abs(num(left) - num(right)) <= tolerance;
}

function isTotalLabel(value = "") {
  const text = String(value || "").trim();
  return !text || text === "-" || / total$/i.test(text);
}

function isSubtotalRow(row = {}) {
  return row?.__rowKind === "total";
}

function leafRows(rows = [], dimensionKey = "agent") {
  return (rows || []).filter((row) => {
    if (isSubtotalRow(row)) {
      return false;
    }
    const value = String(row?.[dimensionKey] || "").trim();
    return value && value !== "-" && !/ total$/i.test(value);
  });
}

function sumMetric(rows = [], metricKey = "") {
  return (rows || []).reduce((sum, row) => sum + num(row?.[metricKey]), 0);
}

export function auditSummaryMetrics(summary = {}, context = {}) {
  const issues = [];
  const totalLeads = num(summary.totalLeads);
  const totalFtd = num(summary.totalFtd);
  const cr = num(summary.cr);
  const crTarget = num(summary.crTarget);
  const crTargetReach = num(summary.crTargetReach);
  const ftdTarget = num(summary.ftdTarget);
  const ftdTargetReach = num(summary.ftdTargetReach);

  if (totalLeads > 0) {
    const expectedCr = (totalFtd / totalLeads) * 100;
    if (!nearlyEqual(expectedCr, cr, PERCENT_TOLERANCE)) {
      issues.push({
        code: "summary_cr_mismatch",
        severity: "error",
        message: `CR ${cr.toFixed(2)}% does not match FTD/Leads (${expectedCr.toFixed(2)}%)`,
        expected: expectedCr,
        actual: cr,
        ...context,
      });
    }
  } else if (totalFtd > 0 && cr !== 0) {
    issues.push({
      code: "summary_cr_without_leads",
      severity: "error",
      message: `CR is ${cr}% but total leads is 0`,
      ...context,
    });
  }

  if (ftdTarget > 0) {
    const expectedReach = (totalFtd / ftdTarget) * 100;
    if (!nearlyEqual(expectedReach, ftdTargetReach, PERCENT_TOLERANCE)) {
      issues.push({
        code: "summary_ftd_target_reach_mismatch",
        severity: "error",
        message: `FTD Target Reach ${ftdTargetReach.toFixed(2)}% expected ${expectedReach.toFixed(2)}%`,
        expected: expectedReach,
        actual: ftdTargetReach,
        ...context,
      });
    }
  }

  if (crTarget > 0) {
    const expectedReach = (cr / crTarget) * 100;
    if (!nearlyEqual(expectedReach, crTargetReach, PERCENT_TOLERANCE)) {
      issues.push({
        code: "summary_cr_target_reach_mismatch",
        severity: "error",
        message: `CR Target Reach ${crTargetReach.toFixed(2)}% expected ${expectedReach.toFixed(2)}%`,
        expected: expectedReach,
        actual: crTargetReach,
        ...context,
      });
    }
  }

  for (const [key, value] of Object.entries(summary || {})) {
    if (num(value) < 0) {
      issues.push({
        code: "summary_negative_metric",
        severity: "error",
        message: `${key} is negative (${value})`,
        metric: key,
        value,
        ...context,
      });
    }
  }

  if (totalLeads === 0 && totalFtd === 0 && num(summary.kycFtd) === 0) {
    issues.push({
      code: "summary_all_zero",
      severity: "warn",
      message: "Summary metrics are all zero",
      ...context,
    });
  }

  return issues;
}

export function auditBuilderTable(report = {}, context = {}) {
  const issues = [];
  if (report?.tableType !== "builder") {
    return issues;
  }
  const rows = Array.isArray(report?.table) ? report.table : [];
  const summary = report?.summary || {};
  const selectedDimensions = Array.isArray(report?.builder?.selectedDimensions)
    ? report.builder.selectedDimensions.map((item) => item.key || item)
    : [];
  const leafDimension = selectedDimensions[selectedDimensions.length - 1] || "agent";
  const leaves = leafRows(rows, leafDimension);
  const metricMap = {
    leads: "totalLeads",
    ftd: "totalFtd",
    kycFtd: "kycFtd",
    selfs: "selfs",
    lateFtd: "lateFtd",
  };

  for (const [rowMetric, summaryKey] of Object.entries(metricMap)) {
    if (!rows.some((row) => Object.prototype.hasOwnProperty.call(row, rowMetric))) {
      continue;
    }
    const leafSum = sumMetric(leaves, rowMetric);
    const summaryValue = num(summary[summaryKey]);
    if (!nearlyEqual(leafSum, summaryValue, COUNT_TOLERANCE)) {
      issues.push({
        code: "builder_leaf_sum_mismatch",
        severity: "error",
        message: `${rowMetric} leaf sum ${leafSum} != summary ${summaryValue}`,
        metric: rowMetric,
        leafSum,
        summaryValue,
        leafCount: leaves.length,
        ...context,
      });
    }
  }

  for (const dimension of ["desk", "teamLeader", "agent"]) {
    const groups = new Map();
    for (const row of rows) {
      const label = String(row?.[dimension] || "").trim();
      if (!label || label === "-") {
        continue;
      }
      const baseLabel = label.replace(/ total$/i, "");
      const isTotal = / total$/i.test(label) || isSubtotalRow(row);
      if (!groups.has(baseLabel)) {
        groups.set(baseLabel, { leaves: [], totalRow: null });
      }
      const bucket = groups.get(baseLabel);
      if (isTotal) {
        bucket.totalRow = row;
      } else if (!isSubtotalRow(row)) {
        bucket.leaves.push(row);
      }
    }
    for (const [label, bucket] of groups.entries()) {
      if (!bucket.totalRow || !bucket.leaves.length) {
        continue;
      }
      for (const metric of ["leads", "ftd", "kycFtd"]) {
        if (!Object.prototype.hasOwnProperty.call(bucket.totalRow, metric)) {
          continue;
        }
        const leafSum = sumMetric(bucket.leaves, metric);
        const totalValue = num(bucket.totalRow[metric]);
        if (!nearlyEqual(leafSum, totalValue, COUNT_TOLERANCE)) {
          issues.push({
            code: "builder_subtotal_mismatch",
            severity: "error",
            message: `${dimension} "${label}" ${metric} subtotal ${totalValue} != leaf sum ${leafSum}`,
            dimension,
            label,
            metric,
            leafSum,
            totalValue,
            ...context,
          });
        }
      }
    }
  }

  if (rows.some((row) => Object.prototype.hasOwnProperty.call(row, "leadShare"))) {
    const topLevelRows = rows.filter((row) => {
      if (isSubtotalRow(row)) {
        return false;
      }
      return selectedDimensions.every((dimension, index) => {
        if (index === 0) {
          return !isTotalLabel(row?.[dimension]);
        }
        return isTotalLabel(row?.[dimension]);
      });
    });
    const shareSum = topLevelRows.reduce((sum, row) => sum + num(row.leadShare), 0);
    if (topLevelRows.length > 0 && shareSum > 0 && !nearlyEqual(shareSum, 100, 1.5)) {
      issues.push({
        code: "lead_share_not_100",
        severity: "warn",
        message: `Top-level leadShare sums to ${shareSum.toFixed(2)}% (expected ~100%)`,
        shareSum,
        rowCount: topLevelRows.length,
        ...context,
      });
    }
  }

  return issues;
}

export function auditLast4Matrix(report = {}, context = {}) {
  const issues = [];
  if (report?.tableType !== "last4_matrix") {
    return issues;
  }
  const rows = Array.isArray(report?.table) ? report.table : [];
  const months = Array.isArray(report?.monthBlocks) ? report.monthBlocks : [];
  for (const month of months) {
    const monthKey = String(month?.key || month?.monthKey || "").trim();
    if (!monthKey) {
      continue;
    }
    const leafSum = rows
      .filter((row) => !isSubtotalRow(row) && !isTotalLabel(row?.agent))
      .reduce((sum, row) => sum + num(row?.[`ftd_${monthKey}`] ?? row?.[monthKey] ?? row?.[`month_${monthKey}`]), 0);
    const blockTotal = num(month?.totals?.ftd ?? month?.ftd);
    if (blockTotal > 0 && leafSum > 0 && !nearlyEqual(leafSum, blockTotal, COUNT_TOLERANCE)) {
      issues.push({
        code: "last4_month_ftd_mismatch",
        severity: "warn",
        message: `Last4 ${monthKey} FTD block ${blockTotal} != leaf sum ${leafSum}`,
        monthKey,
        leafSum,
        blockTotal,
        ...context,
      });
    }
  }
  return issues;
}

export function auditReportResult(report = {}, context = {}) {
  const issues = [
    ...auditSummaryMetrics(report?.summary || {}, context),
    ...auditBuilderTable(report, context),
    ...auditLast4Matrix(report, context),
  ];
  if (!report?.tableType) {
    issues.push({
      code: "missing_table_type",
      severity: "error",
      message: "Report returned without tableType",
      ...context,
    });
  }
  if (Array.isArray(report?.table) && report.table.length === 0 && num(report?.summary?.totalLeads) > 0) {
    issues.push({
      code: "empty_table_nonzero_summary",
      severity: "warn",
      message: "Summary has leads but table is empty",
      ...context,
    });
  }
  return issues;
}

export function summarizeAuditResults(runs = []) {
  const allIssues = runs.flatMap((run) =>
    (run.issues || []).map((issue) => ({
      ...issue,
      office: run.office,
      preset: run.preset,
      monthKey: run.monthKey,
    })),
  );
  const errors = allIssues.filter((item) => item.severity === "error");
  const warnings = allIssues.filter((item) => item.severity === "warn");
  const byCode = new Map();
  for (const issue of allIssues) {
    const bucket = byCode.get(issue.code) || [];
    bucket.push(issue);
    byCode.set(issue.code, bucket);
  }
  return {
    runCount: runs.length,
    issueCount: allIssues.length,
    errorCount: errors.length,
    warningCount: warnings.length,
    ok: errors.length === 0,
    byCode: Object.fromEntries([...byCode.entries()].map(([code, items]) => [code, items.length])),
    issues: allIssues,
    runs: runs.map((run) => ({
      office: run.office,
      preset: run.preset,
      monthKey: run.monthKey,
      elapsedMs: run.elapsedMs,
      tableType: run.tableType,
      summary: run.summary,
      issueCount: run.issues?.length || 0,
      error: run.error || null,
    })),
  };
}

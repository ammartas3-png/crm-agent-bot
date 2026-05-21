import { ALLOWED_STATUSES } from "./ruleSheetService.js";

const SHORT_FORM_REPLACEMENTS = [
  [/\btmrw\b|\btmw\b|\b2moro\b/gi, "tomorrow"],
  [/\bcx\b/gi, "customer"],
  [/\bpu\b/gi, "picked up"],
  [/\bhu\b/gi, "hung up"],
  [/\bvm\b|\bv1\b|\bv2\b|\bv3\b/gi, "voicemail"],
];

const SYSTEM_COMMENT_PATTERNS = [/^email/i, /^\s*incoming\s+email/i, /\bwas sent by\b/i];
const COMMENT_PREFIX_PATTERN =
  /^\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*\|\s*[^|]*\s*\|\s*(.*)$/i;
const APPOINTMENT_PATTERNS = [
  /\btomorrow\b/i,
  /\btoday\b/i,
  /\blater\b/i,
  /\bcall later\b/i,
  /\bcall back\b/i,
  /\bafter work\b/i,
  /\bnext week\b/i,
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b\d{1,2}:\d{2}\b/i,
  /\b\d{1,2}\s?(am|pm)\b/i,
];

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("en-US");
}

function canonicalStatus(value) {
  const normalized = normalizeKey(value);
  const match = ALLOWED_STATUSES.find((status) => normalizeKey(status) === normalized);
  return match || "";
}

function pickColumn(row, columnNames = []) {
  const normalizedMap = new Map(
    Object.keys(row).map((key) => [normalizeKey(key), key]),
  );
  for (const candidate of columnNames) {
    const found = normalizedMap.get(normalizeKey(candidate));
    if (found) {
      return row[found];
    }
  }
  return "";
}

function normalizeCommentText(value) {
  let text = String(value || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");

  for (const [pattern, replacement] of SHORT_FORM_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }

  text = text
    .replace(/[^\w\s:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

function parseCommentTimestamp(datePart, timePart) {
  const dateText = String(datePart || "").trim();
  const timeText = String(timePart || "").trim();
  if (!dateText || !timeText) {
    return null;
  }
  const [hourRaw, minuteRaw, secondRaw] = timeText.split(":");
  if (!hourRaw || !minuteRaw) {
    return null;
  }
  const safeTime = `${hourRaw.padStart(2, "0")}:${minuteRaw.padStart(2, "0")}:${(
    secondRaw || "00"
  ).padStart(2, "0")}`;
  const timestamp = Date.parse(`${dateText}T${safeTime}`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parseComments(rawComments) {
  const lines = String(rawComments || "")
    .split(/\r?\n+/)
    .map((line) => line.trimEnd());
  const rawItems = [];
  let currentItem = null;
  let sequence = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const prefixMatch = trimmed.match(COMMENT_PREFIX_PATTERN);
    if (prefixMatch) {
      if (currentItem) {
        rawItems.push(currentItem);
      }
      currentItem = {
        raw: trimmed,
        text: prefixMatch[3].trim(),
        timestamp: parseCommentTimestamp(prefixMatch[1], prefixMatch[2]),
        sequence: sequence++,
      };
      continue;
    }

    if (!currentItem) {
      currentItem = {
        raw: trimmed,
        text: trimmed,
        timestamp: null,
        sequence: sequence++,
      };
      continue;
    }

    currentItem = {
      raw: `${currentItem.raw}\n${trimmed}`,
      text: `${currentItem.text} ${trimmed}`.trim(),
      timestamp: currentItem.timestamp,
      sequence: currentItem.sequence,
    };
  }

  if (currentItem) {
    rawItems.push(currentItem);
  }

  const comments = [];
  for (const item of rawItems) {
    const content = String(item.text || "").trim();
    if (!content) {
      continue;
    }
    if (SYSTEM_COMMENT_PATTERNS.some((pattern) => pattern.test(content))) {
      continue;
    }
    const normalized = normalizeCommentText(content);
    if (!normalized) {
      continue;
    }
    comments.push({
      raw: item.raw,
      text: content,
      normalized,
      timestamp: item.timestamp,
      sequence: item.sequence,
    });
  }
  return comments.sort((left, right) => {
    if (
      Number.isFinite(left.timestamp) &&
      Number.isFinite(right.timestamp) &&
      left.timestamp !== right.timestamp
    ) {
      return left.timestamp - right.timestamp;
    }
    return left.sequence - right.sequence;
  });
}

function findKeywordMatches(comments, keywords = []) {
  const matched = new Set();
  for (const keyword of keywords) {
    const normalizedKeyword = normalizeCommentText(keyword);
    if (!normalizedKeyword) {
      continue;
    }
    const keywordTokens = normalizedKeyword.split(/\s+/).filter(Boolean);
    const keywordMatched = comments.some((comment) => {
      if (comment.normalized.includes(normalizedKeyword)) {
        return true;
      }
      if (!keywordTokens.length) {
        return false;
      }
      const commentTokens = comment.normalized.split(/\s+/).filter(Boolean);
      return keywordTokens.every((keywordToken) =>
        commentTokens.some(
          (commentToken) =>
            commentToken === keywordToken ||
            commentToken.startsWith(keywordToken) ||
            keywordToken.startsWith(commentToken),
        ),
      );
    });
    if (keywordMatched) {
      matched.add(normalizedKeyword);
    }
  }
  return [...matched];
}

function resolveExpectedStatus(comments, rules = []) {
  const scopedComments = comments.length ? [comments[comments.length - 1]] : [];
  const matches = [];
  for (const rule of rules) {
    const positiveMatches = findKeywordMatches(scopedComments, rule.positiveKeywords);
    if (!positiveMatches.length) {
      continue;
    }
    const negativeMatches = findKeywordMatches(scopedComments, rule.negativeKeywords);
    if (negativeMatches.length) {
      continue;
    }
    matches.push({
      status: rule.status,
      positiveMatches,
      negativeMatches,
      priority: rule.priority,
    });
  }

  if (!matches.length) {
    return {
      expectedStatus: "",
      reviewType: "Manual Check",
      reason: "No keyword rule matched.",
      matchedPositiveKeywords: [],
      matchedNegativeKeywords: [],
      confidence: "low",
    };
  }

  if (matches.length === 1) {
    return {
      expectedStatus: matches[0].status,
      reviewType: "Status Change Suggested",
      reason: `Matched rule for ${matches[0].status}.`,
      matchedPositiveKeywords: matches[0].positiveMatches,
      matchedNegativeKeywords: [],
      confidence: "high",
    };
  }

  const withPriority = matches.filter((match) => Number.isFinite(match.priority));
  if (withPriority.length === matches.length) {
    const sorted = [...withPriority].sort((left, right) => left.priority - right.priority);
    if (sorted[0].priority < sorted[1].priority) {
      return {
        expectedStatus: sorted[0].status,
        reviewType: "Status Change Suggested",
        reason: `Multiple statuses matched. Selected by priority (${sorted[0].priority}).`,
        matchedPositiveKeywords: sorted.flatMap((match) => match.positiveMatches),
        matchedNegativeKeywords: [],
        confidence: "high",
      };
    }
  }

  return {
    expectedStatus: "",
    reviewType: "Conflict / Multiple Matches",
    reason: "Multiple statuses matched and could not resolve confidently.",
    matchedPositiveKeywords: matches.flatMap((match) => match.positiveMatches),
    matchedNegativeKeywords: [],
    confidence: "low",
  };
}

function detectAppointment(comments = []) {
  const scopedComments = comments.length ? [comments[comments.length - 1]] : [];
  const joinedText = scopedComments.map((comment) => comment.text).join(" | ");
  const normalizedJoined = scopedComments.map((comment) => comment.normalized).join(" ");
  const matchedPattern = APPOINTMENT_PATTERNS.find((pattern) => pattern.test(normalizedJoined));
  if (!matchedPattern) {
    return {
      detected: false,
      extracted: "",
    };
  }

  const extracted = (() => {
    const result = joinedText.match(matchedPattern);
    return result?.[0] || "Signal detected";
  })();
  return {
    detected: true,
    extracted,
  };
}

function callCheckResult(row) {
  const attempts = Number(
    pickColumn(row, [
      "Voip Calls Attempts Cnt",
      "Voip Calls Attempts In 1st Day After Regs Cnt",
      "Voip Calls Attempts In 2nd Day After Regs Cnt",
      "Voip Calls Attempts In 3rd Day After Regs Cnt",
      "Voip Calls Attempts In 4th Day After Regs Cnt",
      "Voip Calls Attempts In 5th Day After Regs Cnt",
    ]),
  );
  const duration = Number(
    pickColumn(row, [
      "Voip Calls Duration in Seconds",
      "Voip Calls Duration In 1st Day After Regs in Seconds",
      "Voip Calls Duration In 2nd Day After Regs in Seconds",
      "Voip Calls Duration In 3rd Day After Regs in Seconds",
      "Voip Calls Duration In 4th Day After Regs in Seconds",
      "Voip Calls Duration In 5th Day After Regs in Seconds",
    ]),
  );

  if (Number.isFinite(attempts) && Number.isFinite(duration)) {
    if (attempts > 0 || duration > 0) {
      return "Call activity observed";
    }
    return "No call activity observed";
  }
  return "Needs Manual Call Check";
}

function normalizeReviewType(reviewType, expectedStatus, currentStatus, appointmentDetected, appointmentStatusOkay) {
  if (reviewType === "Conflict / Multiple Matches") {
    return reviewType;
  }
  if (appointmentDetected && !appointmentStatusOkay) {
    return "Appointment Check";
  }
  if (!expectedStatus) {
    return "Manual Check";
  }
  if (expectedStatus !== currentStatus) {
    return "Status Change Suggested";
  }
  return "";
}

function buildReviewRow(row, validation) {
  return {
    Brand: pickColumn(row, ["Brand"]),
    "Account No": pickColumn(row, ["Account No"]),
    "Client Name": pickColumn(row, ["Client Name"]),
    Country: pickColumn(row, ["Country"]),
    Campaign: pickColumn(row, ["Campaign"]),
    "Sub-Campaign": pickColumn(row, ["Sub-Campaign"]),
    "Current Assigned Agent": pickColumn(row, ["Current Assigned Agent"]),
    "Current Agent Office": pickColumn(row, ["Current Agent Office"]),
    "Current Agent Desk": pickColumn(row, ["Current Agent Desk"]),
    "Customer Status": validation.currentStatus || pickColumn(row, ["Customer Status"]),
    "Suggested Status": validation.suggestedStatus || "Manual Check",
    "Review Type": validation.reviewType,
    Reason: validation.reason,
    "Matched Positive Keywords": validation.matchedPositiveKeywords.join(", "),
    "Matched Negative Keywords": validation.matchedNegativeKeywords.join(", "),
    "Appointment Detected": validation.appointmentDetected ? "YES" : "NO",
    "Appointment Date/Time Extracted": validation.appointmentExtracted,
    "Call Check Result": validation.callCheckResult,
    "Last Relevant Comment": validation.lastRelevantComment,
    "Full Last 10 Comments": pickColumn(row, ["Last 10 Comments"]),
  };
}

function validateRow(row, activeRules) {
  const currentStatus = canonicalStatus(pickColumn(row, ["Customer Status"]));
  const comments = parseComments(pickColumn(row, ["Last 10 Comments"]));
  if (!comments.length) {
    return { include: false };
  }

  const statusResult = resolveExpectedStatus(comments, activeRules);
  const appointment = detectAppointment(comments);
  const callResult = appointment.detected ? callCheckResult(row) : "-";

  let suggestedStatus = statusResult.expectedStatus;
  if (!suggestedStatus && appointment.detected) {
    suggestedStatus = "Call Again";
  }

  const appointmentStatusOkay = appointment.detected
    ? ["Call Again", suggestedStatus].filter(Boolean).some((status) => status === currentStatus)
    : true;

  const reviewType = normalizeReviewType(
    statusResult.reviewType,
    suggestedStatus,
    currentStatus,
    appointment.detected,
    appointmentStatusOkay,
  );

  const include =
    reviewType === "Status Change Suggested" ||
    reviewType === "Manual Check" ||
    reviewType === "Appointment Check" ||
    reviewType === "Conflict / Multiple Matches" ||
    (appointment.detected && callResult === "Needs Manual Call Check");

  if (!include) {
    return { include: false };
  }

  return {
    include: true,
    currentStatus: currentStatus || pickColumn(row, ["Customer Status"]),
    suggestedStatus,
    reviewType: reviewType || "Manual Check",
    reason:
      reviewType === "Appointment Check"
        ? "Appointment/callback signal found; status/follow-up requires review."
        : statusResult.reason,
    matchedPositiveKeywords: statusResult.matchedPositiveKeywords,
    matchedNegativeKeywords: statusResult.matchedNegativeKeywords,
    appointmentDetected: appointment.detected,
    appointmentExtracted: appointment.extracted,
    callCheckResult: callResult,
    lastRelevantComment: comments[comments.length - 1]?.text || "",
  };
}

export function validateCommentStatusRows(rows = [], activeRules = []) {
  const flaggedRows = [];
  let skippedCorrect = 0;
  let statusChanges = 0;
  let manualChecks = 0;
  let appointmentChecks = 0;

  for (const row of rows) {
    const result = validateRow(row, activeRules);
    if (!result.include) {
      skippedCorrect += 1;
      continue;
    }
    const reviewRow = buildReviewRow(row, result);
    flaggedRows.push(reviewRow);
    if (result.reviewType === "Status Change Suggested") {
      statusChanges += 1;
    } else if (result.reviewType === "Appointment Check") {
      appointmentChecks += 1;
    } else {
      manualChecks += 1;
    }
  }

  return {
    flaggedRows,
    summary: {
      totalRows: rows.length,
      skippedCorrect,
      statusChanges,
      manualChecks,
      appointmentChecks,
    },
  };
}

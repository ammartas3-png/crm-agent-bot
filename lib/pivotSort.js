function parseMaybeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function comparePivotValues(leftValue, rightValue, columnType = "text") {
  const leftNumber = parseMaybeNumber(leftValue);
  const rightNumber = parseMaybeNumber(rightValue);
  if (columnType === "number" || columnType === "percent") {
    const leftSafe = leftNumber ?? 0;
    const rightSafe = rightNumber ?? 0;
    if (leftSafe === rightSafe) {
      return 0;
    }
    return leftSafe > rightSafe ? 1 : -1;
  }
  if (leftNumber !== null && rightNumber !== null) {
    if (leftNumber === rightNumber) {
      return 0;
    }
    return leftNumber > rightNumber ? 1 : -1;
  }
  const leftText = String(leftValue || "");
  const rightText = String(rightValue || "");
  return leftText.localeCompare(rightText, "en", { sensitivity: "base" });
}

function normalizeGroupLabel(value) {
  return String(value || "-").trim() || "-";
}

function aggregateGroupValue(rows = [], activeColumnKey = "", activeColumnType = "text") {
  if (!rows.length || !activeColumnKey) {
    return 0;
  }
  if (activeColumnType === "percent") {
    const values = rows
      .map((row) => parseMaybeNumber(row?.[activeColumnKey]))
      .filter((value) => value !== null);
    if (!values.length) {
      return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  if (activeColumnType === "number") {
    return rows.reduce((sum, row) => sum + Number(row?.[activeColumnKey] || 0), 0);
  }
  const values = rows.map((row) => row?.[activeColumnKey]);
  return values.find((value) => String(value || "").trim()) ?? values[0] ?? "";
}

function sortRowsFlat(rows = [], activeColumnKey = "", activeColumnType = "text", direction = "desc") {
  return [...rows].sort((left, right) => {
    const compare = comparePivotValues(left?.[activeColumnKey], right?.[activeColumnKey], activeColumnType);
    return direction === "desc" ? -compare : compare;
  });
}

export function sortBuilderRows(rows = [], options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const hierarchyKeys = Array.isArray(options.hierarchyKeys)
    ? options.hierarchyKeys.map((key) => String(key || "").trim()).filter(Boolean)
    : [];
  const activeColumnKey = String(options.activeColumnKey || "").trim();
  const activeColumnType = String(options.activeColumnType || "text").trim() || "text";
  const direction = options.direction === "asc" ? "asc" : "desc";
  const groupValueResolver =
    typeof options.groupValueResolver === "function"
      ? options.groupValueResolver
      : (groupRows) => aggregateGroupValue(groupRows, activeColumnKey, activeColumnType);

  if (!activeColumnKey) {
    return [...list];
  }
  if (!hierarchyKeys.length) {
    return sortRowsFlat(list, activeColumnKey, activeColumnType, direction);
  }

  const orderHierarchical = (inputRows = [], depth = 0) => {
    const dimensionKey = hierarchyKeys[depth];
    if (!dimensionKey) {
      return sortRowsFlat(inputRows, activeColumnKey, activeColumnType, direction);
    }
    const grouped = new Map();
    for (const row of inputRows) {
      const label = normalizeGroupLabel(row?.[dimensionKey]);
      if (!grouped.has(label)) {
        grouped.set(label, { rows: [], firstIndex: grouped.size });
      }
      grouped.get(label).rows.push(row);
    }
    const sortedGroups = [...grouped.entries()].sort((leftEntry, rightEntry) => {
      const [leftLabel, leftBucket] = leftEntry;
      const [rightLabel, rightBucket] = rightEntry;
      let leftSortValue;
      let rightSortValue;
      if (activeColumnKey === dimensionKey) {
        leftSortValue = leftLabel;
        rightSortValue = rightLabel;
      } else {
        leftSortValue = groupValueResolver(leftBucket.rows, dimensionKey, depth, leftLabel);
        rightSortValue = groupValueResolver(rightBucket.rows, dimensionKey, depth, rightLabel);
      }
      const compare = comparePivotValues(leftSortValue, rightSortValue, activeColumnType);
      if (compare !== 0) {
        return direction === "desc" ? -compare : compare;
      }
      const labelCompare = leftLabel.localeCompare(rightLabel, "en", { sensitivity: "base" });
      if (labelCompare !== 0) {
        return labelCompare;
      }
      return leftBucket.firstIndex - rightBucket.firstIndex;
    });

    const ordered = [];
    for (const [, bucket] of sortedGroups) {
      if (depth >= hierarchyKeys.length - 1) {
        ordered.push(...sortRowsFlat(bucket.rows, activeColumnKey, activeColumnType, direction));
      } else {
        ordered.push(...orderHierarchical(bucket.rows, depth + 1));
      }
    }
    return ordered;
  };

  return orderHierarchical(list, 0);
}

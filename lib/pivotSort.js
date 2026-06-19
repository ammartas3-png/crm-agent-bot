// Hierarchical (Looker Studio style) sorting for the dashboard builder table.
//
// The builder "Results Table" renders a flat array of rows whose hierarchy
// (e.g. Desk -> Team Leader -> Agent) is implied by the order of the rows and
// their dimension column values. The renderer detects group boundaries by
// comparing adjacent rows, so rows that belong to the same group MUST stay
// contiguous. A naive flat sort of every visible row by a metric column breaks
// that contiguity and makes groups appear duplicated / mixed.
//
// `sortBuilderRows` instead sorts the tree level by level:
//   - top-level groups are ordered against each other,
//   - within each group its children are ordered only against their siblings,
//   - leaf rows are ordered only within their parent.
// This keeps every group contiguous, preserves the expand/collapse hierarchy,
// keeps subtotal rows attached to their group, and is deterministic/stable.
//
// This module is intentionally pure (no React / DOM / network) so it can be
// unit tested in isolation. It does not change any metric values; it only
// reorders the rows produced by the backend.

export function compareBuilderValues(left, right, type) {
  if (type === "number" || type === "percent") {
    return Number(left || 0) - Number(right || 0);
  }
  return String(left || "").localeCompare(String(right || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function sortBuilderRows(table, options = {}) {
  const {
    activeColumn,
    direction = "asc",
    selectedDimensions = [],
    selectedTotalDimensions = [],
  } = options;

  const rows = Array.isArray(table) ? [...table] : [];
  if (!activeColumn) {
    return rows;
  }

  const dimensions = Array.isArray(selectedDimensions) ? selectedDimensions : [];
  const totalDimensions = Array.isArray(selectedTotalDimensions) ? selectedTotalDimensions : [];

  const applyDirection = (compare) => (direction === "desc" ? -compare : compare);

  // No real hierarchy (0 or 1 dimension): a flat sort cannot break nesting, so
  // sort every row together by the active column.
  if (dimensions.length <= 1) {
    rows.sort((left, right) =>
      applyDirection(
        compareBuilderValues(left[activeColumn.key], right[activeColumn.key], activeColumn.type),
      ),
    );
    return rows;
  }

  const detailRows = rows.filter((row) => row.__rowKind !== "total");
  const totalRows = rows.filter((row) => row.__rowKind === "total");
  const dimensionDepth = new Map(dimensions.map((key, index) => [key, index]));
  const totalDimensionSet = new Set(totalDimensions);
  const normalizePiece = (value) => String(value || "-").trim().toLowerCase();
  const prefixKey = (pieces = []) => pieces.map(normalizePiece).join("::");

  // Index any subtotal rows the backend emitted so groups can be ordered by
  // their subtotal value and the subtotal can be re-attached to its group.
  const subtotalMap = new Map();
  for (const row of totalRows) {
    const dimensionKey = row.__totalDimension;
    const depth = dimensionDepth.get(dimensionKey);
    if (!dimensionKey || depth === undefined) {
      continue;
    }
    const pieces = [];
    for (let index = 0; index < depth; index += 1) {
      pieces.push(String(row[dimensions[index]] || "-").trim() || "-");
    }
    const ownValue = String(row[dimensionKey] || "")
      .replace(/\s+total$/i, "")
      .trim();
    pieces.push(ownValue || "-");
    subtotalMap.set(`${dimensionKey}::${prefixKey(pieces)}`, row);
  }

  const aggregateMetric = (groupRows = []) => {
    if (activeColumn.type === "percent") {
      if (!groupRows.length) {
        return 0;
      }
      const total = groupRows.reduce((sum, row) => sum + Number(row[activeColumn.key] || 0), 0);
      return total / groupRows.length;
    }
    return groupRows.reduce((sum, row) => sum + Number(row[activeColumn.key] || 0), 0);
  };

  const sortRowsFlat = (groupRows = []) =>
    [...groupRows].sort((left, right) =>
      applyDirection(
        compareBuilderValues(left[activeColumn.key], right[activeColumn.key], activeColumn.type),
      ),
    );

  const sortGroups = (entries = [], dimensionKey, prefixPieces = []) =>
    [...entries].sort((leftEntry, rightEntry) => {
      const [leftValue, leftRows] = leftEntry;
      const [rightValue, rightRows] = rightEntry;
      const leftPrefix = [...prefixPieces, leftValue];
      const rightPrefix = [...prefixPieces, rightValue];
      const leftSubtotal = subtotalMap.get(`${dimensionKey}::${prefixKey(leftPrefix)}`);
      const rightSubtotal = subtotalMap.get(`${dimensionKey}::${prefixKey(rightPrefix)}`);

      let leftSortValue;
      let rightSortValue;
      if (activeColumn.kind === "metric" || activeColumn.type === "number" || activeColumn.type === "percent") {
        // Order groups by their subtotal when available, otherwise by the
        // aggregate of their descendant rows.
        leftSortValue = leftSubtotal ? leftSubtotal[activeColumn.key] : aggregateMetric(leftRows);
        rightSortValue = rightSubtotal ? rightSubtotal[activeColumn.key] : aggregateMetric(rightRows);
      } else if (activeColumn.key === dimensionKey) {
        leftSortValue = leftValue;
        rightSortValue = rightValue;
      } else {
        leftSortValue = leftRows[0]?.[activeColumn.key];
        rightSortValue = rightRows[0]?.[activeColumn.key];
      }
      return applyDirection(compareBuilderValues(leftSortValue, rightSortValue, activeColumn.type));
    });

  const orderHierarchical = (inputRows = [], depth = 0, prefixPieces = []) => {
    const dimensionKey = dimensions[depth];
    if (!dimensionKey) {
      return sortRowsFlat(inputRows);
    }

    const grouped = new Map();
    for (const row of inputRows) {
      const groupValue = String(row[dimensionKey] || "-").trim() || "-";
      if (!grouped.has(groupValue)) {
        grouped.set(groupValue, []);
      }
      grouped.get(groupValue).push(row);
    }

    const sortedGroups = sortGroups([...grouped.entries()], dimensionKey, prefixPieces);
    const ordered = [];
    for (const [groupValue, groupRows] of sortedGroups) {
      const nextPrefix = [...prefixPieces, groupValue];
      if (totalDimensionSet.has(dimensionKey)) {
        const subtotalRow = subtotalMap.get(`${dimensionKey}::${prefixKey(nextPrefix)}`);
        if (subtotalRow) {
          ordered.push(subtotalRow);
        }
      }
      if (depth >= dimensions.length - 1) {
        ordered.push(...sortRowsFlat(groupRows));
      } else {
        ordered.push(...orderHierarchical(groupRows, depth + 1, nextPrefix));
      }
    }
    return ordered;
  };

  return orderHierarchical(detailRows, 0, []);
}

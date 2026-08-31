// Lightweight, dependency-free inline-SVG/CSS visualization components.
// Pure presentational (no hooks, no state) so they can be dropped into the
// existing dashboard tables/cards without changing data flow or adding a chart
// library. All components degrade gracefully on empty/invalid input.

function toNumbers(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .map((value) => (Number.isFinite(value) ? value : 0));
}

// Tiny inline trend line for table rows / KPI cards.
export function Sparkline({ values = [], width = 80, height = 22, color = "#2563eb", strokeWidth = 1.5 }) {
  const nums = toNumbers(values);
  if (nums.length < 2) {
    return null;
  }
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const stepX = width / (nums.length - 1);
  const points = nums
    .map((value, index) => {
      const x = index * stepX;
      const y = height - ((value - min) / span) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const lastX = (nums.length - 1) * stepX;
  const lastY = height - ((nums[nums.length - 1] - min) / span) * (height - 2) - 1;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-hidden="true" style={{ display: "block" }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={2} fill={color} />
    </svg>
  );
}

// In-cell horizontal data bar drawn behind/with a value (proportional to max).
export function DataBar({ value = 0, max = 0, color = "#bfdbfe", height = 14 }) {
  const v = Number(value) || 0;
  const m = Number(max) || 0;
  const pct = m > 0 ? Math.max(0, Math.min(100, (v / m) * 100)) : 0;
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        left: 0,
        top: "50%",
        transform: "translateY(-50%)",
        height: `${height}px`,
        width: `${pct}%`,
        background: color,
        borderRadius: 3,
        opacity: 0.55,
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}

// Multi-series line/area trend chart with light gridlines and axis labels.
export function TrendChart({
  series = [],
  xLabels = [],
  width = 560,
  height = 200,
  padding = { top: 12, right: 12, bottom: 22, left: 36 },
}) {
  const cleanSeries = (Array.isArray(series) ? series : [])
    .map((entry) => ({ ...entry, values: toNumbers(entry?.values) }))
    .filter((entry) => entry.values.length >= 2);
  if (cleanSeries.length === 0) {
    return null;
  }
  const length = Math.max(...cleanSeries.map((entry) => entry.values.length));
  const allValues = cleanSeries.flatMap((entry) => entry.values);
  const max = Math.max(...allValues, 1);
  const min = Math.min(...allValues, 0);
  const span = max - min || 1;
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const stepX = innerW / (length - 1);
  const x = (i) => padding.left + i * stepX;
  const y = (v) => padding.top + innerH - ((v - min) / span) * innerH;
  const gridYs = [0, 0.25, 0.5, 0.75, 1].map((t) => padding.top + innerH - t * innerH);
  const labelStep = Math.ceil(length / 6);

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" style={{ display: "block" }}>
      {gridYs.map((gy, index) => (
        <line key={`g${index}`} x1={padding.left} x2={width - padding.right} y1={gy} y2={gy} stroke="#eef2f7" strokeWidth={1} />
      ))}
      {[0, 0.5, 1].map((t, index) => (
        <text key={`yl${index}`} x={padding.left - 6} y={padding.top + innerH - t * innerH + 3} fontSize="9" fill="#94a3b8" textAnchor="end">
          {Math.round(min + t * span).toLocaleString("en-US")}
        </text>
      ))}
      {cleanSeries.map((entry, sIndex) => {
        const color = entry.color || ["#2563eb", "#16a34a", "#f59e0b"][sIndex % 3];
        const points = entry.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
        const area = `${padding.left},${padding.top + innerH} ${points} ${x(entry.values.length - 1)},${padding.top + innerH}`;
        return (
          <g key={`s${sIndex}`}>
            <polygon points={area} fill={color} opacity={0.08} />
            <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </g>
        );
      })}
      {xLabels.map((label, index) =>
        index % labelStep === 0 ? (
          <text key={`xl${index}`} x={x(index)} y={height - 6} fontSize="9" fill="#94a3b8" textAnchor="middle">
            {label}
          </text>
        ) : null,
      )}
    </svg>
  );
}

function heatColor(t) {
  // t in [0,1]; light yellow (low) -> green (high).
  const clamped = Math.max(0, Math.min(1, Number(t) || 0));
  if (clamped < 0.5) {
    // #fef9c3 (low) -> #bbf7d0 (mid)
    const k = clamped / 0.5;
    const r = Math.round(254 + (187 - 254) * k);
    const g = Math.round(249 + (247 - 249) * k);
    const b = Math.round(195 + (208 - 195) * k);
    return `rgb(${r},${g},${b})`;
  }
  // #bbf7d0 (mid) -> #16a34a (high)
  const k = (clamped - 0.5) / 0.5;
  const r = Math.round(187 + (22 - 187) * k);
  const g = Math.round(247 + (163 - 247) * k);
  const b = Math.round(208 + (74 - 208) * k);
  return `rgb(${r},${g},${b})`;
}

// CSS-grid heatmap. `matrix[rowIndex][colIndex]` holds the numeric value.
export function Heatmap({ rowLabels = [], colLabels = [], matrix = [], formatValue }) {
  const flat = matrix.flat().map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (!rowLabels.length || !colLabels.length || flat.length === 0) {
    return null;
  }
  const min = Math.min(...flat);
  const max = Math.max(...flat);
  const span = max - min || 1;
  return (
    <div style={{ overflowX: "auto" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `auto repeat(${colLabels.length}, minmax(18px, 1fr))`,
          gap: 2,
          minWidth: 0,
        }}
      >
        <div />
        {colLabels.map((label) => (
          <div key={`hc-${label}`} style={{ fontSize: 9, color: "#94a3b8", textAlign: "center" }}>
            {label}
          </div>
        ))}
        {rowLabels.map((rowLabel, r) => (
          <div key={`hr-${rowLabel}`} style={{ display: "contents" }}>
            <div style={{ fontSize: 10, color: "#475569", paddingRight: 6, whiteSpace: "nowrap", display: "flex", alignItems: "center" }}>
              {rowLabel}
            </div>
            {colLabels.map((colLabel, c) => {
              const value = Number(matrix[r]?.[c]);
              const has = Number.isFinite(value);
              const t = has ? (value - min) / span : 0;
              return (
                <div
                  key={`hcell-${r}-${c}`}
                  title={has ? `${rowLabel} · ${colLabel}: ${formatValue ? formatValue(value) : value}` : ""}
                  style={{
                    background: has ? heatColor(t) : "#f1f5f9",
                    height: 22,
                    borderRadius: 2,
                    fontSize: 9,
                    color: "#0f172a",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {has && t > 0.66 ? (formatValue ? formatValue(value) : value) : ""}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// Horizontal ranking bars (top performers).
export function RankBars({ items = [], color = "#2563eb", formatValue }) {
  const clean = (Array.isArray(items) ? items : []).filter((item) => item && Number.isFinite(Number(item.value)));
  if (clean.length === 0) {
    return null;
  }
  const max = Math.max(...clean.map((item) => Number(item.value)), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {clean.map((item, index) => {
        const pct = Math.max(2, Math.min(100, (Number(item.value) / max) * 100));
        return (
          <div key={`${item.label}-${index}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 120, fontSize: 12, color: "var(--viz-label, #334155)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {item.label}
            </div>
            <div style={{ flex: 1, background: "var(--viz-track, #f1f5f9)", borderRadius: 4, height: 16, position: "relative" }}>
              <div style={{ width: `${pct}%`, background: color, height: "100%", borderRadius: 4 }} />
            </div>
            <div style={{ width: 56, textAlign: "right", fontSize: 12, fontWeight: 600, color: "var(--viz-value, #0f172a)" }}>
              {formatValue ? formatValue(item.value) : item.value}
            </div>
          </div>
        );
      })}
    </div>
  );
}

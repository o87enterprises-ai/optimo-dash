"use client";

import { SERIES } from "../lib/viz";

/**
 * A single-series sparkline.
 *
 * One series means no legend box — the tile's own title names it. The line is
 * 2px, the last point is marked, and the value is printed beside it rather
 * than labelling every point.
 */
export default function Sparkline({
  values,
  label,
  width = 120,
  height = 32,
}: {
  values: number[];
  label: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);

  const points = values.map((v, i) => {
    const x = i * step;
    // 3px of padding keeps the 2px stroke and the end marker inside the box.
    const y = height - 3 - ((v - min) / span) * (height - 6);
    return [x, y] as const;
  });

  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg width={width} height={height} className="sparkline" role="img" aria-label={label}>
      <path d={path} fill="none" stroke={SERIES[0]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={3} fill={SERIES[0]} stroke="#131a26" strokeWidth={2} />
    </svg>
  );
}

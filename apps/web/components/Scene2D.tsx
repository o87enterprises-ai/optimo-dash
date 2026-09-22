"use client";

import { useState } from "react";
import { SCENE_LEGEND } from "../lib/scene-data";
import type { SceneData, SceneNode } from "../lib/scene-data";
import { INK } from "../lib/viz";

/**
 * Two-dimensional fallback for the data galaxy.
 *
 * Shown when the device has too few cores for a smooth WebGL scene, when
 * WebGL is unavailable, or when the operator turns 3D off. It draws the same
 * node model as the 3D scene — concentric rings, same shapes, same colour
 * scales — as plain SVG, so it stays readable on a low-end phone and works
 * with a screen reader.
 */

type Props = { data: SceneData; onSelect: (node: SceneNode) => void };

const RINGS: { key: keyof Omit<SceneData, "domain">; radius: number }[] = [
  { key: "keywords", radius: 90 },
  { key: "prompts", radius: 140 },
  { key: "citations", radius: 190 },
  { key: "backlinks", radius: 240 },
];

/** Renders a node as the 2D equivalent of its 3D shape. */
function Mark({ node, x, y, onSelect, onHover }: {
  node: SceneNode;
  x: number;
  y: number;
  onSelect: (n: SceneNode) => void;
  onHover: (n: SceneNode | null) => void;
}) {
  const size = 5 * node.scale;
  const common = {
    fill: node.color,
    // A 2px surface ring keeps overlapping marks separable.
    stroke: "#131a26",
    strokeWidth: 2,
    style: { cursor: "pointer" },
    tabIndex: 0,
    role: "button" as const,
    "aria-label": `${node.kindLabel}: ${node.title}`,
    onMouseEnter: () => onHover(node),
    onMouseLeave: () => onHover(null),
    onFocus: () => onHover(node),
    onBlur: () => onHover(null),
    onClick: () => onSelect(node),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(node);
      }
    },
  };

  if (node.shape === "octahedron") {
    return <polygon points={`${x},${y - size} ${x + size},${y} ${x},${y + size} ${x - size},${y}`} {...common} />;
  }
  if (node.shape === "tetrahedron") {
    return <polygon points={`${x},${y - size} ${x + size},${y + size} ${x - size},${y + size}`} {...common} />;
  }
  if (node.shape === "torus") {
    return <circle cx={x} cy={y} r={size} {...common} fill="none" stroke={node.color} strokeWidth={3} />;
  }
  return <circle cx={x} cy={y} r={size} {...common} />;
}

export default function Scene2D({ data, onSelect }: Props) {
  const [hovered, setHovered] = useState<SceneNode | null>(null);
  const size = 560;
  const cx = size / 2;
  const cy = size / 2;

  return (
    <div className="scene-root scene-root-2d">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="scene-svg"
        role="img"
        aria-label={`Data galaxy for ${data.domain}, rendered in 2D`}
      >
        {RINGS.map((ring) => (
          <circle
            key={ring.key}
            cx={cx}
            cy={cy}
            r={ring.radius}
            fill="none"
            stroke={INK.grid}
            strokeWidth={1}
          />
        ))}

        {/* Backlink arcs, drawn first so marks sit on top. */}
        {data.backlinks.map((node, i, all) => {
          const angle = (i / Math.max(1, all.length)) * Math.PI * 2;
          const x = cx + Math.cos(angle) * 240;
          const y = cy + Math.sin(angle) * 240;
          return (
            <line
              key={`arc-${node.id}`}
              x1={x}
              y1={y}
              x2={cx}
              y2={cy}
              stroke="#199e70"
              strokeWidth={1}
              opacity={node.lost ? 0.1 : 0.2 + (node.magnitude ?? 0) * 0.35}
            />
          );
        })}

        {RINGS.map((ring) =>
          data[ring.key].map((node, i, all) => {
            const angle = (i / Math.max(1, all.length)) * Math.PI * 2;
            return (
              <Mark
                key={node.id}
                node={node}
                x={cx + Math.cos(angle) * ring.radius}
                y={cy + Math.sin(angle) * ring.radius}
                onSelect={onSelect}
                onHover={setHovered}
              />
            );
          })
        )}

        <circle cx={cx} cy={cy} r={26} fill="#3987e5" stroke="#131a26" strokeWidth={2} />
        <text x={cx} y={cy + 46} textAnchor="middle" fill={INK.primary} fontSize={13} fontWeight={600}>
          {data.domain}
        </text>
      </svg>

      {hovered && (
        <div className="scene-hover" role="status" aria-live="polite">
          <div className="scene-hover-kind">{hovered.kindLabel}</div>
          <div className="scene-hover-title">{hovered.title}</div>
          <dl className="scene-hover-stats">
            {hovered.stats.map((stat) => (
              <div key={stat.label}>
                <dt>{stat.label}</dt>
                <dd style={stat.tone ? { color: stat.tone } : undefined}>
                  {stat.mark ? `${stat.mark} ` : ""}
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

/** Shared legend. Identity is shape-first, so the legend leads with shape. */
export function SceneLegend() {
  return (
    <ul className="scene-legend">
      {SCENE_LEGEND.map((item) => (
        <li key={item.label}>
          <span className="scene-legend-shape" aria-hidden="true">{item.shape}</span>
          <strong>{item.label}</strong>
          <span className="scene-legend-detail">{item.detail}</span>
        </li>
      ))}
    </ul>
  );
}

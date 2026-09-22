"use client";

import { Suspense, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import type * as THREE from "three";

import { SERIES } from "../lib/viz";
import type { SceneData, SceneNode } from "../lib/scene-data";

/**
 * The data galaxy.
 *
 * The site sits at the centre; each ring is one kind of record. Ring and shape
 * carry identity, so colour is free to encode magnitude (keyword rank,
 * citation authority) and state (whether an LLM cited us).
 *
 * Performance: the scene is capped at 60fps with dpr clamped to [1, 2] and no
 * shadows, because it has to stay usable on a mid-range Android phone.
 */

type Props = {
  data: SceneData;
  onSelect: (node: SceneNode) => void;
  autoRotate: boolean;
};

/**
 * Places n items evenly on an inclined shell.
 *
 * Each ring gets its own radius, height and tilt so the shells stay visually
 * separate; sharing a plane collapses the whole scene into one flat band.
 */
function ringPositions(
  count: number,
  radius: number,
  height: number,
  tilt: number
): [number, number, number][] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / Math.max(1, count)) * Math.PI * 2;
    return [
      Math.cos(angle) * radius,
      height + Math.sin(angle * 2) * radius * tilt,
      Math.sin(angle) * radius,
    ];
  });
}

function CentralNode() {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (mesh.current) mesh.current.rotation.y += delta * 0.15;
  });
  return (
    <mesh ref={mesh}>
      <icosahedronGeometry args={[1.1, 1]} />
      <meshStandardMaterial color={SERIES[0]} emissive={SERIES[0]} emissiveIntensity={0.35} roughness={0.35} />
    </mesh>
  );
}

/** One interactive node. Hover raises it slightly so the target is obvious. */
function Node({
  node,
  position,
  onSelect,
  onHover,
}: {
  node: SceneNode;
  position: [number, number, number];
  onSelect: (n: SceneNode) => void;
  onHover: (n: SceneNode | null) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const scale = (hovered ? 1.45 : 1) * node.scale;

  return (
    <mesh
      position={position}
      scale={scale}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        onHover(node);
      }}
      onPointerOut={() => {
        setHovered(false);
        onHover(null);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(node);
      }}
    >
      {node.shape === "octahedron" && <octahedronGeometry args={[0.4, 0]} />}
      {node.shape === "torus" && <torusKnotGeometry args={[0.25, 0.085, 64, 10]} />}
      {node.shape === "tetrahedron" && <tetrahedronGeometry args={[0.42, 0]} />}
      {node.shape === "sphere" && <sphereGeometry args={[0.28, 18, 18]} />}
      <meshStandardMaterial
        color={node.color}
        emissive={node.color}
        // A cited prompt glows; everything else is lit conventionally.
        emissiveIntensity={node.glow ? 0.9 : hovered ? 0.5 : 0.15}
        roughness={0.4}
      />
    </mesh>
  );
}

/** Backlink arcs, drawn from an outer source point toward the centre. */
function Arcs({ points }: { points: { from: [number, number, number]; opacity: number }[] }) {
  return (
    <>
      {points.map((arc, i) => (
        <Line
          key={i}
          points={[arc.from, [0, 0, 0]]}
          color="#2a78d6"
          lineWidth={1}
          transparent
          opacity={arc.opacity}
        />
      ))}
    </>
  );
}

function Rings({ data, onSelect, onHover }: Props & { onHover: (n: SceneNode | null) => void }) {
  const layout = useMemo(() => {
    const keywords = ringPositions(data.keywords.length, 4.4, 0, 0.12);
    const prompts = ringPositions(data.prompts.length, 7.0, 1.8, 0.1);
    const citations = ringPositions(data.citations.length, 9.4, -1.9, 0.12);
    const backlinks = ringPositions(data.backlinks.length, 12.2, 0.7, 0.1);
    return { keywords, prompts, citations, backlinks };
  }, [data]);

  return (
    <>
      <CentralNode />

      {data.keywords.map((node, i) => (
        <Node key={node.id} node={node} position={layout.keywords[i]} onSelect={onSelect} onHover={onHover} />
      ))}
      {data.prompts.map((node, i) => (
        <Node key={node.id} node={node} position={layout.prompts[i]} onSelect={onSelect} onHover={onHover} />
      ))}
      {data.citations.map((node, i) => (
        <Node key={node.id} node={node} position={layout.citations[i]} onSelect={onSelect} onHover={onHover} />
      ))}
      {data.backlinks.map((node, i) => (
        <Node key={node.id} node={node} position={layout.backlinks[i]} onSelect={onSelect} onHover={onHover} />
      ))}

      <Arcs
        points={data.backlinks.map((node, i) => ({
          from: layout.backlinks[i],
          opacity: node.lost ? 0.12 : 0.25 + (node.magnitude ?? 0) * 0.4,
        }))}
      />
    </>
  );
}

export default function Scene3D({ data, onSelect, autoRotate }: Props) {
  const [hovered, setHovered] = useState<SceneNode | null>(null);

  return (
    <div className="scene-root">
      <Canvas
        // dpr capped and shadows off: this has to stay smooth on a phone.
        dpr={[1, 2]}
        shadows={false}
        camera={{ position: [0, 4.5, 21], fov: 48 }}
        frameloop="always"
      >
        <color attach="background" args={["#0b0f17"]} />
        <ambientLight intensity={0.55} />
        <pointLight position={[10, 12, 8]} intensity={120} />
        <pointLight position={[-10, -6, -8]} intensity={45} color={SERIES[0]} />

        <Suspense fallback={null}>
          <Rings data={data} onSelect={onSelect} onHover={setHovered} autoRotate={autoRotate} />
        </Suspense>

        <OrbitControls
          enablePan
          enableZoom
          enableRotate
          autoRotate={autoRotate}
          autoRotateSpeed={0.5}
          minDistance={4}
          maxDistance={45}
          // Touch: one finger rotates, two fingers pinch to zoom and pan.
          makeDefault
        />
      </Canvas>

      {/* Rendered outside the canvas rather than through a WebGL portal:
          a portal unmounts out of order when the canvas is torn down, and
          plain DOM is selectable and screen-readable. */}
      <div className="scene-center-label">{data.domain}</div>

      {hovered && <HoverCard node={hovered} />}
    </div>
  );
}

/**
 * Hover detail. Rendered as ordinary DOM rather than inside the canvas so it
 * stays selectable, screen-readable and styled by the page's own tokens.
 */
function HoverCard({ node }: { node: SceneNode }) {
  return (
    <div className="scene-hover" role="status" aria-live="polite">
      <div className="scene-hover-kind">{node.kindLabel}</div>
      <div className="scene-hover-title">{node.title}</div>
      <dl className="scene-hover-stats">
        {node.stats.map((stat) => (
          <div key={stat.label}>
            <dt>{stat.label}</dt>
            <dd style={stat.tone ? { color: stat.tone } : undefined}>
              {stat.mark ? `${stat.mark} ` : ""}
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="scene-hover-hint">Click to open in the table below</div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import { INK, compact, magnitudeColor } from "../lib/viz";

/**
 * Regional intelligence map.
 *
 * Leaflet with OpenStreetMap tiles, so the free tier needs no Mapbox token.
 *
 * Country polygons would need a GeoJSON world file — a ~250KB asset this
 * dashboard would have to ship and keep current. Since `regional_metrics`
 * stores one row per country, a proportional bubble at each country's centroid
 * carries the same information without that payload, and reads better at world
 * zoom than a choropleth of mostly-empty countries.
 *
 * Bubble area (not radius) is proportional to the value, so a country with
 * twice the clicks looks twice as big rather than four times.
 */

export type RegionalData = {
  countries: Record<string, Record<string, number | null>>;
};

const METRICS = [
  { key: "clicks", label: "Clicks" },
  { key: "impressions", label: "Impressions" },
  { key: "llm_citations", label: "LLM citations" },
  { key: "rank", label: "Average position", lowerIsBetter: true },
] as const;

type MetricKey = (typeof METRICS)[number]["key"];

/** Centroids for the countries the regional rollup can produce. */
const CENTROIDS: Record<string, [number, number]> = {
  US: [39.8, -98.6], GB: [54.0, -2.0], DE: [51.2, 10.4], FR: [46.6, 2.5], ES: [40.2, -3.7],
  IT: [42.8, 12.6], NL: [52.2, 5.3], CA: [56.1, -106.3], AU: [-25.3, 133.8], NZ: [-41.5, 172.8],
  IN: [22.4, 78.9], JP: [36.2, 138.3], CN: [35.9, 104.2], KR: [36.5, 127.9], BR: [-14.2, -51.9],
  MX: [23.6, -102.6], AR: [-38.4, -63.6], ZA: [-30.6, 22.9], SE: [60.1, 18.6], NO: [60.5, 8.5],
  DK: [56.3, 9.5], FI: [61.9, 25.7], PL: [51.9, 19.1], IE: [53.4, -8.2], CH: [46.8, 8.2],
  AT: [47.5, 14.6], BE: [50.5, 4.5], PT: [39.4, -8.2], SG: [1.35, 103.8], AE: [23.4, 53.8],
  IL: [31.0, 34.9], TR: [39.0, 35.2], RU: [61.5, 105.3], UA: [48.4, 31.2], ID: [-0.8, 113.9],
  PH: [12.9, 121.8], TH: [15.9, 101.0], VN: [14.1, 108.3], MY: [4.2, 101.98], NG: [9.1, 8.7],
  KE: [-0.02, 37.9], EG: [26.8, 30.8],
};

/** Keeps the map sized correctly when its container appears or resizes. */
function ResizeHandler() {
  const map = useMap();
  useEffect(() => {
    // Leaflet measures on mount; a tab that was hidden reports zero height.
    const timer = setTimeout(() => map.invalidateSize(), 100);
    const observer = new ResizeObserver(() => map.invalidateSize());
    const container = map.getContainer();
    observer.observe(container);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [map]);
  return null;
}

export default function WorldMap({
  data,
  onSelectCountry,
  selected,
}: {
  data: RegionalData;
  onSelectCountry: (code: string | null) => void;
  selected: string | null;
}) {
  const [metric, setMetric] = useState<MetricKey>("clicks");
  const config = METRICS.find((m) => m.key === metric)!;

  const points = useMemo(() => {
    const rows = Object.entries(data.countries)
      .map(([code, metrics]) => ({ code, value: metrics[metric] ?? null }))
      .filter((r) => r.value != null && CENTROIDS[r.code]) as { code: string; value: number }[];

    const max = Math.max(1, ...rows.map((r) => r.value));
    const min = Math.min(...rows.map((r) => r.value), 0);
    const span = max - min || 1;

    return rows.map((r) => {
      // For rank, a low number is good, so the scale is inverted before it
      // reaches the colour ramp — brighter always means "better" here.
      const t = "lowerIsBetter" in config && config.lowerIsBetter
        ? 1 - (r.value - min) / span
        : (r.value - min) / span;
      return {
        ...r,
        color: magnitudeColor(t),
        // Area-proportional: radius scales with the square root.
        radius: 6 + Math.sqrt(Math.abs(r.value) / max) * 22,
      };
    });
  }, [data, metric, config]);

  return (
    <div className="stack">
      <div className="row map-controls">
        <div className="seg" role="group" aria-label="Metric">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              className={metric === m.key ? "seg-on" : "seg-off"}
              aria-pressed={metric === m.key}
              onClick={() => setMetric(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
        {selected && (
          <button type="button" className="secondary" onClick={() => onSelectCountry(null)}>
            Clear {selected}
          </button>
        )}
      </div>

      {points.length === 0 ? (
        <div className="empty">
          No regional data yet. Run a Search Console sync, then a regional sync — country data comes
          from the Search Console country dimension.
        </div>
      ) : (
        <>
          <div className="map-shell">
            <MapContainer
              center={[25, 5]}
              zoom={2}
              minZoom={1}
              scrollWheelZoom
              className="map-canvas"
              worldCopyJump
            >
              <ResizeHandler />
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {points.map((p) => (
                <CircleMarker
                  key={p.code}
                  center={CENTROIDS[p.code]}
                  radius={p.radius}
                  pathOptions={{
                    color: selected === p.code ? INK.primary : "#131a26",
                    weight: 2,
                    fillColor: p.color,
                    fillOpacity: 0.78,
                  }}
                  eventHandlers={{ click: () => onSelectCountry(p.code) }}
                >
                  <Tooltip direction="top" offset={[0, -4]}>
                    <strong>{p.code}</strong>
                    <br />
                    {config.label}: {compact(p.value)}
                  </Tooltip>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>

          <ScaleLegend label={config.label} />

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Country</th>
                  {METRICS.map((m) => (
                    <th key={m.key} scope="col" className="right">{m.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.countries)
                  .sort((a, b) => (b[1][metric] ?? 0) - (a[1][metric] ?? 0))
                  .map(([code, metrics]) => (
                    <tr
                      key={code}
                      className={selected === code ? "row-highlight" : undefined}
                      onClick={() => onSelectCountry(code)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>{code}</td>
                      {METRICS.map((m) => (
                        <td key={m.key} className="right">
                          {metrics[m.key] == null
                            ? "—"
                            : m.key === "rank"
                              ? Number(metrics[m.key]).toFixed(1)
                              : compact(metrics[m.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** The sequential ramp, shown as discrete swatches with both ends labelled. */
function ScaleLegend({ label }: { label: string }) {
  const steps = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="scale-legend">
      <span className="meta">Lower</span>
      {steps.map((t) => (
        <span key={t} className="scale-swatch" style={{ background: magnitudeColor(t) }} aria-hidden="true" />
      ))}
      <span className="meta">Higher · {label}</span>
    </div>
  );
}

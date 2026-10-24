'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Globe, { GlobeMethods } from 'react-globe.gl'

type ArcDatum = {
  startLat: number
  startLng: number
  endLat: number
  endLng: number
  color: [string, string]
  label: string
}

type PointDatum = {
  lat: number
  lng: number
  size: number
  color: string
  label: string
}

const MOCK_ARCS: ArcDatum[] = [
  { startLat: 40.7128, startLng: -74.006, endLat: 51.5074, endLng: -0.1278, color: ['#00e5ff', '#ffb300'], label: 'New York → London' },
]

const MOCK_POINTS: PointDatum[] = [
  { lat: 40.7128, lng: -74.006, size: 0.45, color: '#00e5ff', label: 'New York' },
]

const COUNTRY_COORDS: Record<string, [number, number]> = {
  USA: [37.0902, -95.7129], GBR: [55.3781, -3.436], CAN: [56.1304, -106.3468],
  DEU: [51.1657, 10.4515], FRA: [46.2276, 2.2137], AUS: [-25.2744, 133.7751],
  IND: [20.5937, 78.9629], JPN: [36.2048, 138.2529], BRA: [-14.235, -51.9253],
  ZAF: [-30.5595, 22.9375], NLD: [52.1326, 5.2913], ESP: [40.4637, -3.7492],
  ITA: [41.8719, 12.5674], MEX: [23.6345, -102.5528], CHN: [35.8617, 104.1954],
  RUS: [61.524, 105.3188], KOR: [35.9078, 127.7669], IDN: [-0.7893, 113.9213],
  TUR: [38.9637, 35.2433], SAU: [23.8859, 45.0792], ARG: [-38.4161, -63.6167],
  SWE: [60.1282, 18.6435], POL: [51.9194, 19.1451], IRL: [53.1424, -7.6921],
  SGP: [1.3521, 103.8198], NZL: [-40.9006, 174.886], CHE: [46.8182, 8.2275],
  AUT: [47.5162, 14.5501], BEL: [50.5039, 4.4699], DNK: [56.2639, 9.5018],
  NOR: [60.472, 8.4689], FIN: [61.9241, 25.7482],
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

export default function GlobeCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const globeRef = useRef<GlobeMethods | undefined>(undefined)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  
  const [arcs, setArcs] = useState<ArcDatum[]>(MOCK_ARCS)
  const [points, setPoints] = useState<PointDatum[]>(MOCK_POINTS)
  const [webglSupported, setWebglSupported] = useState(true)

  useEffect(() => {
    // Check if WebGL is supported in this browser
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) {
        setWebglSupported(false);
        return;
      }
    } catch (e) {
      setWebglSupported(false);
      return;
    }

    async function fetchRegionalData() {
      try {
        const res = await fetch(`${API_BASE}/api/sites/1/regional_metrics`)
        if (!res.ok) throw new Error("Failed to fetch")
        const data = await res.json()

        if (data && data.length > 0) {
          const realPoints: PointDatum[] = []
          const realArcs: ArcDatum[] = []
          
          const originCoords = COUNTRY_COORDS[data[0].country.toUpperCase()] || [40.7128, -74.006]
          
          data.forEach((row: any) => {
            const coords = COUNTRY_COORDS[row.country.toUpperCase()]
            if (coords) {
              realPoints.push({
                lat: coords[0],
                lng: coords[1],
                size: Math.min(0.6, Math.max(0.2, row.clicks / 2000)),
                color: row.clicks > 1000 ? '#ffb300' : '#00e5ff',
                label: `${row.country}: ${row.clicks} clicks`
              })

              if (coords[0] !== originCoords[0] || coords[1] !== originCoords[1]) {
                realArcs.push({
                  startLat: originCoords[0],
                  startLng: originCoords[1],
                  endLat: coords[0],
                  endLng: coords[1],
                  color: ['#00e5ff', '#ffb300'],
                  label: `Data flow: ${row.country}`
                })
              }
            }
          })
          
          setPoints(realPoints)
          setArcs(realArcs)
        }
      } catch (err) {
        console.warn("Using mock globe data (API offline or no data).", err)
      }
    }
    
    fetchRegionalData()
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setDimensions({ width: Math.floor(width), height: Math.floor(height) })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const handleGlobeReady = useCallback(() => {
    const globe = globeRef.current
    if (!globe) return
    globe.pointOfView({ lat: 20, lng: -30, altitude: 2.5 }, 0)
    const controls = globe.controls()
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.35
    controls.enableZoom = true
    controls.enablePan = false
  }, [])

  if (!webglSupported) {
    return (
      <div className="flex h-full w-full items-center justify-center flex-col gap-4 border border-panel-border rounded-sm bg-panel/10 p-6 text-center">
        <span className="font-mono text-danger hud-text-glow text-xl">WEBGL OFFLINE</span>
        <span className="font-mono text-foreground/60 text-sm max-w-md">
          Hardware acceleration or WebGL is disabled in your browser. The 3D Holographic Globe requires WebGL to render.
        </span>
        <span className="font-mono text-primary text-xs uppercase tracking-widest mt-2">
          Enable WebGL in browser settings to view telemetry
        </span>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      {dimensions.width > 0 && dimensions.height > 0 && (
        <Globe
          ref={globeRef}
          width={dimensions.width}
          height={dimensions.height}
          backgroundColor="rgba(0,0,0,0)"
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-dark.jpg"
          bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
          atmosphereColor="#00e5ff"
          atmosphereAltitude={0.22}
          arcsData={arcs}
          arcColor={(d: object) => (d as ArcDatum).color}
          arcDashLength={0.4}
          arcDashGap={0.2}
          arcDashAnimateTime={1800}
          arcStroke={0.6}
          arcAltitudeAutoScale={0.35}
          arcLabel={(d: object) => (d as ArcDatum).label}
          pointsData={points}
          pointColor={(d: object) => (d as PointDatum).color}
          pointAltitude={(d: object) => (d as PointDatum).size * 0.01}
          pointRadius={(d: object) => (d as PointDatum).size}
          pointLabel={(d: object) => (d as PointDatum).label}
          onGlobeReady={handleGlobeReady}
        />
      )}
    </div>
  )
}
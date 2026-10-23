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

const ARCS: ArcDatum[] = [
  { startLat: 40.7128, startLng: -74.006, endLat: 51.5074, endLng: -0.1278, color: ['#00e5ff', '#ffb300'], label: 'New York → London' },
  { startLat: 34.0522, startLng: -118.2437, endLat: 35.6762, endLng: 139.6503, color: ['#00e5ff', '#ffb300'], label: 'Los Angeles → Tokyo' },
  { startLat: 51.5074, startLng: -0.1278, endLat: -33.8688, endLng: 151.2093, color: ['#00e5ff', '#ffb300'], label: 'London → Sydney' },
  { startLat: 1.3521, startLng: 103.8198, endLat: 25.2048, endLng: 55.2708, color: ['#00e5ff', '#ffb300'], label: 'Singapore → Dubai' },
  { startLat: -23.5505, startLng: -46.6333, endLat: 48.8566, endLng: 2.3522, color: ['#00e5ff', '#ffb300'], label: 'São Paulo → Paris' },
  { startLat: 19.076, startLng: 72.8777, endLat: -37.8136, endLng: 144.9631, color: ['#00e5ff', '#ffb300'], label: 'Mumbai → Melbourne' },
]

const POINTS: PointDatum[] = [
  { lat: 40.7128, lng: -74.006, size: 0.45, color: '#00e5ff', label: 'New York' },
  { lat: 51.5074, lng: -0.1278, size: 0.4, color: '#00e5ff', label: 'London' },
  { lat: 35.6762, lng: 139.6503, size: 0.45, color: '#ffb300', label: 'Tokyo' },
  { lat: 1.3521, lng: 103.8198, size: 0.35, color: '#00e5ff', label: 'Singapore' },
  { lat: -33.8688, lng: 151.2093, size: 0.4, color: '#ffb300', label: 'Sydney' },
  { lat: 19.076, lng: 72.8777, size: 0.35, color: '#00e5ff', label: 'Mumbai' },
  { lat: 48.8566, lng: 2.3522, size: 0.35, color: '#00e5ff', label: 'Paris' },
  { lat: -23.5505, lng: -46.6333, size: 0.35, color: '#ffb300', label: 'São Paulo' },
  { lat: 25.2048, lng: 55.2708, size: 0.35, color: '#00e5ff', label: 'Dubai' },
]

export default function GlobeCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const globeRef = useRef<GlobeMethods | undefined>(undefined)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })

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
          arcsData={ARCS}
          arcColor={(d: object) => (d as ArcDatum).color}
          arcDashLength={0.4}
          arcDashGap={0.2}
          arcDashAnimateTime={1800}
          arcStroke={0.6}
          arcAltitudeAutoScale={0.35}
          arcLabel={(d: object) => (d as ArcDatum).label}
          pointsData={POINTS}
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
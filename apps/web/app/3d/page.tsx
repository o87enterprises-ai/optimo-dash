'use client'

import dynamic from 'next/dynamic'

const GlobeCanvas = dynamic(() => import('../../components/3d/GlobeCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-400/30 border-t-cyan-400" />
        <p className="font-mono text-xs tracking-[0.3em] text-cyan-400/70">
          INITIALIZING ORBITAL RENDER
        </p>
      </div>
    </div>
  ),
})

export default function ThreeDPage() {
  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Cockpit corner brackets */}
      <div className="pointer-events-none absolute inset-0 z-20">
        <div className="absolute left-3 top-3 h-6 w-6 border-l-2 border-t-2 border-cyan-400/60" />
        <div className="absolute right-3 top-3 h-6 w-6 border-r-2 border-t-2 border-cyan-400/60" />
        <div className="absolute bottom-3 left-3 h-6 w-6 border-b-2 border-l-2 border-cyan-400/60" />
        <div className="absolute bottom-3 right-3 h-6 w-6 border-b-2 border-r-2 border-cyan-400/60" />
      </div>

      {/* Globe canvas */}
      <div className="absolute inset-0">
        <GlobeCanvas />
      </div>

      {/* Top-left status readout */}
      <div className="pointer-events-none absolute left-6 top-6 z-20 font-mono text-[10px] leading-relaxed tracking-widest text-cyan-300/80">
        <div className="mb-1 text-cyan-400">◤ GEO TELEMETRY</div>
        <div>MODE&nbsp;&nbsp;&nbsp;: ORBITAL / LIVE</div>
        <div>NODES&nbsp;&nbsp;: 09</div>
        <div>ARCS&nbsp;&nbsp;&nbsp;: 06</div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
          <span>STREAM ACTIVE</span>
        </div>
      </div>

      {/* Bottom-right legend */}
      <div className="pointer-events-none absolute bottom-6 right-6 z-20 flex flex-col items-end gap-1.5 font-mono text-[10px] tracking-widest">
        <div className="flex items-center gap-2 text-cyan-300/80">
          <span>PRIMARY NODE</span>
          <span className="inline-block h-2 w-2 rounded-full bg-cyan-400" />
        </div>
        <div className="flex items-center gap-2 text-amber-300/80">
          <span>HOT NODE</span>
          <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
        </div>
        <div className="flex items-center gap-2 text-cyan-300/80">
          <span>DATA ARC</span>
          <span className="inline-block h-[2px] w-4 bg-cyan-400" />
        </div>
      </div>
    </div>
  )
}
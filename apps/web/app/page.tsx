import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans selection:bg-primary/30">
      {/* Navbar */}
      <header className="w-full px-6 py-4 flex items-center justify-between border-b border-panel-border/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin-slow" />
          <span className="font-mono text-xl font-bold tracking-widest text-primary">0ptimo Prim3</span>
        </div>
        <nav className="flex items-center gap-6">
          <Link href="/login" className="text-sm font-mono text-foreground/70 hover:text-primary transition-colors">
            Log In
          </Link>
          <Link href="/login?signup=true" className="text-sm font-mono px-4 py-2 bg-primary/10 text-primary border border-primary/30 rounded-sm hover:bg-primary/20 transition-all">
            Get Started
          </Link>
        </nav>
      </header>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-4 py-20 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-background to-background pointer-events-none" />
        
        <div className="relative z-10 max-w-3xl">
          <h1 className="text-5xl md:text-7xl font-bold font-mono tracking-tight mb-6">
            SEO, AEO & GEO <br />
            <span className="text-primary hud-text-glow">Telemetry.</span>
          </h1>
          <p className="text-lg md:text-xl text-foreground/60 mb-10 max-w-2xl mx-auto font-mono">
            The transformer-grade cockpit for your search analytics. Monitor global keyword health, track LLM visibility, and autonomously optimize your site with AI.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/login?signup=true" className="px-8 py-3 bg-primary text-background font-mono font-bold rounded-sm hover:bg-primary/90 transition-all w-full sm:w-auto">
              Start Free Trial
            </Link>
            <Link href="/login" className="px-8 py-3 border border-panel-border font-mono rounded-sm hover:border-primary/50 transition-all w-full sm:w-auto">
              View Demo
            </Link>
          </div>
        </div>
      </main>

      {/* Features Grid */}
      <section className="px-6 py-20 border-t border-panel-border/50 bg-panel/5">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 border border-panel-border rounded-sm bg-panel/10">
            <h3 className="font-mono text-primary text-xl mb-3">Text Diagnostics</h3>
            <p className="text-sm text-foreground/60">Real-time keyword tracking, impression telemetry, and issue queues to catch SEO drops instantly.</p>
          </div>
          <div className="p-6 border border-panel-border rounded-sm bg-panel/10">
            <h3 className="font-mono text-primary text-xl mb-3">3D Geo-Mapping</h3>
            <p className="text-sm text-foreground/60">Visualize click distribution and interaction density on a holographic globe. Powered by Search Console data.</p>
          </div>
          <div className="p-6 border border-panel-border rounded-sm bg-panel/10">
            <h3 className="font-mono text-primary text-xl mb-3">Autopilot AI</h3>
            <p className="text-sm text-foreground/60">Connect your GitHub repo. Our AI scans your static files and proposes ready-to-merge PRs to fix titles and descriptions.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
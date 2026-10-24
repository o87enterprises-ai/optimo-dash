const TARGET_DOMAIN = process.env.NEXT_PUBLIC_TARGET_DOMAIN ?? "truegle.info";

export function TopBar() {
  return (
    <header className="h-16 border-b border-panel-border bg-panel/20 flex items-center justify-between px-6 backdrop-blur-md">
      <div className="flex items-center gap-6">
        <div className="flex flex-col">
          <span className="text-xs font-mono text-foreground/50 uppercase tracking-widest">Target Domain</span>
          <span className="font-mono text-sm text-foreground">{TARGET_DOMAIN}</span>
        </div>
        <div className="h-8 w-px bg-panel-border hidden sm:block" />
        <div className="hidden sm:flex flex-col">
          <span className="text-xs font-mono text-foreground/50 uppercase tracking-widest">Global Health</span>
          <span className="font-mono text-sm text-success hud-text-glow">98.4%</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-success/30 bg-success/10">
          <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
          <span className="text-xs font-mono text-success uppercase tracking-wider">Live</span>
        </div>
        <div className="w-8 h-8 rounded-full bg-panel border border-panel-border flex items-center justify-center font-mono text-xs text-foreground">
          OP
        </div>
      </div>
    </header>
  );
}
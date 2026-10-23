"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Type, BarChart3, Globe2 } from "lucide-react";

const navItems = [
  { name: "Text Dash", href: "/", icon: Type },
  { name: "Chart Dash", href: "/charts", icon: BarChart3 },
  { name: "3D Dash", href: "/3d", icon: Globe2 },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-20 md:w-64 border-r border-panel-border bg-panel/30 flex flex-col h-full transition-all duration-300">
      <div className="h-16 flex items-center justify-center md:justify-start md:px-6 border-b border-panel-border">
        {/* Placeholder for the Emblem */}
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-accent animate-spin-slow mr-0 md:mr-3" />
        <span className="hidden md:block font-mono font-bold text-lg tracking-wider text-foreground">
          0ptimo <span className="text-primary">Prim3</span>
        </span>
      </div>

      <nav className="flex-1 py-6 flex flex-col gap-2 px-3">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-4 px-3 py-3 rounded-md transition-all duration-200 group ${
                isActive
                  ? "bg-primary/10 text-primary border border-primary/30"
                  : "text-foreground/60 hover:text-foreground hover:bg-panel/50 border border-transparent"
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? "text-primary" : "group-hover:text-foreground"}`} />
              <span className="hidden md:block font-mono text-sm tracking-wide">
                {item.name}
              </span>
              {isActive && (
                <div className="hidden md:block ml-auto w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
              )}
            </Link>
          );
        })}
      </nav>
      
      <div className="p-4 border-t border-panel-border text-xs font-mono text-foreground/40 text-center md:text-left">
        SYS.STATUS: <span className="text-success">ONLINE</span>
      </div>
    </aside>
  );
}
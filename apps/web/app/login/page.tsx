"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    // Simulate successful login/registration to view the dashboard
    setTimeout(() => {
      if (isSignup) {
        alert("Account created! (In production, this routes to Stripe Checkout)");
        router.push("/dashboard");
      } else {
        router.push("/dashboard");
      }
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <Link href="/" className="mb-8 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin-slow" />
        <span className="font-mono text-xl font-bold tracking-widest text-primary">0ptimo Prim3</span>
      </Link>

      <div className="w-full max-w-md p-8 border border-panel-border rounded-sm bg-panel/10 backdrop-blur-md">
        <h2 className="font-mono text-2xl text-primary mb-6 text-center">
          {isSignup ? "Initialize Account" : "System Login"}
        </h2>

        <form onSubmit={handleAuth} className="flex flex-col gap-4">
          <div>
            <label className="block font-mono text-xs text-foreground/50 uppercase tracking-widest mb-1">Email</label>
            <input 
              type="email" 
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-background border border-panel-border rounded-sm p-2 text-foreground font-mono focus:border-primary focus:outline-none transition-colors"
              placeholder="operator@optimo.com"
            />
          </div>
          <div>
            <label className="block font-mono text-xs text-foreground/50 uppercase tracking-widest mb-1">Password</label>
            <input 
              type="password" 
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-background border border-panel-border rounded-sm p-2 text-foreground font-mono focus:border-primary focus:outline-none transition-colors"
              placeholder="••••••••"
            />
          </div>
          
          <button 
            type="submit" 
            disabled={loading}
            className="mt-4 w-full py-2 bg-primary text-background font-mono font-bold rounded-sm hover:bg-primary/90 transition-all disabled:opacity-50"
          >
            {loading ? "AUTHENTICATING..." : isSignup ? "CREATE ACCOUNT" : "ENTER COCKPIT"}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button 
            onClick={() => setIsSignup(!isSignup)}
            className="text-xs font-mono text-foreground/50 hover:text-primary transition-colors"
          >
            {isSignup ? "Already have an account? Log in" : "Need an account? Initialize one"}
          </button>
        </div>
      </div>
    </div>
  );
}
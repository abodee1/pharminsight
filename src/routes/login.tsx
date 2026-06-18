import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<"google" | "apple" | null>(null);

  const signInWith = async (provider: "google" | "apple") => {
    setOauthLoading(provider);
    const result = await lovable.auth.signInWithOAuth(provider, {
      redirect_uri: window.location.origin + "/dashboard",
    });
    if (result.redirected) return;
    setOauthLoading(null);
    if (result.error) return toast.error(result.error.message || `${provider} sign-in failed`);
    nav({ to: "/dashboard" });
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    nav({ to: "/dashboard" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg bg-card border border-border p-8 shadow-sm">
        <Link to="/" className="block text-center">
          <span className="text-xl font-bold tracking-tight text-primary">PharmInsight</span>
        </Link>
        <h1 className="mt-6 text-xl font-semibold text-center">Sign in</h1>

        <div className="mt-6 space-y-2">
          <button
            type="button"
            onClick={() => signInWith("google")}
            disabled={!!oauthLoading}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-input bg-background py-2 text-sm font-medium hover:bg-secondary disabled:opacity-50"
          >
            <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden>
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 7.1 29.3 5 24 5 16.3 5 9.7 9.4 6.3 14.7z"/>
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.6l-6.5 5C9.6 39.5 16.2 44 24 44z"/>
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4-4.1 5.3l6.2 5.2C41.6 35.6 44 30.2 44 24c0-1.3-.1-2.3-.4-3.5z"/>
            </svg>
            {oauthLoading === "google" ? "Redirecting…" : "Continue with Google"}
          </button>
          <button
            type="button"
            onClick={() => signInWith("apple")}
            disabled={!!oauthLoading}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-input bg-background py-2 text-sm font-medium hover:bg-secondary disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden fill="currentColor">
              <path d="M16.365 1.43c0 1.14-.42 2.22-1.2 3-.79.81-2.06 1.45-3.1 1.36-.13-1.1.42-2.22 1.15-2.97.81-.84 2.18-1.46 3.15-1.39zM20.5 17.27c-.55 1.27-.82 1.83-1.53 2.95-.99 1.55-2.38 3.47-4.1 3.49-1.53.01-1.93-1-4-.99-2.07.01-2.51 1.01-4.05.99-1.72-.02-3.04-1.76-4.03-3.31C.94 17.61.65 12.45 2.66 9.62c1.45-2.05 3.73-3.25 5.87-3.25 2.18 0 3.55 1.2 5.36 1.2 1.75 0 2.82-1.2 5.34-1.2 1.91 0 3.93 1.04 5.36 2.84-4.7 2.58-3.93 9.3-.13 8.06z"/>
            </svg>
            {oauthLoading === "apple" ? "Redirecting…" : "Continue with Apple"}
          </button>
        </div>

        <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <button
            disabled={loading}
            className="w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="mt-6 text-sm text-center text-muted-foreground">
          No account?{" "}
          <Link to="/register" className="text-primary font-medium hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}

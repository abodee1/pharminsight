import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";

function passwordStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: "", color: "" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: "Weak", color: "bg-red-500" };
  if (score === 2) return { score, label: "Fair", color: "bg-orange-400" };
  if (score === 3) return { score, label: "Good", color: "bg-yellow-400" };
  return { score, label: "Strong", color: "bg-green-500" };
}

export const Route = createFileRoute("/register")({ component: Register });

function Register() {
  const nav = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<"google" | "apple" | null>(null);
  const strength = useMemo(() => passwordStrength(password), [password]);

  const signUpWith = async (provider: "google" | "apple") => {
    setOauthLoading(provider);
    const result = await lovable.auth.signInWithOAuth(provider, {
      redirect_uri: window.location.origin + "/dashboard",
    });
    if (result.redirected) return;
    setOauthLoading(null);
    if (result.error) return toast.error(result.error.message || `${provider} sign-up failed`);
    nav({ to: "/dashboard" });
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: { full_name: fullName },
      },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Account created. Check your email to confirm, then sign in.");
    nav({ to: "/login" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-lg bg-card border border-border p-8 shadow-sm">
        <Link to="/" className="block text-center">
          <span className="text-xl font-bold tracking-tight text-primary">PharmInsight</span>
        </Link>
        <h1 className="mt-6 text-xl font-semibold text-center">Create account</h1>

        <div className="mt-6 space-y-2">
          <button
            type="button"
            onClick={() => signUpWith("google")}
            disabled={!!oauthLoading}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-input bg-background py-2 text-sm font-medium hover:bg-secondary disabled:opacity-50"
          >
            <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden>
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 7.1 29.3 5 24 5 16.3 5 9.7 9.4 6.3 14.7z"/>
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.6l-6.5 5C9.6 39.5 16.2 44 24 44z"/>
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4-4.1 5.3l6.2 5.2C41.6 35.6 44 30.2 44 24c0-1.3-.1-2.3-.4-3.5z"/>
            </svg>
            {oauthLoading === "google" ? "Redirecting…" : "Sign up with Google"}
          </button>
          <button
            type="button"
            onClick={() => signUpWith("apple")}
            disabled={!!oauthLoading}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-input bg-background py-2 text-sm font-medium hover:bg-secondary disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden fill="currentColor">
              <path d="M16.365 1.43c0 1.14-.42 2.22-1.2 3-.79.81-2.06 1.45-3.1 1.36-.13-1.1.42-2.22 1.15-2.97.81-.84 2.18-1.46 3.15-1.39zM20.5 17.27c-.55 1.27-.82 1.83-1.53 2.95-.99 1.55-2.38 3.47-4.1 3.49-1.53.01-1.93-1-4-.99-2.07.01-2.51 1.01-4.05.99-1.72-.02-3.04-1.76-4.03-3.31C.94 17.61.65 12.45 2.66 9.62c1.45-2.05 3.73-3.25 5.87-3.25 2.18 0 3.55 1.2 5.36 1.2 1.75 0 2.82-1.2 5.34-1.2 1.91 0 3.93 1.04 5.36 2.84-4.7 2.58-3.93 9.3-.13 8.06z"/>
            </svg>
            {oauthLoading === "apple" ? "Redirecting…" : "Sign up with Apple"}
          </button>
        </div>

        <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Full name</label>
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
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
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            {password && (
              <div className="mt-2 space-y-1">
                <div className="flex gap-1">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-colors ${
                        strength.score >= i ? strength.color : "bg-muted"
                      }`}
                    />
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {strength.label && <span className="font-medium">{strength.label} — </span>}
                  Use 8+ characters with a mix of letters, numbers, and symbols.
                </p>
              </div>
            )}
          </div>
          <button
            disabled={loading}
            className="w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create account"}
          </button>
        </form>
        <p className="mt-6 text-sm text-center text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="text-primary font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

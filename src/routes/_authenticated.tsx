import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { AppSidebar } from "@/components/AppSidebar";
import { MobileTopBar } from "@/components/MobileTopBar";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated")({ component: AuthLayout });

function AuthLayout() {
  const { user, profile, loading, refreshProfile } = useAuth();
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!loading && !user) nav({ to: "/login" });
  }, [loading, user, nav]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  // First-login role prompt
  if (!profile?.role) {
    return <RolePrompt onSet={refreshProfile} />;
  }

  return (
    <div className="min-h-screen flex bg-background">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <MobileTopBar />
        <main className="flex-1 overflow-x-hidden">
          <div key={pathname} className="animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function RolePrompt({ onSet }: { onSet: () => Promise<void> }) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);

  const setRole = async (role: "owner_manager" | "consultant_analyst") => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ role })
      .eq("id", user.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    await onSet();
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="max-w-md w-full rounded-lg bg-card border border-border p-8 shadow-sm text-center">
        <h1 className="text-xl font-semibold">Welcome to PharmInsight</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Tell us how you'll be using the platform.
        </p>
        <div className="mt-6 space-y-3">
          <button
            disabled={saving}
            onClick={() => setRole("owner_manager")}
            className="w-full rounded-md border border-border bg-secondary px-4 py-3 text-sm font-medium hover:border-gold disabled:opacity-50"
          >
            Pharmacy Owner / Manager
          </button>
          <button
            disabled={saving}
            onClick={() => setRole("consultant_analyst")}
            className="w-full rounded-md border border-border bg-secondary px-4 py-3 text-sm font-medium hover:border-gold disabled:opacity-50"
          >
            Consultant / Analyst
          </button>
        </div>
      </div>
    </div>
  );
}

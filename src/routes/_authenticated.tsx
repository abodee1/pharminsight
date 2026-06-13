import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { AppSidebar } from "@/components/AppSidebar";
import { MobileTopBar } from "@/components/MobileTopBar";
import { InsightsContent } from "@/components/InsightsContent";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose } from "@/components/ui/drawer";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated")({ component: AuthLayout });

function AuthLayout() {
  const { user, profile, loading, refreshProfile } = useAuth();
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [insightsOpen, setInsightsOpen] = useState(false);

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
      {/* Smart Insights FAB — mobile only, hidden on the insights page itself */}
      {pathname !== "/insights" && (
        <button
          onClick={() => setInsightsOpen(true)}
          aria-label="Smart Insights"
          className="md:hidden fixed bottom-5 right-4 z-40 flex items-center gap-2 rounded-full bg-primary text-primary-foreground shadow-lg px-4 py-3 text-sm font-semibold hover:bg-primary/90 active:scale-95 transition-all"
        >
          <Sparkles className="h-4 w-4 shrink-0" />
          Insights
        </button>
      )}

      {/* Smart Insights bottom sheet — mobile only */}
      <Drawer open={insightsOpen} onOpenChange={setInsightsOpen} shouldScaleBackground={false}>
        <DrawerContent className="md:hidden max-h-[92vh] flex flex-col">
          <DrawerHeader className="flex-row items-center justify-between pb-0 border-b border-border">
            <DrawerTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-gold" />
              Smart Insights
            </DrawerTitle>
            <DrawerClose asChild>
              <button
                aria-label="Close"
                className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </DrawerClose>
          </DrawerHeader>
          <div className="flex-1 overflow-y-auto">
            <InsightsContent isDrawer />
          </div>
        </DrawerContent>
      </Drawer>
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

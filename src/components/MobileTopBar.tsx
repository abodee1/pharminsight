import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  LayoutDashboard, Trophy, BarChart2, GitCompare, Sparkles, Upload, Settings,
  LogOut, Menu, User as UserIcon,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";

export const NAV_LINKS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/leaderboards", label: "Leaderboards", icon: Trophy },
  { to: "/benchmarking", label: "Benchmarking", icon: BarChart2 },
  { to: "/compare", label: "Compare", icon: GitCompare },
  { to: "/insights", label: "AI Insights", icon: Sparkles },
  { to: "/upload", label: "Upload Data", icon: Upload },
  { to: "/settings", label: "My Account", icon: Settings },
] as const;

export function MobileTopBar() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { profile, user, signOut } = useAuth();
  const navigate = useNavigate();

  const current = NAV_LINKS.find((l) => pathname === l.to || pathname.startsWith(l.to + "/"));

  const initials = (profile?.full_name || user?.email || "?")
    .split(/\s+|@/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  return (
    <header className="md:hidden sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-card/95 backdrop-blur px-4 h-14">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            aria-label="Open menu"
            className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-border hover:bg-secondary"
          >
            <Menu className="h-5 w-5" />
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="bg-sidebar text-sidebar-foreground border-sidebar-border p-0 w-72">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="px-5 py-5 border-b border-sidebar-border">
            <p className="text-xl font-bold tracking-tight">PharmIQ</p>
            <p className="text-xs text-sidebar-muted mt-1">NHS pharmacy analytics</p>
          </div>
          <nav className="p-3 space-y-1">
            {NAV_LINKS.map(({ to, label, icon: Icon }) => {
              const active = pathname === to || pathname.startsWith(to + "/");
              return (
                <Link
                  key={to}
                  to={to}
                  onClick={() => setOpen(false)}
                  className={[
                    "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-foreground font-semibold"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  ].join(" ")}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-sidebar-border p-3 mt-2">
            <div className="flex items-center gap-3 px-2 py-2">
              <div className="h-9 w-9 rounded-full bg-sidebar-foreground text-sidebar flex items-center justify-center text-xs font-semibold">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{profile?.full_name || user?.email}</p>
                <p className="text-xs text-sidebar-muted truncate">{user?.email}</p>
              </div>
            </div>
            <button
              onClick={async () => { setOpen(false); await signOut(); navigate({ to: "/login" }); }}
              className="mt-2 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <Link to="/dashboard" className="font-bold tracking-tight text-foreground">
        PharmIQ
      </Link>

      <Link
        to="/settings"
        aria-label="My account"
        className="inline-flex items-center justify-center h-9 w-9 rounded-full bg-primary text-primary-foreground text-xs font-semibold"
      >
        {initials || <UserIcon className="h-4 w-4" />}
      </Link>
    </header>
  );
}

import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Trophy,
  BarChart2,
  GitCompare,
  Sparkles,
  Upload,
  Settings,
  Database,
  LogOut,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { PharmacySearch } from "./PharmacySearch";

const links = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/leaderboards", label: "Leaderboards", icon: Trophy },
  { to: "/benchmarking", label: "Benchmarking", icon: BarChart2 },
  { to: "/compare", label: "Compare", icon: GitCompare },
  { to: "/insights", label: "Smart Insights", icon: Sparkles },
  { to: "/upload", label: "Upload Data", icon: Upload },
  { to: "/admin/data", label: "Data Coverage", icon: Database },
  { to: "/admin/payments-import", label: "Payments Import", icon: Upload },
  { to: "/settings", label: "My Account", icon: Settings },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { profile, user, signOut } = useAuth();
  const navigate = useNavigate();

  const initials = (profile?.full_name || user?.email || "?")
    .split(/\s+|@/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const roleLabel =
    profile?.role === "owner_manager"
      ? "Owner / Manager"
      : profile?.role === "consultant_analyst"
        ? "Consultant"
        : "No role set";

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="px-5 py-5 border-b border-sidebar-border">
        <Link to="/dashboard" className="flex items-center gap-2">
          <span className="text-xl font-bold tracking-tight text-sidebar-foreground">
            PharmIQ
          </span>
        </Link>
        <p className="text-xs text-sidebar-muted mt-1">NHS pharmacy analytics</p>
      </div>

      <div className="px-3 pt-3">
        <PharmacySearch compact />
      </div>


      <nav className="flex-1 p-3 space-y-1">
        {links.map(({ to, label, icon: Icon }) => {
          const active = pathname === to || pathname.startsWith(to + "/");
          return (
            <Link
              key={to}
              to={to}
              className={[
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors relative",
                active
                  ? "bg-sidebar-accent text-sidebar-foreground font-semibold"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              ].join(" ")}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 bg-sidebar-foreground rounded-r" />
              )}
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="h-9 w-9 rounded-full bg-sidebar-foreground text-sidebar flex items-center justify-center text-xs font-semibold">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {profile?.full_name || user?.email}
            </p>
            <p className="text-xs text-sidebar-muted truncate">{roleLabel}</p>
          </div>
        </div>
        <button
          onClick={async () => {
            await signOut();
            navigate({ to: "/login" });
          }}
          className="mt-2 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}

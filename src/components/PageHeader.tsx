import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  action,
  backTo = "/dashboard",
  backLabel = "Dashboard",
  showBack = true,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  backTo?: "/dashboard" | "/leaderboards" | "/benchmarking" | "/compare" | "/insights" | "/upload" | "/settings";
  backLabel?: string;
  showBack?: boolean;
}) {
  return (
    <div className="mb-6">
      {showBack && (
        <Link
          to={backTo}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back to {backLabel}
        </Link>
      )}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}

import type { LucideIcon } from "lucide-react";

type StatAccent = "indigo" | "emerald" | "amber" | "rose" | "sky" | "violet" | "slate";

const ACCENTS: Record<StatAccent, { ring: string; chip: string; glow: string; bar: string }> = {
  indigo:  { ring: "ring-indigo-500/15",  chip: "bg-indigo-500/10 text-indigo-600",   glow: "from-indigo-500/15",  bar: "bg-indigo-500" },
  emerald: { ring: "ring-emerald-500/15", chip: "bg-emerald-500/10 text-emerald-600", glow: "from-emerald-500/15", bar: "bg-emerald-500" },
  amber:   { ring: "ring-amber-500/15",   chip: "bg-amber-500/10 text-amber-600",     glow: "from-amber-500/15",   bar: "bg-amber-500" },
  rose:    { ring: "ring-rose-500/15",    chip: "bg-rose-500/10 text-rose-600",       glow: "from-rose-500/15",    bar: "bg-rose-500" },
  sky:     { ring: "ring-sky-500/15",     chip: "bg-sky-500/10 text-sky-600",         glow: "from-sky-500/15",     bar: "bg-sky-500" },
  violet:  { ring: "ring-violet-500/15",  chip: "bg-violet-500/10 text-violet-600",   glow: "from-violet-500/15",  bar: "bg-violet-500" },
  slate:   { ring: "ring-slate-500/15",   chip: "bg-slate-500/10 text-slate-600",     glow: "from-slate-500/15",   bar: "bg-slate-500" },
};

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = "indigo",
  trend,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  accent?: StatAccent;
  trend?: { value: number; label?: string };
}) {
  const a = ACCENTS[accent];
  const trendUp = (trend?.value ?? 0) >= 0;
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl bg-card border border-border p-5 shadow-sm ring-1 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md",
        a.ring,
      )}
    >
      {/* Soft corner glow */}
      <div
        className={cn(
          "pointer-events-none absolute -top-12 -right-12 h-32 w-32 rounded-full bg-gradient-to-br to-transparent opacity-70 blur-2xl",
          a.glow,
        )}
      />
      {/* Accent rail */}
      <div className={cn("absolute left-0 top-0 h-full w-[3px]", a.bar)} />

      <div className="relative flex items-start justify-between gap-3">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </p>
        {Icon && (
          <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", a.chip)}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>

      <p className="relative mt-3 text-[1.65rem] leading-none font-semibold tracking-tight text-foreground tabular-nums">
        {value}
      </p>

      <div className="relative mt-2 flex items-center gap-2 min-h-[18px]">
        {trend && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
              trendUp ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600",
            )}
          >
            {trendUp ? "▲" : "▼"} {Math.abs(trend.value)}%
            {trend.label && <span className="font-normal opacity-70 ml-0.5">{trend.label}</span>}
          </span>
        )}
        {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

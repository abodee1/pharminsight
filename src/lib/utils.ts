import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Compact GBP formatter: £1,240 / £12.4k / £1.2m. Always rounds sensibly. */
export function fmtGbpCompact(n: number | string | null | undefined): string {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}£${(abs / 1_000_000).toFixed(1)}m`;
  if (abs >= 10_000) return `${sign}£${(abs / 1_000).toFixed(1)}k`;
  return `${sign}£${Math.round(abs).toLocaleString()}`;
}


type Props = { country?: string | null; className?: string };

const STYLES: Record<string, string> = {
  England: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900",
  Scotland: "bg-indigo-100 text-indigo-900 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-900",
  Wales: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900",
  "Northern Ireland": "bg-green-100 text-green-800 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-900",
};

export function CountryBadge({ country, className = "" }: Props) {
  if (!country) return null;
  const cls = STYLES[country] || "bg-secondary text-secondary-foreground border-border";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls} ${className}`}>
      {country === "Northern Ireland" ? "NI" : country}
    </span>
  );
}

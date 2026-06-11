import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sankey, sankeyLeft, sankeyLinkHorizontal } from "d3-sankey";
import type { SankeyNode, SankeyLink, SankeyGraph } from "d3-sankey";
import { Maximize2, Minimize2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  pharmacyOds: string;
  country: string | null;
}

interface SNode {
  id: string;
  name: string;
  nodeType: "gp" | "pharmacy";
}

interface SLink {
  source: string;
  target: string;
  value: number;
}

type LayoutNode = SankeyNode<SNode, SLink>;
type LayoutLink = SankeyLink<SNode, SLink>;

const PERIOD_OPTIONS = [
  { label: "Last 3 months", months: 3 },
  { label: "Last 6 months", months: 6 },
  { label: "Last 12 months", months: 12 },
];

const linkPath = sankeyLinkHorizontal();

function periodFilter(months: number) {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - months, 1);
  return { year: from.getFullYear(), month: from.getMonth() + 1 };
}

export function NominationFlow({ pharmacyOds, country }: Props) {
  const [periodIdx, setPeriodIdx] = useState(2);
  const [layoutNodes, setLayoutNodes] = useState<LayoutNode[]>([]);
  const [layoutLinks, setLayoutLinks] = useState<LayoutLink[]>([]);
  const [topFeederNote, setTopFeederNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [width, setWidth] = useState(600);
  const containerRef = useRef<HTMLDivElement>(null);

  const isSupported = country === "England" || country === "Scotland";
  const period = PERIOD_OPTIONS[periodIdx];
  const height = fullscreen ? Math.max(400, window.innerHeight - 180) : 340;

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? 600;
      setWidth(Math.max(320, w - 32));
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!isSupported) return;
    setLoading(true);
    setLayoutNodes([]);
    setLayoutLinks([]);
    setTopFeederNote(null);

    (async () => {
      const { year, month } = periodFilter(period.months);

      // Flows to this pharmacy
      const { data: toThis } = await supabase
        .from("gp_pharmacy_linkage")
        .select("practice_code,items_dispensed,year,month")
        .eq("pharmacy_ods_code", pharmacyOds)
        .gte("year", year);

      if (!toThis?.length) { setLoading(false); return; }

      // Filter to period (gte year filter above catches too many if spanning years)
      const filtered = toThis.filter(r => r.year > year || (r.year === year && r.month >= month));
      if (!filtered.length) { setLoading(false); return; }

      // Aggregate by GP and pick top 10
      const gpTotals = new Map<string, number>();
      for (const r of filtered) {
        gpTotals.set(r.practice_code, (gpTotals.get(r.practice_code) ?? 0) + r.items_dispensed);
      }
      const top10 = Array.from(gpTotals.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([code]) => code);

      // GP names from gp_practices
      const { data: gpNames } = await supabase
        .from("gp_practices")
        .select("practice_code,practice_name,google_name")
        .in("practice_code", top10);

      const nameMap = new Map<string, string>(
        (gpNames ?? []).map(g => [g.practice_code, g.google_name || g.practice_name || g.practice_code])
      );

      // All flows from top10 GPs in this period
      const { data: allFlows } = await supabase
        .from("gp_pharmacy_linkage")
        .select("practice_code,pharmacy_ods_code,items_dispensed,year,month")
        .in("practice_code", top10)
        .gte("year", year);

      const periodFlows = (allFlows ?? []).filter(
        r => r.year > year || (r.year === year && r.month >= month)
      );

      // Aggregate by GP→pharmacy
      const flowMap = new Map<string, number>();
      for (const r of periodFlows) {
        const key = `${r.practice_code}__${r.pharmacy_ods_code}`;
        flowMap.set(key, (flowMap.get(key) ?? 0) + r.items_dispensed);
      }

      // Pharmacies receiving flows (keep top 8 by volume)
      const pharmTotals = new Map<string, number>();
      for (const [key, val] of flowMap.entries()) {
        const pharmOds = key.split("__")[1];
        pharmTotals.set(pharmOds, (pharmTotals.get(pharmOds) ?? 0) + val);
      }
      const topPharms = Array.from(pharmTotals.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([ods]) => ods);

      // Ensure this pharmacy is always included
      if (!topPharms.includes(pharmacyOds)) topPharms.push(pharmacyOds);

      // Build node list
      const nodeData: SNode[] = [
        ...top10.map(code => ({ id: `gp_${code}`, name: nameMap.get(code) ?? code, nodeType: "gp" as const })),
        ...topPharms.map(ods => ({
          id: `ph_${ods}`,
          name: ods === pharmacyOds ? "This pharmacy" : ods,
          nodeType: "pharmacy" as const,
        })),
      ];

      const linkData: SLink[] = [];
      for (const [key, value] of flowMap.entries()) {
        const [gpCode, pharmOds] = key.split("__");
        if (!topPharms.includes(pharmOds)) continue;
        linkData.push({ source: `gp_${gpCode}`, target: `ph_${pharmOds}`, value });
      }

      if (!linkData.length) { setLoading(false); return; }

      try {
        const layout = sankey<SNode, SLink>()
          .nodeId(d => d.id)
          .nodeAlign(sankeyLeft)
          .nodeWidth(16)
          .nodePadding(8)
          .extent([[0, 0], [width - 180, height - 40]]);

        const graph: SankeyGraph<SNode, SLink> = layout({
          nodes: nodeData.map(n => ({ ...n })),
          links: linkData.map(l => ({ ...l })),
        });

        setLayoutNodes(graph.nodes as LayoutNode[]);
        setLayoutLinks(graph.links as LayoutLink[]);

        // Top feeder note
        const topGpCode = top10[0];
        const topGpName = nameMap.get(topGpCode) ?? topGpCode;
        const topGpItems = gpTotals.get(topGpCode) ?? 0;
        setTopFeederNote(`Top feeder: ${topGpName} — ${topGpItems.toLocaleString()} items over ${period.label.toLowerCase()}`);
      } catch {
        // Layout failed silently
      } finally {
        setLoading(false);
      }
    })();
  }, [pharmacyOds, isSupported, period.months, width, height]);

  const SVG_PADDING = { left: 120, right: 60, top: 10, bottom: 10 };

  const inner = (
    <div ref={containerRef}>
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold">GP nomination flow</h2>
        <div className="flex items-center gap-2">
          <Select value={String(periodIdx)} onValueChange={v => setPeriodIdx(Number(v))}>
            <SelectTrigger className="w-36 h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((o, i) => (
                <SelectItem key={i} value={String(i)}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            onClick={() => setFullscreen(f => !f)}
            className="p-1.5 rounded hover:bg-secondary transition-colors"
            title={fullscreen ? "Exit full screen" : "Full screen"}
          >
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div className="p-4">
        {loading && (
          <div className="text-sm text-muted-foreground animate-pulse py-10 text-center">Loading nomination flows…</div>
        )}

        {!loading && layoutNodes.length === 0 && (
          <div className="text-sm text-muted-foreground py-10 text-center">
            No GP→pharmacy flow data found for this pharmacy in the selected period.
          </div>
        )}

        {!loading && layoutNodes.length > 0 && (
          <>
            <svg
              width={width}
              height={height}
              className="max-w-full overflow-visible"
              style={{ fontFamily: "inherit" }}
            >
              <g transform={`translate(${SVG_PADDING.left},${SVG_PADDING.top})`}>
                {layoutLinks.map((link, i) => {
                  const targetNode = typeof link.target === "object" ? link.target as LayoutNode : null;
                  const isThisPharm = targetNode?.id === `ph_${pharmacyOds}`;
                  return (
                    <path
                      key={i}
                      d={linkPath(link as Parameters<typeof linkPath>[0]) ?? ""}
                      fill="none"
                      stroke={isThisPharm ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"}
                      strokeWidth={Math.max(1, link.width ?? 2)}
                      opacity={isThisPharm ? 0.45 : 0.12}
                    />
                  );
                })}

                {layoutNodes.map((node, i) => {
                  const x0 = node.x0 ?? 0;
                  const x1 = node.x1 ?? 16;
                  const y0 = node.y0 ?? 0;
                  const y1 = node.y1 ?? 20;
                  const h = Math.max(2, y1 - y0);
                  const isGp = node.nodeType === "gp";
                  const isThis = node.id === `ph_${pharmacyOds}`;

                  return (
                    <g key={i}>
                      <rect
                        x={x0}
                        y={y0}
                        width={x1 - x0}
                        height={h}
                        fill={isThis ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"}
                        opacity={isThis ? 1 : 0.55}
                        rx={2}
                      />
                      <text
                        x={isGp ? x0 - 4 : x1 + 4}
                        y={y0 + h / 2}
                        dy="0.35em"
                        textAnchor={isGp ? "end" : "start"}
                        fontSize={9}
                        fill="hsl(var(--foreground))"
                        opacity={0.85}
                      >
                        {node.name.length > 22 ? node.name.slice(0, 22) + "…" : node.name}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>

            {topFeederNote && (
              <div className="mt-3 rounded-md bg-primary/5 border border-primary/20 px-3 py-2 text-xs text-muted-foreground">
                {topFeederNote}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  if (!isSupported) {
    return (
      <section className="mt-6 rounded-lg bg-card border border-border shadow-sm px-4 py-3 text-sm text-muted-foreground">
        GP nomination flow data is available for England and Scotland pharmacies only.
      </section>
    );
  }

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-background overflow-auto p-4">
        <div className="rounded-lg bg-card border border-border shadow-sm overflow-hidden">
          {inner}
        </div>
      </div>
    );
  }

  return (
    <section className="mt-6">
      <div className="rounded-lg bg-card border border-border shadow-sm overflow-hidden">
        {inner}
      </div>
    </section>
  );
}

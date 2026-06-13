import { createFileRoute } from "@tanstack/react-router";
import { InsightsContent } from "@/components/InsightsContent";

export const Route = createFileRoute("/_authenticated/insights")({ component: InsightsContent });

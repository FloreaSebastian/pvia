import { TriangleAlert } from "lucide-react";
import type { LayoutSummary } from "@/lib/solar/studio-steps";

/** Barre de synthèse permanente de l'étape Implantation (compteurs + alertes). */
export function LayoutSummaryBar({ summary }: { summary: LayoutSummary }) {
  return (
    <section
      aria-label="Synthèse de l'implantation"
      className="border-t bg-card/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/80"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {summary.items.map((item) => (
          <div key={item.label} className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{item.label}</p>
            <p className="truncate text-sm font-semibold">{item.value}</p>
          </div>
        ))}
        {summary.progress != null && (
          <div className="ml-auto w-32">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Objectif atteint</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
              <div className="h-full bg-primary" style={{ width: `${Math.round(summary.progress * 100)}%` }} />
            </div>
          </div>
        )}
      </div>
      {summary.alerts.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {summary.alerts.map((alert) => (
            <li key={alert} className="flex items-center gap-1 text-xs text-destructive">
              <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{alert}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

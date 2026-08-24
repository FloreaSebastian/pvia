import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, ChevronRight, ClipboardList, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { listChantierTechnicalVisits } from "@/lib/visites.functions";
import { getVisitTemplate, isVisitType } from "@/lib/visites/templates";
import { VisitStatusBadge } from "@/components/visites/VisitStatusBadge";

interface Row {
  id: string;
  reference: string;
  visit_type: string;
  status: string;
  scheduled_at: string | null;
  completion_percent: number | null;
}

function fmt(iso: string | null) {
  if (!iso) return "Non planifiée";
  return new Date(iso).toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Visites techniques rattachées à un chantier (onglet de la fiche chantier). */
export function ChantierVisitesTab({
  companyId,
  chantierId,
  canCreate,
}: {
  companyId: string;
  chantierId: string;
  canCreate: boolean;
}) {
  const listFn = useServerFn(listChantierTechnicalVisits);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await listFn({ data: { companyId, chantierId } });
      setRows(res.visits as unknown as Row[]);
    } catch (e: any) {
      toast.error(e?.message ?? "Chargement des visites impossible");
    } finally {
      setLoading(false);
    }
  }, [chantierId, companyId, listFn]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-3">
      {canCreate ? (
        <Button asChild variant="outline" className="h-11 w-full sm:w-auto">
          <Link to="/visites-techniques/nouvelle">
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Nouvelle visite technique
          </Link>
        </Button>
      ) : null}

      {rows.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-6 text-center">
          <ClipboardList className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Aucune visite technique sur ce chantier.</p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {rows.map((v) => (
            <li key={v.id} className="min-w-0">
              <Link
                to="/visites-techniques/$id"
                params={{ id: v.id }}
                className="flex min-w-0 items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-muted/60"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{v.reference}</span>
                    <VisitStatusBadge status={v.status} />
                    <Badge variant="outline">
                      {isVisitType(v.visit_type) ? getVisitTemplate(v.visit_type).label : v.visit_type}
                    </Badge>
                  </div>
                  <p className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                    <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{fmt(v.scheduled_at)}</span>
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <Progress value={v.completion_percent ?? 0} className="h-1.5 flex-1" aria-label="Complétude" />
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {v.completion_percent ?? 0}%
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Compliance widget for the dashboard.
 *
 * Surfaces forensic-quality KPIs of the reserve-lift module:
 *  - % of photos with GPS / EXIF
 *  - % reserves validated / rejected / unassigned / overdue
 *  - suspicious metadata count (anti-fraud)
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { ShieldCheck, MapPin, AlertTriangle, Camera, CheckCircle2, XCircle, UserX, Clock } from "lucide-react";
import { getReserveComplianceMetrics } from "@/lib/reserve-compliance.functions";

type Metrics = Awaited<ReturnType<typeof getReserveComplianceMetrics>>;

function Row({
  icon: Icon,
  label,
  value,
  tone = "text-foreground",
  detail,
}: {
  icon: any;
  label: string;
  value: string;
  tone?: string;
  detail?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className={`h-3.5 w-3.5 ${tone}`} />
        <span className="truncate text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="text-right">
        <div className={`text-sm font-semibold tabular-nums ${tone}`}>{value}</div>
        {detail && <div className="text-[10px] text-muted-foreground">{detail}</div>}
      </div>
    </div>
  );
}

export function ComplianceWidget({ companyId }: { companyId: string }) {
  const fetchFn = useServerFn(getReserveComplianceMetrics);
  const [m, setM] = useState<Metrics | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchFn({ data: { companyId } });
        if (!cancelled) setM(r);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Indisponible");
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, fetchFn]);

  if (err) {
    return (
      <Card className="p-6">
        <h3 className="font-display font-semibold">Conformité réserves</h3>
        <p className="mt-2 text-xs text-destructive">{err}</p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="h-3.5 w-3.5" />
          </div>
          <div>
            <h3 className="font-display font-semibold">Conformité réserves</h3>
            <p className="text-[11px] text-muted-foreground">Qualité des preuves photo & traitement.</p>
          </div>
        </div>
      </div>

      {!m ? (
        <div className="mt-4 grid gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-md bg-muted/40" />
          ))}
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Photos ({m.photos.total})</p>
            <Row icon={MapPin} label="Avec GPS" value={`${m.photos.withGpsPct}%`} detail={`${m.photos.withGps}/${m.photos.total}`} tone="text-primary" />
            <Row icon={Camera} label="Avec EXIF" value={`${m.photos.withExifPct}%`} detail={`${m.photos.withExif}/${m.photos.total}`} />
            <Row icon={AlertTriangle} label="Métadonnées suspectes" value={String(m.photos.suspicious)} tone={m.photos.suspicious > 0 ? "text-destructive" : "text-success"} />
          </div>
          <div className="space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Réserves ({m.reserves.total})</p>
            <Row icon={CheckCircle2} label="Validées" value={`${m.reserves.validatedPct}%`} detail={`${m.reserves.validated}/${m.reserves.total}`} tone="text-success" />
            <Row icon={XCircle} label="Rejetées" value={`${m.reserves.rejectedPct}%`} detail={`${m.reserves.rejected}/${m.reserves.total}`} tone={m.reserves.rejected > 0 ? "text-destructive" : "text-muted-foreground"} />
            <Row icon={UserX} label="Sans responsable" value={`${m.reserves.unassignedPct}%`} detail={`${m.reserves.unassigned}`} tone={m.reserves.unassigned > 0 ? "text-warning" : "text-muted-foreground"} />
            <Row icon={Clock} label="Hors délai" value={`${m.reserves.overduePct}%`} detail={`${m.reserves.overdue}`} tone={m.reserves.overdue > 0 ? "text-destructive" : "text-success"} />
          </div>
        </div>
      )}
    </Card>
  );
}

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
import { ShieldCheck, MapPin, AlertTriangle, Camera, CheckCircle2, XCircle, UserX, Clock, type LucideIcon } from "lucide-react";
import { getReserveComplianceMetrics } from "@/lib/reserve-compliance.functions";

type Metrics = Awaited<ReturnType<typeof getReserveComplianceMetrics>>;

function Row({
  icon: Icon,
  label,
  value,
  tone = "text-foreground",
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: string;
  detail?: string;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border py-2">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className={`h-4 w-4 shrink-0 ${tone}`} />
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <div className="shrink-0 text-right">
        <div className={`text-sm font-semibold tabular-nums ${tone}`}>{value}</div>
        {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
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
    setM(null);
    setErr(null);
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchFn({ data: { companyId } });
        if (!cancelled) setM(r);
      } catch {
        if (!cancelled) setErr("Suivi documentaire indisponible pour le moment.");
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, fetchFn]);

  if (err) {
    return (
      <section className="min-w-0 border-t border-border pt-5" aria-label="Suivi documentaire">
        <h2 className="font-display text-lg font-semibold">Suivi documentaire</h2>
        <p role="status" className="mt-2 text-sm text-muted-foreground">{err}</p>
      </section>
    );
  }

  return (
    <section className="min-w-0 border-t border-border pt-5" aria-label="Suivi documentaire" aria-busy={!m}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="h-3.5 w-3.5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold">Suivi documentaire</h2>
            <p className="text-sm text-muted-foreground">Preuves photo et traitement des réserves</p>
          </div>
        </div>
      </div>

      {!m ? (
        <div className="mt-4 grid gap-2" role="status" aria-label="Chargement du suivi documentaire">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-md bg-muted/40" />
          ))}
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Photos ({m.photos.total}) · 1 000 dernières au maximum</p>
            <Row icon={MapPin} label="Avec GPS" value={`${m.photos.withGpsPct}%`} detail={`${m.photos.withGps}/${m.photos.total}`} tone="text-primary" />
            <Row icon={Camera} label="Avec EXIF" value={`${m.photos.withExifPct}%`} detail={`${m.photos.withExif}/${m.photos.total}`} />
            <Row icon={AlertTriangle} label="Métadonnées suspectes" value={String(m.photos.suspicious)} tone={m.photos.suspicious > 0 ? "text-destructive" : "text-success"} />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Réserves ({m.reserves.total})</p>
            <Row icon={CheckCircle2} label="Validées" value={`${m.reserves.validatedPct}%`} detail={`${m.reserves.validated}/${m.reserves.total}`} tone="text-success" />
            <Row icon={XCircle} label="Rejetées" value={`${m.reserves.rejectedPct}%`} detail={`${m.reserves.rejected}/${m.reserves.total}`} tone={m.reserves.rejected > 0 ? "text-destructive" : "text-muted-foreground"} />
            <Row icon={UserX} label="Sans responsable" value={`${m.reserves.unassignedPct}%`} detail={`${m.reserves.unassigned}`} tone={m.reserves.unassigned > 0 ? "text-warning" : "text-muted-foreground"} />
            <Row icon={Clock} label="Hors délai" value={`${m.reserves.overduePct}%`} detail={`${m.reserves.overdue}`} tone={m.reserves.overdue > 0 ? "text-destructive" : "text-success"} />
          </div>
        </div>
      )}
    </section>
  );
}

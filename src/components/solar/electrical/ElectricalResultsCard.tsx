/** Résultats : synthèse de la conception électrique enregistrée (lecture seule). */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DESIGN_STATUS_LABEL, TOPOLOGY_LABEL } from "@/lib/solar-electrical";
import { getElectricalContext } from "@/lib/solar-electrical.functions";

type Ctx = Awaited<ReturnType<typeof getElectricalContext>>;

export function ElectricalResultsCard({ companyId, modelId, expert }: { companyId: string; modelId: string; expert: boolean }) {
  const load = useServerFn(getElectricalContext);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  useEffect(() => {
    load({ data: { companyId, modelId } }).then((c) => setCtx(c as Ctx)).catch(() => setCtx(null));
  }, [load, companyId, modelId]);
  if (!ctx) return null;
  const d = ctx.design;
  if (!d) {
    return <Card className="p-3 text-xs text-muted-foreground">Conception électrique : non réalisée.</Card>;
  }
  if (ctx.designStale) {
    return (
      <Card role="alert" className="p-3 text-xs text-destructive">
        L'implantation a changé depuis le calcul électrique. Relancez le câblage.
      </Card>
    );
  }
  const inv = d.inverter_snapshot;
  const kw = (w: number | null) => (w == null ? "Non vérifiable" : `${(w / 1000).toFixed(2)} kW`);
  return (
    <Card className="space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">Conception électrique</p>
        <Badge variant="secondary">{TOPOLOGY_LABEL[d.topology] ?? d.topology}</Badge>
        {d.topology === "hybride" && <Badge>Hybride</Badge>}
        <Badge variant={d.status === "valide" ? "default" : "outline"}>{DESIGN_STATUS_LABEL[d.status] ?? d.status}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div><dt className="text-muted-foreground">Onduleur</dt><dd>{d.inverter_count} × {inv.manufacturer} {inv.model}</dd></div>
        <div><dt className="text-muted-foreground">Phase</dt><dd>{inv.phase === "tri" ? "Triphasé" : inv.phase === "mono" ? "Monophasé" : "Non renseignée"}</dd></div>
        <div><dt className="text-muted-foreground">AC / DC</dt><dd>{kw(d.summary.ac_power_w)} / {kw(d.summary.dc_power_w)}</dd></div>
        <div><dt className="text-muted-foreground">Ratio DC/AC</dt><dd>{d.summary.dc_ac_ratio ?? "Non vérifiable"}</dd></div>
        <div><dt className="text-muted-foreground">{d.topology === "micro" ? "Micro-onduleurs" : "Strings"}</dt><dd>{d.summary.strings}</dd></div>
        <div><dt className="text-muted-foreground">MPPT utilisés</dt><dd>{d.summary.mppts.length || "—"}</dd></div>
        <div><dt className="text-muted-foreground">Non raccordés</dt><dd>{d.summary.unassigned}</dd></div>
      </dl>
      {d.warnings.length > 0 && (
        <ul className="list-disc pl-4 text-xs text-muted-foreground">
          {d.warnings.slice(0, expert ? undefined : 5).map((w, i) => <li key={i}>{w.scope} — {w.message}</li>)}
        </ul>
      )}
    </Card>
  );
}

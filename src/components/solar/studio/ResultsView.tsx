/**
 * Solar Studio V2 — P1 : étape « Résultats ».
 *
 * Toutes les valeurs affichées proviennent du modèle enregistré via les modules
 * purs `results.ts` / `plan-drawing.ts`. Aucune production annuelle ni ombrage
 * n'est affiché : ces calculs n'existent pas encore (bloc « à venir »).
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  drawingFromModel,
  formatModelAddress,
  resultsFromModel,
  type ReportModelLike,
} from "@/lib/solar/report-from-model";
import { renderPlanSvg } from "@/lib/solar/plan-drawing";
import { moduleTypeLabel, planExportFileName } from "@/lib/solar/results";
import { exportSolarPdf } from "@/lib/solar-export.functions";

function download(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function ResultsView({
  payload,
  companyId,
  studyId,
  reference,
  expert,
}: {
  payload: ReportModelLike;
  companyId: string | null;
  studyId: string;
  reference: string | null;
  expert: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);

  const report = useMemo(() => resultsFromModel(payload), [payload]);
  const drawing = useMemo(
    () =>
      drawingFromModel(payload, {
        title: "Plan d'implantation photovoltaïque",
        subtitle: formatModelAddress(payload.model),
      }),
    [payload],
  );
  const svg = useMemo(() => renderPlanSvg(drawing), [drawing]);

  const exportSvg = () => {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    download(url, planExportFileName(reference, new Date(), "svg"));
    URL.revokeObjectURL(url);
  };

  const exportPng = async () => {
    setBusy("png");
    try {
      const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("image"));
        img.src = url;
      });
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = (img.width || 1200) * scale;
      canvas.height = (img.height || 800) * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      download(canvas.toDataURL("image/png"), planExportFileName(reference, new Date(), "png"));
    } catch {
      toast.error("Export image impossible. Utilisez l'export vectoriel (SVG).");
    } finally {
      setBusy(null);
    }
  };

  const exportPdf = async (variant: "client" | "technique") => {
    if (!companyId) return;
    setBusy(variant);
    try {
      const res = (await exportSolarPdf({ data: { companyId, studyId, variant } })) as {
        url: string;
        fileName: string;
      };
      download(res.url, res.fileName);
      toast.success("Document prêt.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Génération du document impossible.");
    } finally {
      setBusy(null);
    }
  };

  const g = report.global;

  return (
    <div className="h-full overflow-auto p-3">
      <div className="mx-auto flex max-w-5xl flex-col gap-3">
        {report.warnings.length > 0 && (
          <Card className="space-y-1 border-amber-300 bg-amber-50/60 p-3 dark:bg-amber-950/20">
            <p className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4" aria-hidden /> Points à vérifier
            </p>
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
              {report.warnings.map((w, i) => (
                <li key={`${w.code}-${i}`}>{w.message}</li>
              ))}
            </ul>
          </Card>
        )}

        <Card className="space-y-3 p-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric
              label={g.power_complete ? "Puissance installée" : "Puissance connue"}
              value={`${g.power_kwc} kWc`}
            />
            <Metric label="Panneaux" value={String(g.module_count)} />
            <Metric label="Surface de panneaux" value={`${g.module_area_m2} m²`} />
            <Metric label="Surface de toiture" value={`${g.roof_area_m2} m²`} />
          </div>
          <div className="grid gap-1 text-sm sm:grid-cols-2">
            {g.module_types.length > 1 ? (
              <div className="sm:col-span-2">
                <p className="font-medium">{g.module_types.length} références de panneaux</p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {g.module_types.map((t) => (
                    <li key={`${moduleTypeLabel(t)}-${t.width_mm}-${t.height_mm}-${t.power_wc}`}>
                      {moduleTypeLabel(t)} — {t.power_wc ?? "?"} Wc —{" "}
                      {t.width_mm && t.height_mm
                        ? `${Math.round(t.width_mm)} × ${Math.round(t.height_mm)} mm`
                        : "dimensions non renseignées"}{" "}
                      — {t.module_count} panneaux — {t.power_kwc ?? "?"} kWc
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                <p>
                  <span className="text-muted-foreground">Panneau : </span>
                  {[g.spec.manufacturer, g.spec.model].filter(Boolean).join(" ") || "Non renseigné"}
                </p>
                <p>
                  <span className="text-muted-foreground">Dimensions : </span>
                  {g.spec.width_mm && g.spec.height_mm
                    ? `${Math.round(g.spec.width_mm)} × ${Math.round(g.spec.height_mm)} mm`
                    : "Non renseignées"}
                </p>
              </>
            )}
            <p>
              <span className="text-muted-foreground">Pans utilisés : </span>
              {g.planes_used}
            </p>
            <p>
              <span className="text-muted-foreground">Orientation de pose : </span>
              {g.orientations.join(", ") || "—"}
            </p>
          </div>
          <Badge variant={g.status === "ok" ? "secondary" : "destructive"}>
            {g.status === "ok" ? "Géométrie cohérente" : "Géométrie à vérifier"}
          </Badge>
        </Card>

        <Card className="space-y-2 p-3">
          <p className="text-sm font-medium">Détail par pan</p>
          <div className="grid gap-2 md:grid-cols-2">
            {report.planes.map((p) => (
              <div key={p.key} className="rounded-md border p-2 text-sm">
                <p className="font-medium">{p.name}</p>
                <p className="text-muted-foreground">
                  {p.area_m2} m² · {p.tilt_deg}° · {p.azimuth_deg}° {p.cardinal}
                </p>
                <p>
                  {p.module_count} panneaux —{" "}
                  {p.power_known ? `${p.power_kwc} kWc — ${p.module_area_m2} m²` : "puissance inconnue"}
                </p>
                {(p.invalid_count > 0 || p.warning_count > 0) && (
                  <p className="text-xs text-destructive">
                    {p.invalid_count > 0 && `${p.invalid_count} invalide(s)`}
                    {p.invalid_count > 0 && p.warning_count > 0 && " · "}
                    {p.warning_count > 0 && `${p.warning_count} à vérifier`}
                  </p>
                )}
                {p.obstacles.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Obstacles : {p.obstacles.join(", ")}
                  </p>
                )}
                {p.alerts.map((a) => (
                  <p key={a} className="text-xs text-amber-600">
                    {a}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </Card>

        <Card className="space-y-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Plan d'implantation</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="min-h-11" onClick={exportSvg}>
                <Download className="mr-2 h-4 w-4" aria-hidden /> Plan vectoriel (SVG)
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={busy === "png"}
                onClick={() => void exportPng()}
              >
                <Download className="mr-2 h-4 w-4" aria-hidden /> Image (PNG)
              </Button>
            </div>
          </div>
          <div
            className="overflow-auto rounded-md border bg-white p-2 [&>svg]:h-auto [&>svg]:w-full"
            // Plan vectoriel généré localement à partir du modèle : aucune source externe.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </Card>

        <Card className="flex flex-wrap items-center gap-2 p-3">
          <Button
            type="button"
            className="min-h-11"
            disabled={busy === "client" || !companyId}
            onClick={() => void exportPdf("client")}
          >
            <FileText className="mr-2 h-4 w-4" aria-hidden /> PDF client
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={busy === "technique" || !companyId}
            onClick={() => void exportPdf("technique")}
          >
            <FileText className="mr-2 h-4 w-4" aria-hidden /> PDF technique
          </Button>
          <p className="text-xs text-muted-foreground">
            Implantation indicative à confirmer selon relevé terrain et contraintes de pose.
          </p>
        </Card>

        <Card className="space-y-2 p-3">
          <p className="text-sm font-medium">Simulation énergétique</p>
          <p className="text-sm text-muted-foreground">
            Production annuelle et ombrage : à venir. Aucune estimation n'est affichée tant que le
            calcul n'est pas réellement réalisé.
          </p>
        </Card>

        {expert && (
          <Card className="p-3">
            <button
              type="button"
              className="flex min-h-11 w-full items-center justify-between text-sm font-medium"
              onClick={() => setShowTechnical((s) => !s)}
              aria-expanded={showTechnical}
            >
              Données techniques
              <ChevronDown
                className={`h-4 w-4 transition-transform ${showTechnical ? "rotate-180" : ""}`}
                aria-hidden
              />
            </button>
            {showTechnical && (
              <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                {(
                  [
                    ["Version géométrique", String(report.technical.geometry_version)],
                    ["Empreinte géométrique", report.technical.geometry_hash_short ?? "—"],
                    ...report.technical.configurations.map(
                      (c) =>
                        [
                          `Pan ${c.plane_name}`,
                          `${c.module_variant_id ?? "—"} · rév. ${c.module_revision_id ?? "—"} · règles ${c.rules_profile_id ?? "—"}${c.rules_profile_version === null ? "" : ` v${c.rules_profile_version}`} · moteur ${c.layout_engine_version ?? "—"}`,
                        ] as const,
                    ),
                    [
                      "Dernière modification",
                      report.technical.updated_at
                        ? new Date(report.technical.updated_at).toLocaleString("fr-FR")
                        : "—",
                    ],
                    ["Données vérifiées", report.technical.quality_verified ?? "—"],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 border-b py-1">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="truncate font-mono">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

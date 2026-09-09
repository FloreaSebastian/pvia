/**
 * Solar Studio — panneau « Site » (phase 2).
 *
 * Localisation, disponibilité des données publiques, traitements géospatiaux,
 * cotes et fiche qualité. Aucun appel fournisseur direct : tout passe par les
 * fonctions serveur.
 */
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, Loader2, MapPin, Ruler, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  applyDimensionConstraint,
  applySolarProposal,
  confirmSolarLocation,
  getSolarSiteData,
  recordFieldMeasurement,
  revertSolarGeometry,
  saveSolarMeasurement,
  deleteSolarMeasurement,
  searchSolarAddress,
  startSolarJob,
} from "@/lib/solar-geo.functions";
import type { SolarModelPayload } from "@/lib/solar.functions";
import { CONFIDENCE_META, SOURCE_TYPE_META, VERIFICATION_META, type ConfidenceLevel } from "@/lib/solar/provenance";
import { formatLength } from "@/lib/solar/units";
import type { BuildingParams } from "@/lib/solar/types";

type Payload = NonNullable<SolarModelPayload>;

interface Props {
  payload: Payload;
  companyId: string | null;
  disabled: boolean;
  onPayload: (next: Payload) => void;
}

interface Candidate {
  label: string;
  latitude: number;
  longitude: number;
  address: string;
  postal_code: string;
  city: string;
}

export function SitePanel({ payload, companyId, disabled, onPayload }: Props) {
  const search = useServerFn(searchSolarAddress);
  const confirm = useServerFn(confirmSolarLocation);
  const siteData = useServerFn(getSolarSiteData);
  const runJob = useServerFn(startSolarJob);
  const applyProposal = useServerFn(applySolarProposal);
  const revert = useServerFn(revertSolarGeometry);
  const addMeasure = useServerFn(saveSolarMeasurement);
  const removeMeasure = useServerFn(deleteSolarMeasurement);
  const fieldMeasure = useServerFn(recordFieldMeasurement);
  const constrain = useServerFn(applyDimensionConstraint);

  const [query, setQuery] = useState(payload.model.address ?? "");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [site, setSite] = useState<Awaited<ReturnType<typeof getSolarSiteData>> | null>(null);
  const [job, setJob] = useState<{ id: string; job_type: string; status: string; error_message: string | null; result: unknown } | null>(null);
  const [busy, setBusy] = useState(false);

  const model = payload.model;
  const located = model.origin_latitude != null && model.origin_longitude != null;

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      try {
        return await fn();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Action impossible.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!companyId || !located) return;
    let cancelled = false;
    siteData({ data: { companyId, modelId: model.id, refresh: false } })
      .then((res) => !cancelled && setSite(res))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [companyId, located, model.id, siteData]);

  if (!companyId) return null;

  const proposal = (job?.result as { proposal?: BuildingParams; current?: BuildingParams; rectangularity?: number } | null) ?? null;

  return (
    <div className="space-y-3">
      {/* ------------------------------ Localisation ---------------------------- */}
      <Card className="space-y-3 p-3">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold">Localisation du bâtiment</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          {located
            ? `${model.origin_latitude?.toFixed(6)}, ${model.origin_longitude?.toFixed(6)}${
                model.origin_altitude_m == null ? " — altitude inconnue" : ` — altitude ${model.origin_altitude_m.toFixed(1)} m`
              }`
            : "Position non confirmée : les données publiques ne peuvent pas être consultées."}
        </p>
        <div className="flex gap-2">
          <Input
            className="min-h-11"
            value={query}
            placeholder="Adresse du chantier"
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Rechercher une adresse"
          />
          <Button
            variant="outline"
            className="min-h-11"
            disabled={disabled || busy || query.trim().length < 3}
            onClick={() =>
              void run(async () => {
                const res = await search({ data: { companyId, query: query.trim() } });
                if (!res.ok) {
                  toast.error(res.message ?? "Recherche indisponible.");
                  setCandidates([]);
                  return null;
                }
                setCandidates(res.candidates as Candidate[]);
                if (!res.candidates.length) toast.info("Aucune adresse trouvée.");
                return null;
              })
            }
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            <span className="sr-only">Rechercher</span>
          </Button>
        </div>
        {candidates.length > 0 && (
          <ul className="divide-y rounded-md border">
            {candidates.map((c, i) => (
              <li key={`${c.label}-${i}`}>
                <button
                  type="button"
                  className="min-h-11 w-full p-2 text-left text-xs hover:bg-accent"
                  disabled={disabled || busy}
                  onClick={() =>
                    void run(async () => {
                      const next = (await confirm({
                        data: {
                          companyId,
                          modelId: model.id,
                          latitude: c.latitude,
                          longitude: c.longitude,
                          address: c.address,
                          postal_code: c.postal_code,
                          city: c.city,
                          label: c.label,
                        },
                      })) as Payload;
                      onPayload(next);
                      setCandidates([]);
                      toast.success("Position confirmée.");
                      return null;
                    })
                  }
                >
                  {c.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        {candidates.length > 1 && (
          <p className="text-xs text-muted-foreground">
            Plusieurs adresses correspondent : choisissez celle du chantier, rien n'est retenu automatiquement.
          </p>
        )}
      </Card>

      {/* --------------------------- Données disponibles ------------------------ */}
      {located && (
        <Card className="space-y-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Données publiques disponibles</h2>
            <Button
              variant="ghost"
              className="min-h-11"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const res = await siteData({ data: { companyId, modelId: model.id, refresh: true } });
                  setSite(res);
                  return null;
                })
              }
            >
              Actualiser
            </Button>
          </div>
          <ul className="space-y-1.5">
            {(site?.coverage ?? []).map((c) => (
              <li key={c.dataset_kind} className="flex items-start justify-between gap-2 text-xs">
                <span className="min-w-0">
                  <span className="block font-medium">{c.label}</span>
                  <span className="block text-muted-foreground">{c.detail}</span>
                </span>
                <Badge variant={c.available ? "secondary" : "outline"}>
                  {c.available ? "Disponible" : "Indisponible"}
                </Badge>
              </li>
            ))}
            {!site && <li className="text-xs text-muted-foreground">Vérification en cours…</li>}
          </ul>
          {site?.attribution && <p className="text-[11px] text-muted-foreground">{site.attribution}</p>}
        </Card>
      )}

      {/* -------------------------------- Traitements --------------------------- */}
      {located && (
        <Card className="space-y-2 p-3">
          <h2 className="text-sm font-semibold">Traitements géospatiaux</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(
              [
                ["GENERATE_TERRAIN", "Relever le terrain"],
                ["DETECT_ROOF", "Proposer le bâtiment"],
                ["GENERATE_SURFACE", "Modèle de surface"],
                ["FETCH_LIDAR", "LiDAR HD"],
              ] as const
            ).map(([type, label]) => (
              <Button
                key={type}
                variant="outline"
                className="min-h-11"
                disabled={disabled || busy}
                onClick={() =>
                  void run(async () => {
                    const res = (await runJob({ data: { companyId, modelId: model.id, jobType: type, force: false } })) as typeof job;
                    setJob(res);
                    if (res?.status === "FAILED") toast.error(res.error_message ?? "Traitement impossible.");
                    else toast.success("Traitement terminé.");
                    return null;
                  })
                }
              >
                {label}
              </Button>
            ))}
          </div>
          {job && (
            <div className="space-y-2 rounded-md border p-2 text-xs">
              <p className="font-medium">
                {job.job_type} — {job.status === "COMPLETED" ? "terminé" : job.status === "FAILED" ? "échec" : "en cours"}
              </p>
              {job.error_message && <p className="text-destructive">{job.error_message}</p>}
              {proposal?.proposal && (
                <>
                  <p className="text-muted-foreground">
                    Proposition : {formatLength(proposal.proposal.width_m)} × {formatLength(proposal.proposal.depth_m)},
                    azimut {Math.round(proposal.proposal.azimuth_deg)}°
                    {proposal.current
                      ? ` — actuel ${formatLength(proposal.current.width_m)} × ${formatLength(proposal.current.depth_m)}, azimut ${Math.round(proposal.current.azimuth_deg)}°`
                      : ""}
                  </p>
                  <p className="text-muted-foreground">
                    Contour cartographique : la pente réelle et la hauteur restent à confirmer sur site.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="min-h-11"
                      disabled={disabled || busy}
                      onClick={() =>
                        void run(async () => {
                          const next = (await applyProposal({
                            data: {
                              companyId,
                              modelId: model.id,
                              jobId: job.id,
                              expectedGeometryVersion: model.geometry_version,
                            },
                          })) as Payload;
                          onPayload(next);
                          toast.success("Modèle appliqué. La géométrie précédente est conservée.");
                          return null;
                        })
                      }
                    >
                      Appliquer
                    </Button>
                    <Button
                      variant="outline"
                      className="min-h-11"
                      disabled={disabled || busy}
                      onClick={() =>
                        void run(async () => {
                          const next = (await revert({ data: { companyId, modelId: model.id } })) as Payload;
                          onPayload(next);
                          toast.success("Géométrie précédente restaurée.");
                          return null;
                        })
                      }
                    >
                      Revenir en arrière
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Le LiDAR brut et le modèle de surface exigent un service de traitement externe : tant qu'il n'est pas
            connecté, aucune donnée n'est inventée.
          </p>
        </Card>
      )}

      {/* ---------------------------------- Cotes -------------------------------- */}
      <MeasurePanel
        payload={payload}
        disabled={disabled || busy}
        onAdd={(values) =>
          void run(async () => {
            const next = (await addMeasure({ data: { companyId, modelId: model.id, ...values } })) as Payload;
            onPayload(next);
            toast.success("Cote enregistrée.");
            return null;
          })
        }
        onDelete={(measurementId) =>
          void run(async () => {
            const next = (await removeMeasure({ data: { companyId, modelId: model.id, measurementId } })) as Payload;
            onPayload(next);
            return null;
          })
        }
        onField={(measurementId, value) =>
          void run(async () => {
            const next = (await fieldMeasure({
              data: { companyId, modelId: model.id, measurementId, value_field: value, verification_method: "mesure sur site", retain: true },
            })) as Payload;
            onPayload(next);
            toast.success("Mesure terrain enregistrée.");
            return null;
          })
        }
        onConstrain={(target, value) =>
          void run(async () => {
            const next = (await constrain({
              data: { companyId, modelId: model.id, target, value, expectedGeometryVersion: model.geometry_version },
            })) as Payload;
            onPayload(next);
            toast.success("Dimension corrigée à partir de la mesure.");
            return null;
          })
        }
      />

      {/* -------------------------------- Qualité -------------------------------- */}
      <Card className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Qualité du modèle</h2>
          <Badge variant="outline">
            {CONFIDENCE_META[payload.quality.overall as ConfidenceLevel].badge}{" "}
            {CONFIDENCE_META[payload.quality.overall as ConfidenceLevel].label}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {payload.quality.verified_count}/{payload.quality.total_count} élément(s) vérifié(s) sur site. Le niveau global
          correspond au plus faible constaté, jamais à une moyenne.
        </p>
        <ul className="space-y-1.5">
          {payload.quality.rows.map((r, i) => (
            <li key={`${r.label}-${i}`} className="flex items-start justify-between gap-2 text-xs">
              <span className="min-w-0">
                <span className="block font-medium">{r.label}</span>
                <span className="block text-muted-foreground">
                  {SOURCE_TYPE_META[r.source].label} · {r.detail}
                </span>
              </span>
              <span className="shrink-0 text-right text-muted-foreground">
                <span className="block">{CONFIDENCE_META[r.confidence].label}</span>
                <span className="block">{VERIFICATION_META[r.verification].label}</span>
              </span>
            </li>
          ))}
        </ul>
        <Separator />
        <p className="text-[11px] text-muted-foreground">
          Version géométrique {model.geometry_version}
          {model.location_confirmed_at ? " · position confirmée" : " · position non confirmée"}
        </p>
      </Card>
    </div>
  );
}

/* --------------------------------- Cotes ---------------------------------- */

function MeasurePanel({
  payload,
  disabled,
  onAdd,
  onDelete,
  onField,
  onConstrain,
}: {
  payload: Payload;
  disabled: boolean;
  onAdd: (values: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  onField: (id: string, value: number) => void;
  onConstrain: (target: "width_m" | "depth_m" | "wall_height_m" | "tilt_deg", value: number) => void;
}) {
  const [label, setLabel] = useState("Largeur mesurée");
  const [value, setValue] = useState(payload.params.width_m);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  return (
    <Card className="space-y-3 p-3">
      <div className="flex items-center gap-2">
        <Ruler className="h-4 w-4 text-primary" aria-hidden />
        <h2 className="text-sm font-semibold">Cotes et mesures</h2>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Intitulé</Label>
          <Input className="min-h-11" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Valeur (m)</Label>
          <Input
            className="min-h-11"
            type="number"
            inputMode="decimal"
            step={0.01}
            value={value}
            onChange={(e) => {
              const n = Number(e.target.value.replace(",", "."));
              if (Number.isFinite(n)) setValue(n);
            }}
          />
        </div>
      </div>
      <Button
        className="min-h-11 w-full"
        disabled={disabled || !label.trim()}
        onClick={() =>
          onAdd({
            measure_type: "distance",
            category: "autre",
            label: label.trim(),
            value_numeric: value,
            unit: "m",
            pinned: true,
            geometry: [],
            data_source: "MANUAL",
          })
        }
      >
        Ajouter la cote
      </Button>

      <ul className="space-y-2">
        {payload.measurements.map((m) => (
          <li key={m.id} className="space-y-1 rounded-md border p-2 text-xs">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block font-medium">{m.label ?? m.measure_type}</span>
                <span className="block text-muted-foreground">
                  Estimé {formatLength(m.value_estimated ?? m.value_numeric ?? 0 ?? 0)}
                  {m.value_field != null ? ` · terrain ${formatLength(m.value_field)}` : ""} · retenu{" "}
                  {formatLength(m.value_retained ?? m.value_numeric ?? 0 ?? 0)}
                </span>
              </span>
              <div className="flex items-center gap-1">
                {m.verification_status === "verified" && (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="Vérifié terrain" />
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11"
                  aria-label="Supprimer la cote"
                  disabled={disabled}
                  onClick={() => onDelete(m.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="min-h-11 w-28"
                type="number"
                inputMode="decimal"
                step={0.01}
                placeholder="Terrain"
                aria-label={`Mesure terrain pour ${m.label ?? m.measure_type}`}
                value={fieldValues[m.id] ?? ""}
                onChange={(e) => setFieldValues((s) => ({ ...s, [m.id]: e.target.value }))}
              />
              <Button
                variant="outline"
                className="min-h-11"
                disabled={disabled || !fieldValues[m.id]}
                onClick={() => {
                  const n = Number((fieldValues[m.id] ?? "").replace(",", "."));
                  if (Number.isFinite(n)) onField(m.id, n);
                }}
              >
                Valider terrain
              </Button>
              <Button
                variant="ghost"
                className="min-h-11"
                disabled={disabled || m.value_retained == null}
                onClick={() => onConstrain("width_m", m.value_retained ?? m.value_numeric ?? 0 ?? 0)}
              >
                Contraindre la largeur
              </Button>
            </div>
          </li>
        ))}
        {!payload.measurements.length && (
          <li className="text-xs text-muted-foreground">
            Aucune cote. Les mesures terrain remplacent l'estimation sans l'effacer.
          </li>
        )}
      </ul>
    </Card>
  );
}

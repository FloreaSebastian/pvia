/**
 * Solar Studio — reconstruction 3D du bâtiment à partir des données réelles.
 *
 * Ce panneau n'invente jamais de donnée : si le moteur de traitement n'est pas
 * configuré ou injoignable, il le dit et ne propose aucune analyse.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Boxes, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  applySolar3dProposal,
  cancelSolar3dAnalysis,
  getSolar3dProposal,
  getSolarEngineStatus,
  startBuilding3dAnalysis,
} from "@/lib/solar-engine.functions";
import {
  ENGINE_STATE_LABEL,
  DATASET_STATE_LABEL,
  planeQualityLine,
  type EngineDiffRow,
  type EngineRoofModel,
} from "@/lib/solar/engine";
import type { EngineStatus } from "@/lib/solar/engine.server";
import type { SolarModelPayload } from "@/lib/solar.functions";

type Payload = NonNullable<SolarModelPayload>;

interface JobRow {
  id: string;
  status: string;
  stage: string | null;
  progress_percent: number | null;
  progress_label: string | null;
  error_message: string | null;
  attempt_count: number | null;
  max_attempts: number | null;
}

interface Props {
  payload: Payload;
  companyId: string;
  disabled: boolean;
  onPayload: (next: Payload) => void;
}

const ACTIVE = new Set(["QUEUED", "CLAIMED", "PROCESSING"]);

export function Building3dPanel({ payload, companyId, disabled, onPayload }: Props) {
  const statusFn = useServerFn(getSolarEngineStatus);
  const startFn = useServerFn(startBuilding3dAnalysis);
  const cancelFn = useServerFn(cancelSolar3dAnalysis);
  const proposalFn = useServerFn(getSolar3dProposal);
  const applyFn = useServerFn(applySolar3dProposal);

  const model = payload.model;
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [job, setJob] = useState<JobRow | null>(null);
  const [proposal, setProposal] = useState<EngineRoofModel | null>(null);
  const [diff, setDiff] = useState<EngineDiffRow[]>([]);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const res = await statusFn({ data: { companyId, modelId: model.id } });
    setEngine(res.engine);
    const latest = (res.jobs?.[0] as JobRow | undefined) ?? null;
    setJob(latest);
    if (latest && latest.status === "COMPLETED") {
      const p = await proposalFn({ data: { companyId, modelId: model.id, jobId: latest.id } });
      setProposal((p.proposal as EngineRoofModel | null) ?? null);
      setDiff(p.diff as EngineDiffRow[]);
      setApplied(p.applied);
    } else {
      setProposal(null);
      setDiff([]);
      setApplied(false);
    }
    return latest;
  }, [companyId, model.id, proposalFn, statusFn]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const latest = await refresh();
        if (!cancelled && latest && ACTIVE.has(latest.status)) {
          timer.current = setTimeout(tick, 4000);
        }
      } catch {
        /* le panneau reste affiché : l'état sera revérifié à la prochaine action */
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  };

  const ready = engine?.state === "ready" || engine?.state === "degraded";
  const active = job && ACTIVE.has(job.status);

  return (
    <Card className="space-y-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold">Modèle 3D du bâtiment</h2>
        </div>
        <Badge variant={engine?.state === "ready" ? "secondary" : "outline"}>
          {engine ? ENGINE_STATE_LABEL[engine.state] : "Vérification…"}
        </Badge>
      </div>

      {engine && engine.state !== "ready" && (
        <p className="text-xs text-muted-foreground">
          {engine.detail ?? "Le service de reconstruction 3D n'est pas disponible : la saisie manuelle reste complète."}
        </p>
      )}

      {engine?.datasets?.length ? (
        <ul className="space-y-1">
          {engine.datasets.map((d) => (
            <li key={d.dataset_kind} className="flex items-start justify-between gap-2 text-xs">
              <span className="min-w-0">
                <span className="block font-medium">{d.label}</span>
                {d.detail && <span className="block text-muted-foreground">{d.detail}</span>}
              </span>
              <Badge variant={d.state === "available" ? "secondary" : "outline"}>
                {DATASET_STATE_LABEL[d.state]}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11"
          disabled={disabled || busy || !ready || !!active}
          onClick={() =>
            void run(async () => {
              await startFn({ data: { companyId, modelId: model.id } });
              await refresh();
              toast.success("Analyse 3D demandée. Vous pouvez continuer à travailler.");
            })
          }
        >
          Améliorer le modèle avec les données 3D
        </Button>
        {active && (
          <Button
            variant="outline"
            className="min-h-11"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const res = await cancelFn({ data: { companyId, modelId: model.id, jobId: job.id } });
                await refresh();
                toast.success(res.immediate ? "Analyse annulée." : "Annulation demandée au traitement en cours.");
              })
            }
          >
            Annuler
          </Button>
        )}
      </div>

      {job && (
        <div className="space-y-2 rounded-md border p-2 text-xs">
          <div className="flex items-center gap-2">
            {active && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            <span className="font-medium">
              {job.progress_label ?? job.stage ?? job.status}
              {job.attempt_count && job.attempt_count > 1
                ? ` — tentative ${job.attempt_count}/${job.max_attempts ?? "?"}`
                : ""}
            </span>
          </div>
          {active && <Progress value={job.progress_percent ?? 0} className="h-1.5" />}
          {job.status === "FAILED" && (
            <p className="text-destructive">{job.error_message ?? "L'analyse 3D a échoué."}</p>
          )}
        </div>
      )}

      {proposal && (
        <div className="space-y-2 rounded-md border p-2 text-xs">
          <p className="font-medium">Proposition issue des données 3D</p>
          <ul className="space-y-1">
            {diff.map((d) => (
              <li key={d.label} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{d.label}</span>
                <span>
                  {d.current} → {d.proposed}
                </span>
              </li>
            ))}
          </ul>
          <ul className="space-y-1 text-muted-foreground">
            {proposal.planes.map((p) => (
              <li key={p.index}>{planeQualityLine(p, proposal.sources[0]?.dataset ?? "LiDAR")}</li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            Aucune précision terrain n'est garantie : les pans détectés restent « à vérifier » tant qu'une mesure sur
            site ne les confirme pas.
          </p>
          {applied ? (
            <Badge variant="secondary">Déjà appliquée</Badge>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                className="min-h-11"
                disabled={disabled || busy}
                onClick={() =>
                  void run(async () => {
                    const res = await applySolar3dProposalSafe();
                    if (res) {
                      onPayload(res.model as Payload);
                      toast.success(
                        res.modules_message
                          ? `Modèle 3D appliqué. ${res.modules_message}`
                          : "Modèle 3D appliqué. La version précédente est conservée.",
                      );
                      await refresh();
                    }
                  })
                }
              >
                Appliquer le modèle 3D
              </Button>
              <span className="self-center text-muted-foreground">
                Le modèle actuel est enregistré comme version avant remplacement.
              </span>
            </div>
          )}
        </div>
      )}
    </Card>
  );

  async function applySolar3dProposalSafe() {
    if (!job) return null;
    return (await applyFn({
      data: {
        companyId,
        modelId: model.id,
        jobId: job.id,
        expectedGeometryVersion: model.geometry_version,
      },
    })) as { model: unknown; modules_message: string | null };
  }
}

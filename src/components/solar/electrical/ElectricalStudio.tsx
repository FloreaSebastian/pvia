/**
 * Solar Studio P2-A — étape Électrique.
 * Aucune modification de position de panneau ici : sélection et câblage seulement.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Plus, Redo2, Scale, Trash2, Undo2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { drawingFromModel, type ReportModelLike } from "@/lib/solar/report-from-model";
import {
  addEmptyGroup,
  designSignature,
  DESIGN_STATUS_LABEL,
  evaluateDesign,
  groupColor,
  historyInit,
  historyPush,
  historyRedo,
  historyUndo,
  moveModules,
  proposeWiring,
  rebalanceMppt,
  removeEmptyGroup,
  setGroupMppt,
  TOPOLOGY_LABEL,
  validateTemperatures,
  type DesignTemperatures,
  type ElecGroup,
  type History,
  type WiringProposal,
} from "@/lib/solar-electrical";
import { getElectricalContext, saveElectricalDesign } from "@/lib/solar-electrical.functions";
import { ManualInverterDialog } from "./ManualInverterDialog";

type Ctx = Awaited<ReturnType<typeof getElectricalContext>>;

const STATUS_TONE: Record<string, string> = {
  valide: "bg-primary/10 text-primary",
  avertissement: "bg-accent text-accent-foreground",
  non_verifiable: "bg-muted text-foreground",
  invalide: "bg-destructive/10 text-destructive",
};

export function ElectricalStudio(props: {
  payload: ReportModelLike;
  companyId: string;
  modelId: string;
  canWrite: boolean;
  expert: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { payload, companyId, modelId } = props;
  const load = useServerFn(getElectricalContext);
  const save = useServerFn(saveElectricalDesign);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inverterId, setInverterId] = useState<string>("");
  const [tmin, setTmin] = useState("");
  const [tmax, setTmax] = useState("");
  const [tsource, setTsource] = useState("");
  const [proposals, setProposals] = useState<WiringProposal[]>([]);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [hist, setHist] = useState<History<ElecGroup[]> | null>(null);
  const [variantLabel, setVariantLabel] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const c = (await load({ data: { companyId, modelId } })) as Ctx;
      setCtx(c);
      setLoadError(null);
      if (c.design && !c.designStale) {
        setInverterId((cur) => cur || c.design!.inverter_snapshot.inverter_id);
        setTmin((v) => v || String(c.design!.temp_min_c));
        setTmax((v) => v || String(c.design!.temp_max_c));
        setTsource((v) => v || c.design!.temp_source);
        setHist((h) => h ?? historyInit(c.design!.groups));
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }, [load, companyId, modelId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    props.onDirtyChange?.(dirty);
  }, [dirty, props]);

  const inverter = ctx?.inverters.find((i) => i.inverter_id === inverterId) ?? null;
  const temps: DesignTemperatures | null = useMemo(() => {
    const t = { tmin_c: Number(tmin), tmax_c: Number(tmax), source: tsource.trim() };
    if (tmin === "" || tmax === "") return null;
    return validateTemperatures(t) ? null : t;
  }, [tmin, tmax, tsource]);
  const tempError =
    tmin !== "" || tmax !== "" || tsource
      ? validateTemperatures({
          tmin_c: tmin === "" ? undefined : Number(tmin),
          tmax_c: tmax === "" ? undefined : Number(tmax),
          source: tsource,
        })
      : null;

  const groups = useMemo(() => hist?.present ?? [], [hist]);
  const evaluation = useMemo(
    () =>
      ctx && inverter && temps && groups.length
        ? evaluateDesign({
            inverter,
            modules: ctx.modules,
            electrical: ctx.electrical,
            temps,
            groups,
          })
        : null,
    [ctx, inverter, temps, groups],
  );

  const drawing = useMemo(() => drawingFromModel(payload, { title: "Câblage" }), [payload]);
  const groupIndexByModule = useMemo(() => {
    const m = new Map<string, number>();
    groups.forEach((g, i) => g.module_ids.forEach((id) => m.set(id, i)));
    return m;
  }, [groups]);
  const failingGroups = useMemo(() => {
    const s = new Set<string>();
    evaluation?.checks.forEach((c) => {
      if (c.status === "erreur") s.add(c.scope);
    });
    return s;
  }, [evaluation]);

  const commit = (next: ElecGroup[]) => {
    setHist((h) => (h ? historyPush(h, next) : historyInit(next)));
    setDirty(true);
    setSaveError(null);
  };

  const propose = () => {
    if (!ctx || !inverter || !temps) return;
    const res = proposeWiring({
      inverter,
      modules: ctx.modules,
      electrical: ctx.electrical,
      temps,
      plane_order: ctx.plane_order,
      layout_hash: ctx.layout_hash,
    });
    if (!res.ok) {
      setProposals([]);
      setProposalError(
        `${res.reason}${res.missing.length ? ` Champs manquants : ${res.missing.join(", ")}.` : ""}`,
      );
      return;
    }
    setProposalError(null);
    setProposals(res.proposals);
  };

  const onSave = async () => {
    if (!ctx || !inverter || !temps || !evaluation) return;
    setSaving(true);
    setSaveError(null);
    try {
      await save({
        data: {
          companyId,
          modelId,
          inverterId: inverter.inverter_id,
          inverterRevisionId: inverter.revision_id,
          temps,
          groups,
          signature: designSignature({
            inverter,
            electrical: ctx.electrical,
            temps,
            layout_hash: ctx.layout_hash,
            groups,
          }),
          expectedGeometryVersion: ctx.geometry_version,
          expectedLayoutVersion: ctx.layout_version,
          expectedLayoutHash: ctx.layout_hash,
          variantLabel,
        },
      });
      setDirty(false);
      toast.success("Conception électrique enregistrée.");
      await refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  };

  const toggleModule = (id: string, additive: boolean) => {
    setSelection((cur) =>
      additive ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : [id],
    );
  };

  if (loadError) {
    return <Card className="m-4 p-4 text-sm text-destructive">{loadError}</Card>;
  }
  if (!ctx)
    return <p className="p-4 text-sm text-muted-foreground">Chargement de l'étude électrique…</p>;

  const mpptCount = inverter?.mppt_count ?? 0;
  const isMicro = inverter?.kind === "micro";
  const { view } = drawing;

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* Canevas : plan coloré par string / micro-onduleur */}
      <div className="relative min-h-[260px] flex-1 overflow-hidden bg-muted/20">
        {ctx.designStale && (
          <p
            role="alert"
            className="absolute inset-x-2 top-2 z-10 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            L'implantation a changé depuis le calcul électrique. Relancez le câblage.
          </p>
        )}
        <svg
          viewBox={`${view.minX} ${-(view.minY + view.height)} ${view.width} ${view.height}`}
          className="h-full w-full"
          role="img"
          aria-label="Plan de câblage : panneaux colorés par string"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelection([]);
          }}
        >
          <g transform="scale(1,-1)">
            {drawing.items.map((it, i) => {
              if (it.kind === "polygon") {
                return (
                  <polygon
                    key={i}
                    points={it.points.map((p) => `${p.x},${p.y}`).join(" ")}
                    className="fill-background stroke-foreground/40"
                    strokeWidth={0.05}
                  />
                );
              }
              if (it.kind !== "rect" || !it.moduleId) return null;
              const gi = groupIndexByModule.get(it.moduleId);
              const selected = selection.includes(it.moduleId);
              const g = gi != null ? groups[gi] : null;
              const dim = activeGroup && g?.id !== activeGroup;
              return (
                <rect
                  key={i}
                  x={it.x}
                  y={it.y}
                  width={it.w}
                  height={it.h}
                  style={{ fill: g ? groupColor(gi!) : undefined, opacity: dim ? 0.35 : 1 }}
                  className={`${g ? "" : "fill-muted-foreground/30"} ${selected ? "stroke-foreground" : "stroke-background"} cursor-pointer`}
                  strokeWidth={selected ? 0.12 : 0.03}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleModule(it.moduleId!, e.shiftKey || e.ctrlKey || e.metaKey);
                  }}
                >
                  <title>{g ? `${g.label}` : "Non raccordé"}</title>
                </rect>
              );
            })}
          </g>
        </svg>
        {groups.length > 0 && (
          <div
            className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1"
            aria-label="Légende"
          >
            {groups.map((g, i) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setActiveGroup((a) => (a === g.id ? null : g.id))}
                className={`flex min-h-11 items-center gap-1 rounded-md border bg-background px-2 text-xs ${activeGroup === g.id ? "ring-2 ring-ring" : ""} ${failingGroups.has(g.label) ? "border-destructive text-destructive" : ""}`}
                aria-pressed={activeGroup === g.id}
              >
                <span
                  className="h-3 w-3 rounded-sm"
                  style={{ background: groupColor(i) }}
                  aria-hidden
                />
                {g.label} · {g.module_ids.length}
                {g.mppt_index != null && ` · MPPT ${g.mppt_index + 1}`}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Paramètres contextuels */}
      <aside className="w-full space-y-3 overflow-y-auto border-t p-3 lg:w-[360px] lg:border-l lg:border-t-0">
        <Card className="space-y-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <Label>Onduleur</Label>
            {props.canWrite && ctx.canManage && (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11"
                onClick={() => setDialogOpen(true)}
              >
                <Plus className="mr-1 h-4 w-4" /> Référence manuelle
              </Button>
            )}
          </div>
          {ctx.inverters.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Aucun onduleur au catalogue. Ajoutez une référence à partir de sa fiche technique
              (provenance obligatoire).
            </p>
          ) : (
            <Select
              value={inverterId}
              onValueChange={(v) => {
                setInverterId(v);
                setProposals([]);
              }}
            >
              <SelectTrigger className="min-h-11">
                <SelectValue placeholder="Choisir un onduleur réel" />
              </SelectTrigger>
              <SelectContent>
                {ctx.inverters.map((i) => (
                  <SelectItem key={i.inverter_id} value={i.inverter_id}>
                    {i.manufacturer} {i.model}
                    {i.ac_power_w != null ? ` · ${(i.ac_power_w / 1000).toFixed(1)} kW` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {inverter && (
            <div className="flex flex-wrap gap-1 text-xs">
              <Badge variant="secondary">{TOPOLOGY_LABEL[inverter.kind]}</Badge>
              {inverter.kind === "hybride" && <Badge>Hybride</Badge>}
              {inverter.phase && (
                <Badge variant="outline">
                  {inverter.phase === "tri" ? "Triphasé" : "Monophasé"}
                </Badge>
              )}
              <Badge variant="outline">
                Source : {inverter.source_type === "manuel" ? "manuelle" : inverter.source_type}
              </Badge>
            </div>
          )}
          {inverter?.kind === "hybride" && (
            <p className="text-xs text-muted-foreground">
              Seule la partie photovoltaïque est dimensionnée ; la batterie n'est pas traitée à
              cette étape.
            </p>
          )}
        </Card>

        <Card className="space-y-2 p-3">
          <Label>Températures de dimensionnement</Label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="tmin" className="text-xs">
                Tmin (°C)
              </Label>
              <Input
                id="tmin"
                inputMode="decimal"
                className="min-h-11"
                value={tmin}
                onChange={(e) => {
                  setTmin(e.target.value);
                  setProposals([]);
                }}
              />
            </div>
            <div>
              <Label htmlFor="tmax" className="text-xs">
                Tmax cellule (°C)
              </Label>
              <Input
                id="tmax"
                inputMode="decimal"
                className="min-h-11"
                value={tmax}
                onChange={(e) => {
                  setTmax(e.target.value);
                  setProposals([]);
                }}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="tsrc" className="text-xs">
              Source des températures
            </Label>
            <Input
              id="tsrc"
              className="min-h-11"
              placeholder="Ex. : données météo locales, norme, bureau d'études"
              value={tsource}
              onChange={(e) => setTsource(e.target.value)}
            />
          </div>
          {tempError && <p className="text-xs text-destructive">{tempError}</p>}
        </Card>

        <Button
          className="min-h-11 w-full"
          disabled={!inverter || !temps || ctx.modules.length === 0}
          onClick={propose}
        >
          <Zap className="mr-2 h-4 w-4" /> Proposer un câblage
        </Button>
        {proposalError && (
          <p role="alert" className="text-xs text-destructive">
            {proposalError}
          </p>
        )}

        {proposals.map((p) => (
          <Card key={p.id} className="space-y-1 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{p.label}</p>
              <span className={`rounded px-2 py-0.5 text-xs ${STATUS_TONE[p.evaluation.status]}`}>
                {DESIGN_STATUS_LABEL[p.evaluation.status]}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {p.groups.length} {p.groups[0]?.kind === "micro" ? "micro-onduleur(s)" : "string(s)"}{" "}
              · {p.evaluation.inverter_count} onduleur(s)
              {p.evaluation.dc_ac_ratio != null && ` · DC/AC ${p.evaluation.dc_ac_ratio}`}
              {p.evaluation.unassigned_module_ids.length > 0 &&
                ` · ${p.evaluation.unassigned_module_ids.length} non raccordé(s)`}
            </p>
            <ul className="list-disc pl-4 text-xs text-muted-foreground">
              {p.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <Button
              size="sm"
              variant="outline"
              className="min-h-11 w-full"
              onClick={() => {
                commit(p.groups);
                setVariantLabel(p.label);
                setProposals([]);
              }}
            >
              Utiliser ce câblage
            </Button>
          </Card>
        ))}

        {hist && inverter && (
          <Card className="space-y-2 p-3">
            <div className="flex items-center justify-between">
              <Label>Édition du câblage</Label>
              <div className="flex gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-11 w-11"
                  aria-label="Annuler"
                  disabled={!hist.past.length}
                  onClick={() => {
                    setHist(historyUndo(hist));
                    setDirty(true);
                  }}
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-11 w-11"
                  aria-label="Rétablir"
                  disabled={!hist.future.length}
                  onClick={() => {
                    setHist(historyRedo(hist));
                    setDirty(true);
                  }}
                >
                  <Redo2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {selection.length
                ? `${selection.length} panneau(x) sélectionné(s)`
                : "Cliquez des panneaux (Maj/Ctrl pour en ajouter) puis choisissez une destination."}
            </p>
            {selection.length > 0 && (
              <Select
                onValueChange={(v) => {
                  commit(moveModules(groups, selection, v === "__none" ? null : v));
                  setSelection([]);
                }}
              >
                <SelectTrigger className="min-h-11">
                  <SelectValue placeholder="Affecter la sélection à…" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.label}
                    </SelectItem>
                  ))}
                  <SelectItem value="__none">Non raccordé</SelectItem>
                </SelectContent>
              </Select>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="min-h-11"
                onClick={() =>
                  commit(addEmptyGroup(groups, isMicro ? "micro" : "string", isMicro ? null : 0))
                }
              >
                <Plus className="mr-1 h-4 w-4" /> {isMicro ? "Micro-onduleur" : "String vide"}
              </Button>
            </div>
            <ul className="space-y-1">
              {groups.map((g, i) => (
                <li key={g.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className="h-3 w-3 rounded-sm"
                    style={{ background: groupColor(i) }}
                    aria-hidden
                  />
                  <span className="w-10 font-medium">{g.label}</span>
                  <span className="w-16">{g.module_ids.length} pann.</span>
                  {!isMicro && mpptCount > 0 && (
                    <Select
                      value={`${g.inverter_index}:${g.mppt_index ?? 0}`}
                      onValueChange={(v) => {
                        const [a, b] = v.split(":").map(Number);
                        commit(setGroupMppt(groups, g.id, a, b));
                      }}
                    >
                      <SelectTrigger className="h-11 w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({
                          length: Math.max(1, (evaluation?.inverter_count ?? 1) + 1),
                        }).flatMap((_, inv) =>
                          Array.from({ length: mpptCount }).map((__, m) => (
                            <SelectItem key={`${inv}:${m}`} value={`${inv}:${m}`}>
                              Ond. {inv + 1} · MPPT {m + 1}
                            </SelectItem>
                          )),
                        )}
                      </SelectContent>
                    </Select>
                  )}
                  {!isMicro &&
                    g.mppt_index != null &&
                    groups.filter(
                      (x) => x.inverter_index === g.inverter_index && x.mppt_index === g.mppt_index,
                    ).length > 1 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-11 w-11"
                        aria-label={`Rééquilibrer le MPPT ${g.mppt_index + 1}`}
                        onClick={() =>
                          commit(rebalanceMppt(groups, g.inverter_index, g.mppt_index!))
                        }
                      >
                        <Scale className="h-4 w-4" />
                      </Button>
                    )}
                  {g.module_ids.length === 0 && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-11 w-11"
                      aria-label={`Supprimer ${g.label}`}
                      onClick={() => commit(removeEmptyGroup(groups, g.id))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {evaluation && (
          <Card className="space-y-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <Label>Contrôles</Label>
              <span className={`rounded px-2 py-0.5 text-xs ${STATUS_TONE[evaluation.status]}`}>
                {DESIGN_STATUS_LABEL[evaluation.status]}
              </span>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt className="text-muted-foreground">DC</dt>
                <dd>
                  {evaluation.dc_power_w == null
                    ? "—"
                    : `${(evaluation.dc_power_w / 1000).toFixed(2)} kWc`}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">AC</dt>
                <dd>
                  {evaluation.ac_power_w == null
                    ? "Non vérifiable"
                    : `${(evaluation.ac_power_w / 1000).toFixed(2)} kW`}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">DC/AC</dt>
                <dd>{evaluation.dc_ac_ratio ?? "—"}</dd>
              </div>
            </dl>
            {evaluation.mppts.length > 0 && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th>MPPT</th>
                    <th>Strings</th>
                    <th>Vmp STC</th>
                    <th>ΣImp</th>
                    <th>ΣIsc</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluation.mppts.map((m) => (
                    <tr key={`${m.inverter_index}:${m.mppt_index}`}>
                      <td>
                        {m.inverter_index + 1}/{m.mppt_index + 1}
                      </td>
                      <td>{m.strings}</td>
                      <td>{m.voltage_v ?? "—"} V</td>
                      <td>{m.imp_sum_a ?? "—"} A</td>
                      <td>{m.isc_sum_a ?? "—"} A</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <ul className="space-y-1 text-xs">
              {evaluation.checks
                .filter((c) => c.status !== "ok" || props.expert)
                .map((c, i) => (
                  <li
                    key={i}
                    className={
                      c.status === "erreur"
                        ? "text-destructive"
                        : c.status === "ok"
                          ? "text-muted-foreground"
                          : "text-foreground"
                    }
                  >
                    {c.status !== "ok" && (
                      <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden />
                    )}
                    <span className="font-medium">{c.scope}</span> — {c.message}
                  </li>
                ))}
            </ul>
            {props.expert && (
              <div className="rounded bg-muted/50 p-2 text-[11px] text-muted-foreground">
                {evaluation.formulas.map((f, i) => (
                  <p key={i}>{f}</p>
                ))}
                <p>
                  Moteur {evaluation.engine_version} · implantation v{ctx.layout_version}
                </p>
              </div>
            )}
          </Card>
        )}

        {saveError && (
          <p role="alert" className="text-xs text-destructive">
            {saveError}
          </p>
        )}
        {hist && (
          <Button
            className="min-h-11 w-full"
            disabled={
              !props.canWrite ||
              !ctx.canManage ||
              saving ||
              !dirty ||
              !evaluation ||
              evaluation.status === "invalide"
            }
            onClick={() => void onSave()}
          >
            {saving
              ? "Enregistrement…"
              : evaluation?.status === "invalide"
                ? "Corrigez les erreurs pour enregistrer"
                : "Enregistrer le câblage"}
          </Button>
        )}
        {!ctx.canManage && (
          <p className="text-xs text-muted-foreground">
            Consultation seule : votre rôle ne permet pas de modifier le câblage.
          </p>
        )}
        {ctx.design && !dirty && !ctx.designStale && (
          <p className="text-xs text-muted-foreground">
            Câblage enregistré le {new Date(ctx.design.created_at).toLocaleString("fr-FR")}.
          </p>
        )}
      </aside>

      <ManualInverterDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        companyId={companyId}
        onCreated={async (id) => {
          await refresh();
          setInverterId(id);
        }}
      />
    </div>
  );
}

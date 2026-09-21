/**
 * Smart PV Layout Engine — interface de génération et de comparaison.
 *
 * Le calcul est exécuté par le moteur pur côté serveur (déterministe) ;
 * l'application d'une variante rejoue le même moteur avant écriture atomique.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { applySmartLayout, computeSmartLayout, getLayoutSetup } from "@/lib/solar-layout.functions";
import { getModuleShortlist } from "@/lib/solar-catalog.functions";
import { ModulePicker } from "@/components/solar/ModulePicker";
import { formatModuleDimensions, type ModuleListItem } from "@/lib/solar/module-catalog";
import type { LayoutCandidate } from "@/lib/solar-layout";

type Setup = Awaited<ReturnType<typeof getLayoutSetup>>;
type Result = Awaited<ReturnType<typeof computeSmartLayout>>;

const TARGET_PRESETS = [
  { id: "3", label: "3 kWc", power: 3 },
  { id: "6", label: "6 kWc", power: 6 },
  { id: "9", label: "9 kWc", power: 9 },
  { id: "max", label: "Maximum toiture", power: null },
  { id: "custom", label: "Personnalisé", power: null },
] as const;

/** Aperçu non persisté d'une variante, affiché sur le plan 2D. */
export interface LayoutPreview {
  signature: string;
  modules: {
    id: string;
    plane_key: string;
    u: number;
    v: number;
    orientation: "portrait" | "paysage";
  }[];
}

export function SmartLayoutPanel({
  companyId,
  modelId,
  planes,
  disabled,
  onApplied,
  onContextChange,
  onSaveActivity,
  onPreview,
}: {
  companyId: string | null;
  modelId: string;
  planes: { id: string; key: string; name: string; area_m2: number }[];
  disabled: boolean;
  onApplied: () => void;
  /** Remontée purement présentationnelle vers la barre de synthèse du cadre UX. */
  onContextChange?: (ctx: {
    targetKwc: number | null;
    moduleSelected: boolean;
    planeNames: string[];
  }) => void;
  /** Remonte l'état d'écriture (application d'une implantation) vers la barre haute. */
  onSaveActivity?: (state: { busy: boolean; error: boolean }) => void;
  /** Aperçu de la variante sélectionnée : affichage seul, jamais écrit en base. */
  onPreview?: (preview: LayoutPreview | null) => void;
}) {
  const setupFn = useServerFn(getLayoutSetup);
  const computeFn = useServerFn(computeSmartLayout);
  const applyFn = useServerFn(applySmartLayout);

  const shortlistFn = useServerFn(getModuleShortlist);

  const [setup, setSetup] = useState<Setup | null>(null);
  const [module, setModule] = useState<ModuleListItem | null>(null);
  const [profileId, setProfileId] = useState<string>("none");
  const [preset, setPreset] = useState<string>("max");
  const [customPower, setCustomPower] = useState("12");
  const [orientation, setOrientation] = useState<"auto" | "portrait" | "paysage">("auto");
  const [planeIds, setPlaneIds] = useState<string[]>(planes.map((p) => p.id));
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  /** Numéro du calcul en cours : un résultat périmé n'écrase jamais un plus récent. */
  const computeSeq = useRef(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const constraintsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPlaneIds((prev) => {
      const kept = prev.filter((id) => planes.some((p) => p.id === id));
      return kept.length ? kept : planes.map((p) => p.id);
    });
  }, [planes]);

  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    setupFn({ data: { companyId } })
      .then((s) => {
        if (alive) setSetup(s as Setup);
      })
      .catch(() => toast.error("Profils de règles indisponibles."));
    // Reprise du dernier panneau utilisé par l'entreprise, sinon d'un favori.
    shortlistFn({ data: { companyId } })
      .then((s) => {
        const pick = (s.recents[0] ?? s.favorites[0]) as ModuleListItem | undefined;
        if (alive && pick) setModule((prev) => prev ?? pick);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [companyId, setupFn, shortlistFn]);

  const target = useMemo(() => {
    if (preset === "max") return { mode: "max" as const, rounding: "closest" as const };
    const power = preset === "custom" ? Number(customPower) : Number(preset);
    if (!Number.isFinite(power) || power <= 0)
      return { mode: "max" as const, rounding: "closest" as const };
    return { mode: "power" as const, power_kwc: power, rounding: "closest" as const };
  }, [preset, customPower]);

  // Alimente la barre de synthèse du cadre UX (aucun impact sur le calcul).
  useEffect(() => {
    onContextChange?.({
      targetKwc: target.mode === "power" ? target.power_kwc : null,
      moduleSelected: Boolean(module),
      planeNames: planes.filter((p) => planeIds.includes(p.id)).map((p) => p.name),
    });
  }, [onContextChange, target, module, planes, planeIds]);

  // Changer de référence invalide immédiatement les variantes calculées.
  useEffect(() => {
    computeSeq.current += 1;
    setResult(null);
    setSelected(null);
  }, [module?.variant_id, orientation, planeIds, profileId, preset, customPower]);

  // L'aperçu suit la variante sélectionnée ; il n'est jamais enregistré.
  const candidates = useMemo(() => result?.candidates ?? [], [result]);
  const current = useMemo(
    () => candidates.find((c) => c.signature === selected) ?? candidates[0] ?? null,
    [candidates, selected],
  );
  useEffect(() => {
    if (!onPreview) return;
    onPreview(
      current
        ? {
            signature: current.signature,
            modules: current.modules.map((m) => ({
              id: m.id,
              plane_key: m.plane_key,
              u: m.u,
              v: m.v,
              orientation: m.orientation,
            })),
          }
        : null,
    );
  }, [current, onPreview]);
  useEffect(() => () => onPreview?.(null), [onPreview]);

  const generate = useCallback(async () => {
    if (!companyId || !module || !planeIds.length) return;
    const seq = (computeSeq.current += 1);
    setBusy(true);
    try {
      const res = (await computeFn({
        data: {
          companyId,
          modelId,
          planeIds,
          moduleVariantId: module.variant_id,
          rulesProfileId: profileId === "none" ? null : profileId,
          target,
          orientation,
          maxVariants: 4,
        },
      })) as Result;
      // Un calcul plus récent a été lancé entre-temps : ce résultat est périmé.
      if (seq !== computeSeq.current) return;
      setResult(res);
      setSelected(res.candidates[0]?.signature ?? null);
      if (!res.candidates.length)
        toast.error("Aucune implantation exploitable avec ces contraintes.");
    } catch (e) {
      if (seq === computeSeq.current)
        toast.error(e instanceof Error ? e.message : "Calcul impossible.");
    } finally {
      if (seq === computeSeq.current) setBusy(false);
    }
  }, [companyId, computeFn, modelId, module, orientation, planeIds, profileId, target]);

  const apply = useCallback(
    async (candidate: LayoutCandidate) => {
      if (!companyId || !module || !result) return;
      setBusy(true);
      onSaveActivity?.({ busy: true, error: false });
      let failed = false;
      try {
        await applyFn({
          data: {
            companyId,
            modelId,
            planeIds,
            moduleVariantId: module.variant_id,
            rulesProfileId: profileId === "none" ? null : profileId,
            target,
            orientation,
            maxVariants: 4,
            signature: candidate.signature,
            strategy: candidate.strategy,
            // Version de toiture du calcul : le serveur refuse si elle a bougé.
            geometryVersion: result.geometry_version,
            saveAsVariant: true,
            variantLabel: candidate.label,
          },
        });
        toast.success(`Implantation appliquée : ${candidate.modules.length} panneaux.`);
        onPreview?.(null);
        onApplied();
      } catch (e) {
        failed = true;
        toast.error(e instanceof Error ? e.message : "Enregistrement impossible.");
      } finally {
        setBusy(false);
        onSaveActivity?.({ busy: false, error: failed });
      }
    },
    [
      applyFn,
      companyId,
      modelId,
      module,
      onApplied,
      onPreview,
      onSaveActivity,
      orientation,
      planeIds,
      profileId,
      result,
      target,
    ],
  );

  const targetPower = target.mode === "power" ? target.power_kwc : null;
  /** Meilleur candidat réellement maximal, utilisé par « Utiliser le maximum valide ». */
  const maximumCandidate = useMemo(
    () =>
      candidates.reduce<LayoutCandidate | null>(
        (best2, c) => (!best2 || c.modules.length > best2.modules.length ? c : best2),
        null,
      ),
    [candidates],
  );
  /** Objectif demandé inatteignable : aucune variante ne l'atteint. */
  const impossible =
    targetPower !== null &&
    candidates.length > 0 &&
    candidates.every((c) => c.target_met === false);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Panneaux et objectif</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <ModulePicker
              companyId={companyId}
              value={module}
              disabled={disabled || busy}
              onChange={setModule}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
            />
            {module && (
              <p className="text-xs text-muted-foreground">
                Géométrie utilisée pour le calcul : {formatModuleDimensions(module)}
              </p>
            )}
          </div>

          <div className="space-y-1.5" ref={constraintsRef}>
            <Label htmlFor="smart-rules">Profil de règles</Label>
            <Select value={profileId} onValueChange={setProfileId} disabled={disabled || busy}>
              <SelectTrigger id="smart-rules">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Aucune marge imposée</SelectItem>
                {(setup?.profiles ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} (v{p.version})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Objectif de puissance</Label>
            <div className="flex flex-wrap gap-2">
              {TARGET_PRESETS.map((p) => (
                <Button
                  key={p.id}
                  type="button"
                  size="sm"
                  variant={preset === p.id ? "default" : "outline"}
                  className="min-h-11"
                  disabled={disabled || busy}
                  onClick={() => setPreset(p.id)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            {preset === "custom" && (
              <Input
                type="number"
                min={0.5}
                step={0.5}
                value={customPower}
                onChange={(e) => setCustomPower(e.target.value)}
                aria-label="Puissance cible en kWc"
                className="mt-2 max-w-32"
                disabled={disabled || busy}
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="smart-orientation">Orientation des panneaux</Label>
            <Select
              value={orientation}
              onValueChange={(v) => setOrientation(v as typeof orientation)}
              disabled={disabled || busy}
            >
              <SelectTrigger id="smart-orientation">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Automatique (comparer les deux)</SelectItem>
                <SelectItem value="portrait">Portrait</SelectItem>
                <SelectItem value="paysage">Paysage</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label>Pans utilisés (par ordre de priorité)</Label>
            <div className="flex flex-wrap gap-3">
              {planes.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={planeIds.includes(p.id)}
                    disabled={disabled || busy}
                    onCheckedChange={(c) =>
                      setPlaneIds((prev) =>
                        c ? [...prev, p.id] : prev.filter((id) => id !== p.id),
                      )
                    }
                  />
                  {p.name} — {p.area_m2.toFixed(1)} m²
                </label>
              ))}
            </div>
          </div>

          <div className="sm:col-span-2">
            <Button
              type="button"
              className="min-h-11 w-full sm:w-auto"
              disabled={disabled || busy || !module || !planeIds.length}
              onClick={generate}
            >
              {busy ? "Calcul en cours…" : "Calculer les implantations"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {impossible && maximumCandidate && targetPower !== null && (
        <Card className="border-amber-500/60">
          <CardContent className="space-y-3 pt-4 text-sm">
            <p>
              Objectif {fr(targetPower)} kWc non atteignable avec les contraintes actuelles. Maximum
              valide : {fr(maximumCandidate.power_kwc)} kWc ({maximumCandidate.modules.length}{" "}
              panneaux).
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                size="sm"
                className="min-h-11"
                disabled={disabled || busy}
                onClick={() => apply(maximumCandidate)}
              >
                Utiliser le maximum valide
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-11"
                disabled={busy}
                onClick={() => {
                  constraintsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                Modifier les contraintes
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-11"
                disabled={disabled || busy}
                onClick={() => setPickerOpen(true)}
              >
                Choisir un autre panneau
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {candidates.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {candidates.map((c) => {
            const active = current?.signature === c.signature;
            return (
              <Card
                key={c.signature}
                role="button"
                tabIndex={0}
                aria-pressed={active}
                className={active ? "border-primary ring-1 ring-primary" : "cursor-pointer"}
                onClick={() => setSelected(c.signature)}
                onFocus={() => setSelected(c.signature)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(c.signature);
                  }
                }}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between gap-2 text-sm">
                    <span>{c.label}</span>
                    <Badge variant={c.role === "recommandee" ? "default" : "secondary"}>
                      {fr(c.power_kwc)} kWc
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p>
                    {c.modules.length} panneaux · {orientationLabel(c.orientation)} ·{" "}
                    {c.plane_names.join(", ") || "—"}
                  </p>
                  <p className="text-muted-foreground">{c.summary}</p>
                  <details>
                    <summary className="min-h-11 cursor-pointer py-2 text-muted-foreground">
                      Pourquoi cette proposition ?
                    </summary>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                      {[...c.reasons, ...c.constraints].map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </details>
                  {active && (
                    <Button
                      type="button"
                      size="sm"
                      className="min-h-11 w-full"
                      disabled={disabled || busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        void apply(c);
                      }}
                    >
                      Utiliser cette implantation
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {candidates.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Comparer</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Variante</TableHead>
                  <TableHead>Panneaux</TableHead>
                  <TableHead>kWc</TableHead>
                  <TableHead>Objectif</TableHead>
                  <TableHead>Orientation</TableHead>
                  <TableHead>Pans</TableHead>
                  <TableHead>Surface modules</TableHead>
                  <TableHead>Rangées complètes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map((c) => (
                  <TableRow
                    key={c.signature}
                    data-state={current?.signature === c.signature ? "selected" : undefined}
                  >
                    <TableCell>{c.label}</TableCell>
                    <TableCell>{c.modules.length}</TableCell>
                    <TableCell>{fr(c.power_kwc)}</TableCell>
                    <TableCell>
                      {c.target_met === null
                        ? "—"
                        : c.target_met
                          ? "Atteint"
                          : `${fr(c.target_delta_kwc ?? 0)} kWc`}
                    </TableCell>
                    <TableCell>{orientationLabel(c.orientation)}</TableCell>
                    <TableCell>{c.plane_names.join(", ") || "—"}</TableCell>
                    <TableCell>{fr(c.module_area_m2)} m²</TableCell>
                    <TableCell>
                      {c.rows_full}/{c.rows_total}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Nombre au format français, deux décimales. */
function fr(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

function orientationLabel(o: LayoutCandidate["orientation"]): string {
  if (o === "portrait") return "Portrait";
  if (o === "paysage") return "Paysage";
  return "Mixte";
}

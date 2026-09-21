/**
 * Solar Studio — mode d'édition manuelle (P0-D).
 *
 * Génération automatique d'abord, correction manuelle ensuite : l'éditeur
 * charge l'implantation ENREGISTRÉE (panneau, règles, marges réels) depuis le
 * serveur, travaille sur un brouillon local annulable, puis enregistre une
 * seule fois. Aucun appel serveur pendant le glisser.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Copy,
  MousePointer2,
  Plus,
  RotateCw,
  Save,
  Trash2,
  Undo2,
  Redo2,
  X,
  AlignHorizontalJustifyStart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { applyManualLayout, getManualEditContext } from "@/lib/solar-layout.functions";
import {
  addModule,
  alignSelection,
  canRedo,
  canUndo,
  createHistory,
  createManualContext,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  manualPowerKwc,
  moveSelection,
  NUDGE_COARSE_M,
  NUDGE_FINE_M,
  pushHistory,
  redoHistory,
  rotateSelection,
  sameLayout,
  undoHistory,
  validateManual,
  type AlignMode,
  type History,
  type ManualResult,
} from "@/lib/solar-layout/manual";
import type { LayoutModule, Orientation } from "@/lib/solar-layout/types";
import { useIsMobile } from "@/hooks/use-mobile";
import { ManualPlanCanvas } from "./ManualPlanCanvas";

type ServerContext = Awaited<ReturnType<typeof getManualEditContext>>;

export type ManualSaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/** État publié vers la page : barre haute, panneau contextuel, garde-fous. */
export interface ManualEditorState {
  ready: boolean;
  dirty: boolean;
  saveState: ManualSaveState;
  selection: string[];
  moduleCount: number;
  powerKwc: number;
  invalidCount: number;
  planeName: string;
  orientationOfSelection: Orientation | "mixte" | null;
  positionOfSelection: { u: number; v: number } | null;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  save: () => void;
  rotate: () => void;
  duplicate: () => void;
  remove: () => void;
  align: (mode: AlignMode) => void;
  distribute: (axis: "u" | "v") => void;
  selectAllOnPlane: () => void;
  editDisabled: boolean;
}

export function ManualLayoutEditor({
  companyId,
  modelId,
  planeKey,
  onPlaneKeyChange,
  onState,
  onSaved,
  onExit,
}: {
  companyId: string;
  modelId: string;
  planeKey: string | null;
  onPlaneKeyChange: (key: string) => void;
  onState: (state: ManualEditorState) => void;
  onSaved: () => void;
  onExit: () => void;
}) {
  const loadFn = useServerFn(getManualEditContext);
  const saveFn = useServerFn(applyManualLayout);
  const isMobile = useIsMobile();

  const [server, setServer] = useState<ServerContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hist, setHist] = useState<History<LayoutModule[]>>(createHistory<LayoutModule[]>([]));
  const [selection, setSelection] = useState<string[]>([]);
  const [tool, setTool] = useState<"select" | "add">("select");
  const [addOrientation, setAddOrientation] = useState<Orientation>("portrait");
  const [saveState, setSaveState] = useState<ManualSaveState>("idle");
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const baseline = useRef<LayoutModule[]>([]);

  useEffect(() => {
    let alive = true;
    loadFn({ data: { companyId, modelId } })
      .then((ctx) => {
        if (!alive) return;
        const c = ctx as ServerContext;
        setServer(c);
        baseline.current = c.modules as LayoutModule[];
        setHist(createHistory<LayoutModule[]>(c.modules as LayoutModule[]));
        if (!planeKey && c.planes[0]) onPlaneKeyChange(c.planes[0].key);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Édition manuelle indisponible."),
      );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, modelId]);

  const ctx = useMemo(
    () =>
      server
        ? createManualContext(
            server.planes as Parameters<typeof createManualContext>[0],
            server.module_spec,
            server.rules,
          )
        : null,
    [server],
  );

  const modules = hist.present;
  const dirty = !sameLayout(modules, baseline.current);
  const activePlaneKey = planeKey ?? server?.planes[0]?.key ?? "";
  const editDisabled = isMobile;

  const apply = useCallback(
    (result: ManualResult) => {
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setHist((h) => pushHistory(h, result.modules));
      setSelection(result.selection);
      setSaveState("dirty");
    },
    [setHist],
  );

  const invalid = useMemo(
    () => (ctx ? validateManual(ctx, modules).filter((v) => v.status !== "valid") : []),
    [ctx, modules],
  );

  /* ------------------------------- Actions ------------------------------- */

  const rotate = useCallback(() => {
    if (ctx) apply(rotateSelection(ctx, modules, selection));
  }, [ctx, modules, selection, apply]);

  const duplicate = useCallback(() => {
    if (ctx) apply(duplicateSelection(ctx, modules, selection));
  }, [ctx, modules, selection, apply]);

  const remove = useCallback(() => {
    apply(deleteSelection(modules, selection));
  }, [modules, selection, apply]);

  const align = useCallback(
    (mode: AlignMode) => {
      if (ctx) apply(alignSelection(ctx, modules, selection, mode));
    },
    [ctx, modules, selection, apply],
  );

  const distribute = useCallback(
    (axis: "u" | "v") => {
      if (ctx) apply(distributeSelection(ctx, modules, selection, axis));
    },
    [ctx, modules, selection, apply],
  );

  const nudge = useCallback(
    (du: number, dv: number) => {
      if (ctx && selection.length) apply(moveSelection(ctx, modules, selection, du, dv));
    },
    [ctx, modules, selection, apply],
  );

  const undo = useCallback(() => {
    setHist((h) => undoHistory(h));
    setSaveState("dirty");
  }, []);
  const redo = useCallback(() => {
    setHist((h) => redoHistory(h));
    setSaveState("dirty");
  }, []);

  const selectAllOnPlane = useCallback(() => {
    setSelection(modules.filter((m) => m.plane_key === activePlaneKey).map((m) => m.id));
  }, [modules, activePlaneKey]);

  const save = useCallback(() => {
    if (!server || !ctx) return;
    if (invalid.length) {
      setSelection(invalid.map((v) => v.module_id));
      toast.error(`${invalid.length} panneau(x) en position interdite : corrigez avant d'enregistrer.`);
      return;
    }
    if (modules.length === 0 && !confirmEmpty) {
      setConfirmEmpty(true);
      return;
    }
    setSaveState("saving");
    saveFn({
      data: {
        companyId,
        modelId,
        geometryVersion: server.geometry_version,
        manualToken: server.manual_token,
        allowEmpty: modules.length === 0,
        modules: modules.map((m) => ({
          id: m.id,
          plane_key: m.plane_key,
          u: m.u,
          v: m.v,
          orientation: m.orientation,
          row: m.row,
          col: m.col,
          matrix: m.matrix,
        })),
      },
    })
      .then(() => {
        baseline.current = modules;
        setHist(createHistory<LayoutModule[]>(modules));
        setSaveState("saved");
        setConfirmEmpty(false);
        toast.success("Modifications enregistrées.");
        onSaved();
      })
      .catch((e: unknown) => {
        setSaveState("error");
        toast.error(e instanceof Error ? e.message : "Dernier enregistrement échoué.");
      });
  }, [server, ctx, invalid, modules, confirmEmpty, companyId, modelId, saveFn, onSaved]);

  /* ------------------------------- Clavier -------------------------------- */

  useEffect(() => {
    if (editDisabled) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === "Escape") {
        if (tool === "add") setTool("select");
        else setSelection([]);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selection.length) {
          e.preventDefault();
          remove();
        }
        return;
      }
      const step = e.shiftKey ? NUDGE_COARSE_M : NUDGE_FINE_M;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        nudge(-step, 0);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        nudge(step, 0);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        nudge(0, step);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        nudge(0, -step);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editDisabled, redo, undo, tool, selection.length, remove, nudge]);

  /* ---------------------------- État publié ------------------------------- */

  const selectedModules = modules.filter((m) => selection.includes(m.id));
  const orientationOfSelection: Orientation | "mixte" | null = selectedModules.length
    ? new Set(selectedModules.map((m) => m.orientation)).size === 1
      ? selectedModules[0]!.orientation
      : "mixte"
    : null;

  const state: ManualEditorState = {
    ready: !!ctx,
    dirty,
    saveState: saveState === "idle" && dirty ? "dirty" : saveState,
    selection,
    moduleCount: modules.length,
    powerKwc: server ? manualPowerKwc(modules, server.module_spec) : 0,
    invalidCount: invalid.length,
    planeName: server?.plane_names?.[activePlaneKey] ?? "",
    orientationOfSelection,
    positionOfSelection:
      selectedModules.length === 1
        ? { u: selectedModules[0]!.u, v: selectedModules[0]!.v }
        : null,
    canUndo: canUndo(hist),
    canRedo: canRedo(hist),
    undo,
    redo,
    save,
    rotate,
    duplicate,
    remove,
    align,
    distribute,
    selectAllOnPlane,
    editDisabled,
  };

  const stateRef = useRef(onState);
  stateRef.current = onState;
  useEffect(() => {
    stateRef.current(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dirty,
    saveState,
    selection,
    modules,
    invalid.length,
    activePlaneKey,
    hist,
    editDisabled,
    server,
  ]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" className="min-h-11" onClick={onExit}>
          Revenir aux implantations
        </Button>
      </div>
    );
  }

  if (!server || !ctx) return <Skeleton className="h-full w-full" />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Barre d'outils compacte, posée sur le canevas */}
      <div className="flex flex-wrap items-center gap-1 border-b bg-card/95 px-2 py-1">
        <ToolButton
          active={tool === "select"}
          label="Sélectionner"
          icon={<MousePointer2 className="h-4 w-4" />}
          onClick={() => setTool("select")}
        />
        <ToolButton
          active={tool === "add"}
          label="Ajouter"
          icon={<Plus className="h-4 w-4" />}
          disabled={editDisabled}
          onClick={() => setTool(tool === "add" ? "select" : "add")}
        />
        <ToolButton
          label="Dupliquer"
          icon={<Copy className="h-4 w-4" />}
          disabled={editDisabled || selection.length === 0}
          onClick={duplicate}
        />
        <ToolButton
          label="Tourner"
          icon={<RotateCw className="h-4 w-4" />}
          disabled={editDisabled || selection.length === 0}
          onClick={rotate}
        />
        <ToolButton
          label="Aligner à gauche"
          icon={<AlignHorizontalJustifyStart className="h-4 w-4" />}
          disabled={editDisabled || selection.length < 2}
          onClick={() => align("gauche")}
        />
        <ToolButton
          label="Supprimer"
          icon={<Trash2 className="h-4 w-4" />}
          disabled={editDisabled || selection.length === 0}
          onClick={remove}
        />
        <span className="mx-1 h-6 w-px bg-border" aria-hidden />
        <ToolButton
          label="Annuler"
          icon={<Undo2 className="h-4 w-4" />}
          disabled={!canUndo(hist)}
          onClick={undo}
        />
        <ToolButton
          label="Rétablir"
          icon={<Redo2 className="h-4 w-4" />}
          disabled={!canRedo(hist)}
          onClick={redo}
        />
        <span className="mx-1 h-6 w-px bg-border" aria-hidden />
        <Button
          size="sm"
          className="min-h-11"
          disabled={saveState === "saving" || !dirty}
          onClick={save}
        >
          <Save className="mr-1 h-4 w-4" /> Enregistrer
        </Button>
        <Button size="sm" variant="ghost" className="min-h-11" onClick={onExit}>
          <X className="mr-1 h-4 w-4" /> Quitter
        </Button>

        <div className="ml-auto flex items-center gap-2 text-xs">
          {dirty && <Badge variant="outline">Modifications non enregistrées</Badge>}
          {saveState === "saving" && <span className="text-muted-foreground">Enregistrement…</span>}
          {saveState === "saved" && !dirty && (
            <span className="text-emerald-600 dark:text-emerald-400">Enregistré</span>
          )}
          {saveState === "error" && (
            <span className="text-destructive">Dernier enregistrement échoué</span>
          )}
          <span className="text-muted-foreground">
            {selection.length} sélectionné{selection.length > 1 ? "s" : ""}
          </span>
          <span className="font-medium">
            {modules.length} panneaux · {manualPowerKwc(modules, server.module_spec).toFixed(2)} kWc
          </span>
        </div>
      </div>

      {server.planes.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b px-2 py-1">
          {server.planes.map((p) => (
            <Button
              key={p.key}
              size="sm"
              variant={p.key === activePlaneKey ? "secondary" : "ghost"}
              className="min-h-11"
              onClick={() => {
                onPlaneKeyChange(p.key);
                setSelection([]);
              }}
            >
              {p.name}
            </Button>
          ))}
        </div>
      )}

      {editDisabled && (
        <p className="border-b bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
          Pour déplacer précisément les panneaux, utilisez le mode paysage ou une tablette. La
          sélection reste possible ici.
        </p>
      )}

      {dirty && (
        <p className="border-b bg-amber-500/10 px-3 py-1 text-xs text-amber-700 dark:text-amber-400">
          Enregistrez les modifications pour actualiser la vue 3D.
        </p>
      )}

      <div className="min-h-0 flex-1 p-2">
        <ManualPlanCanvas
          ctx={ctx}
          planeKey={activePlaneKey}
          modules={modules}
          selection={selection}
          onSelectionChange={setSelection}
          onCommit={apply}
          onAddAt={(p) =>
            apply(
              addModule(ctx, modules, {
                plane_key: activePlaneKey,
                u: p.u,
                v: p.v,
                orientation: addOrientation,
              }),
            )
          }
          tool={tool}
          addOrientation={addOrientation}
          editDisabled={editDisabled}
        />
      </div>

      {tool === "add" && (
        <div className="flex items-center gap-2 border-t px-3 py-1 text-xs">
          <span className="text-muted-foreground">Orientation du panneau ajouté :</span>
          <Button
            size="sm"
            variant={addOrientation === "portrait" ? "secondary" : "ghost"}
            className="min-h-11"
            onClick={() => setAddOrientation("portrait")}
          >
            Portrait
          </Button>
          <Button
            size="sm"
            variant={addOrientation === "paysage" ? "secondary" : "ghost"}
            className="min-h-11"
            onClick={() => setAddOrientation("paysage")}
          >
            Paysage
          </Button>
        </div>
      )}

      {confirmEmpty && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Implantation vide"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"
        >
          <div className="w-full max-w-sm space-y-3 rounded-lg border bg-card p-4">
            <p className="text-sm font-semibold">
              Cette implantation ne contiendra plus aucun panneau.
            </p>
            <div className="flex flex-col gap-2">
              <Button className="min-h-11" onClick={save}>
                Enregistrer quand même
              </Button>
              <Button
                variant="ghost"
                className="min-h-11"
                onClick={() => setConfirmEmpty(false)}
              >
                Annuler
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolButton({
  label,
  icon,
  onClick,
  active,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant={active ? "secondary" : "ghost"}
      className="h-11 w-11"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </Button>
  );
}

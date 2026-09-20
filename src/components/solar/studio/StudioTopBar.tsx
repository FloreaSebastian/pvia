import { Link } from "@tanstack/react-router";
import { Check, HelpCircle, Loader2, Redo2, TriangleAlert, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { saveStateLabel, type SaveState, type StudioMode } from "@/lib/solar/studio-steps";
import { cn } from "@/lib/utils";

/** Barre haute compacte : projet, sauvegarde, annuler/rétablir, 2D/3D, mode, aide, quitter. */
export function StudioTopBar({
  studyId,
  title,
  subtitle,
  saveState,
  mode,
  onModeChange,
  visualMode,
  onVisualModeChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  help,
}: {
  studyId: string;
  title: string;
  subtitle: string;
  saveState: SaveState;
  mode: StudioMode;
  onModeChange: (mode: StudioMode) => void;
  visualMode: "map" | "3d";
  onVisualModeChange: (mode: "map" | "3d") => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  help: string;
}) {
  return (
    <header className="flex flex-wrap items-center gap-2 border-b bg-card px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-tight">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>

      <SaveIndicator state={saveState} />

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11"
          aria-label="Annuler"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11"
          aria-label="Rétablir"
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Redo2 className="h-4 w-4" />
        </Button>

        <div className="ml-1 flex overflow-hidden rounded-md border" role="group" aria-label="Affichage">
          {(["map", "3d"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={visualMode === m}
              onClick={() => onVisualModeChange(m)}
              className={cn(
                "min-h-11 px-3 text-xs font-medium",
                visualMode === m ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground",
              )}
            >
              {m === "map" ? "Carte" : "3D"}
            </button>
          ))}
        </div>

        <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Niveau de réglages">
          {(["rapide", "expert"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => onModeChange(m)}
              className={cn(
                "min-h-11 px-3 text-xs font-medium capitalize",
                mode === m ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground",
              )}
            >
              {m}
            </button>
          ))}
        </div>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Aide sur cette étape">
                <HelpCircle className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{help}</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Button variant="ghost" size="icon" className="h-11 w-11" asChild aria-label="Quitter Solar Studio">
          <Link to="/cahiers-des-charges/$id" params={{ id: studyId }}>
            <X className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </header>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const label = saveStateLabel(state);
  return (
    <Badge
      variant={state === "erreur" ? "destructive" : "secondary"}
      className="hidden items-center gap-1 whitespace-nowrap sm:inline-flex"
    >
      {state === "enregistrement" ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      ) : state === "erreur" ? (
        <TriangleAlert className="h-3 w-3" aria-hidden />
      ) : state === "modifie" ? null : (
        <Check className="h-3 w-3" aria-hidden />
      )}
      {label}
    </Badge>
  );
}

/**
 * Solar Studio — panneau contextuel de l'édition manuelle (P0-D).
 * Affiche la sélection courante et ses actions, sans formulaire technique
 * obligatoire : les coordonnées ne sont montrées qu'en mode Expert.
 */
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ManualEditorState } from "./ManualLayoutEditor";

export function ManualSelectionPanel({
  state,
  expert,
}: {
  state: ManualEditorState | null;
  expert: boolean;
}) {
  if (!state?.ready) {
    return <p className="text-sm text-muted-foreground">Chargement de l'implantation…</p>;
  }

  const n = state.selection.length;

  return (
    <div className="space-y-3">
      <Card className="space-y-2 p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Édition manuelle</span>
          {state.dirty ? (
            <Badge variant="outline">Modifications non enregistrées</Badge>
          ) : (
            <Badge variant="secondary">À jour</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {state.moduleCount} panneaux · {state.powerKwc.toFixed(2)} kWc
          {state.planeName ? ` · pan ${state.planeName}` : ""}
        </p>
        {state.invalidCount > 0 && (
          <p className="text-xs text-destructive">
            {state.invalidCount} panneau{state.invalidCount > 1 ? "x" : ""} en position interdite.
          </p>
        )}
      </Card>

      <Card className="space-y-2 p-3">
        <p className="text-sm font-medium">
          {n === 0
            ? "Aucun panneau sélectionné"
            : n === 1
              ? "1 panneau sélectionné"
              : `${n} panneaux sélectionnés`}
        </p>
        {n === 1 && state.orientationOfSelection && (
          <p className="text-xs text-muted-foreground">
            Orientation : {state.orientationOfSelection}
          </p>
        )}
        {expert && state.positionOfSelection && (
          <p className="text-xs text-muted-foreground">
            Position U {state.positionOfSelection.u.toFixed(2)} m · V{" "}
            {state.positionOfSelection.v.toFixed(2)} m
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="min-h-11"
            disabled={n === 0 || state.editDisabled}
            onClick={state.rotate}
          >
            Tourner
          </Button>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={n === 0 || state.editDisabled}
            onClick={state.duplicate}
          >
            Dupliquer
          </Button>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={n === 0 || state.editDisabled}
            onClick={state.remove}
          >
            Supprimer
          </Button>
          <Button variant="outline" className="min-h-11" onClick={state.selectAllOnPlane}>
            Tout ce pan
          </Button>
        </div>
      </Card>

      {n >= 2 && (
        <Card className="space-y-2 p-3">
          <p className="text-sm font-medium">Aligner</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="min-h-11" onClick={() => state.align("gauche")}>
              Gauche
            </Button>
            <Button variant="outline" className="min-h-11" onClick={() => state.align("droite")}>
              Droite
            </Button>
            <Button variant="outline" className="min-h-11" onClick={() => state.align("haut")}>
              Haut
            </Button>
            <Button variant="outline" className="min-h-11" onClick={() => state.align("bas")}>
              Bas
            </Button>
            <Button variant="outline" className="min-h-11" onClick={() => state.align("centre_u")}>
              Centrer ↕
            </Button>
            <Button variant="outline" className="min-h-11" onClick={() => state.align("centre_v")}>
              Centrer ↔
            </Button>
          </div>
          {n >= 3 && (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="min-h-11" onClick={() => state.distribute("u")}>
                Répartir ↔
              </Button>
              <Button variant="outline" className="min-h-11" onClick={() => state.distribute("v")}>
                Répartir ↕
              </Button>
            </div>
          )}
        </Card>
      )}

      <Button className="min-h-11 w-full" disabled={!state.dirty} onClick={state.save}>
        Enregistrer les modifications
      </Button>
    </div>
  );
}

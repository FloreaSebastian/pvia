/**
 * Solar Studio V2 — étape Toiture (P0-B).
 *
 * Deux briques d'interface, sans logique métier propre :
 *  - RoofToolbar : outils contextuels posés sur le canevas + consigne unique ;
 *  - RoofPlanesPanel : propriétés du pan sélectionné (nom, pente, orientation,
 *    marges) et liste compacte des pans.
 *
 * La géométrie reste calculée par src/lib/solar/polygon.ts et revalidée serveur.
 */
import {
  Copy,
  Crosshair,
  MousePointer2,
  PencilRuler,
  Redo2,
  Ruler,
  Square,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { azimuthLabel, normalizeAzimuth } from "@/lib/solar/geo";
import {
  edgeLengths,
  planeFromCustom,
  ROOF_EDGE_LABEL,
  type CustomRoofPlane,
  type RoofEdgeKind,
} from "@/lib/solar/polygon";
import type { RoofDrawTool } from "@/components/solar/map/GoogleMapView";

export const ROOF_TOOL_HINT: Record<RoofDrawTool | "measure", string> = {
  select: "Sélectionnez un pan, puis faites glisser un sommet pour corriger le contour.",
  draw_plane: "Cliquez sur les angles de la toiture. Double-cliquez pour terminer.",
  add_obstacle: "Cliquez et faites glisser pour délimiter l'obstacle.",
  measure: "Cliquez deux points pour mesurer une distance.",
};

/** Huit orientations courantes, avec la valeur en degrés conservée. */
const ORIENTATIONS: { label: string; value: number }[] = [
  { label: "Nord", value: 0 },
  { label: "Nord-Est", value: 45 },
  { label: "Est", value: 90 },
  { label: "Sud-Est", value: 135 },
  { label: "Sud", value: 180 },
  { label: "Sud-Ouest", value: 225 },
  { label: "Ouest", value: 270 },
  { label: "Nord-Ouest", value: 315 },
];

interface ToolbarProps {
  tool: RoofDrawTool;
  onToolChange: (tool: RoofDrawTool) => void;
  measuring: boolean;
  onToggleMeasure: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onRecenter: () => void;
  disabled?: boolean;
  /** Dessin verrouillé : toiture encore paramétrique, conversion requise. */
  drawDisabled?: boolean;
  issue?: string | null;
}

export function RoofToolbar({
  tool,
  onToolChange,
  measuring,
  onToggleMeasure,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onRecenter,
  disabled = false,
  drawDisabled = false,
  issue,
}: ToolbarProps) {
  const item = (key: RoofDrawTool, label: string, Icon: typeof MousePointer2) => {
    const locked = disabled || (drawDisabled && key !== "select");
    return (
      <Button
        key={key}
        type="button"
        size="sm"
        variant={tool === key && !measuring ? "default" : "secondary"}
        className="h-11 min-w-11 px-2"
        aria-pressed={tool === key && !measuring}
        aria-label={label}
        title={
          drawDisabled && key !== "select"
            ? "Convertissez d'abord la toiture en contours éditables"
            : label
        }
        disabled={locked}
        onClick={() => onToolChange(key)}
      >
        <Icon className="h-4 w-4" />
        <span className="ml-1 hidden text-xs sm:inline">{label}</span>
      </Button>
    );
  };


  return (
    <div className="pointer-events-none absolute left-2 top-2 z-20 flex max-w-[calc(100%-1rem)] flex-col gap-1">
      <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-md border bg-background/95 p-1 shadow-sm">
        {item("select", "Sélectionner", MousePointer2)}
        {item("draw_plane", "Dessiner un pan", PencilRuler)}
        {item("add_obstacle", "Obstacle", Square)}
        <Button
          type="button"
          size="sm"
          variant={measuring ? "default" : "secondary"}
          className="h-11 min-w-11 px-2"
          aria-pressed={measuring}
          aria-label="Mesurer"
          title="Mesurer"
          onClick={onToggleMeasure}
        >
          <Ruler className="h-4 w-4" />
          <span className="ml-1 hidden text-xs sm:inline">Mesurer</span>
        </Button>
        <span className="mx-1 hidden h-6 w-px bg-border sm:block" />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-11 w-11"
          aria-label="Annuler"
          title="Annuler"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-11 w-11"
          aria-label="Rétablir"
          title="Rétablir"
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-11 w-11"
          aria-label="Recentrer"
          title="Recentrer"
          onClick={onRecenter}
        >
          <Crosshair className="h-4 w-4" />
        </Button>
      </div>

      <p className="pointer-events-none rounded bg-background/90 px-2 py-1 text-xs text-muted-foreground">
        {measuring ? ROOF_TOOL_HINT.measure : ROOF_TOOL_HINT[tool]}
      </p>

      {issue && (
        <p
          role="alert"
          className="pointer-events-none rounded bg-destructive px-2 py-1 text-xs text-destructive-foreground"
        >
          {issue}
        </p>
      )}
    </div>
  );
}

interface PanelProps {
  planes: CustomRoofPlane[];
  selectedKey: string | null;
  expert: boolean;
  disabled: boolean;
  onSelect: (key: string | null) => void;
  onChange: (key: string, patch: Partial<CustomRoofPlane>) => void;
  onDuplicate: (key: string) => void;
  onDelete: (key: string) => void;
}

export function RoofPlanesPanel({
  planes,
  selectedKey,
  expert,
  disabled,
  onSelect,
  onChange,
  onDuplicate,
  onDelete,
}: PanelProps) {
  const selected = planes.find((p) => p.key === selectedKey) ?? null;
  const totalArea = planes.reduce((sum, p) => sum + planeFromCustom(p).area_m2, 0);

  return (
    <div className="space-y-3">
      <Card className="divide-y p-0">
        {planes.map((plane) => {
          const geo = planeFromCustom(plane);
          return (
            <button
              key={plane.key}
              type="button"
              onClick={() => onSelect(plane.key)}
              className={`flex min-h-11 w-full items-center justify-between gap-2 p-3 text-left ${
                plane.key === selectedKey ? "bg-accent" : ""
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{plane.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {azimuthLabel(plane.azimuth_deg)} · {Math.round(plane.tilt_deg)}° ·{" "}
                  {geo.area_m2.toFixed(1)} m²
                </span>
              </span>
              <Badge variant="outline">{plane.ring.length} pts</Badge>
            </button>
          );
        })}
        {!planes.length && (
          <p className="p-3 text-xs text-muted-foreground">
            Aucun pan dessiné. Utilisez « Dessiner un pan » sur la carte.
          </p>
        )}
        {planes.length > 0 && (
          <p className="p-3 text-xs text-muted-foreground">
            Surface totale des pans : {totalArea.toFixed(1)} m²
          </p>
        )}
      </Card>

      {selected && (
        <Card className="space-y-3 p-3">
          <div className="space-y-1.5">
            <Label htmlFor="roof-plane-name">Nom du pan</Label>
            <Input
              id="roof-plane-name"
              className="min-h-11"
              value={selected.name}
              disabled={disabled}
              onChange={(e) => onChange(selected.key, { name: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="roof-plane-tilt">Pente (°)</Label>
              <Input
                id="roof-plane-tilt"
                className="min-h-11"
                type="number"
                min={0}
                max={70}
                step={1}
                value={selected.tilt_deg}
                disabled={disabled}
                onChange={(e) => onChange(selected.key, { tilt_deg: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="roof-plane-margin">Marge (m)</Label>
              <Input
                id="roof-plane-margin"
                className="min-h-11"
                type="number"
                min={0}
                max={10}
                step={0.05}
                value={selected.margin_m}
                disabled={disabled}
                onChange={(e) => onChange(selected.key, { margin_m: Number(e.target.value) })}
              />
            </div>
          </div>

          {expert ? (
            <div className="space-y-1.5">
              <Label htmlFor="roof-plane-azimuth">Azimut (°)</Label>
              <Input
                id="roof-plane-azimuth"
                className="min-h-11"
                type="number"
                step={1}
                value={Math.round(selected.azimuth_deg)}
                disabled={disabled}
                onChange={(e) =>
                  onChange(selected.key, { azimuth_deg: normalizeAzimuth(Number(e.target.value)) })
                }
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Orientation</Label>
              <Select
                value={String(nearestOrientation(selected.azimuth_deg))}
                disabled={disabled}
                onValueChange={(v) => onChange(selected.key, { azimuth_deg: Number(v) })}
              >
                <SelectTrigger className="min-h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORIENTATIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>
                      {o.label} ({o.value}°)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Azimut retenu : {Math.round(selected.azimuth_deg)}° (
                {azimuthLabel(selected.azimuth_deg)}).
              </p>
            </div>
          )}

          {expert && (
            <div className="space-y-1.5">
              <Label>Marges par arête</Label>
              <p className="text-xs text-muted-foreground">
                La nature d'une arête n'est jamais devinée : choisissez-la vous-même.
              </p>
              <div className="space-y-2">
                {edgeLengths(selected.ring).map((length, index) => {
                  const current = selected.edge_margins.find((m) => m.index === index);
                  return (
                    <div key={index} className="flex items-center gap-2">
                      <span className="w-16 shrink-0 text-xs text-muted-foreground">
                        {length.toFixed(2)} m
                      </span>
                      <Select
                        value={current?.kind ?? "indefini"}
                        disabled={disabled}
                        onValueChange={(v) =>
                          onChange(selected.key, {
                            edge_margins: upsertEdge(selected, index, { kind: v as RoofEdgeKind }),
                          })
                        }
                      >
                        <SelectTrigger className="min-h-11">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(ROOF_EDGE_LABEL) as RoofEdgeKind[]).map((k) => (
                            <SelectItem key={k} value={k}>
                              {ROOF_EDGE_LABEL[k]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        className="min-h-11 w-20"
                        type="number"
                        min={0}
                        max={10}
                        step={0.05}
                        aria-label={`Marge de l'arête ${index + 1}`}
                        value={current?.margin_m ?? selected.margin_m}
                        disabled={disabled}
                        onChange={(e) =>
                          onChange(selected.key, {
                            edge_margins: upsertEdge(selected, index, {
                              margin_m: Number(e.target.value),
                            }),
                          })
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="min-h-11 flex-1"
              disabled={disabled}
              onClick={() => onDuplicate(selected.key)}
            >
              <Copy className="mr-2 h-4 w-4" />
              Dupliquer
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="min-h-11 flex-1"
              disabled={disabled}
              onClick={() => onDelete(selected.key)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Supprimer
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function nearestOrientation(azimuth: number): number {
  const a = normalizeAzimuth(azimuth);
  let best = ORIENTATIONS[0]!.value;
  let bestDiff = 360;
  for (const o of ORIENTATIONS) {
    const diff = Math.min(Math.abs(a - o.value), 360 - Math.abs(a - o.value));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = o.value;
    }
  }
  return best;
}

function upsertEdge(
  plane: CustomRoofPlane,
  index: number,
  patch: { kind?: RoofEdgeKind; margin_m?: number },
) {
  const existing = plane.edge_margins.find((m) => m.index === index);
  const next = {
    index,
    kind: patch.kind ?? existing?.kind ?? ("indefini" as RoofEdgeKind),
    margin_m: patch.margin_m ?? existing?.margin_m ?? plane.margin_m,
  };
  return [...plane.edge_margins.filter((m) => m.index !== index), next].sort(
    (a, b) => a.index - b.index,
  );
}

/**
 * Solar Studio V2 — P1 : plan technique vectoriel déterministe.
 *
 * Module PUR. Il construit une description géométrique du plan (pans, modules,
 * obstacles, libellés, nord, échelle) à partir des DONNÉES DU MODÈLE, jamais
 * d'une capture d'écran. Le même dessin sert à l'aperçu SVG et au PDF : une
 * seule source de vérité géométrique.
 */
import type { PlacedModule } from "./types";

export interface PlanDrawingPlane {
  key: string;
  name: string;
  /** Contour du pan dans son repère local (u,v), en mètres. */
  polygon: { x: number; y: number }[];
  azimuth_deg: number;
  tilt_deg: number;
}

export interface PlanDrawingObstacle {
  id: string;
  planeKey: string | null;
  u: number;
  v: number;
  width: number;
  length: number;
  label: string;
}

export interface PlanDrawingInput {
  planes: PlanDrawingPlane[];
  modules: PlacedModule[];
  obstacles: PlanDrawingObstacle[];
  /** Dimensions réelles du panneau (snapshot). Sans elles, aucun module n'est dessiné. */
  spec: { width_mm: number; height_mm: number } | null;
  title: string;
  subtitle?: string;
}

export type PlanItem =
  | {
      kind: "polygon";
      points: { x: number; y: number }[];
      fill: string;
      stroke: string;
      width: number;
    }
  | {
      kind: "rect";
      x: number;
      y: number;
      w: number;
      h: number;
      fill: string;
      stroke: string;
      width: number;
    }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; stroke: string; width: number }
  | {
      kind: "text";
      x: number;
      y: number;
      text: string;
      size: number;
      color: string;
      bold?: boolean;
    };

export interface PlanDrawing {
  /** Cadre du dessin en mètres, origine en bas à gauche, axe Y vers le haut. */
  view: { minX: number; minY: number; width: number; height: number };
  items: PlanItem[];
  /** Longueur de la cote de référence affichée, en mètres. */
  scaleBarM: number;
  moduleCount: number;
}

const INK = "#0f172a";
const ROOF_FILL = "#e2e8f0";
const ROOF_STROKE = "#334155";
const PANEL_FILL = "#1d4ed8";
const PANEL_STROKE = "#0f172a";
const PANEL_OFF = "#94a3b8";
const OBSTACLE_FILL = "#f97316";
const MUTED = "#475569";

const GAP_M = 2;
const MARGIN_M = 1.5;

function bboxOf(points: { x: number; y: number }[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/** Cote de référence lisible (1, 2, 5, 10 m…) adaptée à la largeur du plan. */
export function scaleBarLength(widthM: number): number {
  const target = widthM / 5;
  const steps = [0.5, 1, 2, 5, 10, 20, 50];
  let best = steps[0]!;
  for (const s of steps) if (s <= target) best = s;
  return best;
}

/**
 * Construit le plan : les pans sont juxtaposés de gauche à droite, dans l'ordre
 * de leur clé (déterminisme), chacun avec ses modules et obstacles exacts.
 */
export function buildPlanDrawing(input: PlanDrawingInput): PlanDrawing {
  const planes = [...input.planes]
    .filter((p) => p.polygon.length >= 3)
    .sort((a, b) => a.key.localeCompare(b.key));

  const items: PlanItem[] = [];
  let cursorX = MARGIN_M;
  let maxTop = 0;
  let moduleCount = 0;

  for (const plane of planes) {
    const box = bboxOf(plane.polygon);
    // Décalage du repère local du pan vers sa case dans la planche.
    const dx = cursorX - box.minX;
    const dy = MARGIN_M + 1.2 - box.minY; // 1,2 m réservés au libellé sous le pan
    const shift = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy });

    items.push({
      kind: "polygon",
      points: plane.polygon.map(shift),
      fill: ROOF_FILL,
      stroke: ROOF_STROKE,
      width: 0.06,
    });

    for (const o of input.obstacles.filter((x) => x.planeKey === plane.key)) {
      items.push({
        kind: "rect",
        x: o.u + dx - o.width / 2,
        y: o.v + dy - o.length / 2,
        w: o.width,
        h: o.length,
        fill: OBSTACLE_FILL,
        stroke: "#c2410c",
        width: 0.03,
      });
    }

    if (input.spec) {
      const wm = input.spec.width_mm / 1000;
      const hm = input.spec.height_mm / 1000;
      for (const m of input.modules.filter((x) => x.roof_plane_key === plane.key)) {
        const w = m.orientation === "portrait" ? wm : hm;
        const h = m.orientation === "portrait" ? hm : wm;
        items.push({
          kind: "rect",
          x: m.local_u_m + dx - w / 2,
          y: m.local_v_m + dy - h / 2,
          w,
          h,
          fill: m.enabled ? PANEL_FILL : PANEL_OFF,
          stroke: PANEL_STROKE,
          width: 0.02,
        });
        moduleCount += 1;
      }
    }

    const width = box.maxX - box.minX;
    const top = box.maxY + dy;
    items.push({
      kind: "text",
      x: cursorX,
      y: MARGIN_M + 0.4,
      text: `${plane.name} — ${Math.round(plane.tilt_deg)}° / ${Math.round(plane.azimuth_deg)}°`,
      size: 0.42,
      color: INK,
      bold: true,
    });

    cursorX += width + GAP_M;
    maxTop = Math.max(maxTop, top);
  }

  const contentWidth = Math.max(cursorX - GAP_M + MARGIN_M, 8);
  const contentHeight = Math.max(maxTop + MARGIN_M + 2.4, 8);

  // Titre
  items.push({
    kind: "text",
    x: MARGIN_M,
    y: contentHeight - 1.2,
    text: input.title,
    size: 0.6,
    color: INK,
    bold: true,
  });
  if (input.subtitle) {
    items.push({
      kind: "text",
      x: MARGIN_M,
      y: contentHeight - 2,
      text: input.subtitle,
      size: 0.4,
      color: MUTED,
    });
  }

  // Nord : flèche verticale (repère local, Y = Nord du repère du pan).
  const northX = contentWidth - MARGIN_M - 0.4;
  const northY = contentHeight - 2.6;
  items.push({
    kind: "line",
    x1: northX,
    y1: northY,
    x2: northX,
    y2: northY + 1.2,
    stroke: INK,
    width: 0.06,
  });
  items.push({
    kind: "line",
    x1: northX,
    y1: northY + 1.2,
    x2: northX - 0.25,
    y2: northY + 0.85,
    stroke: INK,
    width: 0.06,
  });
  items.push({
    kind: "line",
    x1: northX,
    y1: northY + 1.2,
    x2: northX + 0.25,
    y2: northY + 0.85,
    stroke: INK,
    width: 0.06,
  });
  items.push({
    kind: "text",
    x: northX - 0.15,
    y: northY - 0.5,
    text: "N",
    size: 0.42,
    color: INK,
    bold: true,
  });

  // Cote de référence
  const bar = scaleBarLength(contentWidth);
  const barY = 0.6;
  items.push({
    kind: "line",
    x1: MARGIN_M,
    y1: barY,
    x2: MARGIN_M + bar,
    y2: barY,
    stroke: INK,
    width: 0.06,
  });
  items.push({
    kind: "line",
    x1: MARGIN_M,
    y1: barY - 0.15,
    x2: MARGIN_M,
    y2: barY + 0.15,
    stroke: INK,
    width: 0.05,
  });
  items.push({
    kind: "line",
    x1: MARGIN_M + bar,
    y1: barY - 0.15,
    x2: MARGIN_M + bar,
    y2: barY + 0.15,
    stroke: INK,
    width: 0.05,
  });
  items.push({
    kind: "text",
    x: MARGIN_M + bar + 0.3,
    y: barY - 0.15,
    text: `${bar.toLocaleString("fr-FR")} m`,
    size: 0.38,
    color: MUTED,
  });

  // Légende panneau
  if (input.spec) {
    const lx = MARGIN_M + bar + 2.4;
    items.push({
      kind: "rect",
      x: lx,
      y: barY - 0.25,
      w: 0.55,
      h: 0.55,
      fill: PANEL_FILL,
      stroke: PANEL_STROKE,
      width: 0.02,
    });
    items.push({
      kind: "text",
      x: lx + 0.8,
      y: barY - 0.15,
      text: `Panneau ${Math.round(input.spec.width_mm)} × ${Math.round(input.spec.height_mm)} mm — ${moduleCount} posés`,
      size: 0.38,
      color: MUTED,
    });
  }

  return {
    view: { minX: 0, minY: 0, width: contentWidth, height: contentHeight },
    items,
    scaleBarM: bar,
    moduleCount,
  };
}

function fmt(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Rendu SVG déterministe : mêmes entrées ⇒ même chaîne, octet pour octet.
 * L'axe Y du dessin monte ; le SVG est retourné par une transformation globale.
 */
export function renderPlanSvg(drawing: PlanDrawing, opts: { pxPerM?: number } = {}): string {
  const px = opts.pxPerM ?? 40;
  const w = Math.round(drawing.view.width * px);
  const h = Math.round(drawing.view.height * px);
  const parts: string[] = [];
  for (const it of drawing.items) {
    if (it.kind === "polygon") {
      parts.push(
        `<polygon points="${it.points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(" ")}" fill="${it.fill}" stroke="${it.stroke}" stroke-width="${fmt(it.width)}"/>`,
      );
    } else if (it.kind === "rect") {
      parts.push(
        `<rect x="${fmt(it.x)}" y="${fmt(it.y)}" width="${fmt(it.w)}" height="${fmt(it.h)}" fill="${it.fill}" stroke="${it.stroke}" stroke-width="${fmt(it.width)}"/>`,
      );
    } else if (it.kind === "line") {
      parts.push(
        `<line x1="${fmt(it.x1)}" y1="${fmt(it.y1)}" x2="${fmt(it.x2)}" y2="${fmt(it.y2)}" stroke="${it.stroke}" stroke-width="${fmt(it.width)}"/>`,
      );
    } else {
      // Le texte est écrit dans un repère non retourné pour rester lisible.
      parts.push(
        `<text x="${fmt(it.x)}" y="${fmt(-it.y)}" font-family="Helvetica, Arial, sans-serif" font-size="${fmt(it.size)}" fill="${it.color}"${it.bold ? ' font-weight="bold"' : ""} transform="scale(1,-1)">${escapeXml(it.text)}</text>`,
      );
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${fmt(drawing.view.width)} ${fmt(drawing.view.height)}" role="img" aria-label="Plan d'implantation photovoltaïque">`,
    `<rect x="0" y="0" width="${fmt(drawing.view.width)}" height="${fmt(drawing.view.height)}" fill="#ffffff"/>`,
    `<g transform="translate(0,${fmt(drawing.view.height)}) scale(1,-1)">`,
    ...parts,
    `</g>`,
    `</svg>`,
  ].join("");
}

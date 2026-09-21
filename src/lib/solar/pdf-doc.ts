/**
 * Solar Studio V2 — P1 : documents PDF (client et technique).
 *
 * Module SANS accès base ni réseau : il reçoit la synthèse déjà calculée et le
 * plan vectoriel déjà construit. Le PDF client ne contient AUCUN identifiant
 * interne, AUCUNE empreinte géométrique et AUCUN calcul de production.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { PlanDrawing } from "./plan-drawing";
import type { SolarResultsReport } from "./results";

export type SolarPdfVariant = "client" | "technique";

export interface SolarPdfMeta {
  reference: string | null;
  address: string | null;
  date: Date;
  companyName: string | null;
  /** Couleur de marque (#RRGGBB) : neutre si le branding n'est pas autorisé. */
  brandColor: string;
  /** Logo PNG/JPEG, uniquement si le branding est autorisé par la formule. */
  logo?: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  footer?: string;
}

export interface PdfRow {
  label: string;
  value: string;
}
export interface PdfSection {
  heading: string;
  rows?: PdfRow[];
  text?: string;
  table?: { columns: string[]; rows: string[][] };
}

export const SOLAR_PDF_RESERVE =
  "Implantation indicative à confirmer selon relevé terrain et contraintes de pose.";

function dims(report: SolarResultsReport): string {
  const s = report.global.spec;
  if (s.width_mm === null || s.height_mm === null) return "Non renseignées";
  const depth = s.depth_mm !== null ? ` × ${Math.round(s.depth_mm)} mm` : "";
  return `${Math.round(s.width_mm)} × ${Math.round(s.height_mm)} mm${depth}`;
}

function panelName(report: SolarResultsReport): string {
  const s = report.global.spec;
  return [s.manufacturer, s.model].filter(Boolean).join(" ") || "Référence non renseignée";
}

/**
 * Contenu textuel du document. Séparation stricte client / technique :
 * la variante client n'expose jamais d'identifiant ni de version interne.
 */
export function buildSolarPdfSections(
  report: SolarResultsReport,
  variant: SolarPdfVariant,
  meta: SolarPdfMeta,
): PdfSection[] {
  const sections: PdfSection[] = [];

  sections.push({
    heading: "Dossier",
    rows: [
      { label: "Référence", value: meta.reference ?? "—" },
      { label: "Adresse du chantier", value: meta.address ?? "—" },
      { label: "Date", value: meta.date.toLocaleDateString("fr-FR") },
      ...(meta.companyName ? [{ label: "Entreprise", value: meta.companyName }] : []),
    ],
  });

  sections.push({
    heading: "Installation projetée",
    rows: [
      { label: "Puissance installée", value: `${report.global.power_kwc} kWc` },
      { label: "Nombre de panneaux", value: String(report.global.module_count) },
      { label: "Panneau", value: panelName(report) },
      { label: "Dimensions du panneau", value: dims(report) },
      { label: "Surface de panneaux", value: `${report.global.module_area_m2} m²` },
      { label: "Surface de toiture", value: `${report.global.roof_area_m2} m²` },
      { label: "Pans utilisés", value: String(report.global.planes_used) },
      {
        label: "Orientation de pose",
        value: report.global.orientations.length ? report.global.orientations.join(", ") : "—",
      },
    ],
  });

  sections.push({
    heading: "Répartition par pan",
    table: {
      columns:
        variant === "client"
          ? ["Pan", "Panneaux", "Puissance"]
          : ["Pan", "Surface", "Pente", "Azimut", "Panneaux", "Puissance"],
      rows: report.planes.map((p) =>
        variant === "client"
          ? [p.name, String(p.module_count), `${p.power_kwc} kWc`]
          : [
              p.name,
              `${p.area_m2} m²`,
              `${p.tilt_deg}°`,
              `${p.azimuth_deg}° ${p.cardinal}`,
              String(p.module_count),
              `${p.power_kwc} kWc`,
            ],
      ),
    },
  });

  if (variant === "technique") {
    const obstacles = report.planes
      .filter((p) => p.obstacles.length)
      .map((p) => `${p.name} : ${p.obstacles.join(", ")}`)
      .join(" · ");
    sections.push({
      heading: "Obstacles relevés",
      text: obstacles || "Aucun obstacle enregistré sur les pans utilisés.",
    });

    sections.push({
      heading: "Traçabilité technique",
      rows: [
        { label: "Version géométrique", value: String(report.technical.geometry_version) },
        { label: "Empreinte géométrique", value: report.technical.geometry_hash_short ?? "—" },
        { label: "Référence panneau (variante)", value: report.technical.module_variant_id ?? "—" },
        { label: "Révision panneau", value: report.technical.module_revision_id ?? "—" },
        { label: "Profil de règles", value: report.technical.rules_profile_id ?? "—" },
        {
          label: "Version du profil de règles",
          value:
            report.technical.rules_profile_version === null
              ? "—"
              : String(report.technical.rules_profile_version),
        },
        { label: "Moteur d'implantation", value: report.technical.layout_engine_version ?? "—" },
        {
          label: "Dernière modification",
          value: report.technical.updated_at
            ? new Date(report.technical.updated_at).toLocaleString("fr-FR")
            : "—",
        },
        { label: "Niveau de qualité", value: report.technical.quality_level ?? "—" },
        { label: "Données vérifiées", value: report.technical.quality_verified ?? "—" },
      ],
    });

    sections.push({
      heading: "Points de vigilance",
      text: report.warnings.length
        ? report.warnings.map((w) => `- ${w.message}`).join("\n")
        : "Aucun point de vigilance détecté sur la géométrie enregistrée.",
    });
  }

  sections.push({
    heading: "Portée du document",
    text: [
      SOLAR_PDF_RESERVE,
      "Aucune estimation de production annuelle ni d'ombrage n'est fournie : ces calculs ne sont pas réalisés à ce stade.",
    ].join(" "),
  });

  return sections;
}

/* --------------------------------- Rendu ---------------------------------- */

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;

function sanitize(value: string): string {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x00-\xff]/g, "?");
}

function hex(color: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return [0.12, 0.23, 0.54];
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const raw of sanitize(text).split("\n")) {
    const words = raw.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
        out.push(line);
        line = w;
      } else line = next;
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

/** Dessine le plan vectoriel (mêmes items que l'aperçu SVG) dans un cadre. */
function drawPlan(
  page: PDFPage,
  drawing: PlanDrawing,
  font: PDFFont,
  bold: PDFFont,
  box: { x: number; y: number; w: number; h: number },
) {
  const scale = Math.min(box.w / drawing.view.width, box.h / drawing.view.height);
  const ox = box.x + (box.w - drawing.view.width * scale) / 2;
  const oy = box.y;
  const X = (x: number) => ox + x * scale;
  const Y = (y: number) => oy + y * scale;

  for (const it of drawing.items) {
    if (it.kind === "polygon") {
      const pts = it.points;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        page.drawLine({
          start: { x: X(a.x), y: Y(a.y) },
          end: { x: X(b.x), y: Y(b.y) },
          thickness: Math.max(0.4, it.width * scale),
          color: rgb(...hex(it.stroke)),
        });
      }
    } else if (it.kind === "rect") {
      page.drawRectangle({
        x: X(it.x),
        y: Y(it.y),
        width: it.w * scale,
        height: it.h * scale,
        color: rgb(...hex(it.fill)),
        borderColor: rgb(...hex(it.stroke)),
        borderWidth: Math.max(0.2, it.width * scale),
      });
    } else if (it.kind === "line") {
      page.drawLine({
        start: { x: X(it.x1), y: Y(it.y1) },
        end: { x: X(it.x2), y: Y(it.y2) },
        thickness: Math.max(0.4, it.width * scale),
        color: rgb(...hex(it.stroke)),
      });
    } else {
      page.drawText(sanitize(it.text), {
        x: X(it.x),
        y: Y(it.y),
        size: Math.max(5, it.size * scale),
        font: it.bold ? bold : font,
        color: rgb(...hex(it.color)),
      });
    }
  }
}

export async function renderSolarPdf(input: {
  report: SolarResultsReport;
  drawing: PlanDrawing;
  variant: SolarPdfVariant;
  meta: SolarPdfMeta;
}): Promise<Uint8Array> {
  const { report, drawing, variant, meta } = input;
  const sections = buildSolarPdfSections(report, variant, meta);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const brand = rgb(...hex(meta.brandColor));
  const ink = rgb(0.1, 0.12, 0.16);
  const muted = rgb(0.42, 0.45, 0.5);

  const title =
    variant === "client" ? "Étude d'implantation photovoltaïque" : "Dossier technique d'implantation photovoltaïque";
  pdf.setTitle(sanitize(title));
  pdf.setSubject(sanitize(`Solar Studio — ${meta.reference ?? ""}`.trim()));
  pdf.setProducer("PVIA");

  let page = pdf.addPage(A4);
  let y = A4[1] - MARGIN;
  const width = A4[0] - MARGIN * 2;

  const newPage = () => {
    page = pdf.addPage(A4);
    y = A4[1] - MARGIN;
  };
  const need = (h: number) => {
    if (y - h < MARGIN + 30) newPage();
  };

  // En-tête
  if (meta.logo) {
    try {
      const img =
        meta.logo.type === "png"
          ? await pdf.embedPng(meta.logo.bytes)
          : await pdf.embedJpg(meta.logo.bytes);
      const scaled = img.scaleToFit(120, 42);
      page.drawImage(img, { x: MARGIN, y: y - scaled.height, width: scaled.width, height: scaled.height });
      y -= scaled.height + 12;
    } catch {
      // Un logo illisible ne doit jamais empêcher la génération du document.
    }
  }
  page.drawText(sanitize(title), { x: MARGIN, y: y - 18, size: 17, font: bold, color: brand });
  y -= 30;
  if (meta.companyName) {
    page.drawText(sanitize(meta.companyName), { x: MARGIN, y, size: 10, font, color: muted });
    y -= 16;
  }
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4[0] - MARGIN, y },
    thickness: 1,
    color: brand,
  });
  y -= 20;

  // Plan (page 1)
  const planHeight = 250;
  need(planHeight + 20);
  page.drawText("Plan d'implantation", { x: MARGIN, y, size: 12, font: bold, color: ink });
  y -= planHeight + 6;
  drawPlan(page, drawing, font, bold, { x: MARGIN, y, w: width, h: planHeight });
  y -= 18;

  for (const section of sections) {
    need(40);
    page.drawText(sanitize(section.heading), { x: MARGIN, y, size: 12, font: bold, color: brand });
    y -= 16;

    for (const row of section.rows ?? []) {
      need(16);
      page.drawText(sanitize(row.label), { x: MARGIN, y, size: 9.5, font, color: muted });
      const lines = wrap(font, row.value, 10, width - 190);
      for (const [i, line] of lines.entries()) {
        page.drawText(line, { x: MARGIN + 190, y: y - i * 12, size: 10, font, color: ink });
      }
      y -= Math.max(14, lines.length * 12 + 2);
    }

    if (section.table) {
      const cols = section.table.columns.length;
      const colW = width / cols;
      need(20);
      section.table.columns.forEach((c, i) => {
        page.drawText(sanitize(c), { x: MARGIN + i * colW, y, size: 9, font: bold, color: muted });
      });
      y -= 13;
      for (const row of section.table.rows) {
        need(14);
        row.forEach((cell, i) => {
          page.drawText(sanitize(cell), { x: MARGIN + i * colW, y, size: 9.5, font, color: ink });
        });
        y -= 13;
      }
      y -= 4;
    }

    if (section.text) {
      for (const line of wrap(font, section.text, 9.5, width)) {
        need(13);
        page.drawText(line, { x: MARGIN, y, size: 9.5, font, color: ink });
        y -= 12;
      }
      y -= 4;
    }
    y -= 6;
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(
      sanitize(
        [meta.companyName, meta.reference, meta.footer ?? "Document non contractuel"]
          .filter(Boolean)
          .join(" · "),
      ),
      { x: MARGIN, y: MARGIN - 24, size: 7.5, font, color: muted },
    );
    p.drawText(`${i + 1} / ${pages.length}`, {
      x: A4[0] - MARGIN - 30,
      y: MARGIN - 24,
      size: 7.5,
      font,
      color: muted,
    });
  });

  return pdf.save();
}

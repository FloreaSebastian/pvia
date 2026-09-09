/**
 * Cahiers des charges — génération du PDF client.
 *
 * Le document reprend la charte de l'entreprise et ne contient JAMAIS
 * les notes internes : seules les notes marquées « visible client » y figurent.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getCompanyBranding,
  getCompanyBrandingSettings,
  formatBrandingAddress,
  hexToRgb01,
} from "./branding.server";
import { getStudyTemplate } from "./etudes/templates";
import { resolveSections } from "./visites/engine";
import type { AnswerMap, VisitTemplate } from "./visites/types";
import { computeStudyEstimate, ESTIMATE_DISCLAIMER } from "./etudes/estimate";
import type { StudyType } from "./etudes/types";

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;

function sanitize(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = Array.isArray(value) ? value.join(", ") : String(value);
  // WinAnsi ne couvre pas tous les caractères Unicode ; on nettoie proprement.
  return s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[^\x00-\xFF]/g, "");
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = sanitize(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const next = current ? `${current} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("fr-FR");
}

/** Libellé lisible d'une réponse (option → label du template). */
function answerLabel(field: { type: string; options?: { value: string; label: string }[]; unit?: string }, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field.type === "boolean") return value === true ? "Oui" : "Non";
  if (field.options?.length) {
    const values = Array.isArray(value) ? value : [value];
    const labels = values.map((v) => field.options?.find((o) => o.value === String(v))?.label ?? String(v));
    return labels.join(", ");
  }
  const base = Array.isArray(value) ? value.join(", ") : String(value);
  return field.unit ? `${base} ${field.unit}` : base;
}

export async function buildStudyPdfBytes(companyId: string, studyId: string): Promise<Uint8Array> {
  const [{ data: study }, branding, settings] = await Promise.all([
    supabaseAdmin.from("technical_studies").select("*").eq("id", studyId).eq("company_id", companyId).maybeSingle(),
    getCompanyBranding(companyId),
    getCompanyBrandingSettings(companyId),
  ]);
  if (!study) throw new Error("Cahier des charges introuvable.");

  const [clientRes, answersRes, notesRes, docsRes] = await Promise.all([
    supabaseAdmin
      .from("clients")
      .select("name,company_name,client_type,email,phone,address,postal_code,city")
      .eq("id", study.client_id)
      .maybeSingle(),
    supabaseAdmin.from("technical_study_answers").select("field_key,value").eq("study_id", studyId),
    supabaseAdmin
      .from("technical_study_notes")
      .select("body,created_at")
      .eq("study_id", studyId)
      .eq("visibility", "client")
      .order("created_at"),
    supabaseAdmin
      .from("technical_study_documents")
      .select("category,label,doc_date")
      .eq("study_id", studyId)
      .order("created_at"),
  ]);

  const answers: AnswerMap = {};
  for (const a of (answersRes.data ?? []) as { field_key: string; value: unknown }[]) {
    answers[a.field_key] = a.value as never;
  }

  const type = study.study_type as StudyType;
  const template = getStudyTemplate(type);
  const estimate = computeStudyEstimate(type, answers);
  const [br, bg, bb] = hexToRgb01(settings.pdf_brand_color);
  const brand = rgb(br, bg, bb);
  const muted = rgb(0.42, 0.45, 0.5);
  const ink = rgb(0.1, 0.12, 0.16);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdf.addPage(A4);
  let y = A4[1] - MARGIN;
  const width = A4[0] - MARGIN * 2;

  const newPage = () => {
    page = pdf.addPage(A4);
    y = A4[1] - MARGIN;
  };
  const need = (h: number) => {
    if (y - h < MARGIN + 40) newPage();
  };
  const text = (value: string, opts: { size?: number; font?: PDFFont; color?: typeof ink; indent?: number } = {}) => {
    const size = opts.size ?? 10;
    const f = opts.font ?? font;
    const indent = opts.indent ?? 0;
    for (const line of wrap(f, value, size, width - indent)) {
      need(size + 4);
      page.drawText(line, { x: MARGIN + indent, y, size, font: f, color: opts.color ?? ink });
      y -= size + 4;
    }
  };
  const heading = (value: string) => {
    need(34);
    y -= 10;
    page.drawRectangle({ x: MARGIN, y: y - 4, width: 3, height: 16, color: brand });
    page.drawText(sanitize(value), { x: MARGIN + 10, y, size: 13, font: bold, color: brand });
    y -= 22;
  };
  const row = (label: string, value: string) => {
    need(16);
    const labelLines = wrap(font, label, 9.5, width * 0.42 - 6);
    const valueLines = wrap(bold, value, 9.5, width * 0.58 - 6);
    const lines = Math.max(labelLines.length, valueLines.length);
    labelLines.forEach((l, i) => page.drawText(l, { x: MARGIN, y: y - i * 12, size: 9.5, font, color: muted }));
    valueLines.forEach((l, i) =>
      page.drawText(l, { x: MARGIN + width * 0.42, y: y - i * 12, size: 9.5, font: bold, color: ink }),
    );
    y -= lines * 12 + 3;
  };

  /* ------------------------------ Page de garde ----------------------------- */
  page.drawRectangle({ x: 0, y: A4[1] - 150, width: A4[0], height: 150, color: brand });
  page.drawText(sanitize(branding?.name ?? "Cahier des charges"), {
    x: MARGIN,
    y: A4[1] - 60,
    size: 20,
    font: bold,
    color: rgb(1, 1, 1),
  });
  page.drawText("CAHIER DES CHARGES - PRE-ETUDE", { x: MARGIN, y: A4[1] - 88, size: 12, font, color: rgb(0.92, 0.94, 1) });
  page.drawText(sanitize(`${template.label} · ${study.reference}`), {
    x: MARGIN,
    y: A4[1] - 110,
    size: 11,
    font: bold,
    color: rgb(1, 1, 1),
  });
  y = A4[1] - 190;

  const client = clientRes.data as { name?: string; company_name?: string; email?: string; phone?: string; address?: string; postal_code?: string; city?: string } | null;
  heading("Identification");
  row("Référence", study.reference);
  row("Date d'édition", formatDate(new Date().toISOString()));
  row("Métier", template.label);
  row("Client", client?.company_name || client?.name || "—");
  if (client?.email) row("E-mail", client.email);
  if (client?.phone) row("Téléphone", client.phone);
  row("Adresse du site", [study.site_address, `${study.site_postal_code ?? ""} ${study.site_city ?? ""}`.trim()].filter(Boolean).join(", ") || "—");

  if (branding) {
    heading("Entreprise");
    row("Raison sociale", branding.name);
    const addr = formatBrandingAddress(branding).replace(/\n/g, ", ");
    if (addr) row("Adresse", addr);
    if (branding.siret) row("SIRET", branding.siret);
    if (branding.phone) row("Téléphone", branding.phone);
    if (branding.email) row("E-mail", branding.email);
  }

  /* ------------------------------- Questionnaire ---------------------------- */
  const resolved = resolveSections(template as unknown as VisitTemplate, answers);
  for (const { section, blocks } of resolved) {
    heading(section.title);
    if (section.description) text(section.description, { size: 9, color: muted });
    for (const block of blocks) {
      if (block.label) {
        need(16);
        y -= 4;
        page.drawText(sanitize(block.label), { x: MARGIN, y, size: 10, font: bold, color: brand });
        y -= 14;
      }
      for (const field of block.fields) {
        const value = answers[field.answerKey];
        if (value === undefined || value === null || value === "") continue;
        row(field.label, answerLabel(field, value));
      }
    }
  }

  /* --------------------------- Pré-dimensionnement -------------------------- */
  heading("Pré-dimensionnement indicatif");
  if (estimate.headline) row(estimate.headline.label, estimate.headline.value);
  for (const item of estimate.items) row(item.label, item.value);
  if (estimate.missing.length) {
    y -= 4;
    text(`Éléments manquants : ${estimate.missing.join(", ")}.`, { size: 9, color: muted });
  }
  y -= 4;
  text(ESTIMATE_DISCLAIMER, { size: 8.5, color: muted });

  if (estimate.warnings.length) {
    heading("Points de vigilance");
    for (const w of estimate.warnings) text(`- ${w}`, { size: 9.5 });
  }

  /* --------------------------------- Synthèse ------------------------------- */
  if (study.summary) {
    heading("Synthèse");
    text(study.summary, { size: 10 });
  }

  const clientNotes = (notesRes.data ?? []) as { body: string; created_at: string }[];
  if (clientNotes.length) {
    heading("Observations");
    for (const n of clientNotes) text(`- ${n.body}`, { size: 9.5 });
  }

  const docs = (docsRes.data ?? []) as { category: string; label: string | null; doc_date: string | null }[];
  if (docs.length) {
    heading("Pièces jointes au dossier");
    for (const d of docs) row(d.category, [d.label, d.doc_date ? formatDate(d.doc_date) : null].filter(Boolean).join(" — ") || "—");
  }

  /* -------------------------------- Prochaine étape ------------------------- */
  heading("Prochaine étape");
  text(
    "Ce cahier des charges constitue une pré-étude commerciale. Après votre accord, une visite technique sera planifiee afin de confirmer les elements techniques et d'etablir un devis definitif.",
    { size: 10 },
  );

  /* --------------------------------- Pieds de page -------------------------- */
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({
      start: { x: MARGIN, y: MARGIN - 10 },
      end: { x: A4[0] - MARGIN, y: MARGIN - 10 },
      thickness: 0.5,
      color: rgb(0.85, 0.87, 0.9),
    });
    p.drawText(sanitize(`${branding?.name ?? ""} · ${study.reference} · Document non contractuel`), {
      x: MARGIN,
      y: MARGIN - 24,
      size: 7.5,
      font,
      color: muted,
    });
    p.drawText(`${i + 1} / ${pages.length}`, { x: A4[0] - MARGIN - 30, y: MARGIN - 24, size: 7.5, font, color: muted });
  });

  return pdf.save();
}

/** Génère le PDF et le stocke dans le bucket privé. Retourne le chemin. */
export async function buildAndStoreStudyPdf(companyId: string, studyId: string): Promise<string> {
  const bytes = await buildStudyPdfBytes(companyId, studyId);
  const path = `${companyId}/etudes/${studyId}/cahier-des-charges.pdf`;
  const { error } = await supabaseAdmin.storage.from("pv-assets").upload(path, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw new Error(`Génération du PDF impossible : ${error.message}`);
  await supabaseAdmin
    .from("technical_studies")
    .update({ pdf_path: path, pdf_generated_at: new Date().toISOString() } as never)
    .eq("id", studyId)
    .eq("company_id", companyId);
  return path;
}

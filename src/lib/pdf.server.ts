import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { getCompanyBranding, getCompanyBrandingSettings, hexToRgb01, type CompanyBranding, type CompanyBrandingSettings, DEFAULT_BRANDING_SETTINGS } from "./branding.server";
import { sha256OfBytes, shortUA, EIDAS_MENTIONS } from "./signature-proof.server";
import { RESERVE_STATUS_LABEL, RESERVE_PRIORITY_LABEL, RESERVE_SEVERITY_LABEL, isReserveOverdue, type ReserveStatusValue } from "./reserve-status";

type Company = (Partial<CompanyBranding> & { name?: string | null }) | undefined;
type Client = { name?: string | null; email?: string | null; phone?: string | null; address?: string | null } | undefined;
type Chantier = {
  name?: string | null;
  address?: string | null;
  start_date?: string | null;
  end_date?: string | null;
} | undefined;
type Reserve = {
  description: string;
  severity: string;
  status: string;
  priority?: string | null;
  nature?: string | null;
  work_to_execute?: string | null;
  due_date?: string | null;
  lifted_at?: string | null;
  validated_at?: string | null;
  assigned_name?: string | null;
};
type Pv = {
  id?: string;
  numero: string;
  type: string;
  status: string;
  reception_date: string | null;
  description: string | null;
  observations: string | null;
  client_signature: string | null;
  company_signature: string | null;
  signed_at: string | null;
  created_at: string;
  reception_with_reserves?: boolean | null;
  work_reference_type?: string | null;
  work_reference_number?: string | null;
  work_reference_date?: string | null;
  work_reference_amount?: number | null;
  reserve_completion_delay?: string | null;
  reserve_due_date?: string | null;
  chantier_address?: string | null;
  chantier_postal_code?: string | null;
  chantier_city?: string | null;
  // eIDAS evidence
  signature_mode?: string | null;
  client_identity_email?: string | null;
  client_identity_verified_at?: string | null;
  client_identity_verified_by?: string | null;
  client_signature_ip?: string | null;
  client_signature_user_agent?: string | null;
  consent_text?: string | null;
  consent_at?: string | null;
};

export type SignatureProofMeta = {
  companySignatoryName?: string | null;
  companySignatoryFunction?: string | null;
  pdfSha256?: string | null;
  pdfGeneratedAt: string;
};

export type ReferenceDocument = {
  file_name: string;
  document_type?: string | null;
  document_number?: string | null;
  document_date?: string | null;
  amount_ht?: number | null;
  vat_amount?: number | null;
  amount_ttc?: number | null;
  extraction_status?: "success" | "failed" | "manual" | string | null;
};

const ACCENT = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.42, 0.45, 0.52);
const SUBTLE = rgb(0.62, 0.65, 0.72);
const BORDER = rgb(0.86, 0.88, 0.91);
const SOFT = rgb(0.96, 0.97, 0.99);
const SUCCESS_BG = rgb(0.92, 0.97, 0.93);
const SUCCESS_FG = rgb(0.10, 0.45, 0.20);

/** Replace characters that WinAnsi can't encode (used by Helvetica). */
function sanitize(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u20AC/g, "EUR")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x00-\xff]/g, "?");
}

function formatDate(s: string | null | undefined, withTime = false): string {
  if (!s) return "-";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "-";
  const date = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  if (!withTime) return date;
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${date} a ${time}`;
}

function formatTime(s: string | null | undefined): string {
  if (!s) return "-";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function detectImageType(bytes: Uint8Array): "png" | "jpg" | null {
  if (bytes.length < 4) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  return null;
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; type: "png" | "jpg" } | null {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  const type = m[1].toLowerCase().startsWith("jp") ? "jpg" : "png";
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, type };
}

function wrapLines(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const raw of sanitize(text).split(/\r?\n/)) {
    const words = raw.split(" ");
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > maxWidth && cur) {
        lines.push(cur);
        cur = w;
      } else cur = next;
    }
    if (cur) lines.push(cur);
    if (!words.length) lines.push("");
  }
  return lines;
}

export async function generatePvPdfBytes(input: {
  pv: Pv;
  company: Company;
  client: Client;
  chantier: Chantier;
  reserves: Reserve[];
  photos: { caption: string | null; bytes: Uint8Array }[];
  branding?: CompanyBrandingSettings;
  proof?: SignatureProofMeta;
  referenceDocument?: ReferenceDocument | null;
}): Promise<Uint8Array> {
  const { pv, company, client, chantier, reserves, photos, proof } = input;
  const referenceDocument = input.referenceDocument ?? null;
  const branding = input.branding ?? DEFAULT_BRANDING_SETTINGS;
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const PRIMARY = (() => {
    const [r, g, b] = hexToRgb01(branding.pdf_brand_color || branding.brand_color);
    return rgb(r, g, b);
  })();
  const PRIMARY_DARK = (() => {
    const [r, g, b] = hexToRgb01(branding.pdf_brand_color || branding.brand_color);
    return rgb(clamp01(r * 0.6), clamp01(g * 0.6), clamp01(b * 0.6));
  })();
  const HEADER_BG = (() => {
    const [r, g, b] = hexToRgb01(branding.pdf_brand_color || branding.brand_color);
    return rgb(clamp01(r * 0.05 + 0.95), clamp01(g * 0.05 + 0.95), clamp01(b * 0.05 + 0.97));
  })();
  const pdf = await PDFDocument.create();
  pdf.setTitle(`PV de reception N° ${pv.numero}`);
  pdf.setCreator("PVIA");
  pdf.setProducer("PVIA");
  pdf.setSubject("Proces-verbal de reception de travaux");

  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const MARGIN = 44;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  let pageNum = 1;
  const pages: { page: PDFPage; num: number }[] = [];

  const drawFooter = (p: PDFPage, num: number) => {
    if (branding.pdf_watermark) {
      const wm = sanitize(branding.pdf_watermark).slice(0, 40).toUpperCase();
      p.drawText(wm, {
        x: PAGE_W / 2 - wm.length * 18,
        y: PAGE_H / 2,
        size: 64,
        font: bold,
        color: rgb(0.85, 0.85, 0.88),
        rotate: { type: "degrees", angle: -28 } as any,
        opacity: 0.10,
      });
    }
    p.drawLine({ start: { x: MARGIN, y: 32 }, end: { x: PAGE_W - MARGIN, y: 32 }, thickness: 0.5, color: BORDER });
    const footerL = sanitize(branding.pdf_footer || "PVIA - Reception de travaux intelligente");
    p.drawText(footerL, { x: MARGIN, y: 20, size: 7.5, font: helv, color: MUTED });
    const mid = `PV N° ${sanitize(pv.numero)}  -  Genere le ${formatDate(proof?.pdfGeneratedAt ?? new Date().toISOString())}`;
    const midW = helv.widthOfTextAtSize(mid, 7.5);
    p.drawText(mid, { x: (PAGE_W - midW) / 2, y: 20, size: 7.5, font: helv, color: MUTED });
    p.drawText(`Page ${num}`, { x: PAGE_W - MARGIN - 36, y: 20, size: 7.5, font: bold, color: ACCENT });
  };

  const drawText = (
    text: string,
    opts: { x?: number; y?: number; size?: number; font?: PDFFont; color?: RGB; maxWidth?: number } = {},
  ) => {
    const size = opts.size ?? 10;
    const font = opts.font ?? helv;
    const color = opts.color ?? ACCENT;
    const x = opts.x ?? MARGIN;
    const yy = opts.y ?? y;
    const lines = opts.maxWidth ? wrapLines(font, text, size, opts.maxWidth) : [sanitize(text)];
    let cursor = yy;
    for (const line of lines) {
      page.drawText(line, { x, y: cursor, size, font, color });
      cursor -= size * 1.35;
    }
    return yy - cursor;
  };

  const newPage = () => {
    pages.push({ page, num: pageNum });
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pageNum += 1;
    y = PAGE_H - MARGIN;
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < 50) newPage();
  };

  const sectionTitle = (title: string) => {
    ensureSpace(28);
    page.drawRectangle({ x: MARGIN, y: y - 4, width: 3, height: 12, color: PRIMARY });
    page.drawText(sanitize(title).toUpperCase(), {
      x: MARGIN + 10,
      y: y - 2,
      size: 9.5,
      font: bold,
      color: PRIMARY_DARK,
    });
    page.drawLine({
      start: { x: MARGIN + 10 + bold.widthOfTextAtSize(sanitize(title).toUpperCase(), 9.5) + 8, y: y + 2 },
      end: { x: PAGE_W - MARGIN, y: y + 2 },
      thickness: 0.4,
      color: BORDER,
    });
    y -= 18;
  };

  const para = (text: string, size = 9.5, color: RGB = ACCENT, font: PDFFont = helv) => {
    const lines = wrapLines(font, text, size, CONTENT_W);
    ensureSpace(lines.length * (size * 1.35) + 4);
    for (const l of lines) {
      page.drawText(l, { x: MARGIN, y, size, font, color });
      y -= size * 1.35;
    }
  };

  // ============ HEADER (page 1) ============
  page.drawRectangle({ x: 0, y: PAGE_H - 130, width: PAGE_W, height: 130, color: HEADER_BG });
  page.drawRectangle({ x: 0, y: PAGE_H - 4, width: PAGE_W, height: 4, color: PRIMARY });

  // Logo
  if (company?.logo_url) {
    try {
      const res = await fetch(company.logo_url);
      if (res.ok) {
        const ab = await res.arrayBuffer();
        const u8 = new Uint8Array(ab);
        const t = detectImageType(u8);
        if (t) {
          const img = t === "png" ? await pdf.embedPng(u8) : await pdf.embedJpg(u8);
          const h = 54;
          const w = (img.width / img.height) * h;
          page.drawImage(img, { x: MARGIN, y: PAGE_H - 90, width: Math.min(w, 160), height: h });
        }
      }
    } catch { /* ignore */ }
  }

  // Title block (right)
  const titleX = PAGE_W - MARGIN - 240;
  page.drawText("PROCES-VERBAL", { x: titleX, y: PAGE_H - 36, size: 9, font: bold, color: PRIMARY });
  page.drawText(pv.type === "reception" ? "DE RECEPTION DE TRAVAUX" : sanitize(pv.type).toUpperCase(), {
    x: titleX, y: PAGE_H - 50, size: 9, font: helv, color: MUTED,
  });
  page.drawText(`N° ${sanitize(pv.numero)}`, { x: titleX, y: PAGE_H - 80, size: 20, font: bold, color: ACCENT });
  page.drawText("Article 1792-6 du Code civil", { x: titleX, y: PAGE_H - 100, size: 7.5, font: italic, color: MUTED });

  // Company contact strip
  const stripY = PAGE_H - 122;
  const contactBits = [
    company?.phone ? `Tel ${company.phone}` : null,
    company?.email,
    company?.website,
  ].filter(Boolean).map(s => sanitize(s as string));
  if (contactBits.length) {
    page.drawText(contactBits.join("  -  "), { x: MARGIN, y: stripY, size: 7.5, font: helv, color: MUTED });
  }

  y = PAGE_H - 150;

  // ============ PARTIES ============
  const colW = (CONTENT_W - 16) / 2;
  const drawParty = (x: number, title: string, name: string, lines: string[], legalLines: string[]) => {
    const boxH = 140;
    page.drawRectangle({ x, y: y - boxH, width: colW, height: boxH, borderColor: BORDER, borderWidth: 0.6, color: rgb(1, 1, 1) });
    page.drawRectangle({ x, y: y - 18, width: colW, height: 18, color: PRIMARY });
    page.drawText(sanitize(title).toUpperCase(), { x: x + 10, y: y - 13, size: 8, font: bold, color: rgb(1, 1, 1) });
    page.drawText(sanitize(name) || "-", { x: x + 10, y: y - 36, size: 11, font: bold, color: ACCENT });
    let yy = y - 52;
    for (const l of lines) {
      const t = sanitize(l);
      if (!t) continue;
      const wrapped = wrapLines(helv, t, 8.5, colW - 20);
      for (const w of wrapped) {
        if (yy < y - boxH + 38) break;
        page.drawText(w, { x: x + 10, y: yy, size: 8.5, font: helv, color: MUTED });
        yy -= 11;
      }
    }
    if (legalLines.length) {
      let ly = y - boxH + 26;
      page.drawLine({ start: { x: x + 10, y: ly + 10 }, end: { x: x + colW - 10, y: ly + 10 }, thickness: 0.3, color: BORDER });
      for (const l of legalLines) {
        const t = sanitize(l);
        if (!t) continue;
        page.drawText(t, { x: x + 10, y: ly, size: 7, font: helv, color: SUBTLE });
        ly -= 9;
      }
    }
  };

  const companyAddrLines: string[] = [];
  if (company?.address_line1) companyAddrLines.push(company.address_line1);
  if (company?.address_line2) companyAddrLines.push(company.address_line2);
  const cityLine = [company?.postal_code, company?.city].filter(Boolean).join(" ").trim();
  if (cityLine) companyAddrLines.push(cityLine);
  if (company?.country) companyAddrLines.push(company.country);
  if (!companyAddrLines.length && company?.address) companyAddrLines.push(company.address);

  const companyLegal: string[] = [];
  if (company?.legal_form) companyLegal.push(company.legal_form);
  if (company?.siren) companyLegal.push(`SIREN ${company.siren}`);
  if (company?.siret) companyLegal.push(`SIRET ${company.siret}`);
  if (company?.vat_number) companyLegal.push(`TVA ${company.vat_number}`);
  companyLegal.push("Garantie decennale - Art. 1792 C. civ.");

  drawParty(MARGIN, "Entreprise (titulaire)", company?.name ?? "-", companyAddrLines, companyLegal);
  drawParty(MARGIN + colW + 16, "Maitre d'ouvrage (client)", client?.name ?? "-", [
    client?.address ?? "",
    client?.email ?? "",
    client?.phone ?? "",
  ], []);
  y -= 160;

  // ============ INFO BAND - références & dates ============
  ensureSpace(70);
  page.drawRectangle({ x: MARGIN, y: y - 64, width: CONTENT_W, height: 64, color: SOFT, borderColor: BORDER, borderWidth: 0.5 });

  const refTypeLabel = (() => {
    switch (pv.work_reference_type) {
      case "devis": return "Devis n°";
      case "bon_commande": return "Bon de commande n°";
      case "marche": return "Marche n°";
      case "manuel": return "Reference";
      default: return "Reference";
    }
  })();
  const cells: { label: string; value: string }[] = [
    { label: "Chantier", value: chantier?.name ?? "-" },
    { label: refTypeLabel, value: pv.work_reference_number ?? "-" },
    { label: "Date reception", value: formatDate(pv.reception_date) },
    { label: "Debut travaux", value: formatDate(chantier?.start_date ?? null) },
    { label: "Fin travaux", value: formatDate(chantier?.end_date ?? null) },
    { label: "Statut", value: pv.status === "signe" ? "Signe" : sanitize(pv.status) },
  ];
  const cellW = CONTENT_W / 3;
  cells.forEach((c, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const cx = MARGIN + col * cellW + 12;
    const cy = y - 18 - row * 28;
    page.drawText(sanitize(c.label).toUpperCase(), { x: cx, y: cy, size: 6.5, font: bold, color: MUTED });
    const v = wrapLines(helv, c.value, 9.5, cellW - 16)[0] ?? "-";
    page.drawText(v, { x: cx, y: cy - 12, size: 9.5, font: bold, color: ACCENT });
  });
  if (chantier?.address) {
    page.drawText(sanitize(`Adresse chantier : ${chantier.address}`), {
      x: MARGIN + 12, y: y - 78, size: 7.5, font: italic, color: MUTED,
    });
    y -= 84;
  } else {
    y -= 74;
  }

  // ============ DECLARATION DE RECEPTION ============
  sectionTitle("Declaration de reception");
  const withRes = !!pv.reception_with_reserves;
  para(
    "La reception des travaux est prononcee contradictoirement entre les parties conformement aux dispositions de l'article 1792-6 du Code civil. " +
    "Le maitre d'ouvrage declare avoir pu constater l'etat des ouvrages realises et accepte la reception des travaux decrits dans le present document.",
    9.5, ACCENT,
  );
  y -= 4;

  // Banner with/without reserves
  ensureSpace(38);
  if (withRes) {
    page.drawRectangle({ x: MARGIN, y: y - 32, width: CONTENT_W, height: 32, color: rgb(1, 0.96, 0.90), borderColor: rgb(0.85, 0.55, 0.10), borderWidth: 0.6 });
    page.drawText("RECEPTION PRONONCEE AVEC RESERVES", { x: MARGIN + 14, y: y - 14, size: 10, font: bold, color: rgb(0.55, 0.30, 0.05) });
    page.drawText("Conformement a la liste detaillee ci-apres.", { x: MARGIN + 14, y: y - 26, size: 8.5, font: helv, color: rgb(0.55, 0.30, 0.05) });
  } else {
    page.drawRectangle({ x: MARGIN, y: y - 32, width: CONTENT_W, height: 32, color: SUCCESS_BG, borderColor: SUCCESS_FG, borderWidth: 0.6 });
    page.drawText("RECEPTION PRONONCEE SANS RESERVE", { x: MARGIN + 14, y: y - 14, size: 10, font: bold, color: SUCCESS_FG });
    page.drawText("A compter de la date de signature du present proces-verbal.", { x: MARGIN + 14, y: y - 26, size: 8.5, font: helv, color: SUCCESS_FG });
  }
  y -= 40;

  if (pv.work_reference_type && pv.work_reference_number) {
    const typeLabel = ({ devis: "devis", bon_commande: "bon de commande", marche: "marche", manuel: "document" } as Record<string, string>)[pv.work_reference_type] ?? "document";
    const ref = `Au titre du ${typeLabel} n° ${pv.work_reference_number}` +
      (pv.work_reference_date ? ` en date du ${formatDate(pv.work_reference_date)}` : "") +
      (pv.work_reference_amount != null ? ` d'un montant de ${pv.work_reference_amount} EUR` : "") + ".";
    para(ref, 9, MUTED, italic);
  }
  if (withRes && pv.reserve_completion_delay) {
    para(`Delai global convenu pour la levee des reserves : ${pv.reserve_completion_delay}` +
      (pv.reserve_due_date ? ` (echeance ${formatDate(pv.reserve_due_date)}).` : "."), 9, MUTED, italic);
  }
  y -= 4;

  // ============ TRAVAUX REALISES ============
  sectionTitle("Travaux realises");
  para(pv.description || "Aucune description fournie.", 9.5);
  if (pv.observations) {
    y -= 6;
    sectionTitle("Observations techniques");
    para(pv.observations, 9.5);
  }
  y -= 4;

  // ============ DOCUMENT DE REFERENCE ============
  if (referenceDocument) {
    const rd = referenceDocument;
    const typeLabel = ({
      devis: "Devis",
      bon_commande: "Bon de commande",
      marche: "Marche",
      contrat: "Contrat",
      autre: "Autre",
      manuel: "Document",
    } as Record<string, string>)[rd.document_type ?? "autre"] ?? "Document";
    const fmtMoney = (n: number | null | undefined) =>
      n == null || isNaN(Number(n)) ? "-" : `${Number(n).toFixed(2)} EUR`;
    const statusLabel = ({
      success: "Extraction automatique",
      failed: "Saisie manuelle (extraction echouee)",
      manual: "Saisie manuelle",
    } as Record<string, string>)[rd.extraction_status ?? "manual"] ?? "Saisie manuelle";

    sectionTitle("Document de reference");
    const rows: { label: string; value: string }[] = [
      { label: "Type", value: typeLabel },
      { label: "Numero", value: sanitize(rd.document_number) || "-" },
      { label: "Date", value: formatDate(rd.document_date) },
      { label: "Montant HT", value: fmtMoney(rd.amount_ht) },
      { label: "Montant TVA", value: fmtMoney(rd.vat_amount) },
      { label: "Montant TTC", value: fmtMoney(rd.amount_ttc) },
      { label: "Fichier", value: sanitize(rd.file_name).slice(0, 80) || "-" },
      { label: "Statut", value: statusLabel },
    ];
    const rowH = 16;
    ensureSpace(rowH * rows.length + 26);
    page.drawRectangle({
      x: MARGIN, y: y - rowH * rows.length, width: CONTENT_W, height: rowH * rows.length,
      borderColor: BORDER, borderWidth: 0.5, color: SOFT,
    });
    rows.forEach((r, i) => {
      const ry = y - i * rowH - 12;
      page.drawText(sanitize(r.label).toUpperCase(), { x: MARGIN + 10, y: ry, size: 7.5, font: bold, color: MUTED });
      page.drawText(r.value, { x: MARGIN + 130, y: ry, size: 9, font: helv, color: ACCENT });
      if (i < rows.length - 1) {
        page.drawLine({
          start: { x: MARGIN, y: y - (i + 1) * rowH },
          end: { x: MARGIN + CONTENT_W, y: y - (i + 1) * rowH },
          thickness: 0.3, color: BORDER,
        });
      }
    });
    y -= rowH * rows.length + 6;
    para(
      "Ce document est annexe au dossier numerique PVIA et a servi de base a la redaction du present proces-verbal.",
      8.5, MUTED, italic,
    );
    y -= 6;
  }



  // ============ RESERVES ============
  sectionTitle(`Reserves${reserves.length ? ` (${reserves.length})` : ""}`);
  if (!reserves.length) {
    ensureSpace(34);
    page.drawRectangle({ x: MARGIN, y: y - 30, width: CONTENT_W, height: 30, color: SUCCESS_BG, borderColor: SUCCESS_FG, borderWidth: 0.5 });
    page.drawText("Aucune reserve n'a ete formulee lors de la reception.", { x: MARGIN + 14, y: y - 19, size: 10, font: bold, color: SUCCESS_FG });
    y -= 38;
  } else {
    // Table header
    const cols = [
      { label: "N°", w: 30 },
      { label: "Description", w: 200 },
      { label: "Gravite", w: 70 },
      { label: "Travaux correctifs", w: 140 },
      { label: "Echeance", w: CONTENT_W - 30 - 200 - 70 - 140 },
    ];
    ensureSpace(24);
    let cx = MARGIN;
    page.drawRectangle({ x: MARGIN, y: y - 18, width: CONTENT_W, height: 18, color: PRIMARY });
    for (const c of cols) {
      page.drawText(sanitize(c.label).toUpperCase(), { x: cx + 6, y: y - 13, size: 7.5, font: bold, color: rgb(1, 1, 1) });
      cx += c.w;
    }
    y -= 18;
    reserves.forEach((r, idx) => {
      const descLines = wrapLines(helv, r.description, 8.5, cols[1].w - 10);
      const workLines = wrapLines(helv, r.work_to_execute ?? "-", 8.5, cols[3].w - 10);
      const rowLines = Math.max(descLines.length, workLines.length, 1);
      const rowH = Math.max(22, rowLines * 11 + 8);
      ensureSpace(rowH);
      // alternating bg
      if (idx % 2 === 0) page.drawRectangle({ x: MARGIN, y: y - rowH, width: CONTENT_W, height: rowH, color: SOFT });
      // severity left bar
      const sevColor =
        r.severity === "majeure" || r.severity === "bloquante" ? rgb(0.80, 0.10, 0.10) :
        r.severity === "mineure" ? rgb(0.92, 0.62, 0.07) :
        rgb(0.35, 0.55, 0.80);
      page.drawRectangle({ x: MARGIN, y: y - rowH, width: 3, height: rowH, color: sevColor });
      let cx2 = MARGIN;
      // N°
      page.drawText(String(idx + 1).padStart(2, "0"), { x: cx2 + 8, y: y - 14, size: 9, font: bold, color: ACCENT });
      cx2 += cols[0].w;
      // Description
      let ly = y - 12;
      for (const l of descLines) { page.drawText(l, { x: cx2 + 6, y: ly, size: 8.5, font: helv, color: ACCENT }); ly -= 11; }
      cx2 += cols[1].w;
      // Gravite badge
      page.drawText(sanitize(r.severity).toUpperCase(), { x: cx2 + 6, y: y - 14, size: 7.5, font: bold, color: sevColor });
      page.drawText(sanitize(r.status), { x: cx2 + 6, y: y - 24, size: 7, font: helv, color: MUTED });
      cx2 += cols[2].w;
      // Travaux
      let ly2 = y - 12;
      for (const l of workLines) { page.drawText(l, { x: cx2 + 6, y: ly2, size: 8.5, font: helv, color: ACCENT }); ly2 -= 11; }
      cx2 += cols[3].w;
      // Echeance
      page.drawText(formatDate(r.due_date), { x: cx2 + 6, y: y - 14, size: 8.5, font: helv, color: ACCENT });
      // bottom border
      page.drawLine({ start: { x: MARGIN, y: y - rowH }, end: { x: MARGIN + CONTENT_W, y: y - rowH }, thickness: 0.3, color: BORDER });
      y -= rowH;
    });
    y -= 8;
  }

  // ============ GARANTIES APPLICABLES ============
  sectionTitle("Garanties applicables");
  const garanties: { titre: string; duree: string; desc: string }[] = [
    { titre: "Garantie de parfait achevement", duree: "1 an", desc: "Article 1792-6 du Code civil - reparation de tous les desordres signales par le maitre d'ouvrage." },
    { titre: "Garantie de bon fonctionnement", duree: "2 ans", desc: "Article 1792-3 du Code civil - elements d'equipement dissociables de l'ouvrage." },
    { titre: "Garantie decennale", duree: "10 ans", desc: "Articles 1792 et 2270 du Code civil - dommages compromettant la solidite de l'ouvrage ou le rendant impropre a sa destination." },
  ];
  for (const g of garanties) {
    ensureSpace(36);
    page.drawRectangle({ x: MARGIN, y: y - 32, width: CONTENT_W, height: 32, color: rgb(1, 1, 1), borderColor: BORDER, borderWidth: 0.5 });
    page.drawRectangle({ x: MARGIN, y: y - 32, width: 3, height: 32, color: PRIMARY });
    page.drawText(sanitize(g.titre), { x: MARGIN + 12, y: y - 13, size: 9.5, font: bold, color: ACCENT });
    page.drawText(sanitize(g.duree), { x: PAGE_W - MARGIN - 56, y: y - 13, size: 9.5, font: bold, color: PRIMARY });
    const dl = wrapLines(helv, g.desc, 7.5, CONTENT_W - 24);
    page.drawText(dl[0] ?? "", { x: MARGIN + 12, y: y - 24, size: 7.5, font: helv, color: MUTED });
    y -= 36;
  }
  para("Les garanties legales prennent effet a compter de la date de reception des travaux mentionnee ci-dessus.", 8.5, MUTED, italic);
  y -= 4;

  // ============ EFFETS DE LA RECEPTION ============
  sectionTitle("Effets de la reception");
  para(
    "La reception des travaux emporte transfert de la garde de l'ouvrage au maitre d'ouvrage a compter de la date de signature du present proces-verbal, " +
    "sous reserve des eventuelles reserves mentionnees ci-dessus. Elle constitue le point de depart des garanties legales applicables.",
    9.5,
  );
  y -= 8;

  // ============ PHOTOS ============
  if (photos.length) {
    sectionTitle(`Photos du chantier (${photos.length})`);
    const colsN = 2;
    const gap = 12;
    const cW = (CONTENT_W - gap * (colsN - 1)) / colsN;
    const cH = 150;
    let col = 0;
    for (const p of photos) {
      const t = detectImageType(p.bytes);
      if (!t) continue;
      if (col === 0) ensureSpace(cH + 28);
      const x = MARGIN + col * (cW + gap);
      try {
        const img = t === "png" ? await pdf.embedPng(p.bytes) : await pdf.embedJpg(p.bytes);
        const ratio = img.width / img.height;
        let w = cW, h = cW / ratio;
        if (h > cH) { h = cH; w = cH * ratio; }
        const offX = x + (cW - w) / 2;
        const offY = y - cH + (cH - h) / 2;
        page.drawRectangle({ x, y: y - cH, width: cW, height: cH, borderColor: BORDER, borderWidth: 0.5 });
        page.drawImage(img, { x: offX, y: offY, width: w, height: h });
        if (p.caption) {
          page.drawText(sanitize(p.caption).slice(0, 70), { x, y: y - cH - 12, size: 7.5, font: helv, color: MUTED });
        }
      } catch { /* skip */ }
      col++;
      if (col >= colsN) { col = 0; y -= cH + 24; }
    }
    if (col !== 0) y -= cH + 24;
    y -= 4;
  }

  // ============ SIGNATURES ============
  sectionTitle("Signatures");
  const sigW = (CONTENT_W - 16) / 2;
  const sigH = 140;
  ensureSpace(sigH + 16);
  const drawSig = async (x: number, label: string, data: string | null, meta: { name: string; fnLine?: string; dateLine: string; timeLine: string }) => {
    page.drawRectangle({ x, y: y - sigH, width: sigW, height: sigH, borderColor: BORDER, borderWidth: 0.6, color: rgb(1, 1, 1) });
    page.drawRectangle({ x, y: y - 18, width: sigW, height: 18, color: PRIMARY });
    page.drawText(sanitize(label).toUpperCase(), { x: x + 10, y: y - 13, size: 8, font: bold, color: rgb(1, 1, 1) });
    // signature area
    const padTop = 24, padBot = 56;
    if (data) {
      const parsed = dataUrlToBytes(data);
      if (parsed) {
        try {
          const img = parsed.type === "png" ? await pdf.embedPng(parsed.bytes) : await pdf.embedJpg(parsed.bytes);
          const maxW = sigW - 24, maxH = sigH - padTop - padBot;
          const ratio = img.width / img.height;
          let w = maxW, h = maxW / ratio;
          if (h > maxH) { h = maxH; w = maxH * ratio; }
          page.drawImage(img, { x: x + (sigW - w) / 2, y: y - sigH + padBot, width: w, height: h });
        } catch { /* skip */ }
      }
    } else {
      page.drawText("Non signe", { x: x + 12, y: y - sigH / 2, size: 9, font: italic, color: MUTED });
    }
    // separator
    page.drawLine({
      start: { x: x + 10, y: y - sigH + 50 },
      end: { x: x + sigW - 10, y: y - sigH + 50 },
      thickness: 0.3, color: BORDER,
    });
    // meta block
    page.drawText("Nom :", { x: x + 10, y: y - sigH + 38, size: 7, font: bold, color: MUTED });
    page.drawText(sanitize(meta.name) || "-", { x: x + 40, y: y - sigH + 38, size: 8.5, font: bold, color: ACCENT });
    if (meta.fnLine) {
      page.drawText("Fonction :", { x: x + 10, y: y - sigH + 26, size: 7, font: bold, color: MUTED });
      page.drawText(sanitize(meta.fnLine), { x: x + 52, y: y - sigH + 26, size: 8, font: helv, color: ACCENT });
    }
    page.drawText("Date :", { x: x + 10, y: y - sigH + 14, size: 7, font: bold, color: MUTED });
    page.drawText(meta.dateLine, { x: x + 40, y: y - sigH + 14, size: 8, font: helv, color: ACCENT });
    page.drawText("Heure :", { x: x + sigW / 2 + 6, y: y - sigH + 14, size: 7, font: bold, color: MUTED });
    page.drawText(meta.timeLine, { x: x + sigW / 2 + 42, y: y - sigH + 14, size: 8, font: helv, color: ACCENT });
  };
  await drawSig(MARGIN, "Pour l'entreprise", pv.company_signature, {
    name: proof?.companySignatoryName || company?.name || "-",
    fnLine: proof?.companySignatoryFunction || "Representant legal",
    dateLine: formatDate(pv.signed_at),
    timeLine: formatTime(pv.signed_at),
  });
  await drawSig(MARGIN + sigW + 16, "Pour le maitre d'ouvrage", pv.client_signature, {
    name: client?.name || "-",
    fnLine: undefined,
    dateLine: formatDate(pv.signed_at),
    timeLine: formatTime(pv.signed_at),
  });
  y -= sigH + 14;

  // ============ PREUVE DE SIGNATURE ELECTRONIQUE (eIDAS SES) ============
  if (pv.status === "signe" || pv.signed_at || pv.client_identity_email) {
    newPage();
    sectionTitle("Preuve de signature electronique (eIDAS SES)");
    para("Conformement au reglement (UE) n° 910/2014 (eIDAS), la signature electronique simple (SES) appliquee au present document est accompagnee des elements de preuve detailles ci-dessous.", 8.5, MUTED, italic);
    y -= 4;

    const proofBoxH = 220;
    ensureSpace(proofBoxH + 10);
    page.drawRectangle({ x: MARGIN, y: y - proofBoxH, width: CONTENT_W, height: proofBoxH, borderColor: BORDER, borderWidth: 0.6, color: SOFT });

    const colXa = MARGIN + 14;
    const colXb = MARGIN + CONTENT_W / 2 + 8;
    const colW2 = CONTENT_W / 2 - 22;
    let ya = y - 18;
    let yb = y - 18;

    const proofField = (col: "a" | "b", label: string, value: string) => {
      const x = col === "a" ? colXa : colXb;
      let cy = col === "a" ? ya : yb;
      page.drawText(sanitize(label).toUpperCase(), { x, y: cy, size: 6.5, font: bold, color: MUTED });
      cy -= 10;
      const lines = wrapLines(helv, value || "-", 8.5, colW2);
      for (const l of lines.slice(0, 2)) {
        page.drawText(l, { x, y: cy, size: 8.5, font: helv, color: ACCENT });
        cy -= 11;
      }
      cy -= 4;
      if (col === "a") ya = cy; else yb = cy;
    };

    const mode = pv.signature_mode === "remote"
      ? "Signature electronique a distance - OTP par email"
      : pv.signature_mode === "onsite"
        ? "Signature electronique sur place - OTP par email"
        : "Signature electronique simple";

    const localTs = pv.signed_at ? formatDate(pv.signed_at, true) : "-";
    const utcTs = pv.signed_at ? new Date(pv.signed_at).toISOString() : "-";

    // Column A — identifiants & parties
    proofField("a", "Identifiant PV", pv.id ?? "-");
    proofField("a", "Numero PV", pv.numero);
    proofField("a", "Signataire entreprise", proof?.companySignatoryName || company?.name || "-");
    proofField("a", "Signature entreprise", formatDate(pv.signed_at, true));
    proofField("a", "Email client verifie", pv.client_identity_email || client?.email || "-");
    proofField("a", "Identite verifiee le", formatDate(pv.client_identity_verified_at, true));

    // Column B — traceability
    proofField("b", "Methode de signature", mode);
    proofField("b", "Horodatage UTC", utcTs);
    proofField("b", "Horodatage local (Europe/Paris)", localTs);
    proofField("b", "Adresse IP client", pv.client_signature_ip || "-");
    proofField("b", "Navigateur client", shortUA(pv.client_signature_user_agent));
    proofField("b", "Consentement", pv.consent_at ? `Accepte le ${formatDate(pv.consent_at, true)}` : "-");

    y -= proofBoxH + 8;

    // Hash block
    ensureSpace(60);
    page.drawRectangle({ x: MARGIN, y: y - 52, width: CONTENT_W, height: 52, color: rgb(0.98, 0.98, 1), borderColor: BORDER, borderWidth: 0.5 });
    page.drawText("EMPREINTE NUMERIQUE DU DOCUMENT (SHA-256)", { x: MARGIN + 12, y: y - 14, size: 7, font: bold, color: MUTED });
    const hash = proof?.pdfSha256 ?? "(calcule a la generation)";
    page.drawText(hash, { x: MARGIN + 12, y: y - 28, size: 7.5, font: bold, color: ACCENT, maxWidth: CONTENT_W - 24 } as any);
    page.drawText(`Genere le ${formatDate(proof?.pdfGeneratedAt ?? new Date().toISOString(), true)}`, {
      x: MARGIN + 12, y: y - 42, size: 7, font: helv, color: MUTED,
    });
    y -= 60;

    // Legal mentions
    ensureSpace(80);
    drawText("MENTIONS LEGALES", { size: 8, font: bold, color: MUTED });
    y -= 12;
    for (const m of EIDAS_MENTIONS) {
      for (const l of wrapLines(helv, m, 7, CONTENT_W)) {
        ensureSpace(10);
        page.drawText(l, { x: MARGIN, y, size: 7, font: helv, color: MUTED });
        y -= 10;
      }
      y -= 2;
    }
  } else {
    // Legal mentions for unsigned PV
    y -= 8;
    sectionTitle("Mentions legales");
    para(
      "Le present proces-verbal de reception fait foi de la livraison des travaux decrits ci-dessus. " +
      "Sauf reserves expressement formulees, le client reconnait avoir constate la bonne execution des travaux. " +
      "Les reserves listees devront etre levees dans les delais convenus.",
      8, MUTED, italic,
    );
  }

  // Finalize: draw footer on every page
  pages.push({ page, num: pageNum });
  for (const p of pages) drawFooter(p.page, p.num);

  return await pdf.save();
}

import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Internal: build the PDF, upload it to `pv-assets`, persist pdf_url + pdf_generated_at. Returns the storage path. */
/**
 * PDF finalization guard — refuse to generate a signed PDF unless the PV is
 * legally complete. A PDF presented as a signed reception PV cannot exist
 * before company + client signatures and identity verification are in place.
 * Throws "PV_NOT_FINALIZED: <reason>" so callers can surface a clean error.
 */
function assertPvFinalizedForPdf(pv: any): void {
  if (pv.status !== "signe") throw new Error("PV_NOT_FINALIZED: PV non signé.");
  if (!pv.company_signature) throw new Error("PV_NOT_FINALIZED: Signature entreprise manquante.");
  if (!pv.client_signature) throw new Error("PV_NOT_FINALIZED: Signature client manquante.");
  const mode = pv.signature_mode;
  if (mode === "onsite" && pv.client_otp_verified !== true) {
    throw new Error("PV_NOT_FINALIZED: Code OTP client non validé.");
  }
  if (mode === "remote" && !pv.client_identity_verified_at) {
    throw new Error("PV_NOT_FINALIZED: Identité client distante non vérifiée.");
  }
}

export async function buildAndStorePvPdf(pvId: string): Promise<string> {
  const { data: pv } = await supabaseAdmin
    .from("pv")
    .select("id,numero,type,status,reception_date,description,observations,client_signature,company_signature,signed_at,company_id,client_id,chantier_id,created_at,owner_id,signature_mode,client_identity_email,client_identity_verified_at,client_identity_verified_by,client_signature_ip,client_signature_user_agent,consent_text,consent_at,reception_with_reserves,work_reference_type,work_reference_number,work_reference_date,work_reference_amount,reserve_completion_delay,reserve_due_date,client_otp_verified")
    .eq("id", pvId)
    .maybeSingle();
  if (!pv?.company_id) throw new Error("PV introuvable.");

  try {
    assertPvFinalizedForPdf(pv);
  } catch (e: any) {
    const reason = String(e?.message || "").replace(/^PV_NOT_FINALIZED:\s*/, "");
    const { writeAuditLog } = await import("./audit.server");
    await writeAuditLog({
      companyId: pv.company_id,
      pvId: pv.id,
      entityType: "pv",
      entityId: pv.id,
      action: "pv.pdf_generation_blocked_not_finalized" as any,
      metadata: { reason, status: pv.status, signature_mode: pv.signature_mode },
      actor: "system",
    }).catch(() => {});
    throw e;
  }

  const [company, brandingSettings, clientRes, chantierRes, photosRes, reservesRes, ownerRes] = await Promise.all([
    getCompanyBranding(pv.company_id),
    getCompanyBrandingSettings(pv.company_id),
    pv.client_id
      ? supabaseAdmin.from("clients").select("name,email,phone,address").eq("id", pv.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    pv.chantier_id
      ? supabaseAdmin.from("chantiers").select("name,address,start_date,end_date").eq("id", pv.chantier_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin.from("pv_photos").select("id,url,caption").eq("pv_id", pvId).order("created_at"),
    supabaseAdmin.from("pv_reserves").select("id,description,severity,status,nature,work_to_execute,due_date").eq("pv_id", pvId).order("created_at"),
    pv.owner_id
      ? supabaseAdmin.from("profiles").select("full_name").eq("id", pv.owner_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const photos: { caption: string | null; bytes: Uint8Array }[] = [];
  for (const p of (photosRes.data ?? []).slice(0, 12)) {
    const { data: f } = await supabaseAdmin.storage.from("pv-assets").download(p.url);
    if (f) photos.push({ caption: p.caption, bytes: new Uint8Array(await f.arrayBuffer()) });
  }

  let clientEmailEvidence = (pv as any).client_identity_email as string | null;
  let identityVerifiedAt = (pv as any).client_identity_verified_at as string | null;
  if (!clientEmailEvidence) {
    const { data: otp } = await supabaseAdmin
      .from("pv_signature_otps")
      .select("email,used_at,signature_mode")
      .eq("pv_id", pvId)
      .not("used_at", "is", null)
      .order("used_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (otp) {
      clientEmailEvidence = otp.email;
      identityVerifiedAt = identityVerifiedAt ?? otp.used_at;
    }
  }

  const enrichedPv = {
    ...pv,
    client_identity_email: clientEmailEvidence,
    client_identity_verified_at: identityVerifiedAt,
  } as any;

  // Latest reference document attached to this PV (prefer success extraction)
  const { data: docs } = await supabaseAdmin
    .from("pv_documents")
    .select("file_name,document_type,extracted_data,extraction_status,created_at")
    .eq("pv_id", pvId)
    .order("created_at", { ascending: false })
    .limit(20);
  let referenceDocument: ReferenceDocument | null = null;
  if (docs && docs.length) {
    const best = docs.find((d) => d.extraction_status === "success") ?? docs[0];
    const ex = (best.extracted_data ?? {}) as Record<string, any>;
    referenceDocument = {
      file_name: best.file_name,
      document_type: (best.document_type as string | null) ?? (ex.document_type as string | null) ?? null,
      document_number: (ex.document_number as string | null) ?? null,
      document_date: (ex.document_date as string | null) ?? null,
      amount_ht: typeof ex.amount_ht === "number" ? ex.amount_ht : null,
      vat_amount: typeof ex.vat_amount === "number" ? ex.vat_amount : null,
      amount_ttc: typeof ex.amount_ttc === "number" ? ex.amount_ttc : null,
      extraction_status: (best.extraction_status as any) ?? "manual",
    };
  }

  const generatedAt = new Date().toISOString();
  const companySignatoryName = (ownerRes as any).data?.full_name ?? company?.name ?? null;

  const passOneBytes = await generatePvPdfBytes({
    pv: enrichedPv,
    company: company ?? undefined,
    client: (clientRes as any).data ?? undefined,
    chantier: (chantierRes as any).data ?? undefined,
    reserves: reservesRes.data ?? [],
    photos,
    branding: brandingSettings,
    proof: { companySignatoryName, pdfGeneratedAt: generatedAt, pdfSha256: null },
    referenceDocument,
  });
  const pdfSha256 = await sha256OfBytes(passOneBytes);

  const pdfBytes = await generatePvPdfBytes({
    pv: enrichedPv,
    company: company ?? undefined,
    client: (clientRes as any).data ?? undefined,
    chantier: (chantierRes as any).data ?? undefined,
    reserves: reservesRes.data ?? [],
    photos,
    branding: brandingSettings,
    proof: { companySignatoryName, pdfGeneratedAt: generatedAt, pdfSha256 },
    referenceDocument,
  });

  const path = `${pv.company_id}/pv/${pvId}/PV-${pv.numero}-signed.pdf`;
  const { error: upErr } = await supabaseAdmin.storage
    .from("pv-assets")
    .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (upErr) throw new Error(`Échec upload PDF: ${upErr.message}`);

  const { error: updErr } = await supabaseAdmin
    .from("pv")
    .update({ pdf_url: path, pdf_generated_at: generatedAt } as any)
    .eq("id", pvId);
  if (updErr) throw new Error(updErr.message);

  return path;
}

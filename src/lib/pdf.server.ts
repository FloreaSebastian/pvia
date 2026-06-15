import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { getCompanyBranding, getCompanyBrandingSettings, hexToRgb01, type CompanyBranding, type CompanyBrandingSettings, DEFAULT_BRANDING_SETTINGS } from "./branding.server";
import { sha256OfBytes, shortUA, EIDAS_MENTIONS } from "./signature-proof.server";

type Company = (Partial<CompanyBranding> & { name?: string | null }) | undefined;
type Client = { name?: string | null; email?: string | null; phone?: string | null; address?: string | null } | undefined;
type Chantier = { name?: string | null; address?: string | null } | undefined;
type Reserve = {
  description: string;
  severity: string;
  status: string;
  nature?: string | null;
  work_to_execute?: string | null;
  due_date?: string | null;
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
  pdfSha256?: string | null;
  pdfGeneratedAt: string;
};

const ACCENT = rgb(0.06, 0.09, 0.16); // slate-900
const MUTED = rgb(0.42, 0.45, 0.52);
const BORDER = rgb(0.86, 0.88, 0.91);
const DEFAULT_PRIMARY = rgb(0.12, 0.23, 0.54);


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
}): Promise<Uint8Array> {
  const { pv, company, client, chantier, reserves, photos, proof } = input;
  const branding = input.branding ?? DEFAULT_BRANDING_SETTINGS;
  const PRIMARY = (() => {
    const [r, g, b] = hexToRgb01(branding.pdf_brand_color || branding.brand_color);
    return rgb(r, g, b);
  })();
  const HEADER_BG = (() => {
    const [r, g, b] = hexToRgb01(branding.pdf_brand_color || branding.brand_color);
    // very light tint
    return rgb(r * 0.05 + 0.95, g * 0.05 + 0.95, b * 0.05 + 0.97);
  })();
  const pdf = await PDFDocument.create();
  pdf.setTitle(`N° ${pv.numero}`);
  pdf.setCreator("PVIA");
  pdf.setProducer("PVIA");

  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);


  const PAGE_W = 595.28;
  const PAGE_H = 841.89;
  const MARGIN = 48;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  let pageNum = 1;

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

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN + 30) {
      drawFooter();
      page = pdf.addPage([PAGE_W, PAGE_H]);
      pageNum += 1;
      y = PAGE_H - MARGIN;
    }
  };

  const drawFooter = () => {
    // Watermark (diagonal, very light) — drawn under footer line, behind content
    if (branding.pdf_watermark) {
      const wm = sanitize(branding.pdf_watermark).slice(0, 40).toUpperCase();
      page.drawText(wm, {
        x: PAGE_W / 2 - wm.length * 18,
        y: PAGE_H / 2,
        size: 64,
        font: bold,
        color: rgb(0.85, 0.85, 0.88),
        rotate: { type: "degrees", angle: -28 } as any,
        opacity: 0.18,
      });
    }
    page.drawLine({ start: { x: MARGIN, y: MARGIN }, end: { x: PAGE_W - MARGIN, y: MARGIN }, thickness: 0.5, color: BORDER });
    const footerText = sanitize(branding.pdf_footer || "Document généré par PVIA.");
    page.drawText(`N° ${sanitize(pv.numero)} · ${footerText}`, { x: MARGIN, y: MARGIN - 14, size: 8, font: helv, color: MUTED });
    page.drawText(`Page ${pageNum}`, { x: PAGE_W - MARGIN - 40, y: MARGIN - 14, size: 8, font: helv, color: MUTED });
  };

  // ============ HEADER ============
  page.drawRectangle({ x: 0, y: PAGE_H - 110, width: PAGE_W, height: 110, color: HEADER_BG });
  page.drawRectangle({ x: 0, y: PAGE_H - 4, width: PAGE_W, height: 4, color: PRIMARY });


  // Optional logo
  if (company?.logo_url) {
    try {
      const res = await fetch(company.logo_url);
      if (res.ok) {
        const ab = await res.arrayBuffer();
        const u8 = new Uint8Array(ab);
        const t = detectImageType(u8);
        if (t) {
          const img = t === "png" ? await pdf.embedPng(u8) : await pdf.embedJpg(u8);
          const h = 48;
          const w = (img.width / img.height) * h;
          page.drawImage(img, { x: MARGIN, y: PAGE_H - 80, width: Math.min(w, 140), height: h });
        }
      }
    } catch { /* ignore */ }
  }

  drawText("PROCES-VERBAL", { x: PAGE_W - MARGIN - 200, y: PAGE_H - 40, size: 9, font: bold, color: PRIMARY });
  drawText(pv.type === "reception" ? "DE RECEPTION DE TRAVAUX" : pv.type.toUpperCase(), { x: PAGE_W - MARGIN - 200, y: PAGE_H - 54, size: 9, font: helv, color: MUTED });
  drawText(`N° ${pv.numero}`, { x: PAGE_W - MARGIN - 200, y: PAGE_H - 78, size: 18, font: bold, color: ACCENT });

  y = PAGE_H - 140;

  // ============ PARTIES ============
  const colW = (CONTENT_W - 16) / 2;
  const drawParty = (x: number, title: string, lines: string[]) => {
    page.drawRectangle({ x, y: y - 110, width: colW, height: 110, borderColor: BORDER, borderWidth: 0.5, color: rgb(1, 1, 1) });
    drawText(title.toUpperCase(), { x: x + 12, y: y - 18, size: 8, font: bold, color: PRIMARY });
    let yy = y - 36;
    for (let i = 0; i < lines.length; i++) {
      const isFirst = i === 0;
      const t = sanitize(lines[i]);
      if (!t) continue;
      page.drawText(t, { x: x + 12, y: yy, size: isFirst ? 11 : 9, font: isFirst ? bold : helv, color: isFirst ? ACCENT : MUTED });
      yy -= isFirst ? 16 : 12;
    }
  };

  const companyAddress = (() => {
    if (company?.address_line1) {
      return [
        company.address_line1,
        company.address_line2,
        [company.postal_code, company.city].filter(Boolean).join(" ").trim() || null,
        company.country,
      ].filter(Boolean).join(", ");
    }
    return company?.address ?? "";
  })();

  const companyLegalLine = [
    company?.legal_form,
    company?.siren ? `SIREN ${company.siren}` : null,
    company?.siret ? `SIRET ${company.siret}` : null,
    company?.vat_number ? `TVA ${company.vat_number}` : null,
  ].filter(Boolean).join(" · ");

  drawParty(MARGIN, "Entreprise", [
    company?.name ?? "-",
    companyAddress,
    company?.email ?? "",
    company?.phone ?? "",
    company?.website ?? "",
    companyLegalLine,
  ]);
  drawParty(MARGIN + colW + 16, "Client", [
    client?.name ?? "-",
    client?.address ?? "",
    client?.email ?? "",
    client?.phone ?? "",
  ]);
  y -= 130;

  // ============ INFO BAND ============
  ensureSpace(60);
  page.drawRectangle({ x: MARGIN, y: y - 50, width: CONTENT_W, height: 50, color: rgb(0.97, 0.98, 1), borderColor: BORDER, borderWidth: 0.5 });
  const infoCol = CONTENT_W / 3;
  const infoCell = (i: number, label: string, value: string) => {
    const x = MARGIN + i * infoCol + 12;
    page.drawText(label.toUpperCase(), { x, y: y - 18, size: 7, font: bold, color: MUTED });
    page.drawText(sanitize(value), { x, y: y - 34, size: 10, font: bold, color: ACCENT });
  };
  infoCell(0, "Chantier", chantier?.name ?? "-");
  infoCell(1, "Date de reception", formatDate(pv.reception_date));
  infoCell(2, "Statut", pv.status === "signe" ? "Signe" : pv.status);
  if (chantier?.address) {
    drawText(chantier.address, { x: MARGIN + 12, y: y - 48, size: 8, font: helv, color: MUTED, maxWidth: infoCol - 16 });
  }
  y -= 70;

  // ============ DECLARATION ============
  const withRes = !!pv.reception_with_reserves;
  const declLines: string[] = [];
  if (pv.work_reference_type && pv.work_reference_number) {
    const typeLabel = {
      devis: "devis",
      bon_commande: "bon de commande",
      marche: "marché",
      manuel: "document",
    }[pv.work_reference_type] ?? "document";
    const ref = `Au titre du ${typeLabel} n° ${pv.work_reference_number}` +
      (pv.work_reference_date ? ` en date du ${formatDate(pv.work_reference_date)}` : "") +
      (pv.work_reference_amount != null ? ` d'un montant de ${pv.work_reference_amount} EUR` : "") + ".";
    declLines.push(ref);
  }
  declLines.push(
    withRes
      ? "La reception est prononcee AVEC RESERVES, listees ci-dessous."
      : "La reception est prononcee SANS RESERVE.",
  );
  if (withRes && pv.reserve_completion_delay) {
    declLines.push(`Delai global convenu pour la levee : ${pv.reserve_completion_delay}` +
      (pv.reserve_due_date ? ` (echeance ${formatDate(pv.reserve_due_date)}).` : "."));
  }
  ensureSpace(declLines.length * 14 + 28);
  drawText("DECLARATION DE RECEPTION", { size: 9, font: bold, color: PRIMARY });
  y -= 14;
  for (const l of declLines) {
    const wrapped = wrapLines(helv, l, 10, CONTENT_W);
    for (const w of wrapped) { page.drawText(w, { x: MARGIN, y, size: 10, font: helv, color: ACCENT }); y -= 14; }
  }
  y -= 6;


  // ============ DESCRIPTION ============
  ensureSpace(40);
  drawText("DESCRIPTION DES TRAVAUX", { size: 9, font: bold, color: PRIMARY });
  y -= 14;
  const descLines = wrapLines(helv, pv.description || "Aucune description fournie.", 10, CONTENT_W);
  ensureSpace(descLines.length * 14 + 10);
  for (const l of descLines) { page.drawText(l, { x: MARGIN, y, size: 10, font: helv, color: ACCENT }); y -= 14; }
  y -= 8;

  if (pv.observations) {
    ensureSpace(40);
    drawText("OBSERVATIONS", { size: 9, font: bold, color: PRIMARY });
    y -= 14;
    const obs = wrapLines(helv, pv.observations, 10, CONTENT_W);
    ensureSpace(obs.length * 14 + 10);
    for (const l of obs) { page.drawText(l, { x: MARGIN, y, size: 10, font: helv, color: ACCENT }); y -= 14; }
    y -= 8;
  }

  // ============ RESERVES ============
  if (reserves.length) {
    ensureSpace(40);
    drawText(`RESERVES (${reserves.length})`, { size: 9, font: bold, color: PRIMARY });
    y -= 16;
    for (const r of reserves) {
      const descLines = wrapLines(helv, r.description, 9, CONTENT_W - 24);
      const workLines = r.work_to_execute ? wrapLines(helv, `Travaux a executer : ${r.work_to_execute}`, 8, CONTENT_W - 24) : [];
      const natureLine = r.nature ? 1 : 0;
      const metaLine = (r.due_date ? 1 : 0);
      const totalLines = descLines.length + workLines.length + natureLine + metaLine;
      const h = Math.max(40, totalLines * 11 + 26);
      ensureSpace(h + 6);
      page.drawRectangle({ x: MARGIN, y: y - h, width: CONTENT_W, height: h, borderColor: BORDER, borderWidth: 0.5, color: rgb(0.99, 0.99, 1) });
      const sevColor = r.severity === "majeure" || r.severity === "bloquante"
        ? rgb(0.86, 0.15, 0.15)
        : rgb(0.92, 0.62, 0.07);
      page.drawRectangle({ x: MARGIN, y: y - h, width: 3, height: h, color: sevColor });
      const header = `${sanitize(r.severity).toUpperCase()} - ${sanitize(r.status).toUpperCase()}`
        + (r.nature ? `  |  ${sanitize(r.nature).toUpperCase()}` : "")
        + (r.due_date ? `  |  ECHEANCE ${sanitize(formatDate(r.due_date))}` : "");
      page.drawText(header, { x: MARGIN + 12, y: y - 14, size: 7, font: bold, color: sevColor });
      let yy = y - 28;
      for (const l of descLines) { page.drawText(l, { x: MARGIN + 12, y: yy, size: 9, font: helv, color: ACCENT }); yy -= 11; }
      for (const l of workLines) { page.drawText(l, { x: MARGIN + 12, y: yy, size: 8, font: helv, color: MUTED }); yy -= 11; }
      y -= h + 6;
    }
    y -= 6;
  }

  // ============ PHOTOS ============
  if (photos.length) {
    ensureSpace(40);
    drawText(`PHOTOS DU CHANTIER (${photos.length})`, { size: 9, font: bold, color: PRIMARY });
    y -= 16;
    const cols = 2;
    const gap = 12;
    const cellW = (CONTENT_W - gap * (cols - 1)) / cols;
    const cellH = 150;
    let col = 0;
    for (const p of photos) {
      const t = detectImageType(p.bytes);
      if (!t) continue;
      if (col === 0) ensureSpace(cellH + 28);
      const x = MARGIN + col * (cellW + gap);
      try {
        const img = t === "png" ? await pdf.embedPng(p.bytes) : await pdf.embedJpg(p.bytes);
        const ratio = img.width / img.height;
        let w = cellW, h = cellW / ratio;
        if (h > cellH) { h = cellH; w = cellH * ratio; }
        const offX = x + (cellW - w) / 2;
        const offY = y - cellH + (cellH - h) / 2;
        page.drawRectangle({ x, y: y - cellH, width: cellW, height: cellH, borderColor: BORDER, borderWidth: 0.5 });
        page.drawImage(img, { x: offX, y: offY, width: w, height: h });
        if (p.caption) {
          page.drawText(sanitize(p.caption).slice(0, 70), { x, y: y - cellH - 12, size: 8, font: helv, color: MUTED });
        }
      } catch { /* skip broken image */ }
      col++;
      if (col >= cols) { col = 0; y -= cellH + 24; }
    }
    if (col !== 0) y -= cellH + 24;
    y -= 4;
  }

  // ============ SIGNATURES ============
  ensureSpace(180);
  drawText("SIGNATURES", { size: 9, font: bold, color: PRIMARY });
  y -= 14;
  const sigW = (CONTENT_W - 16) / 2;
  const sigH = 110;
  const drawSig = async (x: number, label: string, data: string | null) => {
    page.drawRectangle({ x, y: y - sigH, width: sigW, height: sigH, borderColor: BORDER, borderWidth: 0.5, color: rgb(1, 1, 1) });
    page.drawText(label.toUpperCase(), { x: x + 12, y: y - 16, size: 8, font: bold, color: PRIMARY });
    if (data) {
      const parsed = dataUrlToBytes(data);
      if (parsed) {
        try {
          const img = parsed.type === "png" ? await pdf.embedPng(parsed.bytes) : await pdf.embedJpg(parsed.bytes);
          const maxW = sigW - 24, maxH = sigH - 40;
          const ratio = img.width / img.height;
          let w = maxW, h = maxW / ratio;
          if (h > maxH) { h = maxH; w = maxH * ratio; }
          page.drawImage(img, { x: x + (sigW - w) / 2, y: y - sigH + 24, width: w, height: h });
        } catch { /* skip */ }
      }
    } else {
      page.drawText("Non signe", { x: x + 12, y: y - sigH / 2, size: 9, font: helv, color: MUTED });
    }
    if (label.toLowerCase().includes("client") && pv.signed_at) {
      page.drawText(`Signe le ${formatDate(pv.signed_at, true)}`, { x: x + 12, y: y - sigH + 8, size: 7, font: helv, color: MUTED });
    }
  };
  await drawSig(MARGIN, "Entreprise", pv.company_signature);
  await drawSig(MARGIN + sigW + 16, "Client", pv.client_signature);
  y -= sigH + 16;


  // ============ PREUVE DE SIGNATURE ELECTRONIQUE (eIDAS SES) ============
  if (pv.status === "signe" || pv.signed_at || pv.client_identity_email) {
    ensureSpace(220);
    drawText("PREUVE DE SIGNATURE ELECTRONIQUE", { size: 9, font: bold, color: PRIMARY });
    y -= 14;

    const proofBoxH = 170;
    page.drawRectangle({
      x: MARGIN,
      y: y - proofBoxH,
      width: CONTENT_W,
      height: proofBoxH,
      borderColor: BORDER,
      borderWidth: 0.5,
      color: rgb(0.985, 0.99, 1),
    });

    const colXa = MARGIN + 12;
    const colXb = MARGIN + CONTENT_W / 2 + 6;
    const colW2 = CONTENT_W / 2 - 18;
    let ya = y - 16;
    let yb = y - 16;

    const proofField = (col: "a" | "b", label: string, value: string) => {
      const x = col === "a" ? colXa : colXb;
      let cy = col === "a" ? ya : yb;
      page.drawText(label.toUpperCase(), { x, y: cy, size: 6.5, font: bold, color: MUTED });
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
      ? "Signature electronique a distance avec verification OTP par email"
      : pv.signature_mode === "onsite"
        ? "Signature electronique sur place avec verification OTP par email"
        : "Signature electronique simple";

    // Column A — parties
    proofField("a", "Signataire entreprise", proof?.companySignatoryName || company?.name || "-");
    proofField("a", "Signature entreprise", formatDate(pv.signed_at, true));
    proofField("a", "Email client verifie", pv.client_identity_email || client?.email || "-");
    proofField("a", "Identite verifiee le", formatDate(pv.client_identity_verified_at, true));
    proofField("a", "Signature client", formatDate(pv.signed_at, true));

    // Column B — traceability
    proofField("b", "Methode de signature", mode);
    proofField("b", "Adresse IP client", pv.client_signature_ip || "-");
    proofField("b", "Navigateur client", shortUA(pv.client_signature_user_agent));
    proofField("b", "Consentement", pv.consent_at ? `Accepte le ${formatDate(pv.consent_at, true)}` : "-");
    proofField("b", "Version consentement", pv.consent_text ? sanitize(pv.consent_text).slice(0, 8) : "-");

    y -= proofBoxH + 6;

    // Doc fingerprint footer (inside proof zone)
    ensureSpace(40);
    drawText("Empreinte numerique du document", { size: 7, font: bold, color: MUTED });
    y -= 10;
    drawText(`UUID : ${pv.id ?? "-"}`, { size: 7, font: helv, color: MUTED });
    y -= 10;
    drawText(`N° : ${pv.numero}   ·   Genere le ${formatDate(proof?.pdfGeneratedAt ?? new Date().toISOString(), true)}`, { size: 7, font: helv, color: MUTED });
    y -= 10;
    drawText(`SHA-256 : ${proof?.pdfSha256 ?? "(calcule a la generation)"}`, { size: 6.5, font: helv, color: MUTED, maxWidth: CONTENT_W });
    y -= 12;
  }

  // ============ MENTIONS ============
  ensureSpace(80);
  drawText("MENTIONS LEGALES", { size: 8, font: bold, color: MUTED });
  y -= 12;
  const mentions =
    "Le present proces-verbal de reception fait foi de la livraison des travaux decrits ci-dessus. " +
    "Sauf reserves expressement formulees ci-dessus, le client reconnait avoir constate la bonne execution des travaux. " +
    "Les reserves listees devront etre levees dans les delais convenus.";
  const ml = wrapLines(helv, mentions, 7.5, CONTENT_W);
  for (const l of ml) { page.drawText(l, { x: MARGIN, y, size: 7.5, font: helv, color: MUTED }); y -= 11; }
  y -= 4;
  for (const m of EIDAS_MENTIONS) {
    for (const l of wrapLines(helv, m, 7, CONTENT_W)) {
      page.drawText(l, { x: MARGIN, y, size: 7, font: helv, color: MUTED });
      y -= 10;
    }
  }

  drawFooter();
  return await pdf.save();
}

import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Internal: build the PDF, upload it to `pv-assets`, persist pdf_url + pdf_generated_at. Returns the storage path. */
export async function buildAndStorePvPdf(pvId: string): Promise<string> {
  const { data: pv } = await supabaseAdmin
    .from("pv")
    .select(
      "id,numero,type,status,reception_date,description,observations,client_signature,company_signature,signed_at,company_id,client_id,chantier_id,created_at,owner_id," +
      "signature_mode,client_identity_email,client_identity_verified_at,client_identity_verified_by," +
      "client_signature_ip,client_signature_user_agent,consent_text,consent_at"
    )
    .eq("id", pvId)
    .maybeSingle();
  if (!pv?.company_id) throw new Error("PV introuvable.");

  const [company, brandingSettings, clientRes, chantierRes, photosRes, reservesRes, ownerRes] = await Promise.all([
    getCompanyBranding(pv.company_id),
    getCompanyBrandingSettings(pv.company_id),
    pv.client_id
      ? supabaseAdmin.from("clients").select("name,email,phone,address").eq("id", pv.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    pv.chantier_id
      ? supabaseAdmin.from("chantiers").select("name,address").eq("id", pv.chantier_id).maybeSingle()
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

  // If client_identity_email is empty, try to lift it from the latest verified signature OTP.
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

  const generatedAt = new Date().toISOString();
  const companySignatoryName = (ownerRes as any).data?.full_name ?? company?.name ?? null;

  // Pass 1: build PDF without hash to compute its SHA-256.
  const passOneBytes = await generatePvPdfBytes({
    pv: enrichedPv,
    company: company ?? undefined,
    client: (clientRes as any).data ?? undefined,
    chantier: (chantierRes as any).data ?? undefined,
    reserves: reservesRes.data ?? [],
    photos,
    branding: brandingSettings,
    proof: { companySignatoryName, pdfGeneratedAt: generatedAt, pdfSha256: null },
  });
  const pdfSha256 = await sha256OfBytes(passOneBytes);

  // Pass 2: embed the hash into the proof block.
  const pdfBytes = await generatePvPdfBytes({
    pv: enrichedPv,
    company: company ?? undefined,
    client: (clientRes as any).data ?? undefined,
    chantier: (chantierRes as any).data ?? undefined,
    reserves: reservesRes.data ?? [],
    photos,
    branding: brandingSettings,
    proof: { companySignatoryName, pdfGeneratedAt: generatedAt, pdfSha256 },
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

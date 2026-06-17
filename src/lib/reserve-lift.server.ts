/**
 * Helpers + PDF generation for reserve-lift reports.
 */
import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getCompanyBranding, getCompanyBrandingSettings, hexToRgb01, DEFAULT_BRANDING_SETTINGS } from "./branding.server";
import { sha256OfBytes, EIDAS_MENTIONS } from "./signature-proof.server";
import { RESERVE_STATUS_LABEL, RESERVE_SEVERITY_LABEL, RESERVE_PRIORITY_LABEL, type ReserveStatusValue } from "./reserve-status";

const ACCENT = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.42, 0.45, 0.52);
const BORDER = rgb(0.86, 0.88, 0.91);

function sanitize(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u20AC/g, "EUR")
    .replace(/\u00A0/g, " ")
    // eslint-disable-next-line no-control-regex
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

export type ReserveLiftPdfVariant = "internal" | "client";

/**
 * Build and persist a reserve-lift PDF.
 *
 * Two variants are supported and stored under distinct paths so the
 * client never sees internal forensic metadata:
 *  - `internal`: GPS coordinates, accuracy, EXIF, camera, client IP, anti-fraud notes.
 *  - `client`:   photos + dates only; geolocation reduced to a boolean badge.
 *
 * Backward compatible: when `variant === "client"` we also refresh
 * the legacy `pdf_url` / `pdf_generated_at` columns.
 */
export async function buildAndStoreReserveLiftPdf(
  reportId: string,
  variant: ReserveLiftPdfVariant = "client",
): Promise<string> {
  const isInternal = variant === "internal";
  const { data: report } = await supabaseAdmin
    .from("reserve_lift_reports")
    .select("id,numero,status,comment,company_signature,client_signature,technician_signature,technician_name,signed_at,pv_id,company_id,created_at,client_validated_at,client_validated_email,client_validated_ip,client_signed_at,client_signature_ip,client_signature_user_agent,client_signature_email,client_signature_consent_text,client_signature_consent_at,client_rejected_at,client_rejected_email,client_rejected_reason,client_rejected_ip")
    .eq("id", reportId)
    .maybeSingle();
  if (!report?.company_id) throw new Error("Rapport introuvable.");

  const [pvRes, brandingRow, brandingSettings, itemsRes] = await Promise.all([
    supabaseAdmin.from("pv").select("numero,reception_date,client_id,chantier_id,created_at").eq("id", report.pv_id).maybeSingle(),
    getCompanyBranding(report.company_id),
    getCompanyBrandingSettings(report.company_id),
    supabaseAdmin
      .from("reserve_lift_items")
      .select("id,reserve_id,old_status,new_status,comment,photo_urls")
      .eq("report_id", reportId),
  ]);
  const pv = pvRes.data;
  const branding = brandingSettings ?? DEFAULT_BRANDING_SETTINGS;
  const company = brandingRow;

  const itemIds = (itemsRes.data ?? []).map((i: any) => i.id);
  const reserveIds = (itemsRes.data ?? []).map((i: any) => i.reserve_id);

  const { data: reservesData } = reserveIds.length
    ? await supabaseAdmin.from("pv_reserves").select("id,description,severity,status,nature,work_to_execute,due_date,priority,assigned_to,created_at,lifted_at,validated_at").in("id", reserveIds)
    : { data: [] as any[] };
  const reserveMap = new Map<string, any>((reservesData ?? []).map((r: any) => [r.id, r]));

  // Photos with metadata (before/after + GPS + integrity hash) for these items
  const { data: photoMeta } = itemIds.length
    ? await supabaseAdmin
        .from("reserve_lift_item_photos" as any)
        .select("id,reserve_lift_item_id,photo_type,storage_path,latitude,longitude,accuracy,taken_at,exif_metadata,file_hash,file_name,file_size,uploaded_at,uploaded_by")
        .in("reserve_lift_item_id", itemIds)
    : { data: [] as any[] };
  const photosByItem = new Map<string, { before: any[]; after: any[] }>();
  for (const row of (photoMeta ?? []) as any[]) {
    const bucket = photosByItem.get(row.reserve_lift_item_id) ?? { before: [], after: [] };
    if (row.photo_type === "before") bucket.before.push(row);
    else bucket.after.push(row);
    photosByItem.set(row.reserve_lift_item_id, bucket);
  }


  const [clientRes, chantierRes] = await Promise.all([
    pv?.client_id
      ? supabaseAdmin.from("clients").select("name,email,phone,address").eq("id", pv.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    pv?.chantier_id
      ? supabaseAdmin.from("chantiers").select("name,address").eq("id", pv.chantier_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const client = (clientRes as any).data;
  const chantier = (chantierRes as any).data;

  const PRIMARY = (() => {
    const [r, g, b] = hexToRgb01(branding.pdf_brand_color || branding.brand_color);
    return rgb(r, g, b);
  })();
  const HEADER_BG = (() => {
    const [r, g, b] = hexToRgb01(branding.pdf_brand_color || branding.brand_color);
    return rgb(r * 0.05 + 0.95, g * 0.05 + 0.95, b * 0.05 + 0.97);
  })();

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Levée de réserves ${report.numero}${isInternal ? " (interne)" : ""}`);
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

  const drawWatermark = (p: PDFPage) => {
    if (!isInternal) return;
    // Diagonal "DOCUMENT INTERNE" watermark, very low opacity, centered.
    const text = "DOCUMENT INTERNE";
    const size = 64;
    const w = bold.widthOfTextAtSize(text, size);
    p.drawText(text, {
      x: (PAGE_W - w * Math.cos(Math.PI / 6)) / 2,
      y: PAGE_H / 2 - 40,
      size,
      font: bold,
      color: rgb(0.85, 0.15, 0.15),
      opacity: 0.08,
      rotate: degrees(30),
    });
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN + 30) {
      drawFooter();
      page = pdf.addPage([PAGE_W, PAGE_H]);
      pageNum += 1;
      y = PAGE_H - MARGIN;
      drawWatermark(page);
    }
  };
  const drawFooter = () => {
    page.drawLine({ start: { x: MARGIN, y: MARGIN }, end: { x: PAGE_W - MARGIN, y: MARGIN }, thickness: 0.5, color: BORDER });
    const footerText = sanitize(branding.pdf_footer || "Document généré par PVIA.");
    page.drawText(`Levée ${sanitize(report.numero)} · ${footerText}`, { x: MARGIN, y: MARGIN - 14, size: 8, font: helv, color: MUTED });
    page.drawText(`Page ${pageNum}`, { x: PAGE_W - MARGIN - 40, y: MARGIN - 14, size: 8, font: helv, color: MUTED });
  };

  drawWatermark(page);

  // HEADER
  page.drawRectangle({ x: 0, y: PAGE_H - 110, width: PAGE_W, height: 110, color: HEADER_BG });
  page.drawRectangle({ x: 0, y: PAGE_H - 4, width: PAGE_W, height: 4, color: PRIMARY });

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

  page.drawText("PROCES-VERBAL", { x: PAGE_W - MARGIN - 220, y: PAGE_H - 36, size: 9, font: bold, color: PRIMARY });
  page.drawText("DE LEVEE DE RESERVES", { x: PAGE_W - MARGIN - 220, y: PAGE_H - 50, size: 9, font: helv, color: MUTED });
  page.drawText(`N° ${sanitize(report.numero)}`, { x: PAGE_W - MARGIN - 220, y: PAGE_H - 74, size: 18, font: bold, color: ACCENT });

  // Statut badge
  const isValidated = !!(report as any).client_validated_at;
  const isRejected = !!(report as any).client_rejected_at;
  const statusLabel = isValidated ? "VALIDEE PAR LE CLIENT" : isRejected ? "REJETEE PAR LE CLIENT" : "EN ATTENTE DE VALIDATION";
  const statusColor = isValidated ? rgb(0.13, 0.6, 0.3) : isRejected ? rgb(0.80, 0.10, 0.10) : rgb(0.70, 0.55, 0.10);
  const statusBg = isValidated ? rgb(0.92, 0.99, 0.94) : isRejected ? rgb(1, 0.94, 0.94) : rgb(0.99, 0.96, 0.86);
  const sLabelW = bold.widthOfTextAtSize(statusLabel, 7.5);
  page.drawRectangle({ x: PAGE_W - MARGIN - sLabelW - 16, y: PAGE_H - 96, width: sLabelW + 12, height: 14, color: statusBg, borderColor: statusColor, borderWidth: 0.6 });
  page.drawText(statusLabel, { x: PAGE_W - MARGIN - sLabelW - 10, y: PAGE_H - 92, size: 7.5, font: bold, color: statusColor });

  if (isInternal) {
    page.drawRectangle({ x: MARGIN, y: PAGE_H - 100, width: 130, height: 14, color: rgb(0.95, 0.92, 0.80), borderColor: rgb(0.70, 0.55, 0.10), borderWidth: 0.5 });
    page.drawText("USAGE INTERNE - CONFIDENTIEL", { x: MARGIN + 4, y: PAGE_H - 96, size: 7, font: bold, color: rgb(0.55, 0.40, 0.05) });
  }

  // Sous-titre
  page.drawText(
    sanitize("Levee des reserves emises lors de la reception des travaux"),
    { x: MARGIN, y: PAGE_H - 124, size: 9.5, font: helv, color: MUTED },
  );

  y = PAGE_H - 148;

  // ============ BLOC JURIDIQUE — Lien avec le PV initial ============
  ensureSpace(86);
  page.drawRectangle({ x: MARGIN, y: y - 82, width: CONTENT_W, height: 82, color: rgb(0.97, 0.98, 1), borderColor: PRIMARY, borderWidth: 0.6 });
  page.drawRectangle({ x: MARGIN, y: y - 82, width: 3, height: 82, color: PRIMARY });
  page.drawText("REFERENCE LEGALE", { x: MARGIN + 12, y: y - 14, size: 7, font: bold, color: PRIMARY });
  const legalRef = sanitize(
    `Le present proces-verbal de levee de reserves est etabli en complement du proces-verbal de reception n° ${pv?.numero ?? "—"} en date du ${formatDate(pv?.reception_date)}, conformement aux dispositions de l'article 1792-6 du Code civil.`
  );
  let ly0 = y - 30;
  for (const l of wrapLines(helv, legalRef, 8.5, CONTENT_W - 24)) {
    page.drawText(l, { x: MARGIN + 12, y: ly0, size: 8.5, font: helv, color: ACCENT });
    ly0 -= 11;
  }
  // 3 dates en bas du bloc
  const dateRowY = y - 72;
  const dateCol = (CONTENT_W - 24) / 3;
  const drawDateCell = (i: number, label: string, value: string) => {
    const x = MARGIN + 12 + i * dateCol;
    page.drawText(label.toUpperCase(), { x, y: dateRowY + 4, size: 6.5, font: bold, color: MUTED });
    page.drawText(sanitize(value), { x, y: dateRowY - 6, size: 9, font: bold, color: ACCENT });
  };
  drawDateCell(0, "PV initial", pv?.numero ?? "—");
  drawDateCell(1, "Receptionne le", formatDate(pv?.reception_date));
  drawDateCell(2, "Levee le", formatDate(report.signed_at ?? report.created_at));
  y -= 96;

  // ============ PARTIES ============
  const colW = (CONTENT_W - 16) / 2;
  ensureSpace(160);
  const partyH = 150;
  // Entreprise
  page.drawRectangle({ x: MARGIN, y: y - partyH, width: colW, height: partyH, borderColor: BORDER, borderWidth: 0.5, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: MARGIN, y: y - 1, width: colW, height: 1, color: PRIMARY });
  page.drawText("ENTREPRISE", { x: MARGIN + 12, y: y - 16, size: 8, font: bold, color: PRIMARY });
  page.drawText(sanitize(company?.name ?? "—"), { x: MARGIN + 12, y: y - 32, size: 11, font: bold, color: ACCENT });
  let ey = y - 46;
  const drawLine = (txt: string) => {
    if (!txt) return;
    for (const l of wrapLines(helv, txt, 8, colW - 24)) {
      page.drawText(l, { x: MARGIN + 12, y: ey, size: 8, font: helv, color: MUTED });
      ey -= 10;
    }
  };
  if (company?.legal_form) drawLine(`Forme : ${company.legal_form}`);
  if (company?.siren) drawLine(`SIREN : ${company.siren}`);
  if (company?.siret) drawLine(`SIRET : ${company.siret}`);
  if (company?.vat_number) drawLine(`TVA : ${company.vat_number}`);
  const addr = [company?.address_line1, company?.address_line2, [company?.postal_code, company?.city].filter(Boolean).join(" "), company?.country].filter(Boolean).join(", ");
  if (addr) drawLine(addr); else if (company?.address) drawLine(company.address);
  if (company?.email) drawLine(company.email);
  if (company?.phone) drawLine(company.phone);
  drawLine("Assurance decennale : voir conditions generales");

  // Client
  const cx = MARGIN + colW + 16;
  page.drawRectangle({ x: cx, y: y - partyH, width: colW, height: partyH, borderColor: BORDER, borderWidth: 0.5, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: cx, y: y - 1, width: colW, height: 1, color: PRIMARY });
  page.drawText("MAITRE D'OUVRAGE (CLIENT)", { x: cx + 12, y: y - 16, size: 8, font: bold, color: PRIMARY });
  page.drawText(sanitize(client?.name ?? "—"), { x: cx + 12, y: y - 32, size: 11, font: bold, color: ACCENT });
  let cy0 = y - 46;
  const drawCLine = (txt: string) => {
    if (!txt) return;
    for (const l of wrapLines(helv, txt, 8, colW - 24)) {
      page.drawText(l, { x: cx + 12, y: cy0, size: 8, font: helv, color: MUTED });
      cy0 -= 10;
    }
  };
  if (client?.address) drawCLine(client.address);
  if (client?.email) drawCLine(client.email);
  if (client?.phone) drawCLine(client.phone);
  y -= partyH + 12;

  if (chantier?.name) {
    ensureSpace(46);
    page.drawRectangle({ x: MARGIN, y: y - 36, width: CONTENT_W, height: 36, color: rgb(0.99, 0.99, 1), borderColor: BORDER, borderWidth: 0.4 });
    page.drawText("CHANTIER", { x: MARGIN + 12, y: y - 12, size: 7, font: bold, color: MUTED });
    page.drawText(sanitize(chantier.name), { x: MARGIN + 12, y: y - 24, size: 10, font: bold, color: ACCENT });
    if (chantier.address) {
      page.drawText(sanitize(chantier.address), { x: MARGIN + 200, y: y - 24, size: 8.5, font: helv, color: MUTED });
    }
    y -= 46;
  }

  // ============ SYNTHESE DES RESERVES ============
  const itemsForSyn = (itemsRes.data ?? []) as any[];
  const synValidated = itemsForSyn.filter((i: any) => i.new_status === "validee").length;
  const synRejected = itemsForSyn.filter((i: any) => i.new_status === "rejetee").length;
  const synPending = itemsForSyn.length - synValidated - synRejected;

  ensureSpace(60);
  page.drawText("SYNTHESE DES RESERVES", { x: MARGIN, y, size: 9, font: bold, color: PRIMARY });
  y -= 14;
  const cardW = (CONTENT_W - 24) / 4;
  const drawCounter = (i: number, label: string, value: number, color: RGB) => {
    const x = MARGIN + i * (cardW + 8);
    page.drawRectangle({ x, y: y - 40, width: cardW, height: 40, color: rgb(1, 1, 1), borderColor: BORDER, borderWidth: 0.5 });
    page.drawRectangle({ x, y: y - 40, width: 3, height: 40, color });
    page.drawText(label.toUpperCase(), { x: x + 10, y: y - 14, size: 7, font: bold, color: MUTED });
    page.drawText(String(value), { x: x + 10, y: y - 32, size: 16, font: bold, color: ACCENT });
  };
  drawCounter(0, "Total", itemsForSyn.length, PRIMARY);
  drawCounter(1, "Validees", synValidated, rgb(0.13, 0.6, 0.3));
  drawCounter(2, "Rejetees", synRejected, rgb(0.80, 0.10, 0.10));
  drawCounter(3, "En attente", synPending, rgb(0.70, 0.55, 0.10));
  y -= 50;

  // Tableau synthèse
  if (itemsForSyn.length) {
    ensureSpace(30);
    const cols = [
      { label: "N°", w: 24 },
      { label: "NATURE", w: 110 },
      { label: "GRAVITE", w: 60 },
      { label: "STATUT INITIAL", w: 90 },
      { label: "STATUT FINAL", w: 90 },
      { label: "DATE LEVEE", w: CONTENT_W - 24 - 110 - 60 - 90 - 90 },
    ];
    page.drawRectangle({ x: MARGIN, y: y - 16, width: CONTENT_W, height: 16, color: HEADER_BG, borderColor: BORDER, borderWidth: 0.4 });
    let cx2 = MARGIN + 4;
    for (const c of cols) {
      page.drawText(c.label, { x: cx2, y: y - 11, size: 7, font: bold, color: PRIMARY });
      cx2 += c.w;
    }
    y -= 16;
    const dateLevee = formatDate(report.signed_at ?? report.created_at);
    itemsForSyn.forEach((it: any, idx: number) => {
      ensureSpace(16);
      const r = reserveMap.get(it.reserve_id);
      page.drawRectangle({ x: MARGIN, y: y - 16, width: CONTENT_W, height: 16, color: idx % 2 ? rgb(0.98, 0.98, 0.99) : rgb(1, 1, 1), borderColor: BORDER, borderWidth: 0.3 });
      let cx3 = MARGIN + 4;
      const row = [
        String(idx + 1),
        sanitize(r?.nature || r?.description || "—").slice(0, 32),
        sanitize(r?.severity ? (RESERVE_SEVERITY_LABEL[r.severity] ?? r.severity) : "—"),
        sanitize(RESERVE_STATUS_LABEL[it.old_status as ReserveStatusValue] ?? it.old_status ?? "—"),
        sanitize(RESERVE_STATUS_LABEL[it.new_status as ReserveStatusValue] ?? it.new_status ?? "—"),
        dateLevee,
      ];
      const colorFinal = it.new_status === "rejetee" ? rgb(0.80, 0.10, 0.10) : it.new_status === "validee" ? rgb(0.13, 0.6, 0.3) : ACCENT;
      row.forEach((txt, i) => {
        page.drawText(txt, { x: cx3, y: y - 11, size: 7.5, font: i === 4 ? bold : helv, color: i === 4 ? colorFinal : ACCENT });
        cx3 += cols[i].w;
      });
      y -= 16;
    });
    y -= 6;
  }





  // Helper: render a photo grid (with per-photo geoloc caption) at the current y.
  const renderPhotoGrid = async (
    photos: Array<{ storage_path: string; latitude?: number | null; longitude?: number | null; accuracy?: number | null; taken_at?: string | null; exif_metadata?: any; file_name?: string | null; file_hash?: string | null }>,
    label: string,
  ) => {
    if (!photos.length) return;
    const cols = 2;
    const gap = 10;
    const cellW = (CONTENT_W - 24 - gap * (cols - 1)) / cols;
    const cellH = 110;
    const captionH = 26;

    ensureSpace(16);
    page.drawText(sanitize(label).toUpperCase(), { x: MARGIN + 12, y: y - 10, size: 7, font: bold, color: MUTED });
    y -= 14;

    let col = 0;
    for (const p of photos.slice(0, 8)) {
      const { data: f } = await supabaseAdmin.storage.from("pv-assets").download(p.storage_path);
      if (!f) continue;
      const bytes = new Uint8Array(await f.arrayBuffer());
      const t = detectImageType(bytes);
      if (!t) continue;
      if (col === 0) ensureSpace(cellH + captionH + 6);
      const x = MARGIN + 12 + col * (cellW + gap);
      try {
        const img = t === "png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        const ratio = img.width / img.height;
        let w = cellW, h = cellW / ratio;
        if (h > cellH) { h = cellH; w = cellH * ratio; }
        const offX = x + (cellW - w) / 2;
        const offY = y - cellH + (cellH - h) / 2;
        page.drawRectangle({ x, y: y - cellH, width: cellW, height: cellH, borderColor: BORDER, borderWidth: 0.5, color: rgb(1, 1, 1) });
        page.drawImage(img, { x: offX, y: offY, width: w, height: h });
      } catch { /* skip */ }
      const hasGeo = p.latitude !== null && p.latitude !== undefined && p.longitude !== null && p.longitude !== undefined;
      const captionLines: string[] = [];
      if (isInternal) {
        if (hasGeo) {
          captionLines.push(`Photo geolocalisee  GPS ${(p.latitude as number).toFixed(5)}, ${(p.longitude as number).toFixed(5)}${p.accuracy ? ` (±${Math.round(p.accuracy)}m)` : ""}`);
        } else {
          captionLines.push("Photo non geolocalisee");
        }
        const exif = (p.exif_metadata ?? {}) as any;
        const cam = [exif?.Make, exif?.Model].filter(Boolean).join(" ");
        const takenIso = p.taken_at ?? exif?.DateTimeOriginal ?? null;
        const meta: string[] = [];
        if (takenIso) {
          try { meta.push(`Prise: ${new Date(takenIso).toLocaleString("fr-FR")}`); } catch { /* */ }
        }
        if (cam) meta.push(cam);
        if (meta.length) captionLines.push(meta.join("  ·  "));
        // Chain of custody (internal only): filename + truncated SHA-256.
        if (p.file_name || p.file_hash) {
          const fn = p.file_name ? sanitize(String(p.file_name)) : "—";
          const fh = p.file_hash ? `${String(p.file_hash).slice(0, 16)}…` : "—";
          captionLines.push(`Fichier: ${fn}  ·  SHA-256: ${fh}`);
        }
      } else {
        // Client-safe caption: only a binary geoloc badge + capture date. No coords, no EXIF, no camera.
        captionLines.push(hasGeo ? "Photo geolocalisee" : "Photo non geolocalisee");
        const takenIso = p.taken_at ?? null;
        if (takenIso) {
          try { captionLines.push(`Prise le ${new Date(takenIso).toLocaleDateString("fr-FR")}`); } catch { /* */ }
        }
      }
      let cy = y - cellH - 9;
      for (const line of captionLines) {
        page.drawText(sanitize(line), { x, y: cy, size: 7, font: helv, color: hasGeo ? rgb(0.13, 0.5, 0.3) : MUTED });
        cy -= 9;
      }
      col++;
      if (col >= cols) { col = 0; y -= cellH + captionH + 8; }
    }
    if (col !== 0) y -= cellH + captionH + 8;
  };

  // ============ DETAIL DE CHAQUE RESERVE ============
  const items = (itemsRes.data ?? []) as any[];
  ensureSpace(40);
  page.drawText(`DETAIL DES RESERVES (${items.length})`, { x: MARGIN, y, size: 9, font: bold, color: PRIMARY });
  y -= 16;

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const reserve = reserveMap.get(item.reserve_id);
    const desc = reserve?.description ?? "(reserve supprimee)";
    const oldLabel = RESERVE_STATUS_LABEL[item.old_status as ReserveStatusValue] ?? item.old_status ?? "—";
    const newLabel = RESERVE_STATUS_LABEL[item.new_status as ReserveStatusValue] ?? item.new_status ?? "—";
    const sevLabel = reserve?.severity ? (RESERVE_SEVERITY_LABEL[reserve.severity] ?? reserve.severity) : "—";
    const prioLabel = reserve?.priority ? (RESERVE_PRIORITY_LABEL[reserve.priority] ?? reserve.priority) : "—";
    const itemRejected = item.new_status === "rejetee";
    const accentColor = itemRejected ? rgb(0.80, 0.10, 0.10) : rgb(0.13, 0.6, 0.3);
    const cardBg = itemRejected ? rgb(1, 0.98, 0.98) : rgb(0.99, 1, 0.99);

    // Header bloc "Reserve n°X"
    ensureSpace(30);
    page.drawRectangle({ x: MARGIN, y: y - 26, width: CONTENT_W, height: 26, color: cardBg, borderColor: BORDER, borderWidth: 0.5 });
    page.drawRectangle({ x: MARGIN, y: y - 26, width: 4, height: 26, color: accentColor });
    page.drawText(sanitize(`RESERVE N°${idx + 1}`), { x: MARGIN + 14, y: y - 11, size: 9, font: bold, color: ACCENT });
    const trans = sanitize(`${oldLabel} -> ${newLabel}`);
    const transW = bold.widthOfTextAtSize(trans, 8);
    page.drawText(trans, { x: MARGIN + CONTENT_W - transW - 12, y: y - 11, size: 8, font: bold, color: accentColor });
    page.drawText(sanitize(reserve?.nature ? `${reserve.nature}` : "Sans nature"), { x: MARGIN + 14, y: y - 21, size: 8, font: helv, color: MUTED });
    y -= 30;

    // Métadonnées en grille (2 lignes x 4)
    ensureSpace(52);
    const metaCol = CONTENT_W / 4;
    const drawMeta = (i: number, label: string, value: string) => {
      const x = MARGIN + i * metaCol;
      page.drawText(label.toUpperCase(), { x, y: y - 8, size: 6.5, font: bold, color: MUTED });
      page.drawText(sanitize(value).slice(0, 26), { x, y: y - 19, size: 8.5, font: bold, color: ACCENT });
    };
    drawMeta(0, "Gravite", sevLabel);
    drawMeta(1, "Priorite", prioLabel);
    drawMeta(2, "Responsable", reserve?.assigned_to || "—");
    drawMeta(3, "Echeance", reserve?.due_date ? formatDate(reserve.due_date) : "—");
    y -= 24;
    drawMeta(0, "Creee le", reserve?.created_at ? formatDate(reserve.created_at) : "—");
    drawMeta(1, "Levee le", reserve?.lifted_at ? formatDate(reserve.lifted_at) : formatDate(report.signed_at));
    drawMeta(2, "Validee le", reserve?.validated_at ? formatDate(reserve.validated_at) : ((report as any).client_validated_at ? formatDate((report as any).client_validated_at) : "—"));
    drawMeta(3, "Statut final", newLabel);
    y -= 26;

    // Description
    ensureSpace(20);
    page.drawText("DESCRIPTION DE LA RESERVE", { x: MARGIN, y, size: 7, font: bold, color: MUTED });
    y -= 12;
    const descLines = wrapLines(helv, desc, 9, CONTENT_W);
    ensureSpace(descLines.length * 12 + 4);
    for (const l of descLines) {
      page.drawText(l, { x: MARGIN, y: y - 10, size: 9, font: helv, color: ACCENT });
      y -= 12;
    }
    y -= 4;

    // Travaux demandés (work_to_execute)
    if (reserve?.work_to_execute) {
      const wLines = wrapLines(helv, reserve.work_to_execute, 8.5, CONTENT_W);
      ensureSpace(wLines.length * 11 + 16);
      page.drawText("TRAVAUX DEMANDES", { x: MARGIN, y, size: 7, font: bold, color: MUTED });
      y -= 12;
      for (const l of wLines) {
        page.drawText(l, { x: MARGIN, y: y - 10, size: 8.5, font: helv, color: ACCENT });
        y -= 11;
      }
      y -= 4;
    }

    // Travaux réalisés / Motif rejet
    if (item.comment) {
      const label = itemRejected ? "MOTIF DU REJET" : "TRAVAUX REALISES";
      const cLines = wrapLines(helv, item.comment, 9, CONTENT_W);
      ensureSpace(cLines.length * 12 + 16);
      page.drawText(label, { x: MARGIN, y, size: 7, font: bold, color: itemRejected ? rgb(0.80, 0.10, 0.10) : PRIMARY });
      y -= 12;
      for (const l of cLines) {
        page.drawText(l, { x: MARGIN, y: y - 10, size: 9, font: helv, color: ACCENT });
        y -= 12;
      }
      y -= 4;
    } else if (!itemRejected) {
      ensureSpace(20);
      page.drawText("TRAVAUX REALISES", { x: MARGIN, y, size: 7, font: bold, color: PRIMARY });
      y -= 12;
      page.drawText("Intervention realisee conformement aux travaux demandes.", { x: MARGIN, y: y - 10, size: 9, font: helv, color: MUTED });
      y -= 16;
    }

    // Photos avant / après
    const bucket = photosByItem.get(item.id);
    const beforePhotos = bucket?.before ?? [];
    const afterPhotos = bucket?.after ?? [];

    if (beforePhotos.length) {
      y -= 2;
      await renderPhotoGrid(beforePhotos, `Photos avant intervention (${beforePhotos.length})`);
    }
    if (afterPhotos.length) {
      y -= 2;
      await renderPhotoGrid(afterPhotos, `Photos apres intervention (${afterPhotos.length})`);
    }

    if (!beforePhotos.length && !afterPhotos.length) {
      const legacyPaths: string[] = item.photo_urls ?? [];
      if (legacyPaths.length) {
        y -= 2;
        const label = itemRejected ? "Photos justificatives" : "Photos d'intervention";
        await renderPhotoGrid(
          legacyPaths.map((p) => ({ storage_path: p, latitude: null, longitude: null, accuracy: null })),
          `${label} (${legacyPaths.length})`,
        );
      }
    }

    // Historique de la réserve
    ensureSpace(40);
    page.drawText("HISTORIQUE", { x: MARGIN, y, size: 7, font: bold, color: PRIMARY });
    y -= 12;
    const histSteps: Array<{ label: string; date: string; done: boolean }> = [
      { label: "Creation", date: reserve?.created_at ? formatDate(reserve.created_at, true) : "—", done: !!reserve?.created_at },
      { label: "Intervention", date: formatDate(report.signed_at ?? report.created_at, true), done: true },
      { label: "Levee proposee", date: formatDate(report.signed_at ?? report.created_at, true), done: true },
      {
        label: itemRejected ? "Rejet client" : ((report as any).client_validated_at ? "Validation client" : "En attente client"),
        date: itemRejected
          ? formatDate((report as any).client_rejected_at, true)
          : ((report as any).client_validated_at ? formatDate((report as any).client_validated_at, true) : "—"),
        done: itemRejected || !!(report as any).client_validated_at,
      },
    ];
    const stepW = CONTENT_W / histSteps.length;
    histSteps.forEach((s, i) => {
      const x = MARGIN + i * stepW;
      const dotColor = s.done ? (itemRejected && i === 3 ? rgb(0.80, 0.10, 0.10) : rgb(0.13, 0.6, 0.3)) : MUTED;
      page.drawCircle({ x: x + 6, y: y - 6, size: 3, color: dotColor });
      if (i < histSteps.length - 1) {
        page.drawLine({ start: { x: x + 12, y: y - 6 }, end: { x: x + stepW - 4, y: y - 6 }, thickness: 0.5, color: BORDER });
      }
      page.drawText(sanitize(s.label), { x: x + 14, y: y - 4, size: 7.5, font: bold, color: ACCENT });
      page.drawText(sanitize(s.date), { x: x + 14, y: y - 14, size: 6.5, font: helv, color: MUTED });
    });
    y -= 24;

    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.3, color: BORDER });
    y -= 10;
  }
  if (!items.length) {
    ensureSpace(28);
    page.drawText("Aucune reserve associee a ce rapport.", { x: MARGIN, y: y - 12, size: 9, font: helv, color: MUTED });
    y -= 22;
  }
  y -= 6;

  // ============ CONSTAT DE LEVEE (bloc juridique) ============
  ensureSpace(90);
  const constatIntro =
    "Apres realisation des travaux correctifs decrits dans le present document, les reserves mentionnees ci-dessus sont presentees au maitre d'ouvrage pour validation.";
  let constatConclusion = "";
  if (isValidated) {
    constatConclusion = "Le maitre d'ouvrage reconnait que les reserves decrites ont ete traitees de maniere satisfaisante et prononce leur levee definitive.";
  } else if (isRejected) {
    constatConclusion = "Le maitre d'ouvrage considere que les reserves demeurent non conformes pour les motifs exposes ci-dessus.";
  } else {
    constatConclusion = "Le present proces-verbal est transmis au maitre d'ouvrage. Sa validation est requise pour prononcer la levee definitive des reserves.";
  }
  const constatLines = [
    ...wrapLines(helv, constatIntro, 9, CONTENT_W - 24),
    ...wrapLines(helv, " ", 9, CONTENT_W - 24),
    ...wrapLines(helv, constatConclusion, 9, CONTENT_W - 24),
  ];
  const constatH = constatLines.length * 12 + 28;
  ensureSpace(constatH + 4);
  page.drawRectangle({ x: MARGIN, y: y - constatH, width: CONTENT_W, height: constatH, color: rgb(0.97, 0.98, 1), borderColor: PRIMARY, borderWidth: 0.6 });
  page.drawText("CONSTAT DE LEVEE", { x: MARGIN + 12, y: y - 14, size: 8, font: bold, color: PRIMARY });
  let kc = y - 30;
  for (const l of constatLines) {
    page.drawText(l, { x: MARGIN + 12, y: kc, size: 9, font: helv, color: ACCENT });
    kc -= 12;
  }
  y -= constatH + 10;

  // Legal note on geolocation (interne)
  if (items.length && isInternal) {
    const legalText =
      "Les metadonnees de geolocalisation sont enregistrees a titre de preuve d'intervention. Leur absence n'invalide ni la reserve ni sa levee.";
    const legalLines = wrapLines(helv, legalText, 7.5, CONTENT_W - 16);
    ensureSpace(legalLines.length * 10 + 10);
    page.drawRectangle({ x: MARGIN, y: y - (legalLines.length * 10 + 8), width: CONTENT_W, height: legalLines.length * 10 + 8, color: rgb(0.98, 0.98, 1), borderColor: BORDER, borderWidth: 0.4 });
    let ly = y - 8;
    for (const l of legalLines) {
      page.drawText(l, { x: MARGIN + 8, y: ly, size: 7.5, font: helv, color: MUTED });
      ly -= 10;
    }
    y = ly - 8;
  }



  // Comment
  if (report.comment) {
    ensureSpace(60);
    page.drawText("COMMENTAIRE GENERAL", { x: MARGIN, y, size: 9, font: bold, color: PRIMARY });
    y -= 14;
    const cl = wrapLines(helv, report.comment, 10, CONTENT_W);
    ensureSpace(cl.length * 14 + 10);
    for (const l of cl) { page.drawText(l, { x: MARGIN, y, size: 10, font: helv, color: ACCENT }); y -= 14; }
    y -= 8;
  }

  // Signatures (3 colonnes : Technicien / Entreprise / Client)
  const techSig = (report as any).technician_signature as string | null;
  const techName = (report as any).technician_name as string | null;
  const showTech = isInternal && (!!techSig || !!techName);
  ensureSpace(200);
  page.drawText("SIGNATURES", { x: MARGIN, y, size: 9, font: bold, color: PRIMARY });
  y -= 14;
  const sigCount = showTech ? 3 : 2;
  const sigGap = 12;
  const sigW = (CONTENT_W - sigGap * (sigCount - 1)) / sigCount;
  const sigH = 130;
  const drawSig = async (
    x: number,
    label: string,
    data: string | null,
    opts: { who?: string | null; role?: string | null; date?: string | null },
  ) => {
    page.drawRectangle({ x, y: y - sigH, width: sigW, height: sigH, borderColor: BORDER, borderWidth: 0.5, color: rgb(1, 1, 1) });
    page.drawRectangle({ x, y: y - 1, width: sigW, height: 1, color: PRIMARY });
    page.drawText(label.toUpperCase(), { x: x + 10, y: y - 14, size: 7.5, font: bold, color: PRIMARY });
    if (data) {
      const parsed = dataUrlToBytes(data);
      if (parsed) {
        try {
          const img = parsed.type === "png" ? await pdf.embedPng(parsed.bytes) : await pdf.embedJpg(parsed.bytes);
          const maxW = sigW - 20, maxH = sigH - 70;
          const ratio = img.width / img.height;
          let w = maxW, h = maxW / ratio;
          if (h > maxH) { h = maxH; w = maxH * ratio; }
          page.drawImage(img, { x: x + (sigW - w) / 2, y: y - sigH + 56, width: w, height: h });
        } catch { /* skip */ }
      }
    } else {
      page.drawText("Non signe", { x: x + 10, y: y - sigH / 2 + 10, size: 8.5, font: helv, color: MUTED });
    }
    // Footer : nom / fonction / date+heure
    let fy = y - sigH + 42;
    page.drawLine({ start: { x: x + 8, y: fy + 6 }, end: { x: x + sigW - 8, y: fy + 6 }, thickness: 0.3, color: BORDER });
    page.drawText(sanitize(opts.who ?? "—").slice(0, 32), { x: x + 10, y: fy - 4, size: 8, font: bold, color: ACCENT });
    fy -= 12;
    if (opts.role) {
      page.drawText(sanitize(opts.role).slice(0, 36), { x: x + 10, y: fy - 4, size: 7, font: helv, color: MUTED });
      fy -= 10;
    }
    if (opts.date) {
      page.drawText(sanitize(opts.date), { x: x + 10, y: fy - 4, size: 7, font: helv, color: MUTED });
    }
  };

  if (showTech) {
    await drawSig(MARGIN, "Technicien intervenant", techSig, {
      who: techName, role: "Technicien", date: formatDate(report.signed_at, true),
    });
    await drawSig(MARGIN + sigW + sigGap, "Entreprise", report.company_signature, {
      who: company?.name, role: "Representant entreprise", date: formatDate(report.signed_at, true),
    });
    await drawSig(MARGIN + (sigW + sigGap) * 2, "Client (maitre d'ouvrage)", report.client_signature, {
      who: client?.name,
      role: (report as any).client_validated_email || client?.email || null,
      date: (report as any).client_validated_at
        ? formatDate((report as any).client_validated_at, true)
        : ((report as any).client_signed_at ? formatDate((report as any).client_signed_at, true) : "Non signe"),
    });
  } else {
    await drawSig(MARGIN, "Entreprise", report.company_signature, {
      who: company?.name, role: "Representant entreprise", date: formatDate(report.signed_at, true),
    });
    await drawSig(MARGIN + sigW + sigGap, "Client (maitre d'ouvrage)", report.client_signature, {
      who: client?.name,
      role: (report as any).client_validated_email || client?.email || null,
      date: (report as any).client_validated_at
        ? formatDate((report as any).client_validated_at, true)
        : ((report as any).client_signed_at ? formatDate((report as any).client_signed_at, true) : "Non signe"),
    });
  }
  y -= sigH + 16;

  if ((report as any).client_validated_at) {
    ensureSpace(28);
    page.drawText(
      sanitize(`Validee par le client (${(report as any).client_validated_email ?? "—"}) le ${formatDate((report as any).client_validated_at, true)}`),
      { x: MARGIN, y, size: 8.5, font: bold, color: rgb(0.13, 0.6, 0.3) },
    );
    y -= 16;
  }

  if ((report as any).client_rejected_at) {
    const reason = sanitize((report as any).client_rejected_reason || "Aucun motif fourni.");
    const reasonLines = wrapLines(helv, reason, 9, CONTENT_W - 60);
    const h = 30 + reasonLines.length * 12;
    ensureSpace(h + 8);
    page.drawRectangle({ x: MARGIN, y: y - h, width: CONTENT_W, height: h, color: rgb(1, 0.95, 0.95), borderColor: rgb(0.80, 0.10, 0.10), borderWidth: 0.6 });
    page.drawText(
      sanitize(`REJETEE par le client (${(report as any).client_rejected_email ?? "—"}) le ${formatDate((report as any).client_rejected_at, true)}`),
      { x: MARGIN + 12, y: y - 14, size: 8.5, font: bold, color: rgb(0.80, 0.10, 0.10) },
    );
    let ry = y - 28;
    page.drawText("Motif :", { x: MARGIN + 12, y: ry, size: 8, font: bold, color: rgb(0.80, 0.10, 0.10) });
    for (const l of reasonLines) {
      page.drawText(l, { x: MARGIN + 48, y: ry, size: 9, font: helv, color: ACCENT });
      ry -= 12;
    }
    y -= h + 8;
  }

  // ============ PAGE DEDIÉE : TRACABILITE ET PREUVES DE SIGNATURE ============
  // Force a new page so this section reads as a dedicated forensic appendix.
  drawFooter();
  page = pdf.addPage([PAGE_W, PAGE_H]);
  pageNum += 1;
  y = PAGE_H - MARGIN;
  drawWatermark(page);

  page.drawRectangle({ x: 0, y: PAGE_H - 50, width: PAGE_W, height: 50, color: HEADER_BG });
  page.drawRectangle({ x: 0, y: PAGE_H - 4, width: PAGE_W, height: 4, color: PRIMARY });
  page.drawText("TRACABILITE ET PREUVES DE SIGNATURE", { x: MARGIN, y: PAGE_H - 30, size: 12, font: bold, color: ACCENT });
  page.drawText(sanitize(`Levee n° ${report.numero} - PV ${pv?.numero ?? "—"}`), { x: MARGIN, y: PAGE_H - 44, size: 8, font: helv, color: MUTED });
  y = PAGE_H - 70;

  ensureSpace(170);
  page.drawText("PREUVE DE SIGNATURE ELECTRONIQUE", { x: MARGIN, y, size: 9, font: bold, color: PRIMARY });
  y -= 14;


  const proofBoxH = 140;
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
    page.drawText(sanitize(label).toUpperCase(), { x, y: cy, size: 6.5, font: bold, color: MUTED });
    cy -= 10;
    for (const l of wrapLines(helv, value || "-", 8.5, colW2).slice(0, 2)) {
      page.drawText(l, { x, y: cy, size: 8.5, font: helv, color: ACCENT });
      cy -= 11;
    }
    cy -= 4;
    if (col === "a") ya = cy; else yb = cy;
  };

  proofField("a", "Signataire entreprise", company?.name || "-");
  proofField("a", "Signature entreprise", formatDate(report.signed_at, true));
  proofField("a", "Email client verifie", (report as any).client_validated_email || client?.email || "-");
  proofField("a", "Identite verifiee le", formatDate((report as any).client_validated_at, true));

  proofField("b", "Methode de signature", "Signature electronique simple — signature tactile + consentement explicite (eIDAS SES)");
  if (isInternal) {
    proofField("b", "Adresse IP client", (report as any).client_signature_ip || (report as any).client_validated_ip || "-");
    proofField("b", "User-Agent client", ((report as any).client_signature_user_agent || "-").slice(0, 80));
  }
  proofField("b", "Date de validation client", formatDate((report as any).client_validated_at, true));
  proofField("b", "Date de signature client", formatDate((report as any).client_signed_at, true));
  proofField("b", "Signature client (entreprise)", report.client_signature ? "Signature collectee" : "-");

  y -= proofBoxH + 6;

  // Internal-only: full consent text snapshot (eIDAS evidence).
  if (isInternal && (report as any).client_signature_consent_text) {
    const ct = sanitize(String((report as any).client_signature_consent_text));
    const ctLines = wrapLines(helv, ct, 7.5, CONTENT_W - 12);
    ensureSpace(ctLines.length * 10 + 24);
    page.drawText("CONSENTEMENT CLIENT (TEXTE INTEGRAL)", { x: MARGIN, y, size: 7.5, font: bold, color: PRIMARY });
    y -= 11;
    page.drawText(
      `Accepte le ${formatDate((report as any).client_signature_consent_at, true)}`,
      { x: MARGIN, y, size: 7, font: helv, color: MUTED },
    );
    y -= 10;
    for (const l of ctLines) {
      page.drawText(l, { x: MARGIN, y, size: 7.5, font: helv, color: ACCENT });
      y -= 10;
    }
    y -= 4;
  }


  // Evidence fingerprint (deterministic hash of the proof bundle, not of the PDF bytes)
  const evidenceString = [
    report.id,
    report.numero,
    report.signed_at ?? "",
    (report as any).client_validated_email ?? "",
    (report as any).client_validated_at ?? "",
    (report as any).client_validated_ip ?? "",
    (report as any).client_signed_at ?? "",
    (report as any).client_signature_ip ?? "",
    (report as any).client_signature_user_agent ?? "",
    (report as any).client_signature_consent_at ?? "",
  ].join("|");
  const evidenceBytes = new TextEncoder().encode(evidenceString);
  const evidenceHash = await sha256OfBytes(evidenceBytes);
  const genAt = new Date().toISOString();

  // Traceability block.
  // Internal: full forensic block with UUIDs of report / PV / company + local & UTC timestamps.
  // Client : minimal fingerprint only (UUID rapport + hash preuve).
  // Count photos for the integrity manifest.
  const photoCount = ((photoMeta ?? []) as any[]).length
    + ((itemsRes.data ?? []) as any[]).reduce((n, it: any) => n + ((it.photo_urls ?? []) as any[]).length, 0);

  ensureSpace(isInternal ? 110 : 60);
  page.drawText(isInternal ? "TRACABILITE NUMERIQUE" : "Empreinte numerique du document", {
    x: MARGIN, y, size: 8, font: bold, color: PRIMARY,
  });
  y -= 12;
  const traceLines: string[] = [];
  traceLines.push(`UUID rapport      : ${report.id}`);
  if (isInternal) {
    traceLines.push(`UUID PV           : ${report.pv_id}`);
    traceLines.push(`UUID entreprise   : ${report.company_id}`);
    traceLines.push(`Genere (UTC)      : ${genAt}`);
    try {
      traceLines.push(`Genere (local)    : ${new Date(genAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} (Europe/Paris)`);
    } catch { /* */ }
    traceLines.push(`Email signataire  : ${(report as any).client_validated_email ?? (report as any).client_signature_email ?? "—"}`);
    traceLines.push(`IP signataire     : ${(report as any).client_signature_ip ?? (report as any).client_validated_ip ?? "—"}`);
    traceLines.push(`User-Agent        : ${((report as any).client_signature_user_agent ?? "—").slice(0, 90)}`);
    traceLines.push(`Consentement      : ${(report as any).client_signature_consent_at ? `accepte le ${formatDate((report as any).client_signature_consent_at, true)}` : "—"}`);
    traceLines.push(`Nombre de reserves: ${items.length}`);
    traceLines.push(`Nombre de photos  : ${photoCount}`);
  } else {
    traceLines.push(`N° : ${sanitize(report.numero)}   ·   Genere le ${formatDate(genAt, true)}`);
    traceLines.push(`Reserves : ${items.length}   ·   Photos : ${photoCount}`);
  }
  traceLines.push(`SHA-256 (preuve)  : ${evidenceHash}`);
  for (const t of traceLines) {
    page.drawText(t, { x: MARGIN, y, size: 7, font: helv, color: MUTED });
    y -= 10;
  }
  y -= 6;

  // eIDAS bloc en évidence
  ensureSpace(46);
  page.drawRectangle({ x: MARGIN, y: y - 40, width: CONTENT_W, height: 40, color: rgb(0.97, 0.98, 1), borderColor: PRIMARY, borderWidth: 0.6 });
  page.drawText("CONFORMITE eIDAS", { x: MARGIN + 12, y: y - 14, size: 7.5, font: bold, color: PRIMARY });
  const eidasNotice = "Cette validation constitue une signature electronique simple conformement au reglement eIDAS (UE n°910/2014).";
  let ey0 = y - 26;
  for (const l of wrapLines(helv, eidasNotice, 8, CONTENT_W - 24)) {
    page.drawText(l, { x: MARGIN + 12, y: ey0, size: 8, font: helv, color: ACCENT });
    ey0 -= 10;
  }
  y -= 46;

  // Mentions
  ensureSpace(60);
  page.drawText("MENTIONS LEGALES", { x: MARGIN, y, size: 8, font: bold, color: MUTED });
  y -= 12;
  const mentions = "Le present proces-verbal atteste la levee des reserves listees ci-dessus, suite a l'intervention de l'entreprise, et constitue un complement au proces-verbal de reception initial (art. 1792-6 du Code civil).";
  for (const l of wrapLines(helv, mentions, 7.5, CONTENT_W)) { page.drawText(l, { x: MARGIN, y, size: 7.5, font: helv, color: MUTED }); y -= 11; }
  y -= 4;
  for (const m of EIDAS_MENTIONS) {
    for (const l of wrapLines(helv, m, 7, CONTENT_W)) {
      page.drawText(l, { x: MARGIN, y, size: 7, font: helv, color: MUTED });
      y -= 10;
    }
  }

  drawFooter();

  const bytes = await pdf.save();
  const suffix = isInternal ? "internal" : "client";
  const path = `${report.company_id}/lifts/${reportId}/LR-${report.numero}-${suffix}.pdf`;
  const { error: upErr } = await supabaseAdmin.storage
    .from("pv-assets")
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (upErr) throw new Error(`Échec upload PDF: ${upErr.message}`);

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = isInternal
    ? { pdf_internal_url: path, pdf_internal_generated_at: nowIso }
    : {
        pdf_client_url: path,
        pdf_client_generated_at: nowIso,
        // Keep legacy columns aligned with the client-safe variant so old code paths
        // (email delivery, exports) never accidentally expose internal metadata.
        pdf_url: path,
        pdf_generated_at: nowIso,
      };
  const { error: pdfUpdErr } = await supabaseAdmin
    .from("reserve_lift_reports")
    .update(patch as any)
    .eq("id", reportId);
  if (pdfUpdErr) throw new Error(`Échec persistance pdf_url: ${pdfUpdErr.message}`);

  return path;
}

/**
 * Build both variants (internal + client) in sequence, returning their storage paths.
 * Use this as the default entry point so the two PDFs stay in sync.
 */
export async function buildAndStoreReserveLiftPdfs(
  reportId: string,
): Promise<{ internalPath: string; clientPath: string }> {
  const internalPath = await buildAndStoreReserveLiftPdf(reportId, "internal");
  const clientPath = await buildAndStoreReserveLiftPdf(reportId, "client");

  // Audit both generations (best-effort — never block the lift on audit failures).
  try {
    const { writeAuditLog } = await import("./audit.server");
    const { data: r } = await supabaseAdmin
      .from("reserve_lift_reports")
      .select("company_id,pv_id,numero")
      .eq("id", reportId)
      .maybeSingle();
    if (r?.company_id) {
      await writeAuditLog({
        companyId: r.company_id, pvId: r.pv_id,
        entityType: "reserve_lift", entityId: reportId,
        action: "pdf.internal_generated",
        metadata: { numero: r.numero, path: internalPath },
        actor: "system",
      });
      await writeAuditLog({
        companyId: r.company_id, pvId: r.pv_id,
        entityType: "reserve_lift", entityId: reportId,
        action: "pdf.client_generated",
        metadata: { numero: r.numero, path: clientPath },
        actor: "system",
      });
    }
  } catch (e) {
    console.error("[reserve-lift] audit pdf generation failed", e);
  }

  return { internalPath, clientPath };
}

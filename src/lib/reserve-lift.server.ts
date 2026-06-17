/**
 * Helpers + PDF generation for reserve-lift reports.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getCompanyBranding, getCompanyBrandingSettings, hexToRgb01, DEFAULT_BRANDING_SETTINGS } from "./branding.server";
import { sha256OfBytes, EIDAS_MENTIONS } from "./signature-proof.server";
import { RESERVE_STATUS_LABEL, RESERVE_SEVERITY_LABEL, type ReserveStatusValue } from "./reserve-status";

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

export async function buildAndStoreReserveLiftPdf(reportId: string): Promise<string> {
  const { data: report } = await supabaseAdmin
    .from("reserve_lift_reports")
    .select("id,numero,status,comment,company_signature,client_signature,signed_at,pv_id,company_id,created_at,client_validated_at,client_validated_email,client_rejected_at,client_rejected_email,client_rejected_reason,client_rejected_ip")
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
    ? await supabaseAdmin.from("pv_reserves").select("id,description,severity,status,nature,work_to_execute,due_date").in("id", reserveIds)
    : { data: [] as any[] };
  const reserveMap = new Map<string, any>((reservesData ?? []).map((r: any) => [r.id, r]));

  // Photos with metadata (before/after + GPS) for these items
  const { data: photoMeta } = itemIds.length
    ? await supabaseAdmin
        .from("reserve_lift_item_photos" as any)
        .select("reserve_lift_item_id,photo_type,storage_path,latitude,longitude,accuracy,taken_at")
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
  pdf.setTitle(`Levée de réserves ${report.numero}`);
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

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN + 30) {
      drawFooter();
      page = pdf.addPage([PAGE_W, PAGE_H]);
      pageNum += 1;
      y = PAGE_H - MARGIN;
    }
  };
  const drawFooter = () => {
    page.drawLine({ start: { x: MARGIN, y: MARGIN }, end: { x: PAGE_W - MARGIN, y: MARGIN }, thickness: 0.5, color: BORDER });
    const footerText = sanitize(branding.pdf_footer || "Document généré par PVIA.");
    page.drawText(`Levée ${sanitize(report.numero)} · ${footerText}`, { x: MARGIN, y: MARGIN - 14, size: 8, font: helv, color: MUTED });
    page.drawText(`Page ${pageNum}`, { x: PAGE_W - MARGIN - 40, y: MARGIN - 14, size: 8, font: helv, color: MUTED });
  };

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

  page.drawText("PROCES-VERBAL", { x: PAGE_W - MARGIN - 220, y: PAGE_H - 40, size: 9, font: bold, color: PRIMARY });
  page.drawText("DE LEVEE DE RESERVES", { x: PAGE_W - MARGIN - 220, y: PAGE_H - 54, size: 9, font: helv, color: MUTED });
  page.drawText(`N° ${sanitize(report.numero)}`, { x: PAGE_W - MARGIN - 220, y: PAGE_H - 78, size: 18, font: bold, color: ACCENT });

  y = PAGE_H - 140;

  // PV reference band
  ensureSpace(60);
  page.drawRectangle({ x: MARGIN, y: y - 56, width: CONTENT_W, height: 56, color: rgb(0.97, 0.98, 1), borderColor: BORDER, borderWidth: 0.5 });
  page.drawText("PV INITIAL", { x: MARGIN + 12, y: y - 16, size: 7, font: bold, color: MUTED });
  page.drawText(sanitize(pv?.numero ?? "—"), { x: MARGIN + 12, y: y - 32, size: 12, font: bold, color: ACCENT });
  page.drawText(`Réceptionné le ${formatDate(pv?.reception_date)}`, { x: MARGIN + 12, y: y - 46, size: 9, font: helv, color: MUTED });
  page.drawText("LEVEE LE", { x: MARGIN + CONTENT_W / 2 + 12, y: y - 16, size: 7, font: bold, color: MUTED });
  page.drawText(formatDate(report.signed_at ?? report.created_at, true), { x: MARGIN + CONTENT_W / 2 + 12, y: y - 32, size: 12, font: bold, color: ACCENT });
  y -= 76;

  // Parties
  const colW = (CONTENT_W - 16) / 2;
  const drawParty = (x: number, title: string, lines: string[]) => {
    page.drawRectangle({ x, y: y - 100, width: colW, height: 100, borderColor: BORDER, borderWidth: 0.5, color: rgb(1, 1, 1) });
    page.drawText(title.toUpperCase(), { x: x + 12, y: y - 18, size: 8, font: bold, color: PRIMARY });
    let yy = y - 36;
    for (let i = 0; i < lines.length; i++) {
      const t = sanitize(lines[i]);
      if (!t) continue;
      const isFirst = i === 0;
      page.drawText(t, { x: x + 12, y: yy, size: isFirst ? 11 : 9, font: isFirst ? bold : helv, color: isFirst ? ACCENT : MUTED });
      yy -= isFirst ? 16 : 12;
    }
  };
  ensureSpace(120);
  drawParty(MARGIN, "Entreprise", [company?.name ?? "-", company?.address_line1 ?? company?.address ?? "", company?.email ?? "", company?.phone ?? ""]);
  drawParty(MARGIN + colW + 16, "Client", [client?.name ?? "-", client?.address ?? "", client?.email ?? "", client?.phone ?? ""]);
  y -= 120;

  if (chantier?.name) {
    ensureSpace(40);
    page.drawText("CHANTIER", { x: MARGIN, y, size: 8, font: bold, color: PRIMARY });
    y -= 14;
    page.drawText(sanitize(chantier.name), { x: MARGIN, y, size: 11, font: bold, color: ACCENT });
    y -= 14;
    if (chantier.address) {
      page.drawText(sanitize(chantier.address), { x: MARGIN, y, size: 9, font: helv, color: MUTED });
      y -= 14;
    }
    y -= 6;
  }


  // Reserves traitées — header + per-reserve cards with inline photos
  const items = (itemsRes.data ?? []) as any[];
  ensureSpace(40);
  page.drawText(`RESERVES TRAITEES (${items.length})`, { x: MARGIN, y, size: 9, font: bold, color: PRIMARY });
  y -= 16;

  // Helper: render a photo grid into the current page at the current y
  const renderPhotoGrid = async (paths: string[], label: string) => {
    if (!paths.length) return;
    const cols = 2;
    const gap = 10;
    const cellW = (CONTENT_W - 24 - gap * (cols - 1)) / cols;
    const cellH = 110;

    ensureSpace(16);
    page.drawText(sanitize(label).toUpperCase(), { x: MARGIN + 12, y: y - 10, size: 7, font: bold, color: MUTED });
    y -= 14;

    let col = 0;
    for (const p of paths.slice(0, 8)) {
      const { data: f } = await supabaseAdmin.storage.from("pv-assets").download(p);
      if (!f) continue;
      const bytes = new Uint8Array(await f.arrayBuffer());
      const t = detectImageType(bytes);
      if (!t) continue;
      if (col === 0) ensureSpace(cellH + 6);
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
      col++;
      if (col >= cols) { col = 0; y -= cellH + 8; }
    }
    if (col !== 0) y -= cellH + 8;
  };

  for (const item of items) {
    const reserve = reserveMap.get(item.reserve_id);
    const desc = reserve?.description ?? "(réserve supprimée)";
    const oldLabel = RESERVE_STATUS_LABEL[item.old_status as ReserveStatusValue] ?? item.old_status ?? "—";
    const newLabel = RESERVE_STATUS_LABEL[item.new_status as ReserveStatusValue] ?? item.new_status ?? "—";
    const sevLabel = reserve?.severity ? (RESERVE_SEVERITY_LABEL[reserve.severity] ?? reserve.severity) : "";
    const isRejected = item.new_status === "rejetee";
    const accentColor = isRejected ? rgb(0.80, 0.10, 0.10) : rgb(0.13, 0.6, 0.3);
    const cardBg = isRejected ? rgb(1, 0.98, 0.98) : rgb(0.99, 1, 0.99);

    // --- Header strip per reserve (status transition badge) ---
    ensureSpace(28);
    page.drawRectangle({ x: MARGIN, y: y - 22, width: CONTENT_W, height: 22, color: cardBg, borderColor: BORDER, borderWidth: 0.5 });
    page.drawRectangle({ x: MARGIN, y: y - 22, width: 3, height: 22, color: accentColor });
    page.drawText(
      sanitize(`${sevLabel ? sevLabel.toUpperCase() + " - " : ""}${oldLabel} → ${newLabel}`),
      { x: MARGIN + 12, y: y - 14, size: 8, font: bold, color: accentColor },
    );
    y -= 26;

    // --- Description + comment + (optional) rejection reason ---
    const descLines = wrapLines(helv, desc, 9, CONTENT_W - 24);
    ensureSpace(descLines.length * 12 + 6);
    for (const l of descLines) {
      page.drawText(l, { x: MARGIN + 12, y: y - 10, size: 9, font: helv, color: ACCENT });
      y -= 12;
    }

    if (item.comment) {
      const label = isRejected ? "Motif du rejet" : "Commentaire d'intervention";
      const cLines = wrapLines(helv, item.comment, 8.5, CONTENT_W - 36);
      ensureSpace(cLines.length * 11 + 14);
      page.drawText(`${label} :`, { x: MARGIN + 12, y: y - 10, size: 8, font: bold, color: isRejected ? rgb(0.80, 0.10, 0.10) : MUTED });
      y -= 12;
      for (const l of cLines) {
        page.drawText(l, { x: MARGIN + 24, y: y - 10, size: 8.5, font: helv, color: ACCENT });
        y -= 11;
      }
    }

    // --- Photos (intervention) — rendered per reserve ---
    const photoPaths: string[] = item.photo_urls ?? [];
    if (photoPaths.length) {
      y -= 4;
      const label = isRejected ? "Photos justificatives" : "Photos après intervention";
      await renderPhotoGrid(photoPaths, `${label} (${photoPaths.length})`);
    } else if (!isRejected) {
      ensureSpace(14);
      page.drawText("Aucune photo jointe pour cette intervention.", { x: MARGIN + 12, y: y - 10, size: 8, font: helv, color: MUTED });
      y -= 14;
    }

    y -= 10;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.3, color: BORDER });
    y -= 8;
  }
  if (!items.length) {
    ensureSpace(28);
    page.drawText("Aucune réserve associée à ce rapport.", { x: MARGIN, y: y - 12, size: 9, font: helv, color: MUTED });
    y -= 22;
  }
  y -= 6;


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

  // Signatures
  ensureSpace(180);
  page.drawText("SIGNATURES", { x: MARGIN, y, size: 9, font: bold, color: PRIMARY });
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
  };
  await drawSig(MARGIN, "Entreprise", report.company_signature);
  await drawSig(MARGIN + sigW + 16, "Client", report.client_signature);
  y -= sigH + 16;

  if ((report as any).client_validated_at) {
    ensureSpace(28);
    page.drawText(
      sanitize(`Validée par le client (${(report as any).client_validated_email ?? "—"}) le ${formatDate((report as any).client_validated_at, true)}`),
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
      sanitize(`REJETÉE par le client (${(report as any).client_rejected_email ?? "—"}) le ${formatDate((report as any).client_rejected_at, true)}`),
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

  // ============ PREUVE DE SIGNATURE ELECTRONIQUE (eIDAS SES) ============
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

  proofField("b", "Methode de signature", "Signature electronique simple — validation par lien email");
  proofField("b", "Adresse IP client", (report as any).client_validated_ip || "-");
  proofField("b", "Date de validation client", formatDate((report as any).client_validated_at, true));
  proofField("b", "Signature client (entreprise)", report.client_signature ? "Signature collectee" : "-");

  y -= proofBoxH + 6;

  // Evidence fingerprint (deterministic hash of the proof bundle, not of the PDF bytes)
  const evidenceString = [
    report.id,
    report.numero,
    report.signed_at ?? "",
    (report as any).client_validated_email ?? "",
    (report as any).client_validated_at ?? "",
    (report as any).client_validated_ip ?? "",
  ].join("|");
  const evidenceBytes = new TextEncoder().encode(evidenceString);
  const evidenceHash = await sha256OfBytes(evidenceBytes);
  const genAt = new Date().toISOString();

  ensureSpace(40);
  page.drawText("Empreinte numerique du document", { x: MARGIN, y, size: 7, font: bold, color: MUTED });
  y -= 10;
  page.drawText(`UUID : ${report.id}`, { x: MARGIN, y, size: 7, font: helv, color: MUTED });
  y -= 10;
  page.drawText(`N° : ${sanitize(report.numero)}   ·   Genere le ${formatDate(genAt, true)}`, { x: MARGIN, y, size: 7, font: helv, color: MUTED });
  y -= 10;
  page.drawText(`SHA-256 (preuve) : ${evidenceHash}`, { x: MARGIN, y, size: 6.5, font: helv, color: MUTED });
  y -= 12;

  // Mentions
  ensureSpace(60);
  page.drawText("MENTIONS LEGALES", { x: MARGIN, y, size: 8, font: bold, color: MUTED });
  y -= 12;
  const mentions = "Le present proces-verbal atteste la levee des reserves listees ci-dessus, suite a l'intervention de l'entreprise.";
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
  const path = `${report.company_id}/lifts/${reportId}/LR-${report.numero}.pdf`;
  const { error: upErr } = await supabaseAdmin.storage
    .from("pv-assets")
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (upErr) throw new Error(`Échec upload PDF: ${upErr.message}`);

  const { error: pdfUpdErr } = await supabaseAdmin
    .from("reserve_lift_reports")
    .update({ pdf_url: path, pdf_generated_at: new Date().toISOString() } as any)
    .eq("id", reportId);
  if (pdfUpdErr) throw new Error(`Échec persistance pdf_url: ${pdfUpdErr.message}`);

  return path;
}

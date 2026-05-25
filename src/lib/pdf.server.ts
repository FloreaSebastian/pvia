import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { getCompanyBranding, type CompanyBranding } from "./branding.server";

type Company = (Partial<CompanyBranding> & { name?: string | null }) | undefined;
type Client = { name?: string | null; email?: string | null; phone?: string | null; address?: string | null } | undefined;
type Chantier = { name?: string | null; address?: string | null } | undefined;
type Reserve = { description: string; severity: string; status: string };
type Pv = {
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
};

const ACCENT = rgb(0.06, 0.09, 0.16); // slate-900
const MUTED = rgb(0.42, 0.45, 0.52);
const BORDER = rgb(0.86, 0.88, 0.91);
const PRIMARY = rgb(0.12, 0.23, 0.54);

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
}): Promise<Uint8Array> {
  const { pv, company, client, chantier, reserves, photos } = input;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`PV ${pv.numero}`);
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
    page.drawLine({ start: { x: MARGIN, y: MARGIN }, end: { x: PAGE_W - MARGIN, y: MARGIN }, thickness: 0.5, color: BORDER });
    page.drawText(`PVIA · PV ${sanitize(pv.numero)} · Document généré par PVIA`, { x: MARGIN, y: MARGIN - 14, size: 8, font: helv, color: MUTED });
    page.drawText(`Page ${pageNum}`, { x: PAGE_W - MARGIN - 40, y: MARGIN - 14, size: 8, font: helv, color: MUTED });
  };

  // ============ HEADER ============
  page.drawRectangle({ x: 0, y: PAGE_H - 110, width: PAGE_W, height: 110, color: rgb(0.97, 0.98, 1) });
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
      const lines = wrapLines(helv, r.description, 9, CONTENT_W - 24);
      const h = Math.max(34, lines.length * 12 + 22);
      ensureSpace(h + 6);
      page.drawRectangle({ x: MARGIN, y: y - h, width: CONTENT_W, height: h, borderColor: BORDER, borderWidth: 0.5, color: rgb(0.99, 0.99, 1) });
      const sevColor = r.severity === "majeure" ? rgb(0.86, 0.15, 0.15) : rgb(0.92, 0.62, 0.07);
      page.drawRectangle({ x: MARGIN, y: y - h, width: 3, height: h, color: sevColor });
      page.drawText(`${sanitize(r.severity).toUpperCase()} - ${sanitize(r.status).toUpperCase()}`, { x: MARGIN + 12, y: y - 14, size: 7, font: bold, color: sevColor });
      let yy = y - 28;
      for (const l of lines) { page.drawText(l, { x: MARGIN + 12, y: yy, size: 9, font: helv, color: ACCENT }); yy -= 12; }
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

  // ============ MENTIONS ============
  ensureSpace(80);
  drawText("MENTIONS LEGALES", { size: 8, font: bold, color: MUTED });
  y -= 12;
  const mentions =
    "Le present proces-verbal de reception fait foi de la livraison des travaux decrits ci-dessus. " +
    "Sauf reserves expressement formulees ci-dessus, le client reconnait avoir constate la bonne execution des travaux. " +
    "Les reserves listees devront etre levees dans les delais convenus. Document signe electroniquement conformement au reglement eIDAS.";
  const ml = wrapLines(helv, mentions, 7.5, CONTENT_W);
  for (const l of ml) { page.drawText(l, { x: MARGIN, y, size: 7.5, font: helv, color: MUTED }); y -= 11; }

  drawFooter();
  return await pdf.save();
}

import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Internal: build the PDF, upload it to `pv-assets`, persist pdf_url + pdf_generated_at. Returns the storage path. */
export async function buildAndStorePvPdf(pvId: string): Promise<string> {
  const { data: pv } = await supabaseAdmin
    .from("pv")
    .select("id,numero,type,status,reception_date,description,observations,client_signature,company_signature,signed_at,company_id,client_id,chantier_id,created_at")
    .eq("id", pvId)
    .maybeSingle();
  if (!pv?.company_id) throw new Error("PV introuvable.");

  const [company, clientRes, chantierRes, photosRes, reservesRes] = await Promise.all([
    getCompanyBranding(pv.company_id),
    pv.client_id
      ? supabaseAdmin.from("clients").select("name,email,phone,address").eq("id", pv.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    pv.chantier_id
      ? supabaseAdmin.from("chantiers").select("name,address").eq("id", pv.chantier_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin.from("pv_photos").select("id,url,caption").eq("pv_id", pvId).order("created_at"),
    supabaseAdmin.from("pv_reserves").select("id,description,severity,status").eq("pv_id", pvId).order("created_at"),
  ]);

  const photos: { caption: string | null; bytes: Uint8Array }[] = [];
  for (const p of (photosRes.data ?? []).slice(0, 12)) {
    const { data: f } = await supabaseAdmin.storage.from("pv-assets").download(p.url);
    if (f) photos.push({ caption: p.caption, bytes: new Uint8Array(await f.arrayBuffer()) });
  }

  const pdfBytes = await generatePvPdfBytes({
    pv,
    company: company ?? undefined,
    client: (clientRes as any).data ?? undefined,
    chantier: (chantierRes as any).data ?? undefined,
    reserves: reservesRes.data ?? [],
    photos,
  });

  const path = `${pv.company_id}/pv/${pvId}/PV-${pv.numero}-signed.pdf`;
  const { error: upErr } = await supabaseAdmin.storage
    .from("pv-assets")
    .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (upErr) throw new Error(`Échec upload PDF: ${upErr.message}`);

  const { error: updErr } = await supabaseAdmin
    .from("pv")
    .update({ pdf_url: path, pdf_generated_at: new Date().toISOString() } as any)
    .eq("id", pvId);
  if (updErr) throw new Error(updErr.message);

  return path;
}

/**
 * Visites techniques — rapport PDF technique.
 *
 * Reprend la mise en page des PDF existants (pdf-lib, A4, polices standard).
 * Le rapport restitue UNIQUEMENT ce qui a été relevé sur place : réponses,
 * photos, contraintes, éléments manquants. Aucun calcul réglementaire,
 * dimensionnement ni conclusion de conformité n'est produit ici.
 * Appelé uniquement après contrôle d'appartenance + formule côté serveur.
 */
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getCompanyBranding, formatBrandingAddress } from "./branding.server";
import { LOT_META, resolveVisitTemplate } from "./visites/templates";
import { computeProgress, formatAnswer, resolveSections } from "./visites/engine";
import {
  CONSTRAINT_CATEGORY_LABEL,
  CONSTRAINT_LEVEL_META,
  PHOTO_SKIP_REASON_LABEL,
  VISIT_STATUS_META,
  type AnswerMap,
  type ConstraintCategory,
  type ConstraintLevel,
  type PhotoSkipReason,
  type VisitLot,
  type VisitStatus,
} from "./visites/types";
import { VISIT_BUCKET } from "./visites.server";
import { VISIT_PDF_SCOPE_NOTE, pdfSafe } from "./visites/report";

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 44;
/** Plafond de photos intégrées (taille et temps de génération maîtrisés). */
export const VISIT_PDF_MAX_PHOTOS = 40;

function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of pdfSafe(text).split(/\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    let cur = "";
    for (let w of words) {
      // Mot sans espace plus large que la colonne (URL, référence…) : coupé de force.
      while (font.widthOfTextAtSize(w, size) > maxWidth && w.length > 1) {
        let n = w.length - 1;
        while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > maxWidth) n--;
        if (cur) {
          out.push(cur);
          cur = "";
        }
        out.push(w.slice(0, n));
        w = w.slice(n);
      }
      const next = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > maxWidth && cur) {
        out.push(cur);
        cur = w;
      } else cur = next;
    }
    out.push(cur);
  }
  return out.length ? out : [""];
}

function fmtDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return withTime
    ? d.toLocaleString("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Paris",
      })
    : d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
}

export async function buildVisitReportPdf(
  companyId: string,
  visitId: string,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const { data: visit, error: visitErr } = await supabaseAdmin
    .from("technical_visits")
    .select(
      "*,chantier:chantiers(reference,name,address),client:clients(name,company_name,client_type,email,phone,address)",
    )
    .eq("id", visitId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (visitErr) throw new Error("Lecture de la visite impossible. Réessayez dans un instant.");
  if (!visit) throw new Error("Visite introuvable.");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jointures Supabase non typées
  const v = visit as unknown as Record<string, any>;

  const [branding, answersRes, photosRes, skipsRes, constraintsRes] = await Promise.all([
    getCompanyBranding(companyId),
    supabaseAdmin.from("technical_visit_answers").select("field_key,value").eq("visit_id", visitId),
    supabaseAdmin
      .from("technical_visit_photos")
      .select("slot_key,section_key,storage_path,caption,comment,taken_at")
      .eq("visit_id", visitId)
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("technical_visit_photo_skips")
      .select("slot_key,reason,justification")
      .eq("visit_id", visitId),
    supabaseAdmin
      .from("technical_visit_constraints")
      .select("category,level,title,description,recommendation,location,responsible,lot,photo_paths")
      .eq("visit_id", visitId)
      .order("created_at", { ascending: true }),
  ]);

  // Ne jamais produire un rapport faussement complet : toute lecture en échec bloque la génération.
  if (answersRes.error || photosRes.error || skipsRes.error || constraintsRes.error) {
    throw new Error("Lecture des données de la visite incomplète : rapport non généré. Réessayez dans un instant.");
  }

  let assignee = "-";
  if (v.assigned_to) {
    const { data: p } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", v.assigned_to)
      .maybeSingle();
    assignee = p?.full_name || "-";
  }

  const answers: AnswerMap = {};
  for (const a of answersRes.data ?? []) answers[a.field_key] = a.value as never;
  const photos = photosRes.data ?? [];
  const skips = skipsRes.data ?? [];
  const constraints = constraintsRes.data ?? [];
  const template = resolveVisitTemplate(v as { visit_type: string; lots?: string[] });
  if (!template) throw new Error("Type de visite inconnu : rapport non généré.");
  const sections = resolveSections(template, answers);
  const progress = computeProgress(template, {
    answers,
    photoSlots: new Set(photos.map((p) => p.slot_key)),
    skippedSlots: new Set(skips.map((s) => s.slot_key)),
    constraintCount: constraints.length,
  });

  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(`Rapport de visite technique ${v.reference}`));
  pdf.setProducer("PVIA");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.12, 0.16);
  const muted = rgb(0.42, 0.45, 0.5);
  const accent = rgb(0.13, 0.33, 0.55);
  const W = A4[0] - MARGIN * 2;

  let page: PDFPage = pdf.addPage(A4);
  let y = A4[1] - MARGIN;
  const newPage = () => {
    page = pdf.addPage(A4);
    y = A4[1] - MARGIN;
  };
  const need = (h: number) => {
    if (y - h < MARGIN + 20) newPage();
  };
  const text = (
    t: string,
    opts: {
      size?: number;
      f?: PDFFont;
      color?: ReturnType<typeof rgb>;
      x?: number;
      width?: number;
    } = {},
  ) => {
    const size = opts.size ?? 10;
    const f = opts.f ?? font;
    const x = opts.x ?? MARGIN;
    for (const line of wrap(f, t, size, opts.width ?? W - (x - MARGIN))) {
      need(size + 4);
      page.drawText(line, { x, y: y - size, size, font: f, color: opts.color ?? ink });
      y -= size + 4;
    }
  };
  const heading = (t: string) => {
    need(40);
    y -= 8;
    page.drawRectangle({
      x: MARGIN,
      y: y - 18,
      width: W,
      height: 20,
      color: rgb(0.93, 0.95, 0.97),
    });
    page.drawText(pdfSafe(t), { x: MARGIN + 6, y: y - 13, size: 11, font: bold, color: accent });
    y -= 26;
  };
  const row = (label: string, value: string) => {
    const lw = 190;
    const lLines = wrap(bold, label, 9, lw - 8);
    const vLines = wrap(font, value, 9, W - lw);
    // Ligne par ligne : une réponse longue continue proprement sur la page suivante
    // au lieu de déborder sous le pied de page.
    const n = Math.max(lLines.length, vLines.length);
    for (let i = 0; i < n; i++) {
      need(12);
      if (lLines[i]) page.drawText(lLines[i], { x: MARGIN, y: y - 9, size: 9, font: bold, color: muted });
      if (vLines[i]) page.drawText(vLines[i], { x: MARGIN + lw, y: y - 9, size: 9, font, color: ink });
      y -= 12;
    }
    y -= 2;
  };

  // En-tête
  const companyName = branding?.name ?? "";
  text(companyName, { size: 12, f: bold });
  if (branding) {
    const addr = formatBrandingAddress(branding).replace(/\n/g, " - ");
    if (addr) text(addr, { size: 8, color: muted });
    const contact = [
      branding.phone,
      branding.email,
      branding.siret ? `SIRET ${branding.siret}` : null,
    ]
      .filter(Boolean)
      .join(" - ");
    if (contact) text(contact, { size: 8, color: muted });
  }
  y -= 10;
  text("Rapport de visite technique", { size: 18, f: bold, color: accent });
  text(`${template.label} - ${v.reference}`, { size: 11, f: bold });
  y -= 4;

  heading("Informations générales");
  const client = v.client ?? {};
  const clientLabel =
    client.client_type === "entreprise" ? client.company_name || client.name : client.name;
  row("Client", clientLabel || "-");
  row("Contact client", [client.phone, client.email].filter(Boolean).join(" - ") || "-");
  row("Chantier", [v.chantier?.reference, v.chantier?.name].filter(Boolean).join(" - ") || "-");
  row("Adresse du site", v.site_address || v.chantier?.address || client.address || "-");
  row(
    "Contact sur site",
    [v.site_contact_name, v.site_contact_phone].filter(Boolean).join(" - ") || "-",
  );
  row("Technicien", assignee);
  row("Date prévue", fmtDate(v.scheduled_at, true));
  row("Visite réalisée le", fmtDate(v.completed_at ?? v.started_at, true));
  row("Statut", VISIT_STATUS_META[v.status as VisitStatus]?.label ?? String(v.status));
  row("Complétude", `${progress.percent} %`);
  if (v.validated_at) row("Validée le", fmtDate(v.validated_at, true));
  if (template.lots?.length) row("Lots relevés", template.lots.map((l) => LOT_META[l].label).join(", "));

  // Synthèse (visites BTP) : uniquement ce que le technicien a saisi.
  if (template.type === "btp") {
    const fieldOf = (key: string) => {
      for (const rs of sections) for (const b of rs.blocks) for (const f of b.fields) if (f.answerKey === key) return f;
      return null;
    };
    const show = (key: string, label?: string) => {
      const f = fieldOf(key);
      const val = answers[key];
      if (!f || val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0)) return false;
      row(label ?? f.label, formatAnswer(f, val));
      return true;
    };
    heading("Synthèse de la visite");
    let any = false;
    any = show("btp_conclusion") || any;
    any = show("btp_conditions") || any;
    any = show("btp_complements") || any;
    any = show("btp_prochaines_etapes") || any;
    any = show("btp_travaux_prep", "Travaux préparatoires") || any;
    any = show("btp_travaux_prep_detail") || any;
    any = show("btp_documents") || any;
    any = show("btp_documents_autres") || any;
    const blocking = constraints.filter((c) => c.level === "bloquant" || c.level === "important").length;
    if (constraints.length) {
      row("Points d'attention", `${constraints.length} relevé(s), dont ${blocking} important(s) ou bloquant(s)`);
      any = true;
    }
    if (!any) text("Conclusion non renseignée par le technicien.", { size: 9, color: muted });
    if (progress.missingCount > 0) text(`Visite incomplète : ${progress.missingCount} élément(s) obligatoire(s) manquant(s).`, { size: 9, f: bold });
    text("Constat de visite avant travaux : ce document ne vaut ni procès-verbal de réception ni liste de réserves de fin de travaux.", { size: 8, color: muted });
  }

  // Éléments manquants
  const missing = progress.sections.filter(
    (s) => s.missingFieldLabels.length + s.missingPhotoLabels.length > 0,
  );
  heading("Éléments manquants");
  if (missing.length === 0) text("Aucun élément obligatoire manquant.", { size: 9, color: muted });
  for (const s of missing) {
    text(s.title, { size: 9, f: bold });
    for (const m of [...s.missingFieldLabels, ...s.missingPhotoLabels.map((p) => `Photo : ${p}`)]) {
      text(`- ${m}`, { size: 9, x: MARGIN + 10 });
    }
  }

  // Constats par section
  for (const rs of sections) {
    if (rs.section.kind === "constraints" || rs.section.kind === "review") continue;
    // Sections et champs vides omis : le rapport ne montre que ce qui a été relevé.
    const isEmpty = (val: unknown) => val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0);
    const blocksWithData = rs.blocks.filter(
      (b) => b.fields.some((f) => !isEmpty(answers[f.answerKey])) || b.photos.some((sl) => skips.some((s) => s.slot_key === sl.answerKey)),
    );
    if (blocksWithData.length === 0) continue;
    heading(rs.section.title);
    for (const block of blocksWithData) {
      if (block.label) text(block.label, { size: 10, f: bold });
      for (const f of block.fields) {
        const value = answers[f.answerKey];
        if (isEmpty(value)) continue;
        row(f.label, formatAnswer(f, value));
      }
      for (const slot of block.photos) {
        const skip = skips.find((s) => s.slot_key === slot.answerKey);
        if (skip) {
          row(
            `Photo : ${slot.label}`,
            `Non photographiée - ${PHOTO_SKIP_REASON_LABEL[skip.reason as PhotoSkipReason] ?? skip.reason}${skip.justification ? ` (${skip.justification})` : ""}`,
          );
        }
      }
    }
  }

  // Contraintes
  heading(template.type === "btp" ? "Points d'attention" : "Contraintes et points de vigilance");
  if (constraints.length === 0) text("Aucun point d'attention relevé.", { size: 9, color: muted });
  for (const c of constraints) {
    const lvl = CONSTRAINT_LEVEL_META[c.level as ConstraintLevel]?.label ?? c.level;
    const cat = CONSTRAINT_CATEGORY_LABEL[c.category as ConstraintCategory] ?? c.category;
    text(`[${lvl}] ${c.title}`, { size: 10, f: bold });
    text(cat, { size: 8, color: muted });
    if (c.description) text(c.description, { size: 9 });
    if (c.lot && LOT_META[c.lot as VisitLot]) text(`Lot : ${LOT_META[c.lot as VisitLot].label}`, { size: 9 });
    if (c.location) text(`Emplacement : ${c.location}`, { size: 9 });
    if (c.recommendation) text(`${template.type === "btp" ? "Action" : "Recommandation"} : ${c.recommendation}`, { size: 9 });
    if (c.responsible) text(`Responsable : ${c.responsible}`, { size: 9 });
    const linked = (c.photo_paths ?? []).length;
    if (linked) text(`Photo(s) liée(s) : ${linked} — voir section Photos`, { size: 8, color: muted });
    y -= 4;
  }

  // Photos
  const slotLabel = new Map<string, string>();
  const slotCategory = new Map<string, string>();
  for (const rs of sections)
    for (const b of rs.blocks)
      for (const p of b.photos) {
        slotLabel.set(p.answerKey, b.label ? `${p.label} (${b.label})` : p.label);
        slotCategory.set(p.answerKey, p.category);
      }
  const linkedTo = new Map<string, string>();
  for (const c of constraints) for (const path of c.photo_paths ?? []) linkedTo.set(path, c.title);
  heading(`Photos (${photos.length})`);
  if (photos.length === 0) text("Aucune photo.", { size: 9, color: muted });
  // Classement par catégorie (zone / lot) dans l'ordre du modèle.
  const order = (cat: string) => {
    const i = template.photoCategories.indexOf(cat);
    return i === -1 ? 999 : i;
  };
  const sorted = [...photos].sort((a, b) => order(slotCategory.get(a.slot_key) ?? "") - order(slotCategory.get(b.slot_key) ?? ""));
  const shown = sorted.slice(0, VISIT_PDF_MAX_PHOTOS);
  let currentCat: string | null = null;
  for (const p of shown) {
    const cat = slotCategory.get(p.slot_key) ?? "Autres photos";
    if (cat !== currentCat) {
      currentCat = cat;
      // Titre de groupe jamais orphelin : réserver la place du titre + d'une photo.
      need(340);
      y -= 4;
      text(cat, { size: 10, f: bold, color: accent });
    }
    let img: PDFImage | null = null;
    let missingReason = "photo non disponible (fichier introuvable ou illisible)";
    try {
      const { data: blob, error: dlErr } = await supabaseAdmin.storage
        .from(VISIT_BUCKET)
        .download(p.storage_path);
      if (dlErr || !blob) missingReason = "photo non disponible (fichier introuvable dans le stockage)";
      if (blob) {
        const buf = new Uint8Array(await blob.arrayBuffer());
        const isPng = buf[0] === 0x89 && buf[1] === 0x50;
        const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
        img = isPng ? await pdf.embedPng(buf) : isJpg ? await pdf.embedJpg(buf) : null;
        if (!img) missingReason = "photo non intégrable dans le PDF (format non JPEG/PNG) — consultable dans PVIA";
      }
    } catch {
      img = null;
    }
    const caption = [
      slotLabel.get(p.slot_key) ?? p.slot_key,
      p.caption && p.caption.trim() !== (slotLabel.get(p.slot_key) ?? p.slot_key) ? p.caption : null,
      p.taken_at ? fmtDate(p.taken_at, true) : null,
      linkedTo.has(p.storage_path) ? `Point d'attention : ${linkedTo.get(p.storage_path)}` : null,
    ]
      .filter(Boolean)
      .join(" - ");
    if (img) {
      const maxW = W * 0.75;
      const maxH = 300;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      need(h + 30);
      page.drawImage(img, { x: MARGIN, y: y - h, width: w, height: h });
      y -= h + 4;
    } else {
      need(20);
      text(`(${missingReason})`, { size: 8, color: muted });
    }
    text(caption, { size: 8, color: muted });
    if (p.comment) text(p.comment, { size: 8 });
    y -= 8;
  }
  if (photos.length > shown.length) {
    text(`${photos.length - shown.length} photo(s) supplémentaire(s) consultable(s) dans PVIA.`, {
      size: 8,
      color: muted,
    });
  }

  heading("Portée du document");
  text(VISIT_PDF_SCOPE_NOTE, { size: 9 });

  // Pied de page
  const pages = pdf.getPages();
  pages.forEach((pg, i) => {
    pg.drawText(
      pdfSafe(`${v.reference} - Rapport de visite technique - page ${i + 1}/${pages.length}`),
      {
        x: MARGIN,
        y: 22,
        size: 7,
        font,
        color: muted,
      },
    );
  });

  const bytes = await pdf.save();
  return { bytes, fileName: `visite-${String(v.reference).replace(/[^A-Za-z0-9_-]/g, "")}.pdf` };
}

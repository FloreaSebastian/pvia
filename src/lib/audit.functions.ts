import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog, type AuditAction } from "./audit.server";

async function assertPvAccess(pvId: string, userId: string) {
  const { data: pv } = await supabaseAdmin
    .from("pv")
    .select("id,company_id,numero")
    .eq("id", pvId)
    .maybeSingle();
  if (!pv?.company_id) throw new Error("PV introuvable.");
  const { data: m } = await supabaseAdmin
    .from("company_members")
    .select("id,role")
    .eq("company_id", pv.company_id)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!m) throw new Error("Accès refusé.");
  return { pv, role: m.role as string };
}

/* ------------------------- List audit logs for a PV ------------------------- */

const ListSchema = z.object({
  pvId: z.string().uuid(),
  actions: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

export const listPvAuditLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ListSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { role } = await assertPvAccess(data.pvId, context.userId);
    const canSeeDetails = role === "owner" || role === "admin";
    const limit = data.limit ?? 50;
    const offset = data.offset ?? 0;

    let countQ = supabaseAdmin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("pv_id", data.pvId);
    if (data.actions && data.actions.length) countQ = countQ.in("action", data.actions);
    const { count: total } = await countQ;

    let q = supabaseAdmin
      .from("audit_logs")
      .select("id,action,entity_type,entity_id,user_id,old_values,new_values,metadata,created_at,ip_address")
      .eq("pv_id", data.pvId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (data.actions && data.actions.length) q = q.in("action", data.actions);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    // Hydrate user names
    const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id).filter(Boolean) as string[]));
    let profiles: Record<string, { full_name: string | null }> = {};
    if (userIds.length) {
      const { data: pr } = await supabaseAdmin
        .from("profiles")
        .select("id,full_name")
        .in("id", userIds);
      profiles = Object.fromEntries((pr ?? []).map((p) => [p.id, { full_name: p.full_name }]));
    }

    const logs = (rows ?? []).map((r) => ({
      id: r.id,
      action: r.action as string,
      entity_type: r.entity_type as string,
      entity_id: r.entity_id as string | null,
      user_id: r.user_id as string | null,
      user_name: r.user_id ? profiles[r.user_id]?.full_name ?? null : null,
      created_at: r.created_at as string,
      ip_address: canSeeDetails ? (r.ip_address as string | null) : null,
      old_values: canSeeDetails ? (r.old_values as any) : null,
      new_values: canSeeDetails ? (r.new_values as any) : null,
      metadata: r.metadata as any,
    }));
    const totalCount = total ?? logs.length;
    return { logs, canSeeDetails, total: totalCount, hasMore: offset + logs.length < totalCount, role };
  });

/* ----------------------- Client-driven audit logging ----------------------- */

const AuditActionEnum = z.enum([
  "pv.create","pv.update","pv.updated","pv.delete","pv.status_change",
  "pv.sent_to_client","pv.signed_by_client","pv.signed_by_company",
  "pv.pdf_generated","pv.pdf_downloaded","pv.email_sent","pv.email_failed",
  "reserve.create","reserve.update","reserve.delete","reserve.lifted","reserve.validated",
  "photo.add","photo.delete",
  "member.invited","member.joined","member.role_changed","member.suspended",
  "member.reactivated","member.removed",
  "audit.exported",
  "client.login_code_sent","client.login_success","client.login_failed","client.logout",
  "client.pv_viewed","client.pdf_downloaded","client.pv_signed",
  "client.session_revoked","client.all_sessions_revoked",
  "user.login_code_sent","user.login_success","user.login_failed","user.logout",
  "onboarding.started","onboarding.profile_completed","onboarding.company_lookup",
  "onboarding.company_completed","onboarding.completed","company.updated_from_siren",
  "company.branding_updated","company.logo_updated","company.legal_info_updated",
]);

const EntityTypeEnum = z.enum([
  "pv","reserve","photo","member","audit","auth","client","session",
]);

const SafeJson = z.record(z.string().min(1).max(64), z.unknown());

const LogSchema = z.object({
  pvId: z.string().uuid().optional().nullable(),
  companyId: z.string().uuid(),
  action: AuditActionEnum,
  entityType: EntityTypeEnum,
  entityId: z.string().uuid().optional().nullable(),
  oldValues: SafeJson.optional().nullable(),
  newValues: SafeJson.optional().nullable(),
  metadata: SafeJson.optional().nullable(),
});

/** Used by the client to log mutations performed via the Supabase JS SDK. */
export const logUserAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => LogSchema.parse(i))
  .handler(async ({ data, context }) => {
    // Verify caller is an active member of that company
    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("id")
      .eq("company_id", data.companyId)
      .eq("user_id", context.userId)
      .eq("status", "active")
      .maybeSingle();
    if (!m) throw new Error("Accès refusé.");
    await writeAuditLog({
      companyId: data.companyId,
      userId: context.userId,
      pvId: data.pvId ?? null,
      entityType: data.entityType,
      entityId: data.entityId ?? null,
      action: data.action as AuditAction,
      oldValues: data.oldValues ?? null,
      newValues: data.newValues ?? null,
      metadata: data.metadata ?? null,
      actor: "user",
    });
    return { ok: true };
  });

/* ------------------------- Export audit timeline PDF ------------------------- */

const ExportSchema = z.object({ pvId: z.string().uuid() });

export const exportPvAuditPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ExportSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { pv, role } = await assertPvAccess(data.pvId, context.userId);
    const canSeeDetails = role === "owner" || role === "admin";
    if (!canSeeDetails) {
      throw new Error("Seuls owner et admin peuvent exporter l'historique complet.");
    }
    if (pv.company_id) {
      const { assertSubscriptionUsable } = await import("./plan-guard.server");
      await assertSubscriptionUsable(pv.company_id, context.userId);
    }

    // Fetch the full PV record + related context
    const { data: fullPv } = await supabaseAdmin
      .from("pv")
      .select("id,numero,type,status,client_id,chantier_id,company_id")
      .eq("id", data.pvId)
      .maybeSingle();

    const [{ data: rows }, { data: company }, { data: client }, { data: chantier }, { data: exporter }] = await Promise.all([
      supabaseAdmin
        .from("audit_logs")
        .select("id,action,entity_type,user_id,old_values,new_values,metadata,created_at,ip_address")
        .eq("pv_id", data.pvId)
        .order("created_at", { ascending: true })
        .limit(5000),
      supabaseAdmin.from("companies").select("name,siret,address").eq("id", pv.company_id!).maybeSingle(),
      fullPv?.client_id
        ? supabaseAdmin.from("clients").select("name,email").eq("id", fullPv.client_id).maybeSingle()
        : Promise.resolve({ data: null as null | { name: string; email: string | null } }),
      fullPv?.chantier_id
        ? supabaseAdmin.from("chantiers").select("name,address").eq("id", fullPv.chantier_id).maybeSingle()
        : Promise.resolve({ data: null as null | { name: string; address: string | null } }),
      supabaseAdmin.from("profiles").select("full_name").eq("id", context.userId).maybeSingle(),
    ]);

    const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id).filter(Boolean) as string[]));
    let profiles: Record<string, string> = {};
    if (userIds.length) {
      const { data: pr } = await supabaseAdmin.from("profiles").select("id,full_name").in("id", userIds);
      profiles = Object.fromEntries((pr ?? []).map((p) => [p.id, p.full_name || ""]));
    }

    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const PAGE_W = 595, PAGE_H = 842, M = 48;
    let page = doc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - M;

    const sanitize = (s: string) =>
      s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[^\x00-\xff]/g, "?");

    const newPage = () => {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - M;
    };

    const draw = (text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number } = {}) => {
      const size = opts.size ?? 10;
      const f = opts.bold ? bold : font;
      const [r, g, b] = opts.color ?? [0.06, 0.09, 0.16];
      const x = M + (opts.indent ?? 0);
      const maxW = PAGE_W - M - x;
      const lines: string[] = [];
      const words = sanitize(text).split(/\s+/);
      let line = "";
      for (const w of words) {
        const test = line ? line + " " + w : w;
        if (f.widthOfTextAtSize(test, size) > maxW) {
          if (line) lines.push(line);
          line = w;
        } else line = test;
      }
      if (line) lines.push(line);
      for (const ln of lines) {
        if (y < M + 40) newPage();
        page.drawText(ln, { x, y, size, font: f, color: rgb(r, g, b) });
        y -= size + 3;
      }
    };

    // -------- Header (cover) --------
    draw(`${company?.name || "PVIA"} — Journal d'audit légal`, { size: 18, bold: true });
    if (company?.siret) draw(`SIRET : ${company.siret}`, { size: 9, color: [0.42, 0.45, 0.52] });
    if (company?.address) draw(company.address, { size: 9, color: [0.42, 0.45, 0.52] });
    y -= 6;
    draw(`PV n° ${pv.numero}`, { size: 13, bold: true });
    draw(`Type : ${fullPv?.type || "—"} · Statut : ${fullPv?.status || "—"}`, { size: 10, color: [0.42, 0.45, 0.52] });
    draw(`Client : ${client?.name || "—"}${client?.email ? ` (${client.email})` : ""}`, { size: 10 });
    draw(`Chantier : ${chantier?.name || "—"}${chantier?.address ? ` — ${chantier.address}` : ""}`, { size: 10 });
    y -= 4;
    draw(`Export effectué le ${new Date().toLocaleString("fr-FR")}`, { size: 9, color: [0.42, 0.45, 0.52] });
    draw(`Par : ${exporter?.full_name || "Utilisateur"} (rôle ${role})`, { size: 9, color: [0.42, 0.45, 0.52] });
    draw(`Total des événements : ${rows?.length ?? 0}`, { size: 9, color: [0.42, 0.45, 0.52] });
    y -= 8;
    page.drawLine({ start: { x: M, y }, end: { x: PAGE_W - M, y }, thickness: 0.5, color: rgb(0.86, 0.88, 0.91) });
    y -= 14;

    // -------- Timeline --------
    for (const r of rows ?? []) {
      const when = new Date(r.created_at as string).toLocaleString("fr-FR");
      const who = r.user_id ? profiles[r.user_id] || "Utilisateur" : "Système";
      // estimate space and break early to keep entries together
      if (y < M + 80) newPage();
      draw(`${when} — ${r.action}`, { size: 10, bold: true });
      draw(`Par : ${who} · ${r.entity_type}${r.ip_address ? ` · IP ${r.ip_address}` : ""}`, { size: 9, color: [0.42, 0.45, 0.52], indent: 6 });
      const meta = (r.metadata as any) || {};
      if (meta && Object.keys(meta).length) {
        draw(`Métadonnées : ${JSON.stringify(meta)}`, { size: 8, color: [0.45, 0.45, 0.55], indent: 6 });
      }
      if (r.old_values || r.new_values) {
        if (r.old_values) draw(`Avant : ${JSON.stringify(r.old_values).slice(0, 500)}`, { size: 8, color: [0.6, 0.2, 0.2], indent: 6 });
        if (r.new_values) draw(`Après : ${JSON.stringify(r.new_values).slice(0, 500)}`, { size: 8, color: [0.15, 0.4, 0.2], indent: 6 });
      }
      y -= 6;
    }

    // -------- Page numbers footer --------
    const pages = doc.getPages();
    const totalPages = pages.length;
    pages.forEach((p, idx) => {
      const txt = sanitize(`${company?.name || "PVIA"} · PV ${pv.numero} · Page ${idx + 1} / ${totalPages}`);
      p.drawText(txt, { x: M, y: 20, size: 8, font, color: rgb(0.55, 0.58, 0.63) });
    });

    const bytes = await doc.save();
    const path = `${pv.company_id}/pv/${pv.id}/audit-${Date.now()}.pdf`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("pv-assets")
      .upload(path, bytes, { contentType: "application/pdf", upsert: false });
    if (upErr) throw new Error(upErr.message);
    const { data: signed } = await supabaseAdmin.storage.from("pv-assets").createSignedUrl(path, 600);

    await writeAuditLog({
      companyId: pv.company_id,
      userId: context.userId,
      pvId: pv.id,
      entityType: "audit",
      action: "audit.exported",
      metadata: { path, total_events: rows?.length ?? 0 },
      actor: "user",
    });

    return { url: signed?.signedUrl ?? null, path };
  });

/* ============================================================================
 * Company-wide audit log: list + export
 * ========================================================================== */

async function assertCompanyAccess(companyId: string, userId: string) {
  const { data: m } = await supabaseAdmin
    .from("company_members")
    .select("id,role")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!m) throw new Error("Accès refusé.");
  return { role: m.role as string };
}

const ListCompanySchema = z.object({
  companyId: z.string().uuid(),
  category: z.string().optional(), // "pv" | "reserve" | "photo" | "member" | "audit" | "all"
  search: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

export const listCompanyAuditLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ListCompanySchema.parse(i))
  .handler(async ({ data, context }) => {
    const { role } = await assertCompanyAccess(data.companyId, context.userId);
    const canSeeDetails = role === "owner" || role === "admin";
    const limit = data.limit ?? 50;
    const offset = data.offset ?? 0;

    const applyFilters = (q: any) => {
      let r = q.eq("company_id", data.companyId);
      if (data.category && data.category !== "all") {
        r = r.like("action", `${data.category}.%`);
      }
      if (data.search && data.search.trim()) {
        const s = data.search.trim();
        r = r.or(`action.ilike.%${s}%,entity_type.ilike.%${s}%`);
      }
      return r;
    };

    const { count: total } = await applyFilters(
      supabaseAdmin.from("audit_logs").select("id", { count: "exact", head: true }),
    );

    const { data: rows, error } = await applyFilters(
      supabaseAdmin
        .from("audit_logs")
        .select("id,action,entity_type,entity_id,pv_id,user_id,old_values,new_values,metadata,created_at,ip_address"),
    )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);

    const userIds = Array.from(new Set((rows ?? []).map((r: any) => r.user_id).filter(Boolean) as string[]));
    const pvIds = Array.from(new Set((rows ?? []).map((r: any) => r.pv_id).filter(Boolean) as string[]));
    let profiles: Record<string, { full_name: string | null }> = {};
    let pvs: Record<string, { numero: string | null }> = {};
    if (userIds.length) {
      const { data: pr } = await supabaseAdmin.from("profiles").select("id,full_name").in("id", userIds);
      profiles = Object.fromEntries((pr ?? []).map((p) => [p.id, { full_name: p.full_name }]));
    }
    if (pvIds.length) {
      const { data: pp } = await supabaseAdmin.from("pv").select("id,numero").in("id", pvIds);
      pvs = Object.fromEntries((pp ?? []).map((p) => [p.id, { numero: p.numero }]));
    }

    const logs = (rows ?? []).map((r: any) => ({
      id: r.id,
      action: r.action as string,
      entity_type: r.entity_type as string,
      entity_id: r.entity_id as string | null,
      pv_id: r.pv_id as string | null,
      pv_numero: r.pv_id ? pvs[r.pv_id]?.numero ?? null : null,
      user_id: r.user_id as string | null,
      user_name: r.user_id ? profiles[r.user_id]?.full_name ?? null : null,
      created_at: r.created_at as string,
      ip_address: canSeeDetails ? (r.ip_address as string | null) : null,
      old_values: canSeeDetails ? r.old_values : null,
      new_values: canSeeDetails ? r.new_values : null,
      metadata: r.metadata,
    }));
    const totalCount = total ?? logs.length;
    return { logs, canSeeDetails, total: totalCount, hasMore: offset + logs.length < totalCount, role };
  });

const ExportCompanySchema = z.object({
  companyId: z.string().uuid(),
  category: z.string().optional(),
  search: z.string().max(200).optional(),
});

export const exportCompanyAuditPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ExportCompanySchema.parse(i))
  .handler(async ({ data, context }) => {
    const { role } = await assertCompanyAccess(data.companyId, context.userId);
    if (role !== "owner" && role !== "admin") {
      throw new Error("Seuls owner et admin peuvent exporter l'historique entreprise.");
    }

    const [{ data: company }, { data: exporter }] = await Promise.all([
      supabaseAdmin.from("companies").select("name,siret,address").eq("id", data.companyId).maybeSingle(),
      supabaseAdmin.from("profiles").select("full_name").eq("id", context.userId).maybeSingle(),
    ]);

    let q = supabaseAdmin
      .from("audit_logs")
      .select("id,action,entity_type,pv_id,user_id,old_values,new_values,metadata,created_at,ip_address")
      .eq("company_id", data.companyId);
    if (data.category && data.category !== "all") q = q.like("action", `${data.category}.%`);
    if (data.search && data.search.trim()) {
      const s = data.search.trim();
      q = q.or(`action.ilike.%${s}%,entity_type.ilike.%${s}%`);
    }
    const { data: rows } = await q.order("created_at", { ascending: true }).limit(10000);

    const userIds = Array.from(new Set((rows ?? []).map((r: any) => r.user_id).filter(Boolean) as string[]));
    const pvIds = Array.from(new Set((rows ?? []).map((r: any) => r.pv_id).filter(Boolean) as string[]));
    let profiles: Record<string, string> = {};
    let pvs: Record<string, string> = {};
    if (userIds.length) {
      const { data: pr } = await supabaseAdmin.from("profiles").select("id,full_name").in("id", userIds);
      profiles = Object.fromEntries((pr ?? []).map((p) => [p.id, p.full_name || ""]));
    }
    if (pvIds.length) {
      const { data: pp } = await supabaseAdmin.from("pv").select("id,numero").in("id", pvIds);
      pvs = Object.fromEntries((pp ?? []).map((p) => [p.id, p.numero || ""]));
    }

    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const PAGE_W = 595, PAGE_H = 842, M = 48;
    let page = doc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - M;
    const sanitize = (s: string) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[^\x00-\xff]/g, "?");
    const newPage = () => { page = doc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - M; };
    const draw = (text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number } = {}) => {
      const size = opts.size ?? 10;
      const f = opts.bold ? bold : font;
      const [r, g, b] = opts.color ?? [0.06, 0.09, 0.16];
      const x = M + (opts.indent ?? 0);
      const maxW = PAGE_W - M - x;
      const lines: string[] = [];
      const words = sanitize(text).split(/\s+/);
      let line = "";
      for (const w of words) {
        const test = line ? line + " " + w : w;
        if (f.widthOfTextAtSize(test, size) > maxW) { if (line) lines.push(line); line = w; } else line = test;
      }
      if (line) lines.push(line);
      for (const ln of lines) {
        if (y < M + 40) newPage();
        page.drawText(ln, { x, y, size, font: f, color: rgb(r, g, b) });
        y -= size + 3;
      }
    };

    const firstDate = rows?.[0]?.created_at ? new Date(rows[0].created_at as string).toLocaleDateString("fr-FR") : "—";
    const lastDate = rows?.length ? new Date(rows[rows.length - 1].created_at as string).toLocaleDateString("fr-FR") : "—";

    draw(`${company?.name || "PVIA"} — Historique entreprise`, { size: 18, bold: true });
    if (company?.siret) draw(`SIRET : ${company.siret}`, { size: 9, color: [0.42, 0.45, 0.52] });
    if (company?.address) draw(company.address, { size: 9, color: [0.42, 0.45, 0.52] });
    y -= 6;
    draw(`Période : ${firstDate} → ${lastDate}`, { size: 10 });
    draw(`Total événements : ${rows?.length ?? 0}`, { size: 10 });
    if (data.category && data.category !== "all") draw(`Filtre catégorie : ${data.category}`, { size: 10 });
    if (data.search) draw(`Recherche : "${data.search}"`, { size: 10 });
    draw(`Export effectué le ${new Date().toLocaleString("fr-FR")}`, { size: 9, color: [0.42, 0.45, 0.52] });
    draw(`Par : ${exporter?.full_name || "Utilisateur"} (rôle ${role})`, { size: 9, color: [0.42, 0.45, 0.52] });
    y -= 8;
    page.drawLine({ start: { x: M, y }, end: { x: PAGE_W - M, y }, thickness: 0.5, color: rgb(0.86, 0.88, 0.91) });
    y -= 14;

    for (const r of rows ?? []) {
      const when = new Date(r.created_at as string).toLocaleString("fr-FR");
      const who = r.user_id ? profiles[r.user_id as string] || "Utilisateur" : "Système";
      const pvLabel = r.pv_id ? ` · PV ${pvs[r.pv_id as string] || (r.pv_id as string).slice(0, 8)}` : "";
      if (y < M + 80) newPage();
      draw(`${when} — ${r.action}`, { size: 10, bold: true });
      draw(`Par : ${who} · ${r.entity_type}${pvLabel}${r.ip_address ? ` · IP ${r.ip_address}` : ""}`, { size: 9, color: [0.42, 0.45, 0.52], indent: 6 });
      const meta = (r.metadata as any) || {};
      if (meta && Object.keys(meta).length) {
        draw(`Métadonnées : ${JSON.stringify(meta)}`, { size: 8, color: [0.45, 0.45, 0.55], indent: 6 });
      }
      if (r.old_values) draw(`Avant : ${JSON.stringify(r.old_values).slice(0, 500)}`, { size: 8, color: [0.6, 0.2, 0.2], indent: 6 });
      if (r.new_values) draw(`Après : ${JSON.stringify(r.new_values).slice(0, 500)}`, { size: 8, color: [0.15, 0.4, 0.2], indent: 6 });
      y -= 6;
    }

    const pages = doc.getPages();
    const totalPages = pages.length;
    pages.forEach((p, idx) => {
      const txt = sanitize(`${company?.name || "PVIA"} · Historique entreprise · Page ${idx + 1} / ${totalPages}`);
      p.drawText(txt, { x: M, y: 20, size: 8, font, color: rgb(0.55, 0.58, 0.63) });
    });

    const bytes = await doc.save();
    const path = `${data.companyId}/company/audit-${Date.now()}.pdf`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("pv-assets")
      .upload(path, bytes, { contentType: "application/pdf", upsert: false });
    if (upErr) throw new Error(upErr.message);
    const { data: signed } = await supabaseAdmin.storage.from("pv-assets").createSignedUrl(path, 600);

    await writeAuditLog({
      companyId: data.companyId,
      userId: context.userId,
      entityType: "audit",
      action: "audit.exported",
      metadata: { scope: "company", path, total_events: rows?.length ?? 0, category: data.category ?? "all", search: data.search ?? null },
      actor: "user",
    });

    return { url: signed?.signedUrl ?? null, path };
  });

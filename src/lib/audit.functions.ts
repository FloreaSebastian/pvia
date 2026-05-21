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

const LogSchema = z.object({
  pvId: z.string().uuid().optional().nullable(),
  companyId: z.string().uuid(),
  action: z.string().min(1).max(64),
  entityType: z.string().min(1).max(64),
  entityId: z.string().uuid().optional().nullable(),
  oldValues: z.record(z.unknown()).optional().nullable(),
  newValues: z.record(z.unknown()).optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
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

    const [{ data: rows }, { data: company }] = await Promise.all([
      supabaseAdmin
        .from("audit_logs")
        .select("id,action,entity_type,user_id,old_values,new_values,metadata,created_at,ip_address")
        .eq("pv_id", data.pvId)
        .order("created_at", { ascending: true })
        .limit(2000),
      supabaseAdmin.from("companies").select("name").eq("id", pv.company_id!).maybeSingle(),
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
        if (y < M + 30) {
          page = doc.addPage([PAGE_W, PAGE_H]);
          y = PAGE_H - M;
        }
        page.drawText(ln, { x, y, size, font: f, color: rgb(r, g, b) });
        y -= size + 3;
      }
    };

    draw(`${company?.name || "PVIA"} — Journal d'audit légal`, { size: 16, bold: true });
    draw(`PV ${pv.numero}`, { size: 11, color: [0.42, 0.45, 0.52] });
    draw(`Exporté le ${new Date().toLocaleString("fr-FR")} · ${rows?.length ?? 0} événement(s)`, { size: 9, color: [0.42, 0.45, 0.52] });
    y -= 8;
    page.drawLine({ start: { x: M, y }, end: { x: PAGE_W - M, y }, thickness: 0.5, color: rgb(0.86, 0.88, 0.91) });
    y -= 14;

    for (const r of rows ?? []) {
      const when = new Date(r.created_at as string).toLocaleString("fr-FR");
      const who = r.user_id ? profiles[r.user_id] || "Utilisateur" : "Système";
      draw(`${when} — ${r.action}`, { size: 10, bold: true });
      draw(`Par : ${who} · ${r.entity_type}${canSeeDetails && r.ip_address ? ` · IP ${r.ip_address}` : ""}`, { size: 9, color: [0.42, 0.45, 0.52], indent: 6 });
      const meta = (r.metadata as any) || {};
      if (meta && Object.keys(meta).length) {
        draw(`Métadonnées : ${JSON.stringify(meta)}`, { size: 8, color: [0.45, 0.45, 0.55], indent: 6 });
      }
      if (canSeeDetails && (r.old_values || r.new_values)) {
        if (r.old_values) draw(`Avant : ${JSON.stringify(r.old_values).slice(0, 400)}`, { size: 8, color: [0.6, 0.2, 0.2], indent: 6 });
        if (r.new_values) draw(`Après : ${JSON.stringify(r.new_values).slice(0, 400)}`, { size: 8, color: [0.15, 0.4, 0.2], indent: 6 });
      }
      y -= 6;
    }

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
      metadata: { path },
      actor: "user",
    });

    return { url: signed?.signedUrl ?? null, path };
  });

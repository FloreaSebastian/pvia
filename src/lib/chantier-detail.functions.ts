/**
 * Server functions for the chantier detail page:
 * - getChantierDetail: summary + timeline + notes + documents
 * - CRUD for chantier_events, chantier_notes, chantier_documents
 * - listChantierEvents for the calendar view
 *
 * Writes require can_manage_company (owner/admin/manager). Deletes require
 * is_company_admin (owner/admin only) — enforced by RLS but pre-checked
 * here for clean error messages.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAuditLog } from "./audit.server";

async function assertCanManage(sb: SupabaseClient<Database>, companyId: string, userId: string) {
  const { data, error } = await sb.rpc("can_manage_company", { _company_id: companyId, _user_id: userId });
  if (error) throw new Error("Vérification des droits impossible.");
  if (data !== true) throw new Error("Droits insuffisants.");
}
async function assertIsAdmin(sb: SupabaseClient<Database>, companyId: string, userId: string) {
  const { data, error } = await sb.rpc("is_company_admin", { _company_id: companyId, _user_id: userId });
  if (error) throw new Error("Vérification des droits impossible.");
  if (data !== true) throw new Error("Droits insuffisants (admin requis).");
}

// ---------- getChantierDetail ----------
export const getChantierDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [chRes, evRes, ntRes, dcRes, pvRes, alRes] = await Promise.all([
      supabase.from("chantiers").select("*, client:clients(id,name,email,phone,address)").eq("id", data.id).eq("company_id", data.companyId).maybeSingle(),
      supabase.from("chantier_events").select("*").eq("chantier_id", data.id).order("start_at", { ascending: false, nullsFirst: false }).limit(200),
      supabase.from("chantier_notes").select("*").eq("chantier_id", data.id).order("created_at", { ascending: false }).limit(100),
      supabase.from("chantier_documents").select("*").eq("chantier_id", data.id).order("created_at", { ascending: false }).limit(100),
      supabase.from("pv").select("id,numero,status,type,created_at,signed_at,sent_to_client_at").eq("chantier_id", data.id).order("created_at", { ascending: false }).limit(50),
      supabase.from("audit_logs")
        .select("id,action,old_values,new_values,created_at")
        .eq("company_id", data.companyId)
        .eq("entity_type", "chantier")
        .eq("entity_id", data.id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (!chRes.data) throw new Error("Chantier introuvable.");
    const events = evRes.data ?? [];
    const total = events.length;
    const done = events.filter((e) => e.status === "termine").length;
    const progress = total > 0 ? Math.round((done / total) * 100) : 0;
    const now = Date.now();
    const upcoming = events
      .filter((e) => e.start_at && new Date(e.start_at).getTime() >= now && e.status !== "annule")
      .sort((a, b) => new Date(a.start_at!).getTime() - new Date(b.start_at!).getTime())[0] ?? null;
    const last = events
      .filter((e) => e.start_at && new Date(e.start_at).getTime() < now)
      .sort((a, b) => new Date(b.start_at!).getTime() - new Date(a.start_at!).getTime())[0] ?? null;

    // Reserves attached to any PV of this chantier
    const pvIds = (pvRes.data ?? []).map((p) => p.id);
    const rvRes = pvIds.length
      ? await supabase
          .from("pv_reserves")
          .select("id,pv_id,description,severity,status,priority,nature,work_to_execute,due_date,assigned_to,created_at,lifted_at,validated_at")
          .in("pv_id", pvIds)
          .order("created_at", { ascending: false })
          .limit(200)
      : { data: [] as Array<{ id: string; pv_id: string; description: string; severity: string; status: string; priority: string | null; nature: string | null; work_to_execute: string | null; due_date: string | null; assigned_to: string | null; created_at: string; lifted_at: string | null; validated_at: string | null }> };

    // Résolution des responsables (assigned_to → profile.full_name)
    const assigneeIds = Array.from(
      new Set(((rvRes.data ?? []) as any[]).map((r) => r.assigned_to).filter(Boolean)),
    ) as string[];
    const assigneeMap = new Map<string, string>();
    if (assigneeIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id,full_name")
        .in("id", assigneeIds);
      for (const p of (profs ?? []) as any[]) {
        if (p?.id && p?.full_name) assigneeMap.set(p.id, p.full_name);
      }
    }
    const reservesWithAssignee = ((rvRes.data ?? []) as any[]).map((r) => ({
      ...r,
      assigned_name: r.assigned_to ? (assigneeMap.get(r.assigned_to) || null) : null,
    }));

    return {
      chantier: chRes.data,
      events,
      notes: ntRes.data ?? [],
      documents: dcRes.data ?? [],
      pvs: pvRes.data ?? [],
      reserves: reservesWithAssignee,
      auditLogs: alRes.data ?? [],
      stats: { total, done, progress, upcoming, last },
    };
  });

// ---------- events ----------
const EventPayload = z.object({
  title: z.string().trim().min(1, "Titre requis").max(200),
  description: z.string().trim().max(5000).optional().default(""),
  event_type: z.string().trim().min(1).max(50),
  status: z.enum(["prevu", "en_cours", "termine", "annule", "reporte"]).default("prevu"),
  start_at: z.string().nullable().optional(),
  end_at: z.string().nullable().optional(),
  all_day: z.boolean().optional().default(false),
  assigned_to: z.string().uuid().nullable().optional(),
  reminder_at: z.string().nullable().optional(),
  location: z.string().trim().max(300).optional().default(""),
  color: z.string().trim().max(30).optional().default(""),
  color_source: z.enum(["auto", "manual"]).optional().default("auto"),
  client_id: z.string().uuid().nullable().optional(),
});


export const createChantierEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), chantierId: z.string().uuid(), data: EventPayload }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    const p = data.data;
    const { data: row, error } = await supabase.from("chantier_events").insert({
      company_id: data.companyId, chantier_id: data.chantierId, created_by: userId,
      title: p.title.trim(), description: p.description.trim() || null,
      event_type: p.event_type, status: p.status,
      start_at: p.start_at || null, end_at: p.end_at || null, all_day: p.all_day ?? false,
      assigned_to: p.assigned_to ?? null, reminder_at: p.reminder_at || null,
      location: p.location.trim() || null, color: p.color.trim() || null,
      color_source: p.color_source ?? "auto",
      client_id: p.client_id ?? null,
    }).select("id").single();
    if (error || !row) throw new Error(error?.message ?? "Création impossible.");
    await writeAuditLog({ companyId: data.companyId, userId, entityType: "chantier_event", entityId: row.id, action: "chantier_event.create", newValues: { ...p, chantier_id: data.chantierId } });
    return { ok: true, id: row.id as string };
  });

export const updateChantierEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), id: z.string().uuid(), data: EventPayload }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    const p = data.data;
    const { error } = await supabase.from("chantier_events").update({
      title: p.title.trim(), description: p.description.trim() || null,
      event_type: p.event_type, status: p.status,
      start_at: p.start_at || null, end_at: p.end_at || null, all_day: p.all_day ?? false,
      assigned_to: p.assigned_to ?? null, reminder_at: p.reminder_at || null,
      location: p.location.trim() || null, color: p.color.trim() || null,
      color_source: p.color_source ?? "auto",
      client_id: p.client_id ?? null,
      reminder_sent_at: null,
    }).eq("id", data.id).eq("company_id", data.companyId);

    if (error) throw new Error(error.message);
    await writeAuditLog({ companyId: data.companyId, userId, entityType: "chantier_event", entityId: data.id, action: "chantier_event.update", newValues: p });
    return { ok: true };
  });

export const deleteChantierEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertIsAdmin(supabase, data.companyId, userId);
    const { error } = await supabase.from("chantier_events").delete().eq("id", data.id).eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    await writeAuditLog({ companyId: data.companyId, userId, entityType: "chantier_event", entityId: data.id, action: "chantier_event.delete" });
    return { ok: true };
  });

// ---------- notes ----------
const NotePayload = z.object({
  note: z.string().trim().min(1, "Note requise").max(5000),
  visibility: z.enum(["internal", "client"]).default("internal"),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  reminder_at: z.string().nullable().optional(),
});

export const createChantierNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), chantierId: z.string().uuid(), data: NotePayload }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    const p = data.data;
    const { data: row, error } = await supabase.from("chantier_notes").insert({
      company_id: data.companyId, chantier_id: data.chantierId, created_by: userId,
      note: p.note.trim(), visibility: p.visibility, priority: p.priority,
      reminder_at: p.reminder_at || null,
    }).select("id").single();
    if (error || !row) throw new Error(error?.message ?? "Création impossible.");
    await writeAuditLog({ companyId: data.companyId, userId, entityType: "chantier_note", entityId: row.id, action: "chantier_note.create" });
    return { ok: true, id: row.id as string };
  });

export const updateChantierNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), id: z.string().uuid(), data: NotePayload }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    const p = data.data;
    const { error } = await supabase.from("chantier_notes").update({
      note: p.note.trim(), visibility: p.visibility, priority: p.priority,
      reminder_at: p.reminder_at || null,
    }).eq("id", data.id).eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    await writeAuditLog({ companyId: data.companyId, userId, entityType: "chantier_note", entityId: data.id, action: "chantier_note.update" });
    return { ok: true };
  });

export const deleteChantierNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertIsAdmin(supabase, data.companyId, userId);
    const { error } = await supabase.from("chantier_notes").delete().eq("id", data.id).eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    await writeAuditLog({ companyId: data.companyId, userId, entityType: "chantier_note", entityId: data.id, action: "chantier_note.delete" });
    return { ok: true };
  });

// ---------- documents ----------
const DocPayload = z.object({
  name: z.string().trim().min(1).max(300),
  file_url: z.string().trim().min(1).max(2000),
  storage_path: z.string().trim().max(500).optional().default(""),
  file_type: z.string().trim().max(100).optional().default(""),
  category: z.enum(["devis", "bon_commande", "photo", "plan", "pv", "facture", "autre"]).default("autre"),
});

export const createChantierDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), chantierId: z.string().uuid(), data: DocPayload }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    const p = data.data;
    const { data: row, error } = await supabase.from("chantier_documents").insert({
      company_id: data.companyId, chantier_id: data.chantierId, created_by: userId,
      name: p.name.trim(), file_url: p.file_url.trim(),
      storage_path: p.storage_path.trim() || null, file_type: p.file_type.trim() || null,
      category: p.category,
    }).select("id").single();
    if (error || !row) throw new Error(error?.message ?? "Création impossible.");
    await writeAuditLog({ companyId: data.companyId, userId, entityType: "chantier_document", entityId: row.id, action: "chantier_document.create" });
    return { ok: true, id: row.id as string };
  });

export const deleteChantierDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertIsAdmin(supabase, data.companyId, userId);
    const { data: doc } = await supabase.from("chantier_documents").select("storage_path").eq("id", data.id).eq("company_id", data.companyId).maybeSingle();
    const { error } = await supabase.from("chantier_documents").delete().eq("id", data.id).eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    if (doc?.storage_path) {
      await supabase.storage.from("pv-assets").remove([doc.storage_path]);
    }
    await writeAuditLog({ companyId: data.companyId, userId, entityType: "chantier_document", entityId: data.id, action: "chantier_document.delete" });
    return { ok: true };
  });

// ---------- list events (calendar) ----------
export const listChantierEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    companyId: z.string().uuid(),
    from: z.string().nullable().optional(),
    to: z.string().nullable().optional(),
    chantierId: z.string().uuid().nullable().optional(),
    clientId: z.string().uuid().nullable().optional(),
    eventType: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    assignedTo: z.string().uuid().nullable().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let q = supabase.from("chantier_events").select("*, chantier:chantiers(id,name,color), client:clients(id,name)")
      .eq("company_id", data.companyId).order("start_at", { ascending: true, nullsFirst: false }).limit(500);
    if (data.from) q = q.gte("start_at", data.from);
    if (data.to) q = q.lte("start_at", data.to);
    if (data.chantierId) q = q.eq("chantier_id", data.chantierId);
    if (data.clientId) q = q.eq("client_id", data.clientId);
    if (data.eventType) q = q.eq("event_type", data.eventType);
    if (data.status) q = q.eq("status", data.status);
    if (data.assignedTo) q = q.eq("assigned_to", data.assignedTo);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { events: rows ?? [] };
  });

// ---------- list company members (for assigned_to picker) ----------
export const listCompanyMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: mems, error } = await supabase
      .from("company_members")
      .select("user_id, role")
      .eq("company_id", data.companyId)
      .eq("status", "active");
    if (error) throw new Error(error.message);
    const ids = (mems ?? []).map((m) => m.user_id).filter((x): x is string => !!x);
    if (ids.length === 0) return { members: [] as { user_id: string; name: string; role: string }[] };
    const { data: profs } = await supabase
      .from("profiles").select("id, full_name, first_name, last_name").in("id", ids);
    const byId = new Map((profs ?? []).map((p) => [p.id, p]));
    const members = (mems ?? [])
      .filter((m) => m.user_id)
      .map((m) => {
        const p = byId.get(m.user_id as string);
        const name = (p?.full_name?.trim())
          || [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim()
          || "Membre";
        return { user_id: m.user_id as string, name, role: m.role as string };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return { members };
  });

// ---------- reschedule (drag-and-drop) ----------
export const rescheduleChantierEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    companyId: z.string().uuid(),
    id: z.string().uuid(),
    start_at: z.string(),
    end_at: z.string().nullable().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    const { data: prev } = await supabase.from("chantier_events")
      .select("start_at, end_at").eq("id", data.id).eq("company_id", data.companyId).maybeSingle();
    if (!prev) throw new Error("Événement introuvable.");
    const { error } = await supabase.from("chantier_events")
      .update({ start_at: data.start_at, end_at: data.end_at ?? null, reminder_sent_at: null })
      .eq("id", data.id).eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId, userId,
      entityType: "chantier_event", entityId: data.id,
      action: "chantier_event.rescheduled",
      oldValues: { start_at: prev.start_at, end_at: prev.end_at },
      newValues: { start_at: data.start_at, end_at: data.end_at ?? null },
    });
    return { ok: true };
  });

// ---------- resize (drag handle) ----------
export const resizeChantierEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    companyId: z.string().uuid(),
    id: z.string().uuid(),
    end_at: z.string(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    const { data: prev } = await supabase.from("chantier_events")
      .select("end_at").eq("id", data.id).eq("company_id", data.companyId).maybeSingle();
    if (!prev) throw new Error("Événement introuvable.");
    const { error } = await supabase.from("chantier_events")
      .update({ end_at: data.end_at, resized_at: new Date().toISOString(), reminder_sent_at: null })
      .eq("id", data.id).eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId, userId,
      entityType: "chantier_event", entityId: data.id,
      action: "chantier_event.resized",
      oldValues: { end_at: prev.end_at },
      newValues: { end_at: data.end_at },
    });
    return { ok: true };
  });

// ---------- duplicate ----------
export const duplicateChantierEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    const { data: src, error: errSrc } = await supabase.from("chantier_events")
      .select("*").eq("id", data.id).eq("company_id", data.companyId).maybeSingle();
    if (errSrc || !src) throw new Error("Événement source introuvable.");
    const { data: row, error } = await supabase.from("chantier_events").insert({
      company_id: src.company_id,
      chantier_id: src.chantier_id,
      client_id: src.client_id,
      created_by: userId,
      title: (src.title ?? "") + " (copie)",
      description: src.description,
      event_type: src.event_type,
      status: src.status,
      start_at: src.start_at,
      end_at: src.end_at,
      all_day: src.all_day,
      assigned_to: src.assigned_to,
      reminder_at: src.reminder_at,
      location: src.location,
      color: src.color,
      color_source: src.color_source,
      duplicated_from_event_id: src.id,
    }).select("id").single();

    if (error || !row) throw new Error(error?.message ?? "Duplication impossible.");
    await writeAuditLog({
      companyId: data.companyId, userId,
      entityType: "chantier_event", entityId: row.id as string,
      action: "chantier_event.duplicated",
      newValues: { source_id: src.id },
    });
    return { ok: true, id: row.id as string };
  });

// ---------- reassign (drag-and-drop team view) ----------
export const reassignChantierEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    companyId: z.string().uuid(),
    id: z.string().uuid(),
    assigned_to: z.string().uuid().nullable(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    // Verify assignee is an active member of the company (when provided)
    if (data.assigned_to) {
      const { data: mem } = await supabase
        .from("company_members")
        .select("user_id")
        .eq("company_id", data.companyId)
        .eq("user_id", data.assigned_to)
        .eq("status", "active")
        .maybeSingle();
      if (!mem) throw new Error("Membre invalide ou inactif.");
    }
    const { data: prev } = await supabase.from("chantier_events")
      .select("assigned_to").eq("id", data.id).eq("company_id", data.companyId).maybeSingle();
    if (!prev) throw new Error("Événement introuvable.");
    if (prev.assigned_to === data.assigned_to) return { ok: true, unchanged: true };
    const { error } = await supabase.from("chantier_events")
      .update({ assigned_to: data.assigned_to, reminder_sent_at: null })
      .eq("id", data.id).eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId, userId,
      entityType: "chantier_event", entityId: data.id,
      action: "chantier_event.reassigned",
      oldValues: { assigned_to: prev.assigned_to },
      newValues: { assigned_to: data.assigned_to },
    });
    return { ok: true };
  });

// ---------- detect conflicts ----------
export const detectChantierEventConflicts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    companyId: z.string().uuid(),
    assigned_to: z.string().uuid(),
    start_at: z.string(),
    end_at: z.string(),
    excludeId: z.string().uuid().nullable().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let q = supabase.from("chantier_events")
      .select("id, title, start_at, end_at, event_type, status, assigned_to")
      .eq("company_id", data.companyId)
      .eq("assigned_to", data.assigned_to)
      .neq("status", "annule")
      .lt("start_at", data.end_at)
      .gt("end_at", data.start_at);
    if (data.excludeId) q = q.neq("id", data.excludeId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const conflicts = (rows ?? []).filter((r) => !String(r.event_type ?? "").startsWith("system_"));
    return { conflicts };
  });

// ---------- conflict override audit ----------
export const logChantierEventConflictOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    companyId: z.string().uuid(),
    eventId: z.string().uuid().nullable().optional(),
    conflictingEventIds: z.array(z.string().uuid()).default([]),
    startAt: z.string(),
    endAt: z.string(),
    assignedTo: z.string().uuid().nullable().optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    if (data.eventId) {
      const { data: evt } = await supabase
        .from("chantier_events")
        .select("id")
        .eq("id", data.eventId)
        .eq("company_id", data.companyId)
        .maybeSingle();
      if (!evt) throw new Error("Événement introuvable.");
    }
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "chantier_event",
      entityId: data.eventId ?? null,
      action: "chantier_event.conflict_override",
      metadata: {
        event_id: data.eventId ?? null,
        conflicts_count: data.conflictingEventIds.length,
        conflicting_event_ids: data.conflictingEventIds,
        start_at: data.startAt,
        end_at: data.endAt,
        assigned_to: data.assignedTo ?? null,
      },
    });
    return { ok: true };
  });

// ---------- team workload ----------
export const getTeamWorkload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    companyId: z.string().uuid(),
    from: z.string(),
    to: z.string(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("chantier_events")
      .select("assigned_to, start_at, end_at, status, event_type")
      .eq("company_id", data.companyId)
      .gte("start_at", data.from)
      .lt("start_at", data.to)
      .not("assigned_to", "is", null);
    if (error) throw new Error(error.message);
    const map = new Map<string, { user_id: string; total_minutes: number; events: number }>();
    for (const r of rows ?? []) {
      if (!r.assigned_to || !r.start_at) continue;
      if (r.status === "annule") continue;
      if (String(r.event_type ?? "").startsWith("system_")) continue;
      const s = new Date(r.start_at).getTime();
      const e = r.end_at ? new Date(r.end_at).getTime() : s + 60 * 60000;
      const min = Math.max(0, Math.round((e - s) / 60000));
      const prev = map.get(r.assigned_to) ?? { user_id: r.assigned_to, total_minutes: 0, events: 0 };
      prev.total_minutes += min;
      prev.events += 1;
      map.set(r.assigned_to, prev);
    }
    return { workload: Array.from(map.values()) };
  });

// ---------- auto planning (P2.4) ----------
// Marqueur stable pour détecter les événements créés par le planning auto
// (évite d'ajouter une colonne dédiée à chantier_events).
const AUTO_PLAN_MARKER = "[auto-planning]";
const AUTO_PLAN_STEPS: { offsetDays: number; title: string; event_type: string; description: string }[] = [
  { offsetDays: 0,  title: "Visite technique",   event_type: "visite_technique",   description: "Visite technique initiale" },
  { offsetDays: 3,  title: "Validation devis",   event_type: "rappel",             description: "Validation du devis avec le client" },
  { offsetDays: 7,  title: "Commande matériel",  event_type: "livraison_materiel", description: "Commande du matériel nécessaire" },
  { offsetDays: 14, title: "Début travaux",      event_type: "debut_travaux",      description: "Démarrage des travaux sur site" },
  { offsetDays: 28, title: "Contrôle",           event_type: "controle_qualite",   description: "Contrôle qualité intermédiaire" },
  { offsetDays: 35, title: "Réception",          event_type: "reception",          description: "Réception du chantier" },
];

export const createChantierAutoPlanning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    companyId: z.string().uuid(),
    chantierId: z.string().uuid(),
    startDate: z.string().nullable().optional(),
    replace: z.boolean().optional().default(false),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    const { data: ch, error: chErr } = await supabase
      .from("chantiers")
      .select("id, company_id, client_id, start_date")
      .eq("id", data.chantierId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (chErr || !ch) throw new Error("Chantier introuvable.");

    // Anti-doublon : détecter un planning auto existant via marqueur dans la description
    const { data: existing } = await supabase
      .from("chantier_events")
      .select("id")
      .eq("company_id", data.companyId)
      .eq("chantier_id", data.chantierId)
      .like("description", `${AUTO_PLAN_MARKER}%`);
    const existingCount = existing?.length ?? 0;

    if (existingCount > 0 && !data.replace) {
      await writeAuditLog({
        companyId: data.companyId, userId,
        entityType: "chantier", entityId: data.chantierId,
        action: "chantier.auto_planning_blocked_duplicate",
        metadata: { existing_count: existingCount },
      });
      throw new Error("AUTO_PLANNING_EXISTS");
    }

    if (existingCount > 0 && data.replace) {
      const ids = (existing ?? []).map((e) => e.id);
      const { error: delErr } = await supabase
        .from("chantier_events").delete().in("id", ids).eq("company_id", data.companyId);
      if (delErr) throw new Error(delErr.message);
      await writeAuditLog({
        companyId: data.companyId, userId,
        entityType: "chantier", entityId: data.chantierId,
        action: "chantier.auto_planning_replaced",
        metadata: { deleted_count: ids.length },
      });
    }

    const baseStr = data.startDate || ch.start_date || new Date().toISOString();
    const base = new Date(baseStr);
    if (Number.isNaN(base.getTime())) throw new Error("Date de référence invalide.");
    base.setHours(9, 0, 0, 0);

    const rows = AUTO_PLAN_STEPS.map((s) => {
      const start = new Date(base);
      start.setDate(start.getDate() + s.offsetDays);
      const end = new Date(start);
      end.setHours(end.getHours() + 2);
      return {
        company_id: data.companyId,
        chantier_id: data.chantierId,
        client_id: ch.client_id,
        created_by: userId,
        title: s.title,
        description: `${AUTO_PLAN_MARKER} ${s.description}`,
        event_type: s.event_type,
        status: "prevu" as const,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        all_day: false,
      };
    });
    const { data: inserted, error } = await supabase
      .from("chantier_events").insert(rows).select("id");
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId, userId,
      entityType: "chantier", entityId: data.chantierId,
      action: "chantier.auto_planning_created",
      metadata: { count: inserted?.length ?? 0, base: base.toISOString(), replaced: existingCount > 0 },
    });
    return { ok: true, count: inserted?.length ?? 0, replaced: existingCount > 0 };
  });




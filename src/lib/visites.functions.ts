/**
 * Visites techniques — server functions.
 * Fichier « thin wrapper » : uniquement des imports et des déclarations de server functions.
 */
import { sniffImage } from "@/lib/visites/validation";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAuditLog } from "./audit.server";
import { assertPlanFeature } from "./plan-guard.server";
import { resolveVisitTemplate } from "./visites/templates";
import { findTemplateSlot, validateAnswerEntries, VISIT_PHOTO_EXT, VISIT_PHOTO_MAX_BYTES } from "./visites/validation";
import { friendlyVisitDbError } from "./visites/errors";
import { photoRefusal } from "./visites/photo-commit";
import {
  AnswerEntrySchema,
  ConstraintPayloadSchema,
  CreateVisitSchema,
  PhotoSkipReasonSchema,
  VisitFiltersSchema,
  VisitPhotoPayloadSchema,
  VisitPlanningSchema,
  VisitStatusSchema,
  VisitTypeSchema,
  VisitLotSchema,
  QuickClientSchema,
} from "./visites/schemas";
import {
  assertCanEditVisit,
  assertCanManage,
  assertIsMember,
  assertTransition,
  buildChantierName,
  composeAddress,
  findChantierDuplicates,
  loadVisitScoped,
  normalizeAddressKey,
  refreshVisitCompletion,
  signVisitPhotos,
  VISIT_BUCKET,
} from "./visites.server";

/** Liste paginée + compteurs KPI. */
export const listTechnicalVisits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => VisitFiltersSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertIsMember(supabase, data.companyId, userId);

    let q = supabase
      .from("technical_visits")
      .select(
        "id,reference,visit_type,lots,status,scheduled_at,completed_at,validated_at,completion_percent,assigned_to,created_at," +
          "chantier:chantiers(id,reference,name,address,city,postal_code),client:clients(id,name,company_name,client_type)",
        { count: "exact" },
      )
      .eq("company_id", data.companyId);

    if (!data.include_archived) q = q.neq("status", "archivee");
    if (data.visit_type) q = q.eq("visit_type", data.visit_type);
    if (data.lot) q = q.contains("lots", [data.lot]);
    if (data.status) q = q.eq("status", data.status);
    if (data.assigned_to) q = q.eq("assigned_to", data.assigned_to);
    if (data.chantier_id) q = q.eq("chantier_id", data.chantier_id);
    if (data.client_id) q = q.eq("client_id", data.client_id);
    if (data.from) q = q.gte("scheduled_at", `${data.from}T00:00:00Z`);
    if (data.to) q = q.lte("scheduled_at", `${data.to}T23:59:59Z`);

    const term = data.search.trim();
    let filtered: any[] = [];
    let total = 0;
    if (term) {
      // Recherche globale côté base sur tout le jeu de l'entreprise (RLS appliquée),
      // puis chargement des lignes de la page dans l'ordre retourné.
      const { data: hits, error: sErr } = await supabase.rpc("search_technical_visits", {
        _company_id: data.companyId,
        _term: term,
        _visit_type: data.visit_type ?? undefined,
        _status: data.status ?? undefined,
        _assigned_to: data.assigned_to ?? undefined,
        _chantier_id: data.chantier_id ?? undefined,
        _client_id: data.client_id ?? undefined,
        _from: data.from ?? undefined,
        _to: data.to ?? undefined,
        _include_archived: data.include_archived,
        _offset: data.offset,
        _limit: data.limit,
        _lot: data.lot ?? (null as never),
      });
      if (sErr) throw new Error("Recherche impossible pour le moment. Réessayez.");
      const ids = (hits ?? []).map((h) => h.id);
      total = Number(hits?.[0]?.total ?? 0);
      if (ids.length) {
        const { data: rows, error } = await q.in("id", ids);
        if (error) throw new Error("Lecture des visites impossible.");
        const byId = new Map((rows ?? []).map((r: any) => [r.id, r]));
        filtered = ids.map((id) => byId.get(id)).filter(Boolean);
      } else if (data.offset > 0) {
        // Page au-delà des résultats : on recompte pour garder un total exact.
        const { data: first } = await supabase.rpc("search_technical_visits", {
          _company_id: data.companyId, _term: term, _visit_type: data.visit_type ?? undefined, _status: data.status ?? undefined,
          _assigned_to: data.assigned_to ?? undefined, _chantier_id: data.chantier_id ?? undefined, _client_id: data.client_id ?? undefined,
          _from: data.from ?? undefined, _to: data.to ?? undefined, _include_archived: data.include_archived, _offset: 0, _limit: 1,
          _lot: data.lot ?? (null as never),
        });
        total = Number(first?.[0]?.total ?? 0);
      }
    } else {
      const { data: rows, error, count } = await q
        .order("scheduled_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .range(data.offset, data.offset + data.limit - 1);
      if (error) throw new Error("Lecture des visites impossible.");
      filtered = rows ?? [];
      total = count ?? filtered.length;
    }

    const { data: kpiRows } = await supabase
      .from("technical_visits")
      .select("status,scheduled_at")
      .eq("company_id", data.companyId)
      .neq("status", "archivee")
      .limit(5000);
    const today = new Date().toISOString().slice(0, 10);
    const kpis = {
      total: (kpiRows ?? []).length,
      a_planifier: (kpiRows ?? []).filter((r) => r.status === "a_planifier").length,
      aujourdhui: (kpiRows ?? []).filter((r) => (r.scheduled_at ?? "").slice(0, 10) === today).length,
      en_cours: (kpiRows ?? []).filter((r) => r.status === "en_cours" || r.status === "a_completer").length,
      a_valider: (kpiRows ?? []).filter((r) => r.status === "terminee").length,
    };

    return {
      visits: filtered,
      total,
      hasMore: total > data.offset + data.limit,
      kpis,
    };
  });

/** Visites d'un chantier (onglet de la fiche chantier). */
export const listChantierTechnicalVisits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), chantierId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertIsMember(supabase, data.companyId, userId);
    const { data: rows, error } = await supabase
      .from("technical_visits")
      .select("id,reference,visit_type,lots,status,scheduled_at,completed_at,validated_at,completion_percent,assigned_to,created_at")
      .eq("company_id", data.companyId)
      .eq("chantier_id", data.chantierId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { visits: rows ?? [] };
  });

/** Dossier complet d'une visite : réponses, photos signées, motifs, contraintes. */
export const getTechnicalVisit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), visitId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertIsMember(supabase, data.companyId, userId);

    const { data: visitRow, error } = await supabase
      .from("technical_visits")
      .select(
        "*,chantier:chantiers(id,reference,name,address,address_line1,postal_code,city,status,type)," +
          "client:clients(id,name,company_name,client_type,email,phone,address)",
      )
      .eq("id", data.visitId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!visitRow) throw new Error("Visite introuvable.");
    const visit = visitRow as unknown as Record<string, any>;

    const [answersRes, photosRes, skipsRes, constraintsRes, editableRes] = await Promise.all([
      supabase.from("technical_visit_answers").select("section_key,field_key,value,updated_at").eq("visit_id", data.visitId),
      supabase
        .from("technical_visit_photos")
        .select("id,section_key,slot_key,storage_path,caption,comment,latitude,longitude,taken_at,file_name,created_at,uploaded_by")
        .eq("visit_id", data.visitId)
        .order("created_at", { ascending: true }),
      supabase.from("technical_visit_photo_skips").select("id,section_key,slot_key,reason,justification").eq("visit_id", data.visitId),
      supabase
        .from("technical_visit_constraints")
        .select("id,section_key,category,level,title,description,recommendation,location,responsible,lot,photo_paths,created_at")
        .eq("visit_id", data.visitId)
        .order("created_at", { ascending: true }),
      supabase.rpc("can_edit_technical_visit", { _visit_id: data.visitId, _user_id: userId }),
    ]);

    const answers: Record<string, any> = {};
    const answerUpdatedAt: Record<string, string> = {};
    if (answersRes.error || photosRes.error || skipsRes.error || constraintsRes.error) {
      throw new Error("Lecture de la visite incomplète. Réessayez dans un instant.");
    }
    for (const a of answersRes.data ?? []) {
      answers[a.field_key] = a.value;
      answerUpdatedAt[a.field_key] = a.updated_at;
    }

    let assigneeName: string | null = null;
    if (visit.assigned_to) {
      const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", visit.assigned_to).maybeSingle();
      assigneeName = prof?.full_name ?? null;
    }

    return {
      visit,
      answers,
      answerUpdatedAt,
      photos: await signVisitPhotos(supabase, photosRes.data ?? []),
      skips: skipsRes.data ?? [],
      constraints: constraintsRes.data ?? [],
      assigneeName,
      canEdit: editableRes.data === true,
    };
  });

/** Détection de doublon avant création (appelée par l'étape Chantier du wizard). */
export const findVisitChantierDuplicates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        clientId: z.string().uuid(),
        visit_type: VisitTypeSchema,
        lots: z.array(VisitLotSchema).max(9).optional().default([]),
        address_line1: z.string().max(300).optional().default(""),
        postal_code: z.string().max(20).optional().default(""),
        city: z.string().max(150).optional().default(""),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertIsMember(supabase, data.companyId, userId);
    const tpl = resolveVisitTemplate({ visit_type: data.visit_type, lots: data.lots });
    if (!tpl) throw new Error("Type de visite inconnu.");
    const duplicates = await findChantierDuplicates(supabase, data.companyId, data.clientId, tpl, data);
    return { duplicates };
  });

/**
 * Création atomique de la visite (+ chantier auto si nécessaire + événement calendrier).
 * Idempotent via idempotency_key : une double soumission renvoie la visite existante.
 */
export const createTechnicalVisit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => CreateVisitSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    await assertPlanFeature(data.companyId, "technical_visits", userId);

    const { data: existing } = await supabase
      .from("technical_visits")
      .select("id,reference,chantier_id")
      .eq("company_id", data.companyId)
      .eq("idempotency_key", data.idempotency_key)
      .maybeSingle();
    if (existing) {
      return { ok: true as const, id: existing.id, reference: existing.reference, chantierId: existing.chantier_id, duplicates: [], reused: true };
    }

    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id,name,company_name,client_type,address,address_line1,postal_code,city,latitude,longitude")
      .eq("id", data.client_id)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (clientErr) throw new Error("Lecture du client impossible.");
    if (!client) throw new Error("Client introuvable.");

    const template = resolveVisitTemplate({ visit_type: data.visit_type, lots: data.lots });
    if (!template) throw new Error("Type de visite inconnu.");
    let newChantier: Record<string, unknown> | null = null;
    if (!data.chantier_id) {
      const nc = data.new_chantier ?? { name: "", address_line1: "", postal_code: "", city: "" };
      const address = {
        address_line1: nc.address_line1 || client.address_line1 || "",
        postal_code: nc.postal_code || client.postal_code || "",
        city: nc.city || client.city || "",
      };
      if (!data.force_new_chantier) {
        const duplicates = await findChantierDuplicates(supabase, data.companyId, client.id, template, address);
        if (duplicates.length > 0) {
          return { ok: false as const, reason: "duplicate_chantier" as const, duplicates };
        }
      }
      const clientLabel = (client.client_type === "entreprise" || client.client_type === "professionnel") ? client.company_name || client.name : client.name;
      newChantier = {
        name: (nc.name || buildChantierName(template, clientLabel ?? "")).slice(0, 200),
        type: template.chantierType,
        address: composeAddress(address.address_line1, address.postal_code, address.city) ?? client.address ?? null,
        address_line1: address.address_line1 || null,
        postal_code: address.postal_code || null,
        city: address.city || null,
        latitude: nc.latitude ?? client.latitude ?? null,
        longitude: nc.longitude ?? client.longitude ?? null,
      };
    }

    const planning = VisitPlanningSchema.parse(data.planning ?? {});
    // Une seule transaction en base : verrou sur la clé d'idempotence, contrôle
    // entreprise + client du chantier, création chantier/visite/événement. Toute
    // erreur annule l'ensemble : aucun chantier ni événement orphelin possible.
    const { data: res, error: rpcErr } = await supabase.rpc("create_technical_visit_atomic", {
      _company_id: data.companyId,
      _client_id: client.id,
      _visit_type: data.visit_type,
      _idempotency_key: data.idempotency_key,
      _chantier_id: data.chantier_id ?? (null as never),
      _new_chantier: (newChantier ?? {}) as never,
      _planning: planning as never,
      _event_title: `Visite technique ${template.label}`,
      _lots: template.lots ?? [],
    });
    if (rpcErr || !res) throw new Error(friendlyVisitDbError(rpcErr?.message, "Création de la visite impossible."));
    const out = res as { id: string; reference: string; chantier_id: string; chantier_created: boolean; reused: boolean };

    if (!out.reused) {
      if (out.chantier_created) {
        await writeAuditLog({
          companyId: data.companyId,
          userId,
          entityType: "chantier",
          entityId: out.chantier_id,
          action: "chantier.create",
          newValues: { name: newChantier?.name },
          metadata: { source: "visite_technique", visit_type: data.visit_type },
        });
      }
      await writeAuditLog({
        companyId: data.companyId,
        userId,
        entityType: "technical_visit",
        entityId: out.id,
        action: "visite.create",
        newValues: { reference: out.reference, visit_type: data.visit_type, lots: template.lots ?? [], chantier_id: out.chantier_id },
        metadata: { chantier_created: out.chantier_created, scheduled_at: planning.scheduled_at ?? null },
      });
    }

    return {
      ok: true as const,
      id: out.id,
      reference: out.reference,
      chantierId: out.chantier_id,
      chantierCreated: out.chantier_created,
      duplicates: [],
      reused: out.reused,
    };
  });

/** Mise à jour de la planification / du contexte de la visite. */
export const updateTechnicalVisit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ companyId: z.string().uuid(), visitId: z.string().uuid(), planning: VisitPlanningSchema }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    const prev = await loadVisitScoped(supabase, data.companyId, data.visitId);
    const template = resolveVisitTemplate(prev);
    if (!template) throw new Error("Type de visite inconnu.");
    const { data: res, error } = await supabase.rpc("update_technical_visit_planning", {
      _company_id: data.companyId,
      _visit_id: data.visitId,
      _planning: data.planning as never,
      _event_title: `Visite technique ${template.label}`,
    });
    if (error || !res) throw new Error(friendlyVisitDbError(error?.message, "Mise à jour de la planification impossible."));
    const out = res as { status: string; calendar_event_id: string | null; event_action: string };

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_visit",
      entityId: data.visitId,
      action: "visite.update",
      oldValues: { assigned_to: prev.assigned_to, scheduled_at: prev.scheduled_at, status: prev.status },
      newValues: { ...data.planning, status: out.status },
      metadata: { calendar: out.event_action },
    });
    return { ok: true, status: out.status, calendarEventId: out.calendar_event_id, calendar: out.event_action };
  });

/** Enregistrement des réponses (autosave terrain). Recalcule la complétude. */
export const saveVisitAnswers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        visitId: z.string().uuid(),
        entries: z.array(AnswerEntrySchema).min(1).max(400),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const visit = await assertCanEditVisit(supabase, data.companyId, data.visitId, userId);

    // Validation sémantique contre le modèle métier. Les entrées invalides sont
    // refusées une par une (erreur par champ) ; les valides sont enregistrées.
    // Les réponses déjà en base ne sont jamais supprimées.
    const tpl = resolveVisitTemplate(visit);
    if (!tpl) throw new Error("Type de visite inconnu.");
    const fieldErrors = validateAnswerEntries(tpl, data.entries);
    const rejected = new Set(fieldErrors.map((e) => e.field_key));
    const accepted = data.entries.filter((e) => !rejected.has(e.field_key));
    if (accepted.length === 0) {
      return { ok: false as const, fieldErrors, savedKeys: [] as string[], completion_percent: visit.completion_percent ?? 0 };
    }

    const rows = accepted.map((e) => ({
      visit_id: data.visitId,
      company_id: data.companyId,
      section_key: e.section_key,
      field_key: e.field_key,
      value: e.value,
    }));
    const { error } = await supabase
      .from("technical_visit_answers")
      .upsert(rows as never, { onConflict: "visit_id,field_key" });
    if (error) throw new Error("Enregistrement des réponses impossible. Réessayez.");

    const patch: Record<string, unknown> = {};
    if (visit.status === "planifiee" || visit.status === "a_planifier") {
      patch.status = "en_cours";
      patch.started_at = visit.started_at ?? new Date().toISOString();
    }
    if (Object.keys(patch).length) {
      await supabase.from("technical_visits").update(patch as never).eq("id", data.visitId);
      await writeAuditLog({
        companyId: data.companyId,
        userId,
        entityType: "technical_visit",
        entityId: data.visitId,
        action: "visite.started",
      });
    }

    const percent = await refreshVisitCompletion(supabase, data.visitId);
    return { ok: true as const, fieldErrors, savedKeys: accepted.map((e) => e.field_key), completion_percent: percent };
  });

/** Métadonnées d'une photo après upload direct dans le stockage. */
export const addVisitPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        visitId: z.string().uuid(),
        photo: VisitPhotoPayloadSchema,
        replace_photo_id: z.string().uuid().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const p = data.photo;
    const select = "id,storage_path,slot_key,section_key,caption,comment,created_at,taken_at,latitude,longitude,file_name,uploaded_by";
    const findByPath = async () => {
      const { data: r, error } = await supabase
        .from("technical_visit_photos")
        .select(select)
        .eq("visit_id", data.visitId)
        .eq("company_id", data.companyId)
        .eq("storage_path", p.storage_path)
        .maybeSingle();
      if (error) throw new Error("Vérification de la photo impossible. Réessayez.");
      return r as any;
    };
    // Ne supprime jamais un fichier déjà référencé par une photo (ni en cas de doute).
    const removeUpload = async () => {
      try {
        if (await findByPath()) return;
      } catch {
        return;
      }
      await supabase.storage.from(VISIT_BUCKET).remove([p.storage_path]).catch(() => undefined);
    };
    // Le chemin doit appartenir à cette entreprise, cette visite ET cet emplacement.
    const prefix = `${data.companyId}/visites/${data.visitId}/${p.slot_key}/`;
    if (!p.storage_path.startsWith(prefix) || p.storage_path.includes("..")) {
      throw photoRefusal("Chemin de stockage invalide.");
    }
    // Assertion d'accès : dépend de la base/du réseau et de l'état (panne, concurrence).
    // Une erreur ici n'est PAS un refus déterministe : on propage sans nettoyer le fichier
    // (il reste "incertain", jamais supprimé) et sans marqueur de refus.
    const visit = await assertCanEditVisit(supabase, data.companyId, data.visitId, userId);
    // Idempotence par chemin : une nouvelle tentative après réponse perdue renvoie la photo déjà enregistrée.
    const reuseRow = async (already: any) => {
      const [signed] = await signVisitPhotos(supabase, [already]);
      const percent = await refreshVisitCompletion(supabase, data.visitId);
      return { ok: true, photo: signed, completion_percent: percent, replaced: false, reused: true };
    };
    const reuse = async () => {
      const already = await findByPath();
      if (!already) throw new Error("Enregistrement de la photo incertain : rechargez la visite.");
      return reuseRow(already);
    };
    {
      const already = await findByPath();
      if (already) return reuseRow(already);
    }
    // Refus déterministe (même résultat pour tout appel concurrent du même fichier) : nettoyage autorisé.
    const fail = async (msg: string): Promise<never> => {
      await removeUpload();
      throw photoRefusal(msg);
    };
    // Refus dépendant de l'état (concurrence possible) : jamais de suppression du fichier.
    const failKeep = async (msg: string) => {
      const already = await findByPath().catch(() => null);
      if (already) return reuseRow(already);
      throw new Error(msg);
    };
    const hit = (() => { const t = resolveVisitTemplate(visit); return t ? findTemplateSlot(t, p.section_key, p.slot_key) : null; })();
    if (!hit) await fail("Emplacement photo inconnu pour cette étape.");
    if (!VISIT_PHOTO_EXT.test(p.storage_path)) await fail("Format non supporté : JPEG, PNG ou WebP uniquement.");
    if (p.file_size != null && p.file_size > VISIT_PHOTO_MAX_BYTES) await fail("Photo trop lourde (10 Mo maximum).");

    // Le fichier doit réellement exister dans le stockage.
    const dir = p.storage_path.slice(0, p.storage_path.lastIndexOf("/"));
    const fname = p.storage_path.slice(p.storage_path.lastIndexOf("/") + 1);
    const { data: listed } = await supabase.storage.from(VISIT_BUCKET).list(dir, { search: fname, limit: 5 });
    const obj = (listed ?? []).find((o) => o.name === fname);
    if (!obj) throw new Error("Fichier photo introuvable : renvoyez la photo.");
    const realSize = Number((obj.metadata as { size?: number } | null)?.size ?? p.file_size ?? 0);
    if (realSize > VISIT_PHOTO_MAX_BYTES) await fail("Photo trop lourde (10 Mo maximum).");
    // Contenu réel vérifié (signature JPEG/PNG/WebP) : un fichier renommé en .jpg est refusé.
    {
      const { data: blob, error: dlErr } = await supabase.storage.from(VISIT_BUCKET).download(p.storage_path);
      if (dlErr || !blob) throw new Error("Fichier photo illisible : renvoyez la photo.");
      const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
      if (!sniffImage(head)) await fail("Ce fichier n'est pas une image JPEG, PNG ou WebP valide.");
    }

    const { data: existing } = await supabase
      .from("technical_visit_photos")
      .select("id,storage_path")
      .eq("visit_id", data.visitId)
      .eq("company_id", data.companyId)
      .eq("slot_key", p.slot_key)
      .order("created_at", { ascending: true });

    const meta = {
      section_key: p.section_key,
      slot_key: p.slot_key,
      storage_path: p.storage_path,
      caption: p.caption ?? null,
      comment: p.comment ?? null,
      latitude: p.latitude ?? null,
      longitude: p.longitude ?? null,
      accuracy: p.accuracy ?? null,
      taken_at: p.taken_at ?? null,
      exif_metadata: p.exif_metadata ?? null,
      file_hash: p.file_hash ?? null,
      file_name: p.file_name ?? null,
      file_size: realSize || null,
      uploaded_by: userId,
    };
    let row: any = null;
    let replacedPath: string | null = null;
    if (data.replace_photo_id) {
      const target = (existing ?? []).find((e) => e.id === data.replace_photo_id);
      if (!target) return await failKeep("La photo à remplacer n'existe plus : rechargez la visite.");
      // Remplacement effectif : la ligne existante pointe vers le nouveau fichier.
      // En cas d'échec, l'ancienne photo reste intacte et le nouveau fichier est retiré.
      const { data: upd, error } = await supabase
        .from("technical_visit_photos")
        .update(meta as never)
        .eq("id", target!.id)
        .eq("company_id", data.companyId)
        .select(select)
        .single();
      if (error?.code === "23505") return await reuse();
      if (error || !upd) throw new Error("Remplacement de la photo impossible. L'ancienne photo est conservée.");
      row = upd;
      replacedPath = target!.storage_path;
    } else {
      if (!hit!.slot.multiple && (existing ?? []).length > 0) {
        return await failKeep("Cet emplacement accepte une seule photo : utilisez « Remplacer ».");
      }
      const { data: ins, error } = await supabase
        .from("technical_visit_photos")
        .insert({ ...meta, visit_id: data.visitId, company_id: data.companyId } as never)
        .select(select)
        .single();
      // Conflit d'unicité (appel concurrent du même chemin) : on relit la photo existante.
      if (error?.code === "23505") return await reuse();
      if (error || !ins) throw new Error("Enregistrement de la photo impossible.");
      row = ins;
    }

    if (replacedPath && replacedPath !== p.storage_path) {
      await supabase.storage.from(VISIT_BUCKET).remove([replacedPath]).catch(() => undefined);
    }
    await supabase.from("technical_visit_photo_skips").delete().eq("visit_id", data.visitId).eq("slot_key", p.slot_key);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_visit",
      entityId: data.visitId,
      action: replacedPath ? "visite.photo_replaced" : "visite.photo_added",
      metadata: { slot_key: p.slot_key, section_key: p.section_key },
    });

    const [signed] = await signVisitPhotos(supabase, [row]);
    const percent = await refreshVisitCompletion(supabase, data.visitId);
    return { ok: true, photo: signed, completion_percent: percent, replaced: !!replacedPath, reused: false };
  });

/** Réconciliation après réponse perdue : la photo de ce chemin est-elle enregistrée ? */
export const findVisitPhotoByPath = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ companyId: z.string().uuid(), visitId: z.string().uuid(), storagePath: z.string().min(1).max(600) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanEditVisit(supabase, data.companyId, data.visitId, userId);
    const { data: r, error } = await supabase
      .from("technical_visit_photos")
      .select("id")
      .eq("visit_id", data.visitId)
      .eq("company_id", data.companyId)
      .eq("storage_path", data.storagePath)
      .maybeSingle();
    if (error) throw new Error("Vérification de la photo impossible.");
    return { referenced: !!r };
  });

export const deleteVisitPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), visitId: z.string().uuid(), photoId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanEditVisit(supabase, data.companyId, data.visitId, userId);
    const { data: photo } = await supabase
      .from("technical_visit_photos")
      .select("id,storage_path,slot_key")
      .eq("id", data.photoId)
      .eq("visit_id", data.visitId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (!photo) throw new Error("Photo introuvable.");

    const { error } = await supabase.from("technical_visit_photos").delete().eq("id", data.photoId).eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    await supabase.storage.from(VISIT_BUCKET).remove([photo.storage_path]);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_visit",
      entityId: data.visitId,
      action: "visite.photo_deleted",
      metadata: { slot_key: photo.slot_key },
    });
    const percent = await refreshVisitCompletion(supabase, data.visitId);
    return { ok: true, completion_percent: percent };
  });

/** « Impossible à photographier » : motif obligatoire. */
export const skipVisitPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        visitId: z.string().uuid(),
        section_key: z.string().min(1).max(80),
        slot_key: z.string().min(1).max(160),
        reason: PhotoSkipReasonSchema,
        justification: z.string().trim().min(3, "Justification requise.").max(1000),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanEditVisit(supabase, data.companyId, data.visitId, userId);
    const { error } = await supabase
      .from("technical_visit_photo_skips")
      .upsert(
        {
          visit_id: data.visitId,
          company_id: data.companyId,
          section_key: data.section_key,
          slot_key: data.slot_key,
          reason: data.reason,
          justification: data.justification,
          created_by: userId,
        } as never,
        { onConflict: "visit_id,slot_key" },
      );
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_visit",
      entityId: data.visitId,
      action: "visite.photo_skipped",
      metadata: { slot_key: data.slot_key, reason: data.reason },
    });
    const percent = await refreshVisitCompletion(supabase, data.visitId);
    return { ok: true, completion_percent: percent };
  });

export const removeVisitPhotoSkip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), visitId: z.string().uuid(), slot_key: z.string().min(1).max(160) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanEditVisit(supabase, data.companyId, data.visitId, userId);
    const { error } = await supabase
      .from("technical_visit_photo_skips")
      .delete()
      .eq("visit_id", data.visitId)
      .eq("company_id", data.companyId)
      .eq("slot_key", data.slot_key);
    if (error) throw new Error(error.message);
    const percent = await refreshVisitCompletion(supabase, data.visitId);
    return { ok: true, completion_percent: percent };
  });

/** Création ou mise à jour d'une contrainte. */
export const saveVisitConstraint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ companyId: z.string().uuid(), visitId: z.string().uuid(), constraint: ConstraintPayloadSchema }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanEditVisit(supabase, data.companyId, data.visitId, userId);
    const c = data.constraint;
    // Une photo liée doit appartenir à cette visite (jamais un chemin arbitraire).
    const photoPaths = Array.from(new Set(c.photo_paths ?? []));
    if (photoPaths.length) {
      const { data: owned, error: ownErr } = await supabase
        .from("technical_visit_photos")
        .select("storage_path")
        .eq("visit_id", data.visitId)
        .eq("company_id", data.companyId)
        .in("storage_path", photoPaths);
      if (ownErr) throw new Error("Vérification des photos impossible. Réessayez.");
      if ((owned ?? []).length !== photoPaths.length) throw new Error("Une photo liée n'appartient pas à cette visite.");
    }
    const payload = {
      visit_id: data.visitId,
      company_id: data.companyId,
      section_key: c.section_key ?? null,
      category: c.category,
      level: c.level,
      title: c.title,
      description: c.description || null,
      recommendation: c.recommendation || null,
      location: c.location || null,
      responsible: c.responsible || null,
      lot: c.lot ?? null,
      photo_paths: photoPaths,
      created_by: userId,
    };

    if (c.id) {
      const { error } = await supabase
        .from("technical_visit_constraints")
        .update(payload as never)
        .eq("id", c.id)
        .eq("visit_id", data.visitId)
        .eq("company_id", data.companyId);
      if (error) throw new Error(error.message);
      await writeAuditLog({
        companyId: data.companyId,
        userId,
        entityType: "technical_visit",
        entityId: data.visitId,
        action: "visite.constraint_updated",
        metadata: { constraint_id: c.id, level: c.level },
      });
      await refreshVisitCompletion(supabase, data.visitId);
      return { ok: true, id: c.id };
    }

    const { data: row, error } = await supabase
      .from("technical_visit_constraints")
      .insert(payload as never)
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Enregistrement de la contrainte impossible.");
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_visit",
      entityId: data.visitId,
      action: "visite.constraint_added",
      metadata: { constraint_id: row.id, level: c.level, category: c.category },
    });
    await refreshVisitCompletion(supabase, data.visitId);
    return { ok: true, id: row.id as string };
  });

export const deleteVisitConstraint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), visitId: z.string().uuid(), constraintId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanEditVisit(supabase, data.companyId, data.visitId, userId);
    const { error } = await supabase
      .from("technical_visit_constraints")
      .delete()
      .eq("id", data.constraintId)
      .eq("visit_id", data.visitId)
      .eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_visit",
      entityId: data.visitId,
      action: "visite.constraint_deleted",
      metadata: { constraint_id: data.constraintId },
    });
    return { ok: true };
  });

/** Transitions de statut : démarrer, terminer, valider, réouvrir, archiver. */
export const setVisitStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ companyId: z.string().uuid(), visitId: z.string().uuid(), status: VisitStatusSchema }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const prev = await loadVisitScoped(supabase, data.companyId, data.visitId);
    assertTransition(prev.status, data.status);

    const isAssignee = prev.assigned_to === userId;
    const managerOnly = ["validee", "archivee", "planifiee"].includes(data.status) || prev.status === "validee";
    if (managerOnly || !isAssignee) {
      await assertCanManage(supabase, data.companyId, userId);
    } else {
      await assertCanEditVisit(supabase, data.companyId, data.visitId, userId);
    }

    if (data.status === "terminee") {
      const percent = await refreshVisitCompletion(supabase, data.visitId);
      if (percent < 100) throw new Error("Des éléments obligatoires sont manquants : complétez la visite avant de la clôturer.");
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status: data.status };
    if (data.status === "en_cours" && !prev.started_at) patch.started_at = now;
    if (data.status === "terminee") patch.completed_at = now;
    if (data.status === "validee") {
      patch.validated_at = now;
      patch.validated_by = userId;
      if (!prev.completed_at) patch.completed_at = now;
    }
    if (data.status === "en_cours" && prev.status === "validee") {
      patch.validated_at = null;
      patch.validated_by = null;
    }

    const { error } = await supabase.from("technical_visits").update(patch as never).eq("id", data.visitId).eq("company_id", data.companyId);
    if (error) throw new Error(error.message);

    const action =
      data.status === "terminee"
        ? "visite.completed"
        : data.status === "validee"
          ? "visite.validated"
          : data.status === "archivee"
            ? "visite.archived"
            : prev.status === "validee"
              ? "visite.reopened"
              : "visite.update";
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_visit",
      entityId: data.visitId,
      action,
      oldValues: { status: prev.status },
      newValues: { status: data.status },
    });
    return { ok: true, status: data.status };
  });

export const deleteTechnicalVisit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), visitId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    const visit = await loadVisitScoped(supabase, data.companyId, data.visitId);
    if (visit.status === "validee") throw new Error("Une visite validée ne peut pas être supprimée : archivez-la.");

    const { data: photos } = await supabase.from("technical_visit_photos").select("storage_path").eq("visit_id", data.visitId);
    const { error } = await supabase.from("technical_visits").delete().eq("id", data.visitId).eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    const paths = (photos ?? []).map((p) => p.storage_path);
    if (paths.length) await supabase.storage.from(VISIT_BUCKET).remove(paths);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_visit",
      entityId: data.visitId,
      action: "visite.deleted",
      oldValues: { reference: visit.reference, status: visit.status },
    });
    return { ok: true };
  });

/** Techniciens de l'entreprise (sélecteur d'assignation). */
export const listVisitAssignees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertIsMember(supabase, data.companyId, userId);
    const { data: members } = await supabase
      .from("company_members")
      .select("user_id,role")
      .eq("company_id", data.companyId)
      .eq("status", "active")
      .not("user_id", "is", null);
    const ids = (members ?? []).map((m) => m.user_id).filter(Boolean) as string[];
    if (ids.length === 0) return { assignees: [] };
    const { data: profiles } = await supabase.from("profiles").select("id,full_name").in("id", ids);
    const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name] as const));
    return {
      assignees: (members ?? [])
        .filter((m) => m.user_id)
        .map((m) => ({ id: m.user_id as string, name: nameById.get(m.user_id as string) ?? "Membre", role: m.role })),
    };
  });

/** Vérifie côté serveur qu'une adresse normalisée correspond (utilisé par les tests d'anti-doublon). */
export const previewChantierNameForVisit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), clientId: z.string().uuid(), visit_type: VisitTypeSchema, lots: z.array(VisitLotSchema).max(9).optional().default([]) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertIsMember(supabase, data.companyId, userId);
    const { data: client } = await supabase
      .from("clients")
      .select("name,company_name,client_type,address_line1,postal_code,city")
      .eq("id", data.clientId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (!client) throw new Error("Client introuvable.");
    const label = (client.client_type === "entreprise" || client.client_type === "professionnel") ? client.company_name || client.name : client.name;
    return {
      name: buildChantierName(resolveVisitTemplate({ visit_type: data.visit_type, lots: data.lots }) ?? { label: "Visite", chantierType: "Visite", type: "btp" }, label ?? ""),
      addressKey: normalizeAddressKey(client),
      address_line1: client.address_line1 ?? "",
      postal_code: client.postal_code ?? "",
      city: client.city ?? "",
    };
  });

/**
 * Création rapide d'un client depuis l'assistant de visite.
 * Anti-doublon : si un client actif de l'entreprise porte déjà cet e-mail ou ce
 * téléphone, il est renvoyé tel quel (jamais modifié ni dupliqué).
 */
export const quickCreateVisitClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => QuickClientSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);

    const email = data.email ? data.email.trim().toLowerCase() : null;
    const phone = data.phone ? data.phone.replace(/\s+/g, "") : null;
    const select = "id,name,company_name,client_type,address_line1,postal_code,city";

    // Deux requêtes paramétrées (pas de filtre `or` construit à partir de la saisie).
    for (const [col, val] of [["email", email], ["phone", phone]] as const) {
      if (!val) continue;
      const { data: existing } = await supabase
        .from("clients")
        .select(select)
        .eq("company_id", data.companyId)
        .is("archived_at", null)
        .eq(col, val)
        .limit(1)
        .maybeSingle();
      if (existing) return { client: existing, reused: true as const };
    }

    const isPro = data.client_type === "entreprise";
    const line1 = data.address_line1.trim();
    const postal = data.postal_code.trim();
    const city = data.city.trim();
    const { data: created, error } = await supabase
      .from("clients")
      .insert({
        company_id: data.companyId,
        owner_id: userId,
        client_type: data.client_type,
        name: data.name.trim(),
        company_name: isPro ? data.company_name?.trim() || data.name.trim() : null,
        email,
        phone,
        address_line1: line1 || null,
        postal_code: postal || null,
        city: city || null,
        address: composeAddress(line1, postal, city),
      } as never)
      .select(select)
      .single();
    if (error || !created) throw new Error("Création du client impossible. Vérifiez les informations saisies.");

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "client",
      entityId: (created as { id: string }).id,
      action: "client.create",
      metadata: { source: "visite_technique" },
    });
    return { client: created, reused: false as const };
  });

/**
 * Rapport PDF technique de la visite (téléchargement direct, rien n'est stocké).
 * Accès : membre actif de l'entreprise + formule incluant la visite technique.
 */
export const generateVisitReportPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), visitId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertIsMember(supabase, data.companyId, userId);
    await assertPlanFeature(data.companyId, "technical_visits", userId);
    // Contrôle d'appartenance via le client utilisateur (RLS) AVANT toute lecture privilégiée.
    await loadVisitScoped(supabase, data.companyId, data.visitId);
    const { buildVisitReportPdf } = await import("./visites-pdf.server");
    const { bytes, fileName } = await buildVisitReportPdf(data.companyId, data.visitId);
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_visit",
      entityId: data.visitId,
      action: "visite.report_pdf",
    });
    return { fileName, base64: Buffer.from(bytes).toString("base64") };
  });

/**
 * Ajout de lots à une visite BTP non clôturée (jamais de retrait).
 * Réponses et photos existantes conservées ; complétude recalculée sur le nouveau modèle.
 */
export const addVisitLots = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ companyId: z.string().uuid(), visitId: z.string().uuid(), lots: z.array(VisitLotSchema).min(1).max(9) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const visit = await assertCanEditVisit(supabase, data.companyId, data.visitId, userId);
    if (visit.visit_type !== "btp") throw new Error("Seules les visites BTP multi-lots acceptent des lots supplémentaires.");
    if (!["a_planifier", "planifiee", "en_cours", "a_completer"].includes(visit.status)) {
      throw new Error("Cette visite est terminée ou clôturée : ajout de lot impossible.");
    }
    const { data: lots, error } = await supabase.rpc("add_technical_visit_lots", {
      _company_id: data.companyId,
      _visit_id: data.visitId,
      _lots: data.lots,
    });
    if (error) throw new Error(friendlyVisitDbError(error.message, "Ajout du lot impossible. Réessayez."));
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_visit",
      entityId: data.visitId,
      action: "visite.update",
      oldValues: { lots: visit.lots },
      newValues: { lots },
    });
    const percent = await refreshVisitCompletion(supabase, data.visitId);
    return { ok: true as const, lots: (lots ?? []) as string[], completion_percent: percent };
  });

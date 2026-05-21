import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildAndStorePvPdf } from "./pdf.server";
import { writeAuditLog } from "./audit.server";

async function assertMember(companyId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("company_members")
    .select("id,role")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!data) throw new Error("Accès refusé.");
  return data;
}

async function getPvCompany(pvId: string) {
  const { data } = await supabaseAdmin
    .from("pv")
    .select("id,company_id,owner_id,numero,status")
    .eq("id", pvId)
    .maybeSingle();
  if (!data?.company_id) throw new Error("PV introuvable.");
  return data;
}

/* ------------------------------ Create draft ------------------------------ */

const CreateSchema = z.object({
  companyId: z.string().uuid(),
  chantierId: z.string().uuid().optional().nullable(),
  clientId: z.string().uuid().optional().nullable(),
});

export const createFieldDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => CreateSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await assertMember(data.companyId, userId);

    const now = new Date();
    const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, "");
    const suffix = String(now.getTime()).slice(-5);
    const numero = `PV-TERRAIN-${yyyymmdd}-${suffix}`;

    const { data: pv, error } = await supabaseAdmin
      .from("pv")
      .insert({
        company_id: data.companyId,
        owner_id: userId,
        chantier_id: data.chantierId ?? null,
        client_id: data.clientId ?? null,
        numero,
        type: "reception",
        status: "brouillon",
        is_field_draft: true,
        field_last_saved_at: now.toISOString(),
        reception_date: now.toISOString().slice(0, 10),
      })
      .select("id,numero")
      .single();
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId, userId, pvId: pv.id, entityType: "pv", entityId: pv.id,
      action: "pv.create",
      newValues: { numero: pv.numero, type: "reception", status: "brouillon", is_field_draft: true },
      metadata: { source: "field" }, actor: "user",
    });
    return { id: pv.id, numero: pv.numero };
  });

/* ------------------------------ Save draft ------------------------------ */

const SaveSchema = z.object({
  pvId: z.string().uuid(),
  patch: z.object({
    description: z.string().max(5000).optional(),
    observations: z.string().max(5000).optional(),
    reception_date: z.string().optional(),
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
    chantier_id: z.string().uuid().optional().nullable(),
    client_id: z.string().uuid().optional().nullable(),
  }),
});

export const saveFieldDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => SaveSchema.parse(i))
  .handler(async ({ data, context }) => {
    const pv = await getPvCompany(data.pvId);
    await assertMember(pv.company_id!, context.userId);
    const { error } = await supabaseAdmin
      .from("pv")
      .update({ ...data.patch, field_last_saved_at: new Date().toISOString() })
      .eq("id", data.pvId);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: pv.company_id, userId: context.userId, pvId: pv.id, entityType: "pv", entityId: pv.id,
      action: "pv.update", newValues: data.patch as any,
      metadata: { source: "field_autosave" }, actor: "user",
    });
    return { ok: true, savedAt: new Date().toISOString() };
  });

/* ------------------------------ Add photo ------------------------------ */

const PhotoSchema = z.object({
  pvId: z.string().uuid(),
  dataUrl: z.string().startsWith("data:image/").max(8_000_000),
  kind: z.enum(["avant", "apres", "reserve", "autre"]).default("autre"),
  caption: z.string().max(255).optional().nullable(),
});

export const addFieldPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => PhotoSchema.parse(i))
  .handler(async ({ data, context }) => {
    const pv = await getPvCompany(data.pvId);
    await assertMember(pv.company_id!, context.userId);

    const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(data.dataUrl);
    if (!m) throw new Error("Image invalide.");
    const ext = m[1].toLowerCase().startsWith("jp") ? "jpg" : m[1].toLowerCase() === "png" ? "png" : "webp";
    const mime = `image/${ext === "jpg" ? "jpeg" : ext}`;
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const fileName = `${crypto.randomUUID()}.${ext}`;
    const path = `${pv.company_id}/pv/${pv.id}/field/${fileName}`;

    const { error: upErr } = await supabaseAdmin.storage
      .from("pv-assets")
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (upErr) throw new Error(upErr.message);

    const { data: row, error: insErr } = await supabaseAdmin
      .from("pv_photos")
      .insert({
        pv_id: pv.id,
        company_id: pv.company_id,
        owner_id: context.userId,
        url: path,
        kind: data.kind,
        caption: data.caption ?? null,
      })
      .select("id,url,kind,caption,created_at")
      .single();
    if (insErr) throw new Error(insErr.message);

    const { data: signed } = await supabaseAdmin.storage
      .from("pv-assets")
      .createSignedUrl(path, 3600);

    return { photo: { ...row, signedUrl: signed?.signedUrl ?? null } };
  });

/* ------------------------------ Add reserve ------------------------------ */

const ReserveSchema = z.object({
  pvId: z.string().uuid(),
  description: z.string().min(1).max(2000),
  severity: z.enum(["mineure", "majeure", "bloquante"]).default("mineure"),
});

export const addFieldReserve = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ReserveSchema.parse(i))
  .handler(async ({ data, context }) => {
    const pv = await getPvCompany(data.pvId);
    await assertMember(pv.company_id!, context.userId);
    const { data: row, error } = await supabaseAdmin
      .from("pv_reserves")
      .insert({
        pv_id: pv.id,
        company_id: pv.company_id,
        owner_id: context.userId,
        description: data.description,
        severity: data.severity,
        status: "ouverte",
      })
      .select("id,description,severity,status,created_at")
      .single();
    if (error) throw new Error(error.message);
    return { reserve: row };
  });

/* ------------------------------ Sign field PV ------------------------------ */

const SignSchema = z.object({
  pvId: z.string().uuid(),
  companySignature: z.string().startsWith("data:image/").max(2_000_000),
  clientSignature: z.string().startsWith("data:image/").max(2_000_000),
  clientName: z.string().max(255).optional().nullable(),
});

export const signFieldPv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => SignSchema.parse(i))
  .handler(async ({ data, context }) => {
    const pv = await getPvCompany(data.pvId);
    await assertMember(pv.company_id!, context.userId);

    const { error } = await supabaseAdmin
      .from("pv")
      .update({
        company_signature: data.companySignature,
        client_signature: data.clientSignature,
        status: "signe",
        signed_at: new Date().toISOString(),
        is_field_draft: false,
        observations: data.clientName
          ? `Signé sur chantier par ${data.clientName}`
          : undefined,
      })
      .eq("id", data.pvId);
    if (error) throw new Error(error.message);

    try {
      await buildAndStorePvPdf(pv.id);
    } catch (e) {
      console.error("PDF generation after field sign failed:", e);
    }

    return { ok: true, pvId: pv.id };
  });

/* ------------------------------ List drafts ------------------------------ */

const ListSchema = z.object({ companyId: z.string().uuid() });

export const listFieldDrafts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ListSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertMember(data.companyId, context.userId);
    const { data: rows } = await supabaseAdmin
      .from("pv")
      .select("id,numero,description,field_last_saved_at,created_at,chantier_id,client_id")
      .eq("company_id", data.companyId)
      .eq("is_field_draft", true)
      .order("field_last_saved_at", { ascending: false, nullsFirst: false })
      .limit(50);
    return { drafts: rows ?? [] };
  });

/* ------------------------------ Get draft detail ------------------------------ */

const GetSchema = z.object({ pvId: z.string().uuid() });

export const getFieldDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => GetSchema.parse(i))
  .handler(async ({ data, context }) => {
    const pv = await getPvCompany(data.pvId);
    await assertMember(pv.company_id!, context.userId);

    const [{ data: full }, photosRes, reservesRes] = await Promise.all([
      supabaseAdmin
        .from("pv")
        .select("id,numero,status,description,observations,reception_date,latitude,longitude,chantier_id,client_id,field_last_saved_at,is_field_draft,company_signature,client_signature")
        .eq("id", data.pvId)
        .single(),
      supabaseAdmin.from("pv_photos").select("id,url,kind,caption,created_at").eq("pv_id", data.pvId).order("created_at"),
      supabaseAdmin.from("pv_reserves").select("id,description,severity,status,created_at").eq("pv_id", data.pvId).order("created_at"),
    ]);

    const photos = await Promise.all(
      (photosRes.data ?? []).map(async (p) => {
        const { data: s } = await supabaseAdmin.storage.from("pv-assets").createSignedUrl(p.url, 3600);
        return { ...p, signedUrl: s?.signedUrl ?? null };
      }),
    );

    return { pv: full, photos, reserves: reservesRes.data ?? [] };
  });

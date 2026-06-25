import { createServerFn } from "@tanstack/react-start";
import { isAdminRole } from "@/lib/roles";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "./audit.server";

const BUCKET = "company-logos";
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
};

// Magic-number sniffing to avoid trusting client-declared mime
function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

const InputSchema = z.object({
  companyId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1).max(100),
  base64: z.string().min(1).max(3_500_000),
  kind: z.enum(["logo", "icon"]).optional().default("logo"),
});

async function assertAdmin(companyId: string, userId: string) {
  const { data: m } = await supabaseAdmin
    .from("company_members")
    .select("role,status")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!m || !isAdminRole(m.role)) {
    throw new Error("Seuls les administrateurs peuvent modifier l'identité visuelle.");
  }
}

function extractStoragePath(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  const p = url.slice(idx + marker.length).split("?")[0];
  return p || null;
}

/**
 * Upload du logo OU de l'icône d'entreprise.
 * Le champ `kind` détermine la colonne mise à jour (`logo_url` / `icon_url`)
 * et le chemin storage (`{companyId}/branding/{logo|icon}-{ts}.{ext}`).
 */
export const uploadCompanyLogo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => InputSchema.parse(i))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const kind = data.kind ?? "logo";

    await assertAdmin(data.companyId, userId);
    const { assertSubscriptionUsable } = await import("./plan-guard.server");
    await assertSubscriptionUsable(data.companyId, userId);

    const declared = data.mimeType.toLowerCase();
    if (!ALLOWED.has(declared)) {
      throw new Error("Format non supporté (PNG, JPEG ou WebP).");
    }

    let bytes: Uint8Array;
    try {
      const buf = Buffer.from(data.base64, "base64");
      bytes = new Uint8Array(buf);
    } catch {
      throw new Error("Fichier invalide.");
    }
    if (bytes.length === 0) throw new Error("Fichier vide.");
    if (bytes.length > MAX_BYTES) throw new Error("Fichier trop volumineux (max 2 Mo).");

    const sniffed = sniffMime(bytes);
    if (!sniffed) throw new Error("Contenu non reconnu comme image.");
    const norm = (s: string) => (s === "image/jpg" ? "image/jpeg" : s);
    if (norm(sniffed) !== norm(declared)) {
      throw new Error("Le contenu du fichier ne correspond pas au type déclaré.");
    }

    const ext = EXT[declared] ?? "bin";
    const path = `${data.companyId}/branding/${kind}-${Date.now()}.${ext}`;

    const { error: upErr } = await supabaseAdmin
      .storage
      .from(BUCKET)
      .upload(path, bytes, {
        contentType: norm(declared),
        upsert: false,
        cacheControl: "31536000",
      });
    if (upErr) throw new Error(upErr.message);

    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    const publicUrl = pub.publicUrl;

    const column = kind === "icon" ? "icon_url" : "logo_url";

    const { data: prev } = await supabaseAdmin
      .from("companies")
      .select("logo_url,icon_url")
      .eq("id", data.companyId)
      .maybeSingle();

    const updatePayload = kind === "icon" ? { icon_url: publicUrl } : { logo_url: publicUrl };
    const { error: updErr } = await supabaseAdmin
      .from("companies")
      .update(updatePayload)
      .eq("id", data.companyId);
    if (updErr) throw new Error(updErr.message);

    // Best-effort cleanup of previous file (only if hosted in our bucket).
    const prevUrl = (prev as any)?.[column] as string | null | undefined;
    const prevPath = extractStoragePath(prevUrl);
    if (prevPath && prevPath !== path) {
      try {
        await supabaseAdmin.storage.from(BUCKET).remove([prevPath]);
      } catch { /* ignore */ }
    }

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "auth",
      action: kind === "icon" ? "company.icon_updated" : "company.logo_updated",
      metadata: { has_value: true, size: bytes.length, mime: norm(declared), kind },
      actor: "user",
    });

    return { url: publicUrl, kind };
  });

/** Suppression du logo ou de l'icône. */
const DeleteSchema = z.object({
  companyId: z.string().uuid(),
  kind: z.enum(["logo", "icon"]),
});

export const deleteCompanyVisual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => DeleteSchema.parse(i))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    await assertAdmin(data.companyId, userId);

    const column = data.kind === "icon" ? "icon_url" : "logo_url";
    void column;
    const { data: prev } = await supabaseAdmin
      .from("companies")
      .select("logo_url,icon_url")
      .eq("id", data.companyId)
      .maybeSingle();

    const clearPayload = data.kind === "icon" ? { icon_url: null } : { logo_url: null };
    const { error } = await supabaseAdmin
      .from("companies")
      .update(clearPayload)
      .eq("id", data.companyId);
    if (error) throw new Error(error.message);

    const prevPath = extractStoragePath((prev as any)?.[column]);
    if (prevPath) {
      try {
        await supabaseAdmin.storage.from(BUCKET).remove([prevPath]);
      } catch { /* ignore */ }
    }

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "auth",
      action: data.kind === "icon" ? "company.icon_deleted" : "company.logo_deleted",
      metadata: { kind: data.kind },
      actor: "user",
    });

    return { ok: true };
  });

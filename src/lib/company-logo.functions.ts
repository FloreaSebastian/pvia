import { createServerFn } from "@tanstack/react-start";
import { ADMIN_ROLES, OWNER_ROLES, SIGN_ROLES, isAdminRole, isManageRole } from "@/lib/roles";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "./audit.server";

const BUCKET = "company-logos";
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/svg+xml",
]);
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

// Magic-number sniffing to avoid trusting client-declared mime
function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  // SVG: leading whitespace then "<svg" or "<?xml"
  const head = new TextDecoder().decode(bytes.slice(0, 256)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  return null;
}

const InputSchema = z.object({
  companyId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1).max(100),
  // base64 string (without data: prefix), max ~3 MB encoded → ~2.25 MB decoded
  base64: z.string().min(1).max(3_500_000),
});

export const uploadCompanyLogo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => InputSchema.parse(i))
  .handler(async ({ data, context }) => {
    const userId = context.userId;

    // 1. Authorize: admin/owner only
    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("role,status")
      .eq("company_id", data.companyId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!m || (!isAdminRole(m.role))) {
      throw new Error("Seuls les administrateurs peuvent modifier le logo.");
    }
    const { assertSubscriptionUsable } = await import("./plan-guard.server");
    await assertSubscriptionUsable(data.companyId, userId);

    // 2. Validate declared mime
    const declared = data.mimeType.toLowerCase();
    if (!ALLOWED.has(declared)) {
      throw new Error("Format non supporté (PNG, JPEG, WebP ou SVG).");
    }

    // 3. Decode + size check
    let bytes: Uint8Array;
    try {
      const buf = Buffer.from(data.base64, "base64");
      bytes = new Uint8Array(buf);
    } catch {
      throw new Error("Fichier invalide.");
    }
    if (bytes.length === 0) throw new Error("Fichier vide.");
    if (bytes.length > MAX_BYTES) throw new Error("Logo trop volumineux (max 2 Mo).");

    // 4. Magic-number check (must match declared mime family)
    const sniffed = sniffMime(bytes);
    if (!sniffed) throw new Error("Contenu non reconnu comme image.");
    // Normalize jpg/jpeg
    const norm = (s: string) => (s === "image/jpg" ? "image/jpeg" : s);
    if (norm(sniffed) !== norm(declared)) {
      throw new Error("Le contenu du fichier ne correspond pas au type déclaré.");
    }

    // 5. Build deterministic path scoped to company
    const ext = EXT[declared] ?? "bin";
    const path = `${data.companyId}/logo-${Date.now()}.${ext}`;

    // 6. Upload via service-role
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

    // 7. Persist on companies + audit
    const { data: prev } = await supabaseAdmin
      .from("companies")
      .select("logo_url")
      .eq("id", data.companyId)
      .maybeSingle();

    const { error: updErr } = await supabaseAdmin
      .from("companies")
      .update({ logo_url: publicUrl })
      .eq("id", data.companyId);
    if (updErr) throw new Error(updErr.message);

    // Best-effort delete of previous logo if hosted in our bucket
    if (prev?.logo_url) {
      try {
        const marker = `/object/public/${BUCKET}/`;
        const idx = prev.logo_url.indexOf(marker);
        if (idx >= 0) {
          const oldPath = prev.logo_url.slice(idx + marker.length).split("?")[0];
          if (oldPath && oldPath !== path) {
            await supabaseAdmin.storage.from(BUCKET).remove([oldPath]);
          }
        }
      } catch { /* ignore */ }
    }

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "auth",
      action: "company.logo_updated",
      metadata: { has_logo: true, size: bytes.length, mime: norm(declared) },
      actor: "user",
    });

    return { url: publicUrl };
  });

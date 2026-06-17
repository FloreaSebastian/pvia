/**
 * Server-side PV status transitions.
 *
 * Replaces ad-hoc client-side `supabase.from("pv").update({ status })` calls.
 *
 * Rules (server-authoritative):
 *  - Manager / admin / owner only (no "user" role).
 *  - Locked PVs (signed) cannot be touched.
 *  - Status "signe" can NEVER be set manually here — only through the
 *    signature flows (createPv onsite or signPvByToken remote).
 *  - "en_attente" is reserved for the remote-signature flow.
 *  - Allowed manual transitions: brouillon ↔ archive.
 */
import { createServerFn } from "@tanstack/react-start";
import { ADMIN_ROLES, OWNER_ROLES, SIGN_ROLES, isAdminRole, isManageRole } from "@/lib/roles";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "./audit.server";

const Schema = z.object({
  pvId: z.string().uuid(),
  status: z.enum(["brouillon", "archive"]),
});

export const updatePvStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => Schema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    const { data: pv } = await supabaseAdmin
      .from("pv")
      .select("id,company_id,status,locked_at,numero")
      .eq("id", data.pvId)
      .maybeSingle();
    if (!pv) throw new Error("PV introuvable.");
    if (!pv.company_id) throw new Error("PV sans entreprise.");

    // Role check — manager/admin/owner only
    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("role")
      .eq("company_id", pv.company_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!m) throw new Error("Accès refusé.");
    if (!["owner", "admin", "manager"].includes(m.role as string)) {
      const err = new Error("Rôle insuffisant pour changer le statut.");
      (err as any).code = "ROLE_REQUIRED";
      throw err;
    }

    // Lock check
    if (pv.locked_at || pv.status === "signe") {
      const err = new Error("PV signé et verrouillé — statut non modifiable.");
      (err as any).code = "PV_LOCKED_SIGNED";
      throw err;
    }

    // Transition matrix — only brouillon ↔ archive permitted here.
    const allowed: Record<string, string[]> = {
      brouillon: ["archive"],
      archive: ["brouillon"],
    };
    const current = pv.status as string;
    if (!allowed[current]?.includes(data.status)) {
      const err = new Error(
        `Transition ${current} → ${data.status} non autorisée. ` +
        `Seules les transitions brouillon ↔ archive sont permises.`,
      );
      (err as any).code = "INVALID_STATUS_TRANSITION";
      throw err;
    }

    const { error } = await supabaseAdmin
      .from("pv")
      .update({ status: data.status } as never)
      .eq("id", pv.id);
    if (error) throw new Error(error.message);

    await writeAuditLog({
      companyId: pv.company_id,
      userId,
      pvId: pv.id,
      entityType: "pv",
      entityId: pv.id,
      action: "pv.status_changed",
      oldValues: { status: current },
      newValues: { status: data.status },
      metadata: { numero: pv.numero },
      actor: "user",
    });

    return { ok: true, status: data.status };
  });

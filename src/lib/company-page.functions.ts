import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isAdminRole } from "@/lib/roles";
import { writeAuditLog } from "./audit.server";

/* ---------------- Historique entreprise (audit logs) ---------------- */

const HistorySchema = z.object({ companyId: z.string().uuid(), limit: z.number().int().min(1).max(50).optional() });

export type CompanyHistoryEntry = {
  id: string;
  action: string;
  created_at: string;
  actor: string | null;
  metadata: Record<string, unknown> | null;
};

const TRACKED_ACTIONS = [
  "company.created",
  "company.verified",
  "company.synced_from_siren",
  "company.logo_updated",
  "company.contact_updated",
  "company.legal_info_updated",
  "company.official_fields_update_denied",
  "company.siret_change_attempt_blocked",
  "company.change_request_submitted",
  "onboarding.company_completed",
  "onboarding.completed",
];

export const getCompanyHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => HistorySchema.parse(i))
  .handler(async ({ data, context }): Promise<CompanyHistoryEntry[]> => {
    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("id")
      .eq("company_id", data.companyId)
      .eq("user_id", context.userId)
      .eq("status", "active")
      .maybeSingle();
    if (!m) throw new Error("Accès refusé.");

    const { data: rows } = await supabaseAdmin
      .from("audit_logs")
      .select("id,action,created_at,actor,metadata")
      .eq("company_id", data.companyId)
      .eq("entity_type", "auth")
      .in("action", TRACKED_ACTIONS)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 20);

    return (rows ?? []).map((r) => ({
      id: r.id as string,
      action: r.action as string,
      created_at: r.created_at as string,
      actor: (r.actor as string | null) ?? null,
      metadata: (r.metadata as Record<string, unknown> | null) ?? null,
    }));
  });

/* ---------------- Demande de changement d'entreprise ---------------- */

const ChangeRequestSchema = z.object({
  companyId: z.string().uuid(),
  newSiret: z.string().trim().regex(/^\d{14}$/, "SIRET attendu : 14 chiffres"),
  reason: z.string().trim().min(20, "Décrivez le motif (20 caractères min.)").max(2000),
});

export const requestCompanyChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ChangeRequestSchema.parse(i))
  .handler(async ({ data, context }) => {
    const userId = context.userId;

    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("role")
      .eq("company_id", data.companyId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!m || !isAdminRole(m.role)) {
      throw new Error("Seuls les administrateurs peuvent demander un changement d'entreprise.");
    }

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("name,siret,siren")
      .eq("id", data.companyId)
      .maybeSingle();

    const note = [
      `Demande de changement d'entreprise`,
      `Entreprise actuelle : ${company?.name ?? "—"}`,
      `SIRET actuel : ${company?.siret ?? company?.siren ?? "—"}`,
      `Nouveau SIRET souhaité : ${data.newSiret}`,
      ``,
      `Motif :`,
      data.reason,
    ].join("\n");

    const { error } = await supabaseAdmin.from("support_notes").insert({
      company_id: data.companyId,
      created_by: userId,
      note,
      visibility: "internal",
      type: "change_request",
      priority: "high",
      status: "open",
    });
    if (error) throw new Error(error.message);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "auth",
      action: "company.change_request_submitted",
      metadata: { current_siret: company?.siret ?? null, new_siret: data.newSiret },
      actor: "user",
    });

    return { ok: true };
  });

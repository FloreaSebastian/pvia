import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { deliverSignedPv } from "./email.server";
import { writeAuditLog } from "./audit.server";

const Schema = z.object({ pvId: z.string().uuid() });

/**
 * Manually re-send the signed PV PDF by email (client + company copy).
 * Requires an active member of the PV's company.
 */
export const sendSignedPvEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => Schema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: pv } = await supabaseAdmin
      .from("pv")
      .select("id,company_id,status,numero")
      .eq("id", data.pvId)
      .maybeSingle();
    if (!pv?.company_id) throw new Error("PV introuvable.");
    if (pv.status !== "signe") throw new Error("Le PV n'est pas signé.");

    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("id,role")
      .eq("company_id", pv.company_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!m) throw new Error("Accès refusé.");

    // EM-M2: prevent double-click / accidental rapid resends.
    const { assertNotRecentlySent } = await import("@/lib/email-throttle.server");
    await assertNotRecentlySent({
      emailType: "pv_signed",
      pvId: pv.id,
      windowSec: 60,
      label: "L'email du PV signé",
    });

    try {
      const res = await deliverSignedPv({ pvId: pv.id, trigger: "manual" });
      const anySent = res.client?.status === "sent" || res.company?.status === "sent";

      await writeAuditLog({
        companyId: pv.company_id,
        userId,
        pvId: pv.id,
        entityType: "pv",
        entityId: pv.id,
        action: "pv.signed_email_resent",
        metadata: {
          numero: (pv as any).numero ?? null,
          role: (m as any).role ?? null,
          client_status: res.client?.status ?? null,
          client_recipient: (res.client as any)?.recipient ?? null,
          company_status: res.company?.status ?? null,
          company_recipient: (res.company as any)?.recipient ?? null,
          trigger: "manual",
        },
        actor: "user",
      });

      return { ok: anySent, ...res };
    } catch (e: any) {
      await writeAuditLog({
        companyId: pv.company_id,
        userId,
        pvId: pv.id,
        entityType: "pv",
        entityId: pv.id,
        action: "pv.signed_email_resent_failed",
        metadata: { numero: (pv as any).numero ?? null, error: String(e?.message ?? e) },
        actor: "user",
      });
      throw e;
    }
  });

const ListSchema = z.object({ pvId: z.string().uuid() });

/** Returns the email history for a PV (for the auth'd UI). */
export const listPvEmailLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ListSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: pv } = await supabaseAdmin
      .from("pv")
      .select("id,company_id")
      .eq("id", data.pvId)
      .maybeSingle();
    if (!pv?.company_id) throw new Error("PV introuvable.");
    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("id")
      .eq("company_id", pv.company_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!m) throw new Error("Accès refusé.");

    const { data: logs } = await supabaseAdmin
      .from("email_logs")
      .select("id,recipient_email,email_type,status,error_message,subject,sent_at,created_at")
      .eq("pv_id", data.pvId)
      .order("created_at", { ascending: false })
      .limit(50);
    return { logs: logs ?? [] };
  });

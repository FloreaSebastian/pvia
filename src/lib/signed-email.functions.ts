import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { deliverSignedPv } from "./email.server";

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
      .select("id,company_id,status")
      .eq("id", data.pvId)
      .maybeSingle();
    if (!pv?.company_id) throw new Error("PV introuvable.");
    if (pv.status !== "signe") throw new Error("Le PV n'est pas signé.");

    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("id")
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

    const res = await deliverSignedPv({ pvId: pv.id, trigger: "manual" });
    const anySent = res.client?.status === "sent" || res.company?.status === "sent";
    return { ok: anySent, ...res };
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

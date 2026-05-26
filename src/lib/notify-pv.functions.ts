/** Server fns dedicated to notifying company members about PV lifecycle events.
 *  Called from the desktop PV creation flow (and any other client-side flow)
 *  to fan-out push notifications + write audit logs reliably from the server.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { firePushToCompany, sendPushToUser } from "./push.server";
import { writeAuditLog } from "./audit.server";

const PvCreatedSchema = z.object({
  pvId: z.string().uuid(),
  signed: z.boolean().optional().default(false),
});

/** Notify all company members (except the author) that a PV was created/signed. */
export const notifyPvCreated = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => PvCreatedSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { data: pv } = await supabaseAdmin
      .from("pv")
      .select("id,numero,company_id,owner_id")
      .eq("id", data.pvId)
      .maybeSingle();
    if (!pv?.company_id) return { ok: false };

    // Membership check — actor must belong to the PV's company
    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("id")
      .eq("company_id", pv.company_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!m) return { ok: false };

    const title = data.signed ? "PV signé" : "Nouveau PV";
    const body = data.signed
      ? `Le N° ${pv.numero} a été signé.`
      : `Le N° ${pv.numero} vient d'être créé.`;

    firePushToCompany(
      pv.company_id,
      {
        title,
        body,
        url: `/pv/${pv.id}`,
        tag: `pv-${pv.id}`,
        data: { kind: data.signed ? "pv.signed" : "pv.created", pvId: pv.id },
      },
      { excludeUserId: userId },
    );

    await writeAuditLog({
      companyId: pv.company_id,
      userId,
      pvId: pv.id,
      entityType: "pv",
      entityId: pv.id,
      action: "push.sent",
      metadata: { trigger: data.signed ? "pv.signed" : "pv.created", channel: "web_push" },
      actor: "push",
    });

    return { ok: true };
  });

/** Send a test push to the current user across all of their devices. */
export const sendTestPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const r = await sendPushToUser(context.userId, {
      title: "Test notification PVIA",
      body: "Si vous voyez ceci, vos notifications fonctionnent 🎉",
      tag: "test-push",
      data: { kind: "test" },
    });
    return r;
  });

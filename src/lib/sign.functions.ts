import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildAndStorePvPdf } from "./pdf.server";
import { deliverSignedPv } from "./email.server";

const PvIdSchema = z.object({
  pvId: z.string().uuid(),
  email: z.string().email().max(255),
});

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function renderSignEmail(opts: { companyName: string; clientName: string; pvNumero: string; signUrl: string; expiresAt: string }) {
  const { companyName, clientName, pvNumero, signUrl, expiresAt } = opts;
  const exp = new Date(expiresAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <tr><td style="padding:32px 40px;background:linear-gradient(135deg,#0f172a,#1e3a8a);color:#fff">
        <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:.7">PVIA · Signature électronique</div>
        <div style="font-size:24px;font-weight:600;margin-top:8px">Procès-verbal ${escapeHtml(pvNumero)} à signer</div>
      </td></tr>
      <tr><td style="padding:32px 40px">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6">Bonjour ${escapeHtml(clientName)},</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6"><strong>${escapeHtml(companyName)}</strong> vous transmet le procès-verbal <strong>${escapeHtml(pvNumero)}</strong> pour signature électronique.</p>
        <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#475569">Consultez le PV, les photos et réserves, puis apposez votre signature directement depuis votre navigateur — aucun compte n'est nécessaire.</p>
        <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#1e3a8a">
          <a href="${signUrl}" style="display:inline-block;padding:14px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:15px">Consulter et signer le PV →</a>
        </td></tr></table>
        <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;line-height:1.6">Ce lien est valable jusqu'au <strong>${exp}</strong>. Si le bouton ne fonctionne pas : <br><span style="color:#475569;word-break:break-all">${signUrl}</span></p>
      </td></tr>
      <tr><td style="padding:20px 40px;background:#f8fafc;color:#94a3b8;font-size:11px;text-align:center">© PVIA · Réception de travaux intelligente</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

export const sendPvToClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => PvIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    const { data: pv } = await supabaseAdmin
      .from("pv")
      .select("id,numero,company_id,client_id,owner_id")
      .eq("id", data.pvId)
      .maybeSingle();
    if (!pv) throw new Error("PV introuvable.");
    if (!pv.company_id) throw new Error("PV sans entreprise.");

    // Verify caller is member of company
    const { data: membership } = await supabaseAdmin
      .from("company_members")
      .select("id")
      .eq("company_id", pv.company_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!membership) throw new Error("Accès refusé.");

    const [{ data: company }, { data: client }] = await Promise.all([
      supabaseAdmin.from("companies").select("name").eq("id", pv.company_id!).maybeSingle(),
      pv.client_id
        ? supabaseAdmin.from("clients").select("name").eq("id", pv.client_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const expiresAt = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();

    const { error: updErr } = await supabaseAdmin
      .from("pv")
      .update({
        sign_token: token,
        sign_token_expires_at: expiresAt,
        sent_to_client_at: new Date().toISOString(),
        sent_to_email: data.email.toLowerCase(),
        status: "en_attente",
      })
      .eq("id", pv.id);
    if (updErr) throw new Error(updErr.message);

    const appUrl = (process.env.PUBLIC_APP_URL || "https://pvia.app").replace(/\/$/, "");
    const signUrl = `${appUrl}/sign/pv/${token}`;

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) throw new Error("RESEND_API_KEY manquant côté serveur.");

    const html = renderSignEmail({
      companyName: company?.name || "PVIA",
      clientName: client?.name || "Cher client",
      pvNumero: pv.numero,
      signUrl,
      expiresAt,
    });

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "PVIA <onboarding@resend.dev>",
        to: [data.email],
        subject: `${company?.name || "PVIA"} — PV ${pv.numero} à signer`,
        html,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Échec envoi email (${resp.status}): ${body}`);
    }

    return { ok: true, signUrl };
  });

const TokenSchema = z.object({ token: z.string().min(10).max(128) });

export const getPvByToken = createServerFn({ method: "POST" })
  .inputValidator((input) => TokenSchema.parse(input))
  .handler(async ({ data }) => {
    const { data: pv } = await supabaseAdmin
      .from("pv")
      .select("id,numero,type,status,reception_date,description,observations,client_signature,company_signature,signed_at,sign_token_expires_at,company_id,client_id,chantier_id")
      .eq("sign_token", data.token)
      .maybeSingle();
    if (!pv) return { valid: false as const, reason: "invalid" as const };
    if (pv.sign_token_expires_at && new Date(pv.sign_token_expires_at) < new Date())
      return { valid: false as const, reason: "expired" as const };
    if (pv.status === "signe" && pv.client_signature)
      return { valid: false as const, reason: "signed" as const, pvNumero: pv.numero };

    const [{ data: company }, clientRes, chantierRes, photosRes, reservesRes] = await Promise.all([
      supabaseAdmin.from("companies").select("name,address,phone,email,siret,logo_url").eq("id", pv.company_id!).maybeSingle(),
      pv.client_id
        ? supabaseAdmin.from("clients").select("name,email,address").eq("id", pv.client_id).maybeSingle()
        : Promise.resolve({ data: null }),
      pv.chantier_id
        ? supabaseAdmin.from("chantiers").select("name,address").eq("id", pv.chantier_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabaseAdmin.from("pv_photos").select("id,url,caption").eq("pv_id", pv.id),
      supabaseAdmin.from("pv_reserves").select("id,description,severity,status").eq("pv_id", pv.id).order("created_at"),
    ]);

    // Sign photo URLs (private bucket)
    const photos = await Promise.all(
      (photosRes.data ?? []).map(async (p) => {
        const { data: s } = await supabaseAdmin.storage.from("pv-assets").createSignedUrl(p.url, 3600);
        return { id: p.id, caption: p.caption, signedUrl: s?.signedUrl ?? null };
      }),
    );

    return {
      valid: true as const,
      pv: {
        id: pv.id,
        numero: pv.numero,
        type: pv.type,
        status: pv.status,
        reception_date: pv.reception_date,
        description: pv.description,
        observations: pv.observations,
        company_signature: pv.company_signature,
        expiresAt: pv.sign_token_expires_at,
      },
      company,
      client: (clientRes as any).data,
      chantier: (chantierRes as any).data,
      photos,
      reserves: reservesRes.data ?? [],
    };
  });

const SignSchema = z.object({
  token: z.string().min(10).max(128),
  signatureDataUrl: z.string().startsWith("data:image/").max(2_000_000),
});

export const signPvByToken = createServerFn({ method: "POST" })
  .inputValidator((input) => SignSchema.parse(input))
  .handler(async ({ data }) => {
    const { data: pv } = await supabaseAdmin
      .from("pv")
      .select("id,sign_token_expires_at,status,client_signature,company_id,owner_id,numero")
      .eq("sign_token", data.token)
      .maybeSingle();
    if (!pv) throw new Error("Lien invalide.");
    if (pv.sign_token_expires_at && new Date(pv.sign_token_expires_at) < new Date())
      throw new Error("Lien expiré.");
    if (pv.client_signature) throw new Error("PV déjà signé.");

    // Reissue the token as a short-lived download key (24h) so the client can fetch the
    // generated PDF immediately after signing without re-authenticating.
    const downloadKey = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const downloadExpires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

    const { error } = await supabaseAdmin
      .from("pv")
      .update({
        client_signature: data.signatureDataUrl,
        status: "signe",
        signed_at: new Date().toISOString(),
        sign_token: downloadKey,
        sign_token_expires_at: downloadExpires,
      })
      .eq("id", pv.id);
    if (error) throw new Error(error.message);

    // Persist a notification for the owner
    await supabaseAdmin.from("notifications").insert({
      company_id: pv.company_id!,
      user_id: pv.owner_id,
      type: "pv_signed_remote",
      title: "PV signé par le client",
      body: `Le PV ${pv.numero} a été signé électroniquement.`,
    });

    // Generate the final signed PDF and store it. Failure is non-fatal — the signature is
    // already persisted; the client just won't get an immediate download URL.
    try {
      await buildAndStorePvPdf(pv.id);
    } catch (e) {
      console.error("PDF generation failed after sign:", e);
    }

    return { ok: true, pvId: pv.id, downloadKey };
  });

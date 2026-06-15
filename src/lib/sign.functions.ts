import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildAndStorePvPdf } from "./pdf.server";
import { deliverSignedPv } from "./email.server";
import { writeAuditLog } from "./audit.server";
import { assertPlanFeature } from "./plan-guard.server";
import { firePushToCompany } from "./push.server";
import { enforceRateLimit, getClientIp } from "./rate-limit.server";
import { decodeAndValidateImage } from "./image-validate.server";
import { generateSignToken, sha256Hex, SIGN_CONSENT_TEXT_V1 } from "./sign-token.server";
import { sendOnsiteOtpEmail } from "./email.server";
import {
  createSignatureOtp,
  verifySignatureOtp,
  assertSignatureOtpVerified,
  maskEmail,
} from "./signature-otp.server";

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
    await enforceRateLimit({ bucket: "sign.send", key: userId, limit: 30, windowSec: 3600 });



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

    // Plan gate: remote signature is a Pro/Enterprise feature
    await assertPlanFeature(pv.company_id, "remote_sign");


    const [{ data: company }, { data: client }] = await Promise.all([
      supabaseAdmin.from("companies").select("name").eq("id", pv.company_id!).maybeSingle(),
      pv.client_id
        ? supabaseAdmin.from("clients").select("name").eq("id", pv.client_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const token = generateSignToken();
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();

    const { error: updErr } = await supabaseAdmin
      .from("pv")
      .update({
        // Raw token is NEVER persisted — only the SHA-256 hash. The raw
        // token is delivered to the client through the signed email link.
        sign_token: null,
        sign_token_hash: tokenHash,
        sign_token_expires_at: expiresAt,
        sent_to_client_at: new Date().toISOString(),
        sent_to_email: data.email.toLowerCase(),
        status: "en_attente",
      } as never)
      .eq("id", pv.id);
    if (updErr) throw new Error(updErr.message);

    const appUrl = (process.env.PUBLIC_APP_URL || "https://pvia.fr").replace(/\/$/, "");
    const signUrl = `${appUrl}/sign/pv/${token}`;

    const html = renderSignEmail({
      companyName: company?.name || "PVIA",
      clientName: client?.name || "Cher client",
      pvNumero: pv.numero,
      signUrl,
      expiresAt,
    });

    const { sendEmailWithRetryLog } = await import("@/lib/email-sender.server");
    const sendRes = await sendEmailWithRetryLog({
      emailType: "pv_sign_link",
      companyId: pv.company_id!,
      pvId: pv.id,
      retryable: true,
      payload: {
        from: process.env.RESEND_FROM_EMAIL || "PVIA <noreply@pvia.fr>",
        to: [data.email],
        subject: `${company?.name || "PVIA"} — N° ${pv.numero} à signer`,
        html,
      },
    });
    if (sendRes.status === "failed") {
      throw new Error(`Échec envoi email: ${sendRes.error ?? "inconnue"} (sera relancé automatiquement)`);
    }

    await writeAuditLog({
      companyId: pv.company_id,
      userId,
      pvId: pv.id,
      entityType: "pv",
      entityId: pv.id,
      action: "pv.sent_to_client",
      newValues: { sent_to_email: data.email.toLowerCase(), expires_at: expiresAt },
      metadata: { numero: pv.numero },
      actor: "user",
    });

    firePushToCompany(pv.company_id!, {
      title: "PV envoyé au client",
      body: `${pv.numero} → ${data.email.toLowerCase()}`,
      url: `/pv/${pv.id}`,
      tag: `pv-sent-${pv.id}`,
    }, { excludeUserId: userId });

    return { ok: true, signUrl };
  });

const TokenSchema = z.object({ token: z.string().min(10).max(128) });

export const getPvByToken = createServerFn({ method: "POST" })
  .inputValidator((input) => TokenSchema.parse(input))
  .handler(async ({ data }) => {
    const ip = getClientIp(getRequest());
    await enforceRateLimit({ bucket: "sign.get", key: `${ip}:${data.token.slice(0, 16)}`, limit: 30, windowSec: 60 });
    const tokenHash = await sha256Hex(data.token);
    const { data: pv } = await supabaseAdmin
      .from("pv")
      .select("id,numero,type,status,reception_date,description,observations,client_signature,company_signature,signed_at,sign_token_expires_at,company_id,client_id,chantier_id")
      .eq("sign_token_hash", tokenHash)
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
  consent: z.literal(true),
  // OTP obligatoire pour signature à distance (eIDAS — vérification d'identité)
  otpId: z.string().uuid(),
});

export const signPvByToken = createServerFn({ method: "POST" })
  .inputValidator((input) => SignSchema.parse(input))
  .handler(async ({ data }) => {
    const req = getRequest();
    const ip = getClientIp(req);
    const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 500);
    // Strict limit: 5 signature attempts / 10min per IP+token
    await enforceRateLimit({ bucket: "sign.submit", key: `${ip}:${data.token.slice(0, 16)}`, limit: 5, windowSec: 600 });
    // Validate signature image (magic bytes)
    decodeAndValidateImage(data.signatureDataUrl, { maxBytes: 2_000_000 });
    const tokenHash = await sha256Hex(data.token);
    const { data: pv } = await supabaseAdmin
      .from("pv")
      .select("id,sign_token_expires_at,status,client_signature,company_id,owner_id,numero")
      .eq("sign_token_hash", tokenHash)
      .maybeSingle();
    if (!pv) throw new Error("Lien invalide.");
    if (pv.sign_token_expires_at && new Date(pv.sign_token_expires_at) < new Date())
      throw new Error("Lien expiré.");
    if (pv.client_signature) throw new Error("PV déjà signé.");

    // OTP must exist, belong to this PV, and be verified (used_at set).
    const otp = await assertSignatureOtpVerified({
      otpId: data.otpId,
      expectedPvId: pv.id,
      expectedCompanyId: pv.company_id ?? undefined,
      expectedMode: "remote",
    });

    // Reissue the token as a short-lived download key (24h) so the client can fetch the
    // generated PDF immediately after signing without re-authenticating. The raw key is
    // returned ONCE in the response; only its hash is persisted.
    const downloadKey = generateSignToken();
    const downloadKeyHash = await sha256Hex(downloadKey);
    const downloadExpires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const nowIso = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from("pv")
      .update({
        client_signature: data.signatureDataUrl,
        status: "signe",
        signed_at: nowIso,
        sign_token: null,
        sign_token_hash: downloadKeyHash,
        sign_token_expires_at: downloadExpires,
        // eIDAS SES evidence — set ONLY during this en_attente → signe
        // transition; the pv_block_locked_changes trigger forbids them afterwards.
        client_signature_ip: ip || null,
        client_signature_user_agent: userAgent || null,
        consent_text: SIGN_CONSENT_TEXT_V1,
        consent_at: nowIso,
      } as never)
      .eq("id", pv.id);
    if (error) throw new Error(error.message);

    // Persist a notification for the owner
    await supabaseAdmin.from("notifications").insert({
      company_id: pv.company_id!,
      user_id: pv.owner_id,
      type: "pv_signed_remote",
      title: "PV signé par le client",
      body: `Le N° ${pv.numero} a été signé électroniquement.`,
    });

    await writeAuditLog({
      companyId: pv.company_id,
      userId: null,
      pvId: pv.id,
      entityType: "pv",
      entityId: pv.id,
      action: "pv.signed_by_client",
      newValues: { signed_at: new Date().toISOString(), status: "signe" },
      metadata: { numero: pv.numero, via: "public_token", ip, user_agent: userAgent, consent_text_version: "v1" },
      actor: "client",
    });

    // Notify all company members that the client signed remotely.
    firePushToCompany(pv.company_id!, {
      title: "PV signé par le client",
      body: `${pv.numero} vient d'être signé électroniquement.`,
      url: `/pv/${pv.id}`,
      tag: `pv-signed-${pv.id}`,
      requireInteraction: true,
    });


    // Generate the final signed PDF, then email it to the client (+ company copy). Both are
    // non-fatal — the signature itself is already persisted.
    try {
      await buildAndStorePvPdf(pv.id);
      await writeAuditLog({
        companyId: pv.company_id,
        pvId: pv.id,
        entityType: "pv",
        entityId: pv.id,
        action: "pv.pdf_generated",
        metadata: { trigger: "auto_after_sign" },
        actor: "pdf",
      });
      try {
        await deliverSignedPv({ pvId: pv.id, trigger: "auto" });
      } catch (e) {
        console.error("Signed PV email delivery failed:", e);
      }
    } catch (e) {
      console.error("PDF generation failed after sign:", e);
    }

    return { ok: true, pvId: pv.id, downloadKey };
  });


// ────────────────────────────────────────────────────────────────────────
// Remote-signature OTP (eIDAS — identity verification of the client signer)
// Public endpoints (no auth) — gated by token + IP rate limit.
// ────────────────────────────────────────────────────────────────────────

const RemoteOtpSendSchema = z.object({ token: z.string().min(10).max(128) });

export const sendRemoteClientOtp = createServerFn({ method: "POST" })
  .inputValidator((i) => RemoteOtpSendSchema.parse(i))
  .handler(async ({ data }) => {
    const ip = getClientIp(getRequest());
    await enforceRateLimit({
      bucket: "sign.otp.send",
      key: `${ip}:${data.token.slice(0, 16)}`,
      limit: 5,
      windowSec: 600,
    });
    const tokenHash = await sha256Hex(data.token);
    const { data: pv } = await supabaseAdmin
      .from("pv")
      .select("id,company_id,sent_to_email,sign_token_expires_at,client_signature,numero")
      .eq("sign_token_hash", tokenHash)
      .maybeSingle();
    if (!pv) throw new Error("Lien invalide.");
    if (pv.client_signature) throw new Error("PV déjà signé.");
    if (pv.sign_token_expires_at && new Date(pv.sign_token_expires_at) < new Date())
      throw new Error("Lien expiré.");
    const email = pv.sent_to_email;
    if (!email) throw new Error("Aucune adresse email cible.");

    const { id: otpId, code, expiresAt } = await createSignatureOtp({
      companyId: pv.company_id!,
      pvId: pv.id,
      email,
      mode: "remote",
    });

    const { data: company } = await supabaseAdmin
      .from("companies").select("name").eq("id", pv.company_id!).maybeSingle();

    await sendOnsiteOtpEmail({
      to: email,
      code,
      companyName: company?.name ?? "PVIA",
      companyId: pv.company_id!,
    });

    await writeAuditLog({
      companyId: pv.company_id,
      pvId: pv.id,
      entityType: "pv",
      entityId: pv.id,
      action: "pv.remote_otp_sent",
      metadata: { numero: pv.numero, email_masked: maskEmail(email) },
      actor: "client",
    });

    return { ok: true, otpId, expiresAt, emailMasked: maskEmail(email) };
  });

const RemoteOtpVerifySchema = z.object({
  token: z.string().min(10).max(128),
  otpId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
});

export const verifyRemoteClientOtp = createServerFn({ method: "POST" })
  .inputValidator((i) => RemoteOtpVerifySchema.parse(i))
  .handler(async ({ data }) => {
    const ip = getClientIp(getRequest());
    await enforceRateLimit({
      bucket: "sign.otp.verify",
      key: `${ip}:${data.otpId}`,
      limit: 10,
      windowSec: 600,
    });
    const tokenHash = await sha256Hex(data.token);
    const { data: pv } = await supabaseAdmin
      .from("pv")
      .select("id,company_id,numero,client_signature")
      .eq("sign_token_hash", tokenHash)
      .maybeSingle();
    if (!pv) throw new Error("Lien invalide.");
    if (pv.client_signature) throw new Error("PV déjà signé.");

    const otp = await verifySignatureOtp({
      otpId: data.otpId,
      code: data.code,
      expectedPvId: pv.id,
      expectedCompanyId: pv.company_id ?? undefined,
      expectedMode: "remote",
    });

    await writeAuditLog({
      companyId: pv.company_id,
      pvId: pv.id,
      entityType: "pv",
      entityId: pv.id,
      action: "pv.remote_otp_verified",
      metadata: { numero: pv.numero, email_masked: maskEmail(otp.email) },
      actor: "client",
    });

    return { ok: true, otpId: otp.id };
  });

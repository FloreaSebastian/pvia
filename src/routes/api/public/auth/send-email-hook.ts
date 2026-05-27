/**
 * Supabase Auth "Send Email" Hook.
 *
 * Intercepts ALL auth emails (signInWithOtp, signup, recovery, invite,
 * email_change, reauthentication) and sends our own branded PVIA email
 * in French via Resend. The default auth.lovable.cloud / Supabase email
 * is suppressed.
 *
 * Configure in Supabase Dashboard → Authentication → Hooks → Send Email Hook:
 *   URL    : https://pvia.fr/api/public/auth/send-email-hook
 *   Secret : value of SEND_EMAIL_HOOK_SECRET (format `v1,whsec_<base64>`)
 *
 * Signature scheme (standard-webhooks):
 *   headers: webhook-id, webhook-timestamp, webhook-signature
 *   signature = base64( HMAC-SHA256(secret_bytes, `${id}.${timestamp}.${body}`) )
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function verifySignature(opts: {
  rawSecret: string;
  id: string;
  timestamp: string;
  body: string;
  signatureHeader: string;
}): Promise<boolean> {
  // Secret format from Supabase: "v1,whsec_<base64>"
  let keyMaterial = opts.rawSecret;
  if (keyMaterial.startsWith("v1,whsec_")) keyMaterial = keyMaterial.slice("v1,whsec_".length);
  else if (keyMaterial.startsWith("whsec_")) keyMaterial = keyMaterial.slice("whsec_".length);
  let keyBytes: Uint8Array;
  try {
    keyBytes = b64ToBytes(keyMaterial);
  } catch {
    keyBytes = new TextEncoder().encode(keyMaterial);
  }
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = `${opts.id}.${opts.timestamp}.${opts.body}`;
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(payload));
  const expected = bytesToB64(new Uint8Array(sig));

  // Header may contain multiple signatures: "v1,<sig1> v1,<sig2>"
  const parts = opts.signatureHeader.split(" ");
  for (const p of parts) {
    const [version, value] = p.split(",");
    if (version === "v1" && value && timingSafeEqual(value, expected)) return true;
  }
  return false;
}

function renderOtpEmail(opts: { code: string; expiresMin: number }) {
  const { code, expiresMin } = opts;
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0"><tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <tr><td style="padding:28px 36px 8px">
        <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#1e40af;font-weight:600">PVIA · Connexion sécurisée</div>
        <div style="font-size:22px;font-weight:600;margin-top:10px;color:#0f172a">Votre code de connexion</div>
      </td></tr>
      <tr><td style="padding:8px 36px 0">
        <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#334155">
          Utilisez le code ci-dessous pour accéder à votre espace PVIA. Ne le partagez avec personne.
        </p>
        <div style="margin:24px 0;padding:22px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;text-align:center">
          <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:42px;letter-spacing:14px;font-weight:700;color:#1e40af">${escapeHtml(code)}</div>
          <div style="margin-top:10px;font-size:12px;color:#64748b">Valide ${expiresMin} minutes · usage unique</div>
        </div>
        <div style="margin:24px 0 0;padding:14px 16px;background:#fafafa;border-radius:10px;font-size:12px;color:#64748b;line-height:1.6">
          Si vous n'avez pas demandé ce code, ignorez simplement cet email — aucun accès n'a été créé.
        </div>
      </td></tr>
      <tr><td style="padding:20px 36px 28px;color:#94a3b8;font-size:11px;text-align:center;line-height:1.6">
        PVIA — Procès-verbaux de réception<br>
        Connexion sans mot de passe · sécurisée
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

function subjectFor(actionType: string): string {
  switch (actionType) {
    case "recovery":
      return "Réinitialisation de votre accès PVIA";
    case "invite":
      return "Invitation à rejoindre PVIA";
    case "email_change":
    case "email_change_current":
    case "email_change_new":
      return "Confirmation de changement d'email PVIA";
    case "reauthentication":
      return "Code de vérification PVIA";
    case "signup":
      return "Confirmez votre inscription PVIA";
    case "magiclink":
    default:
      return "Votre code de connexion PVIA";
  }
}

async function logSend(opts: {
  to: string;
  status: "sent" | "failed";
  error?: string;
  resendId?: string;
  emailType: string;
  subject: string;
}) {
  try {
    await supabaseAdmin.from("email_logs").insert({
      company_id: null,
      recipient_email: opts.to,
      email_type: opts.emailType,
      subject: opts.subject,
      status: opts.status,
      error_message: opts.error ?? null,
      resend_id: opts.resendId ?? null,
      payload: null,
      max_retries: 0,
      retries_count: 0,
      sent_at: opts.status === "sent" ? new Date().toISOString() : null,
    } as never);
  } catch {}
}

export const Route = createFileRoute("/api/public/auth/send-email-hook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.SEND_EMAIL_HOOK_SECRET;
        if (!secret) {
          return new Response(JSON.stringify({ error: "Hook secret not configured" }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }
        const id = request.headers.get("webhook-id");
        const ts = request.headers.get("webhook-timestamp");
        const sig = request.headers.get("webhook-signature");
        const body = await request.text();
        if (!id || !ts || !sig) {
          return new Response("Missing webhook headers", { status: 400 });
        }
        const ok = await verifySignature({
          rawSecret: secret, id, timestamp: ts, body, signatureHeader: sig,
        });
        if (!ok) {
          return new Response("Invalid signature", { status: 401 });
        }

        let parsed: any;
        try {
          parsed = JSON.parse(body);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const user = parsed?.user ?? {};
        const emailData = parsed?.email_data ?? {};
        const to: string | undefined = user?.email;
        const token: string | undefined = emailData?.token;
        const actionType: string = emailData?.email_action_type ?? "magiclink";
        if (!to || !token) {
          return new Response("Missing user.email or email_data.token", { status: 400 });
        }

        const resendKey = process.env.RESEND_API_KEY;
        const from = process.env.RESEND_FROM_EMAIL || "PVIA <noreply@pvia.fr>";
        const subject = subjectFor(actionType);
        const html = renderOtpEmail({ code: token, expiresMin: 10 });
        const emailType = `auth_${actionType}`;

        if (!resendKey) {
          await logSend({ to, status: "failed", error: "RESEND_API_KEY missing", emailType, subject });
          return new Response(JSON.stringify({ error: "RESEND_API_KEY missing" }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }

        try {
          const resp = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from, to: [to], subject, html }),
          });
          if (!resp.ok) {
            const errBody = (await resp.text().catch(() => "")).slice(0, 500);
            const err = `Resend ${resp.status}: ${errBody}`;
            await logSend({ to, status: "failed", error: err, emailType, subject });
            return new Response(JSON.stringify({ error: err }), {
              status: 502, headers: { "Content-Type": "application/json" },
            });
          }
          const j = (await resp.json().catch(() => ({}))) as { id?: string };
          await logSend({ to, status: "sent", resendId: j.id, emailType, subject });
          return new Response(JSON.stringify({ ok: true }), {
            status: 200, headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await logSend({ to, status: "failed", error: msg, emailType, subject });
          return new Response(JSON.stringify({ error: msg }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});

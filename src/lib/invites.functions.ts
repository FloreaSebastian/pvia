import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "./audit.server";
import { assertCanAddMember } from "./plan-guard.server";
import { firePushToCompany } from "./push.server";
import { enforceRateLimit, getClientIp } from "./rate-limit.server";
import { getPublicAppUrl } from "./app-url.server";
import {
  INVITE_PASSWORD_MIN,
  INVITE_TOKEN_RE,
  InviteError,
  acceptInviteCore,
  inviteOpenState,
  inviteRoleLabel,
  inviteSignupCore,
  normalizeInviteEmail,
  prepareInvite,
  type InviteRow,
} from "./invite-core";

const INVITE_COLS =
  "id,company_id,role,status,user_id,invited_email,invite_expires_at,invite_token_hash";

const InviteSchema = z.object({
  companyId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email("Adresse email invalide.").max(255),
  role: z.enum([
    "responsable_exploitation",
    "conducteur_travaux",
    "technicien",
    "assistant_admin",
    "lecture_seule",
  ]),
});

export async function sha256HexToken(token: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function findInviteByHash(hash: string): Promise<InviteRow | null> {
  const { data, error } = await supabaseAdmin
    .from("company_members")
    .select(INVITE_COLS)
    .eq("invite_token_hash" as never, hash)
    .maybeSingle();
  if (error) throw new Error("Lecture de l'invitation impossible.");
  return (data as unknown as InviteRow) ?? null;
}

function renderEmail(opts: { companyName: string; inviterName: string; roleLabel: string; acceptUrl: string }) {
  const { companyName, inviterName, roleLabel, acceptUrl } = opts;
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)">
        <tr><td style="padding:32px 40px;background:linear-gradient(135deg,#0f172a,#1e3a8a);color:#fff">
          <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:.7">PVIA</div>
          <div style="font-size:24px;font-weight:600;margin-top:8px">Vous êtes invité à rejoindre ${escapeHtml(companyName)}</div>
        </td></tr>
        <tr><td style="padding:32px 40px">
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6"><strong>${escapeHtml(inviterName)}</strong> vous invite à rejoindre l'espace <strong>${escapeHtml(companyName)}</strong> sur PVIA en tant que <strong>${escapeHtml(roleLabel)}</strong>.</p>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#475569">PVIA est la plateforme de procès-verbaux de réception de travaux pour les entreprises du BTP. Signature électronique, photos, réserves et PDF — tout en un.</p>
          <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#1e3a8a">
            <a href="${acceptUrl}" style="display:inline-block;padding:14px 28px;color:#fff;text-decoration:none;font-weight:600;font-size:15px">Rejoindre PVIA →</a>
          </td></tr></table>
          <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;line-height:1.6">Ce lien est valable 7 jours et remplace tout lien d'invitation précédent. Si le bouton ne fonctionne pas, copiez ce lien : <br><span style="color:#475569;word-break:break-all">${acceptUrl}</span></p>
        </td></tr>
        <tr><td style="padding:20px 40px;background:#f8fafc;color:#94a3b8;font-size:11px;text-align:center">
          © PVIA · Réception de travaux intelligente
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export const sendInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InviteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    await enforceRateLimit({ bucket: "invite.send", key: userId, limit: 20, windowSec: 3600 });
    await enforceRateLimit({
      bucket: "invite.send.email",
      key: `${userId}:${data.email}`,
      limit: 3,
      windowSec: 3600,
    });

    let prepared: Awaited<ReturnType<typeof prepareInvite>>;
    try {
      prepared = await prepareInvite(
        {
          getCallerMembership: async (companyId, uid) => {
            const { data: m } = await supabaseAdmin
              .from("company_members")
              .select("role,status")
              .eq("company_id", companyId)
              .eq("user_id", uid)
              .maybeSingle();
            return m ?? null;
          },
          hasWriteAccess: async (companyId) => {
            const { data: ok, error } = await supabaseAdmin.rpc("company_has_write_access", {
              _company_id: companyId,
            });
            return !error && ok === true;
          },
          isExistingMemberEmail: async (companyId, email) => {
            const { data: rows } = await supabaseAdmin
              .from("company_members")
              .select("user_id")
              .eq("company_id", companyId)
              .not("user_id", "is", null);
            const ids = (rows ?? []).map((r) => r.user_id).filter(Boolean) as string[];
            if (!ids.length) return false;
            for (const id of ids) {
              const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
              if (normalizeInviteEmail(u?.user?.email) === email) return true;
            }
            return false;
          },
          findPendingInvite: async (companyId, email) => {
            const { data: row } = await supabaseAdmin
              .from("company_members")
              .select(INVITE_COLS)
              .eq("company_id", companyId)
              .eq("invited_email", email)
              .is("user_id", null)
              .maybeSingle();
            return (row as unknown as InviteRow) ?? null;
          },
          assertCanAddSeat: (companyId) => assertCanAddMember(companyId),
          assertNotRecentlySent: async (companyId, email) => {
            const { assertNotRecentlySent } = await import("@/lib/email-throttle.server");
            await assertNotRecentlySent({
              emailType: "member_invite",
              companyId,
              recipient: email,
              windowSec: 60,
              label: "L'invitation",
            });
          },
          newToken: async () => {
            const token =
              crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
            return { token, hash: await sha256HexToken(token) };
          },
          casRotateInvite: async (existing, patch) => {
            let q = supabaseAdmin
              .from("company_members")
              .update({
                role: patch.role,
                invite_token_hash: patch.token_hash,
                invite_expires_at: patch.expires_at,
                invited_by: patch.invited_by,
              } as never)
              .eq("id", existing.id)
              .eq("company_id", existing.company_id)
              .eq("status", "invited")
              .is("user_id", null);
            q = existing.invite_token_hash
              ? q.eq("invite_token_hash" as never, existing.invite_token_hash)
              : q.is("invite_token_hash" as never, null);
            const { data: rows, error } = await q.select(INVITE_COLS);
            if (error) throw new Error(error.message);
            return ((rows as unknown as InviteRow[]) ?? [])[0] ?? null;
          },
          insertInvite: async (row) => {
            const { data: ins, error } = await supabaseAdmin
              .from("company_members")
              .insert({
                company_id: row.company_id,
                invited_email: row.invited_email,
                role: row.role,
                status: "invited",
                invite_token_hash: row.token_hash,
                invite_expires_at: row.expires_at,
                invited_by: row.invited_by,
              } as never)
              .select(INVITE_COLS)
              .single();
            if (error) {
              if (/duplicate|unique/i.test(error.message))
                throw new InviteError("conflict", "Une invitation vient d'être créée pour cette adresse.");
              if (/SEAT_QUOTA/i.test(error.message))
                throw new InviteError("forbidden", "Nombre maximal d'utilisateurs atteint pour votre formule.");
              throw new Error(error.message);
            }
            return ins as unknown as InviteRow;
          },
        },
        {
          userId,
          callerEmail: ((context.claims as { email?: string } | undefined)?.email as string) ?? null,
          companyId: data.companyId,
          email: data.email,
          role: data.role,
          now: Date.now(),
        },
      );
    } catch (e) {
      if (e instanceof InviteError) throw new Error(e.message);
      throw e;
    }

    const [{ data: company }, { data: profile }] = await Promise.all([
      supabaseAdmin.from("companies").select("name").eq("id", data.companyId).maybeSingle(),
      supabaseAdmin.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    ]);
    const companyName = company?.name ?? "votre entreprise";
    const roleLabel = inviteRoleLabel(data.role);
    const acceptUrl = `${getPublicAppUrl()}/invite/${prepared.token}`;

    const { sendEmailWithRetryLog } = await import("@/lib/email-sender.server");
    const sendRes = await sendEmailWithRetryLog({
      emailType: "member_invite",
      companyId: data.companyId,
      retryable: true,
      payload: {
        from: process.env.RESEND_FROM_EMAIL || "PVIA <noreply@pvia.fr>",
        to: [prepared.email],
        subject: `${profile?.full_name || "PVIA"} vous invite sur ${companyName}`,
        html: renderEmail({
          companyName,
          inviterName: profile?.full_name || "Un administrateur",
          roleLabel,
          acceptUrl,
        }),
      },
    });
    if (sendRes.status === "failed") {
      throw new Error("L'email d'invitation n'a pas pu partir. Il sera relancé automatiquement.");
    }

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "member",
      entityId: prepared.row.id,
      action: prepared.resent ? "member.invite_resent" : "member.invited",
      newValues: { invited_email: prepared.email, role: data.role },
      metadata: { expires_at: prepared.expiresAt },
      actor: "user",
    });

    firePushToCompany(
      data.companyId,
      {
        title: prepared.resent ? "Invitation renvoyée" : "Invitation envoyée",
        body: `${prepared.email} a été invité (${roleLabel}).`,
        url: "/equipe",
        tag: `invite-${prepared.email}`,
      },
      { excludeUserId: userId },
    );

    return { ok: true as const, resent: prepared.resent };
  });

const TokenSchema = z.object({ token: z.string().regex(INVITE_TOKEN_RE, "Lien d'invitation invalide.") });

export const getInviteByToken = createServerFn({ method: "POST" })
  .inputValidator((input) => TokenSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const ip = getClientIp(getRequest());
      await enforceRateLimit({
        bucket: "invite.get",
        key: `${ip}:${data.token.slice(0, 16)}`,
        limit: 20,
        windowSec: 60,
      });
    } catch (e) {
      if ((e as { name?: string })?.name === "RateLimitError") throw e;
    }

    const invite = await findInviteByHash(await sha256HexToken(data.token));
    const state = inviteOpenState(invite, Date.now());
    if (state) return { valid: false as const, reason: state === "not_found" ? undefined : state };

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("name")
      .eq("id", invite!.company_id)
      .maybeSingle();

    return {
      valid: true as const,
      email: normalizeInviteEmail(invite!.invited_email),
      role: invite!.role as string,
      roleLabel: inviteRoleLabel(invite!.role as string),
      companyName: company?.name ?? "PVIA",
      expiresAt: invite!.invite_expires_at,
    };
  });

export const acceptInviteForCurrentUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => TokenSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { userId, claims } = context;
    const sessionEmail = (claims as { email?: string } | undefined)?.email ?? null;
    const tokenHash = await sha256HexToken(data.token);
    let res: Awaited<ReturnType<typeof acceptInviteCore>>;
    try {
      res = await acceptInviteCore(
        {
          findInviteByHash,
          getAuthIdentity: async (uid) => {
            const { data: u, error } = await supabaseAdmin.auth.admin.getUserById(uid);
            if (error || !u?.user) return null;
            return { email: u.user.email ?? null, verified: !!u.user.email_confirmed_at };
          },
          findMembership: async (companyId, uid) => {
            const { data: m } = await supabaseAdmin
              .from("company_members")
              .select("id,status")
              .eq("company_id", companyId)
              .eq("user_id", uid)
              .maybeSingle();
            return m ?? null;
          },
          casActivate: async (invite, hash, uid) => {
            const { data: rows, error } = await supabaseAdmin
              .from("company_members")
              .update({
                user_id: uid,
                status: "active",
                invited_email: null,
                invite_token_hash: null,
                accepted_at: new Date().toISOString(),
              } as never)
              .eq("id", invite.id)
              .eq("company_id", invite.company_id)
              .eq("status", "invited")
              .is("user_id", null)
              .eq("invite_token_hash" as never, hash)
              .gt("invite_expires_at", new Date().toISOString())
              .select(INVITE_COLS);
            if (error) {
              if (/SEAT_QUOTA/i.test(error.message))
                throw new InviteError("forbidden", "L'entreprise a atteint son nombre maximal d'utilisateurs.");
              throw new Error("Impossible d'accepter cette invitation.");
            }
            return ((rows as unknown as InviteRow[]) ?? [])[0] ?? null;
          },
          casConsume: async (invite, hash) => {
            const { data: rows } = await supabaseAdmin
              .from("company_members")
              .delete()
              .eq("id", invite.id)
              .eq("company_id", invite.company_id)
              .eq("status", "invited")
              .is("user_id", null)
              .eq("invite_token_hash" as never, hash)
              .select("id");
            return (rows ?? []).length === 1;
          },
        },
        { userId, sessionEmail, tokenHash, now: Date.now() },
      );
    } catch (e) {
      if (e instanceof InviteError) throw new Error(e.message);
      throw e;
    }

    if (!res.alreadyMember) {
      await writeAuditLog({
        companyId: res.companyId,
        userId,
        entityType: "member",
        entityId: res.inviteId,
        action: "member.joined",
        newValues: { role: res.role, email: normalizeInviteEmail(sessionEmail) },
        actor: "user",
      });
      firePushToCompany(
        res.companyId,
        {
          title: "Nouveau membre",
          body: `${normalizeInviteEmail(sessionEmail)} a rejoint l'équipe (${inviteRoleLabel(res.role as string)}).`,
          url: "/equipe",
          tag: `member-joined-${res.inviteId}`,
          data: { kind: "member.joined" },
        },
        { excludeUserId: userId },
      );
    }
    return { ok: true as const, alreadyMember: res.alreadyMember, companyId: res.companyId };
  });

const InviteSignupSchema = z.object({
  token: z.string().regex(INVITE_TOKEN_RE),
  fullName: z.string().trim().min(1, "Nom requis").max(120),
  password: z.string().min(INVITE_PASSWORD_MIN).max(128),
});

/** Inscription bornée à l'invitation : email dérivé côté serveur, redirection fixe. */
export const signUpWithInvite = createServerFn({ method: "POST" })
  .inputValidator((input) => InviteSignupSchema.parse(input))
  .handler(async ({ data }) => {
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const ip = getClientIp(getRequest());
      await enforceRateLimit({ bucket: "invite.signup", key: `${ip}:${data.token.slice(0, 16)}`, limit: 5, windowSec: 900 });
    } catch (e) {
      if ((e as { name?: string })?.name === "RateLimitError") throw e;
    }
    try {
      return await inviteSignupCore(
        {
          findInviteByHash,
          hashToken: sha256HexToken,
          appUrl: getPublicAppUrl,
          signUp: async ({ email, password, redirectTo, fullName, token }) => {
            const { createClient } = await import("@supabase/supabase-js");
            const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
            const client = createClient(process.env["SUPABASE_URL"]!, key, {
              auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
              global: {
                fetch: (input, init) => {
                  const h = new Headers(init?.headers);
                  if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
                  h.set("apikey", key);
                  return fetch(input, { ...init, headers: h });
                },
              },
            });
            const { error } = await client.auth.signUp({
              email,
              password,
              options: { emailRedirectTo: redirectTo, data: { full_name: fullName, invite_token: token } },
            });
            return { error: error ? error.message : null };
          },
        },
        { token: data.token, password: data.password, fullName: data.fullName, now: Date.now() },
      );
    } catch (e) {
      if (e instanceof InviteError) throw new Error(e.message);
      throw e;
    }
  });

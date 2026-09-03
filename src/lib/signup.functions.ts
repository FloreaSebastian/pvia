/**
 * Inscription professionnelle — validation SERVEUR.
 *
 * La politique globale de mots de passe du fournisseur d'auth ne peut pas être
 * durcie sans risquer d'invalider les comptes existants (créés sous la règle
 * historique de 6 caractères). On applique donc la règle des 12 caractères
 * côté serveur, AVANT l'appel Auth : la validation ne peut plus être
 * contournée en désactivant le JavaScript ou en appelant l'API directement.
 *
 * Les comptes existants ne sont pas touchés : la règle ne s'applique qu'à la
 * création et au changement de mot de passe.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/rate-limit.server";
import { getClientIp, normalizeEmail } from "@/lib/client-auth.server";

/** Longueur minimale imposée côté serveur pour tout nouveau mot de passe. */
export const MIN_PASSWORD_LENGTH = 12;

export const PASSWORD_POLICY_MESSAGE = `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`;

const SignupSchema = z.object({
  email: z.string().trim().email("Adresse email invalide.").max(255),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, PASSWORD_POLICY_MESSAGE)
    .max(200, "Mot de passe trop long (200 caractères maximum)."),
  fullName: z.string().trim().min(1, "Nom complet requis.").max(120),
  companyName: z.string().trim().min(1, "Nom d'entreprise requis.").max(160),
  redirectTo: z.string().url().max(500).optional(),
});

export type SignupInput = z.infer<typeof SignupSchema>;

/**
 * Destination de confirmation email : jamais l'URL brute du navigateur.
 * On ne conserve que le CHEMIN interne demandé, recollé sur une origine
 * de confiance (origine canonique, ou origine de la requête si preview /
 * localhost). Toute origine externe est ignorée.
 */
export function resolveEmailRedirect(
  requested: string | undefined,
  requestOrigin: string | undefined,
  canonical: string,
): string {
  const isTrusted = (origin: string) =>
    origin === canonical ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) ||
    /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.lovable\.app$/i.test(origin);

  const base = requestOrigin && isTrusted(requestOrigin) ? requestOrigin : canonical;

  let path = "/dashboard";
  if (requested) {
    try {
      const u = new URL(requested);
      // L'origine fournie n'est jamais réutilisée : seul le chemin l'est,
      // et uniquement si l'origine était elle-même de confiance.
      if (isTrusted(u.origin)) path = `${u.pathname}${u.search}`;
    } catch {
      /* URL invalide → chemin par défaut */
    }
  }
  if (!path.startsWith("/") || path.startsWith("//")) path = "/dashboard";
  return `${base}${path}`;
}

export const signUpProfessional = createServerFn({ method: "POST" })
  .inputValidator((input) => SignupSchema.parse(input))
  .handler(async ({ data }) => {
    const email = normalizeEmail(data.email);
    const ip = getClientIp() ?? "unknown";

    await enforceRateLimit({ bucket: "signup_ip", key: ip, limit: 10, windowSec: 3600 });
    await enforceRateLimit({ bucket: "signup_email", key: email, limit: 5, windowSec: 3600 });

    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env["SUPABASE_URL"]!;
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
    const supabasePublic = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    });

    const { getRequest } = await import("@tanstack/react-start/server");
    const { getPublicAppUrl } = await import("@/lib/app-url.server");
    let requestOrigin: string | undefined;
    try {
      requestOrigin = new URL(getRequest().url).origin;
    } catch {
      requestOrigin = undefined;
    }
    const emailRedirectTo = resolveEmailRedirect(data.redirectTo, requestOrigin, getPublicAppUrl());

    const { error } = await supabasePublic.auth.signUp({
      email,
      password: data.password,
      options: {
        emailRedirectTo,
        data: { full_name: data.fullName, company_name: data.companyName },
      },
    });


    if (error) {
      // Anti-énumération : on ne révèle jamais qu'un compte existe déjà.
      if (/already|registered|exists/i.test(error.message)) {
        return { ok: true as const };
      }
      throw new Error(error.message);
    }

    return { ok: true as const };
  });

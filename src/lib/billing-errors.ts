/**
 * Traduction des erreurs serveur liées à l'abonnement en information UX
 * exploitable. Source de vérité : les messages levés par
 * `src/lib/plan-guard.server.ts` (SUBSCRIPTION_REQUIRED:<state>, quotas,
 * fonctionnalité non incluse) et `COMPANY_SUSPENDED:<reason>`.
 *
 * Aucune erreur technique (Supabase, Stripe, réseau) ne doit être affichée
 * telle quelle : `friendlyErrorMessage()` fournit un repli lisible.
 */

export type BillingBlockKind = "subscription" | "feature" | "quota" | "suspended";

export type BillingBlock =
  | { kind: "subscription"; state: string }
  | { kind: "feature"; feature: string | null }
  | { kind: "quota"; quota: "pv" | "members" }
  | { kind: "suspended"; reason: string };

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message ?? "";
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) return String((err as any).message ?? "");
  return "";
}

/** Classe une erreur serveur ; `null` = ce n'est pas un blocage d'abonnement. */
export function classifyBillingError(err: unknown): BillingBlock | null {
  const msg = errorMessage(err);
  if (!msg) return null;

  const sub = msg.match(/SUBSCRIPTION_REQUIRED:([a-z_]+)/i);
  if (sub) return { kind: "subscription", state: (sub[1] ?? "blocked").toLowerCase() };

  const susp = msg.match(/COMPANY_SUSPENDED:(.*)$/);
  if (susp) return { kind: "suspended", reason: (susp[1] || "support").trim() };

  if (/Quota PV mensuel atteint/i.test(msg)) return { kind: "quota", quota: "pv" };
  if (/Nombre maximum d'utilisateurs atteint/i.test(msg)) return { kind: "quota", quota: "members" };

  const feat = msg.match(/Fonctionnalité\s+«\s*(.+?)\s*»\s+non incluse/i);
  if (feat) return { kind: "feature", feature: feat[1] ?? null };

  // RLS : uniquement si la contrainte d'abonnement est explicitement nommée.
  // Une erreur RLS générique (rôle insuffisant, policy, cross-tenant) N'EST PAS
  // un blocage d'abonnement et doit rester une erreur technique générique.
  if (/company_has_write_access/i.test(msg)) return { kind: "subscription", state: "blocked" };

  return null;

}

const TECHNICAL_PATTERNS: RegExp[] = [
  /^SUBSCRIPTION_REQUIRED/i,
  /^COMPANY_SUSPENDED/i,
  /failed to fetch/i,
  /networkerror/i,
  /load failed/i,
  /^\s*undefined\s*$/i,
  /^\s*null\s*$/i,
  /row-level security/i,
  /new row violates/i,
  /permission denied/i,
  /JWT|jwt expired/i,
  /PGRST\d+/,
  /\bStripeError\b|\bStripeInvalid/i,
  /TypeError|ReferenceError|at\s+\w+\s+\(/,
  /^\s*\d{3}\s*$/,
  /Internal Server Error|Unexpected token|<!DOCTYPE/i,
];

/**
 * Message affichable à l'utilisateur. Les blocages d'abonnement sont traduits
 * en français ; toute erreur technique reconnue est remplacée par un message
 * générique — jamais de stack trace ni de code brut.
 */
export function friendlyErrorMessage(err: unknown, fallback = "Une erreur est survenue. Réessayez dans un instant."): string {
  const msg = errorMessage(err).trim();
  const block = classifyBillingError(err);
  if (block) {
    switch (block.kind) {
      case "subscription":
        return "Création et modification suspendues : votre abonnement doit être activé ou régularisé.";
      case "suspended":
        return "Votre compte est suspendu. Contactez le support PVIA.";
      case "quota":
        return block.quota === "pv"
          ? "Quota de PV mensuel atteint pour votre formule."
          : "Nombre maximum d'utilisateurs atteint pour votre formule.";
      case "feature":
        return block.feature
          ? `« ${block.feature} » n'est pas incluse dans votre formule actuelle.`
          : "Cette fonctionnalité n'est pas incluse dans votre formule actuelle.";
    }
  }
  if (!msg) return fallback;
  if (TECHNICAL_PATTERNS.some((r) => r.test(msg))) return fallback;
  if (msg.length > 220) return fallback;
  return msg;
}

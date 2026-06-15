/**
 * Central email template registry.
 *
 * Lists every transactional email the app can send, with metadata
 * (purpose, recipient type, retryable, status). Renderers live in
 * `email.server.ts` (inline HTML, legacy) — this registry is the
 * single source of truth for the admin overview page and for
 * future migration to extracted templates.
 *
 * Roadmap : extract each renderer into its own `email-templates/*.tsx`
 * file with React Email + central branding, then expose a `render()`
 * function here for the admin preview.
 */

export type EmailTemplateMeta = {
  key: string;
  label: string;
  category: "auth" | "pv" | "reserve" | "team" | "system";
  description: string;
  recipient: "client" | "team_member" | "platform_admin";
  /** Whether this email's payload is safe to replay (no OTP, no attachment) */
  retryable: boolean;
  /** Migration status to the centralized pipeline */
  status: "stable" | "legacy_inline" | "todo";
};

export const EMAIL_TEMPLATES: EmailTemplateMeta[] = [
  { key: "client_login_code", label: "Espace client — code de connexion",
    category: "auth", recipient: "client", retryable: false, status: "stable",
    description: "Code OTP envoyé au client pour accéder à son espace." },
  { key: "pv_signed_to_client", label: "PV signé — envoi au client",
    category: "pv", recipient: "client", retryable: false, status: "legacy_inline",
    description: "Email contenant le PV signé en pièce jointe (PDF)." },
  { key: "remote_sign_request", label: "Demande de signature à distance",
    category: "pv", recipient: "client", retryable: true, status: "legacy_inline",
    description: "Email envoyé au client avec le lien de signature à distance (token haché)." },
  { key: "reserve_lift_request", label: "Demande de validation — levée de réserves",
    category: "reserve", recipient: "client", retryable: true, status: "legacy_inline",
    description: "Notification client : levée de réserves prête à valider." },
  { key: "reserve_lift_validation_request", label: "Levée de réserves — demande de validation client",
    category: "reserve", recipient: "client", retryable: true, status: "stable",
    description: "Email envoyé au client après signature entreprise d'une levée, avec lien vers l'espace client de validation." },
  { key: "team_invite", label: "Invitation équipe",
    category: "team", recipient: "team_member", retryable: true, status: "legacy_inline",
    description: "Invitation à rejoindre une entreprise (token haché)." },
  { key: "billing_past_due", label: "Facturation — paiement échoué (legacy)",
    category: "system", recipient: "team_member", retryable: true, status: "todo",
    description: "Ancienne notification push d'échec de prélèvement Stripe." },
  { key: "billing_payment_failed", label: "Facturation — email paiement échoué",
    category: "system", recipient: "team_member", retryable: true, status: "stable",
    description: "Email envoyé aux owners + email facturation entreprise sur échec invoice ou subscription past_due." },
  { key: "onsite_otp", label: "Signature terrain — OTP",
    category: "pv", recipient: "client", retryable: false, status: "stable",
    description: "Code OTP envoyé sur place pour signature mobile." },
];

export function getTemplateByKey(key: string): EmailTemplateMeta | undefined {
  return EMAIL_TEMPLATES.find((t) => t.key === key);
}

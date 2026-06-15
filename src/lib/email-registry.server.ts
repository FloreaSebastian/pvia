/**
 * Central email template registry.
 *
 * Lists every transactional email the app can send, with metadata
 * (purpose, recipient type, retryable, status). Renderers stay in
 * `email.server.ts` for now — this registry is the single source of
 * truth for the admin preview page (/admin/emails) and for future
 * audit work.
 *
 * To add a new template: add an entry here, then point its `render`
 * to a renderer function in `email.server.ts`.
 */

import {
  renderClientLoginCodeEmail,
  renderSignedPvEmail,
  renderRemoteSignRequestEmail,
  renderReserveLiftRequestEmail,
} from "./email.server";

export type EmailTemplateMeta = {
  key: string;
  label: string;
  category: "auth" | "pv" | "reserve" | "team" | "system";
  description: string;
  recipient: "client" | "team_member" | "platform_admin";
  /** Whether this email's payload is safe to replay (no OTP, no attachment) */
  retryable: boolean;
  /** Status of the migration to the central pipeline */
  status: "stable" | "legacy_inline" | "todo";
  /** Demo data for the admin preview */
  preview?: () => { subject: string; html: string };
};

export const EMAIL_TEMPLATES: EmailTemplateMeta[] = [
  {
    key: "client_login_code",
    label: "Espace client — code de connexion",
    category: "auth",
    description: "Code OTP envoyé au client pour accéder à son espace.",
    recipient: "client",
    retryable: false,
    status: "stable",
    preview: () => ({
      subject: "Votre code de connexion PVIA",
      html: renderClientLoginCodeEmail({
        code: "482917",
        ip: "82.64.x.x",
        device: "iPhone 15 · Safari",
        verifyUrl: "https://pvia.fr/client/verify",
        expiresMin: 10,
      }),
    }),
  },
  {
    key: "pv_signed_to_client",
    label: "PV signé — envoi au client",
    category: "pv",
    description: "Email contenant le PV signé en pièce jointe (PDF).",
    recipient: "client",
    retryable: false,
    status: "stable",
    preview: () => ({
      subject: "Votre PV de réception signé",
      html: renderSignedPvEmail?.({
        clientName: "Mme Dupont",
        companyName: "Bâti Pro",
        pvNumero: "PV-2026-00042",
        portalUrl: "https://pvia.fr/client/dashboard",
      }) ?? "<p>Aperçu indisponible</p>",
    }),
  },
  {
    key: "remote_sign_request",
    label: "Demande de signature à distance",
    category: "pv",
    description: "Email envoyé au client avec le lien de signature à distance (token haché).",
    recipient: "client",
    retryable: true,
    status: "stable",
    preview: () => ({
      subject: "Signez votre PV de réception",
      html: renderRemoteSignRequestEmail?.({
        clientName: "Mme Dupont",
        companyName: "Bâti Pro",
        pvNumero: "PV-2026-00042",
        signUrl: "https://pvia.fr/sign/pv/xxx",
      }) ?? "<p>Aperçu indisponible</p>",
    }),
  },
  {
    key: "reserve_lift_request",
    label: "Demande de validation — levée de réserves",
    category: "reserve",
    description: "Notification client : levée de réserves prête à valider.",
    recipient: "client",
    retryable: true,
    status: "stable",
    preview: () => ({
      subject: "Levée de réserves prête à valider",
      html: renderReserveLiftRequestEmail?.({
        clientName: "Mme Dupont",
        companyName: "Bâti Pro",
        reportNumero: "LR-2026-00007",
        signUrl: "https://pvia.fr/client/pv/xxx/levee-reserves/yyy",
      }) ?? "<p>Aperçu indisponible</p>",
    }),
  },
  {
    key: "team_invite",
    label: "Invitation équipe",
    category: "team",
    description: "Invitation à rejoindre une entreprise (token haché).",
    recipient: "team_member",
    retryable: true,
    status: "legacy_inline",
  },
  {
    key: "billing_past_due",
    label: "Facturation — paiement échoué",
    category: "system",
    description: "Notification d'échec de prélèvement Stripe.",
    recipient: "team_member",
    retryable: true,
    status: "todo",
  },
];

export function getTemplateByKey(key: string): EmailTemplateMeta | undefined {
  return EMAIL_TEMPLATES.find((t) => t.key === key);
}

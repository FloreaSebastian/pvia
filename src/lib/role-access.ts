// Source commune UI des accès par rôle entreprise. Elle reflète les vérifications
// serveur existantes (MANAGE_ROLES, SIGN_ROLES, ADMIN_ROLES, can_edit_technical_visit)
// et ne doit jamais accorder un droit que le serveur refuse.
import {
  ADMIN_ROLES,
  ROLE_META,
  canSignAsCompany,
  isAdminRole,
  isManageRole,
  isOwnerRole,
  type CompanyRoleValue,
} from "@/lib/roles";

export type WriteAccess = {
  /** Abonnement + suspension connus et non bloquants. Inconnu/erreur = fermé. */
  writeOpen: boolean;
};

export type RoleCapabilities = {
  /** Créer/modifier PV, chantiers, clients, visites (MANAGE_ROLES + écriture ouverte). */
  manage: boolean;
  /** Signer côté entreprise / lever une réserve (SIGN_ROLES + écriture ouverte). */
  sign: boolean;
  /** Saisie terrain d'une visite qui lui est affectée (tous sauf lecture seule). */
  terrainAssigned: boolean;
  /** Administration entreprise : équipe, entreprise, API, intégrations, numérotation. */
  admin: boolean;
  /** Facturation : mêmes rôles que /billing et billing.functions (ADMIN_ROLES). */
  billing: boolean;
  /** Propriétaire : suppression entreprise, transfert. */
  owner: boolean;
  readOnly: boolean;
};

export function roleCapabilities(
  role: CompanyRoleValue | null | undefined,
  { writeOpen }: WriteAccess,
): RoleCapabilities {
  const known = !!role;
  return {
    manage: known && writeOpen && isManageRole(role),
    sign: known && writeOpen && canSignAsCompany(role),
    terrainAssigned: known && writeOpen && role !== "lecture_seule",
    // Les pages d'administration restent consultables même abonnement bloqué
    // (exceptions serveur facturation/compte) : pas de dépendance à writeOpen.
    admin: known && isAdminRole(role),
    billing: known && (ADMIN_ROLES as readonly string[]).includes(role!),
    owner: known && isOwnerRole(role),
    readOnly: role === "lecture_seule",
  };
}

export type DashboardBlock = "banner" | "metrics" | "main" | "visits" | "recent";

export type RoleProfile = {
  title: string;
  subtitle: string;
  /** Résumé « Vos accès » : phrases courtes et exactes. */
  can: string[];
  cannot: string[];
  /** Ordre d'affichage des blocs du tableau de bord. */
  order: DashboardBlock[];
  /** Planning avant priorités dans le bloc principal. */
  planningFirst: boolean;
  /** Destinations de la barre mobile (hors Accueil et Menu), 3 max. */
  mobile: MobileKey[];
  /** Ton visuel (classes de jetons sémantiques), toujours accompagné de texte. */
  tone: "primary" | "warning" | "info" | "success" | "accent" | "muted";
};

export type MobileKey = "pv" | "reserves" | "chantiers" | "calendrier" | "clients" | "visites";

export const ROLE_PROFILES: Record<CompanyRoleValue, RoleProfile> = {
  directeur: {
    title: "Pilotage de l’entreprise",
    subtitle: "Activité, priorités et gestion de l’équipe.",
    can: [
      "Créer et signer des PV, lever des réserves",
      "Gérer l’équipe, l’entreprise et la facturation",
      "Consulter toute l’activité",
    ],
    cannot: [],
    order: ["banner", "metrics", "main", "recent", "visits"],
    planningFirst: false,
    mobile: ["pv", "reserves", "chantiers"],
    tone: "primary",
  },
  responsable_exploitation: {
    title: "Coordination de l’activité",
    subtitle: "Planning, équipe et suivi opérationnel.",
    can: [
      "Créer et signer des PV, lever des réserves",
      "Gérer l’équipe et la facturation",
      "Organiser le planning",
    ],
    cannot: ["Supprimer l’entreprise ou transférer la direction"],
    order: ["banner", "main", "metrics", "visits", "recent"],
    planningFirst: true,
    mobile: ["calendrier", "chantiers", "reserves"],
    tone: "warning",
  },
  conducteur_travaux: {
    title: "Suivi des chantiers",
    subtitle: "Réserves, visites et PV de vos opérations.",
    can: ["Créer et signer des PV, lever des réserves", "Créer et planifier des visites"],
    cannot: ["Gérer l’équipe, l’entreprise ou la facturation"],
    order: ["banner", "main", "visits", "metrics", "recent"],
    planningFirst: false,
    mobile: ["chantiers", "reserves", "visites"],
    tone: "info",
  },
  technicien: {
    title: "Votre terrain",
    subtitle: "Les visites qui vous sont affectées et votre planning.",
    can: ["Saisir les visites qui vous sont affectées", "Consulter chantiers, PV et réserves"],
    cannot: ["Créer ou signer un PV", "Lever une réserve", "Gérer l’équipe"],
    order: ["visits", "main", "recent", "metrics"],
    planningFirst: true,
    mobile: ["visites", "calendrier", "reserves"],
    tone: "success",
  },
  assistant_admin: {
    title: "Organisation et préparation",
    subtitle: "Clients, préparation des PV et planning.",
    can: ["Gérer clients et chantiers", "Préparer des PV et des visites", "Organiser le planning"],
    cannot: ["Signer un PV ou lever une réserve", "Gérer l’équipe ou la facturation"],
    order: ["banner", "recent", "metrics", "main", "visits"],
    planningFirst: true,
    mobile: ["clients", "pv", "calendrier"],
    tone: "accent",
  },
  lecture_seule: {
    title: "Consultation",
    subtitle: "Suivez l’activité sans modifier les dossiers.",
    can: ["Consulter PV, réserves, chantiers et planning"],
    cannot: ["Créer, modifier, signer ou valider", "Saisir une visite, même affectée"],
    order: ["banner", "metrics", "main", "recent", "visits"],
    planningFirst: false,
    mobile: ["pv", "reserves", "chantiers"],
    tone: "muted",
  },
};

export const ROLE_TONE_CLASS: Record<RoleProfile["tone"], string> = {
  primary: "border-primary/40 bg-primary/10 text-foreground",
  warning: "border-warning/50 bg-warning/15 text-foreground",
  info: "border-primary/30 bg-accent text-accent-foreground",
  success: "border-success/50 bg-success/15 text-foreground",
  accent: "border-border bg-secondary text-secondary-foreground",
  muted: "border-border bg-muted text-foreground",
};

export function roleLabel(role: CompanyRoleValue | null | undefined): string {
  return role ? ROLE_META[role].label : "Rôle inconnu";
}

export function roleShort(role: CompanyRoleValue | null | undefined): string {
  return role ? ROLE_META[role].short : "Rôle inconnu";
}

export function mobileDestinations(
  role: CompanyRoleValue | null | undefined,
  { canVisit }: { canVisit: boolean },
): MobileKey[] {
  const base = role ? ROLE_PROFILES[role].mobile : (["pv", "reserves", "chantiers"] as MobileKey[]);
  const out = base.map((k) => (k === "visites" && !canVisit ? "pv" : k));
  return Array.from(new Set(out)).slice(0, 3);
}

/* ---------------- Paramètres : liste unique autorisée ---------------- */

export type SettingsAccess = "all" | "admin";

export type SettingsEntry = {
  to: string;
  group: "Compte" | "Organisation" | "Communication" | "Développeurs";
  label: string;
  desc: string;
  access: SettingsAccess;
  /** Consultable par tous, modification réservée à l'administration. */
  readOnlyForOthers?: boolean;
  external?: boolean;
};

export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  { to: "/parametres", group: "Compte", label: "Général", desc: "Profil, langue, fuseau", access: "all" },
  { to: "/parametres/preferences", group: "Compte", label: "Préférences", desc: "Thème, densité, sons", access: "all" },
  { to: "/parametres/securite", group: "Compte", label: "Sécurité", desc: "Sessions, appareils", access: "all" },
  { to: "/parametres/notifications", group: "Compte", label: "Notifications", desc: "Email, push, rappels", access: "all" },
  { to: "/entreprise", group: "Organisation", label: "Entreprise", desc: "Identité légale, SIREN", access: "admin", external: true },
  { to: "/parametres/branding", group: "Organisation", label: "Branding", desc: "Logo, couleurs, footer", access: "all", readOnlyForOthers: true },
  { to: "/equipe", group: "Organisation", label: "Utilisateurs", desc: "Membres, rôles, invitations", access: "admin", external: true },
  { to: "/billing", group: "Organisation", label: "Facturation", desc: "Plan, factures, essai", access: "admin", external: true },
  { to: "/parametres/numerotation", group: "Organisation", label: "Numérotation PV", desc: "Format, préfixe, séquence", access: "all", readOnlyForOthers: true },
  { to: "/parametres/integrations", group: "Communication", label: "Intégrations", desc: "Calendrier, Slack, Discord", access: "admin" },
  { to: "/parametres/api", group: "Développeurs", label: "API & webhooks", desc: "Clés, endpoints, logs", access: "admin" },
  { to: "/parametres/audit", group: "Développeurs", label: "Audit & monitoring", desc: "Journal d’activité", access: "all" },
  { to: "/parametres/donnees", group: "Développeurs", label: "Données & exports", desc: "Export, RGPD", access: "all" },
];

/** Liste autorisée unique pour menu desktop, mobile, recherche et palette. */
export function allowedSettings(role: CompanyRoleValue | null | undefined): SettingsEntry[] {
  const admin = !!role && isAdminRole(role);
  return SETTINGS_ENTRIES.filter((e) => e.access === "all" || admin);
}

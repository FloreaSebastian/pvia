// Système de rôles entreprise PVIA (Lot 1)
// Les rôles legacy ont été renommés via migration SQL :
//   owner   → directeur
//   admin   → responsable_exploitation
//   manager → conducteur_travaux
//   user    → technicien
// Et deux nouveaux rôles ont été ajoutés : assistant_admin, lecture_seule.

export const ROLE = {
  DIRECTEUR: "directeur",
  RESPONSABLE: "responsable_exploitation",
  CONDUCTEUR: "conducteur_travaux",
  TECHNICIEN: "technicien",
  ASSISTANT: "assistant_admin",
  LECTURE: "lecture_seule",
} as const;

export type CompanyRoleValue =
  | "directeur"
  | "responsable_exploitation"
  | "conducteur_travaux"
  | "technicien"
  | "assistant_admin"
  | "lecture_seule";

/** Rôle propriétaire (transfert / suppression entreprise / facturation). */
export const OWNER_ROLES = ["directeur"] as const;

/** Administration entreprise (logo, identité, branding, abonnement). */
export const ADMIN_ROLES = ["directeur", "responsable_exploitation"] as const;

/**
 * Gestion opérationnelle (chantiers, PV, réserves, équipe opérationnelle).
 * Inclut l'assistant administratif (gestion documentaire / clients / planning).
 */
export const MANAGE_ROLES = [
  "directeur",
  "responsable_exploitation",
  "conducteur_travaux",
  "assistant_admin",
] as const;

/** Peut signer côté entreprise (PV, levées). */
export const SIGN_ROLES = [
  "directeur",
  "responsable_exploitation",
  "conducteur_travaux",
] as const;

export function isOwnerRole(role?: string | null): boolean {
  return !!role && (OWNER_ROLES as readonly string[]).includes(role);
}
export function isAdminRole(role?: string | null): boolean {
  return !!role && (ADMIN_ROLES as readonly string[]).includes(role);
}
export function isManageRole(role?: string | null): boolean {
  return !!role && (MANAGE_ROLES as readonly string[]).includes(role);
}
export function canSignAsCompany(role?: string | null): boolean {
  return !!role && (SIGN_ROLES as readonly string[]).includes(role);
}

export const ROLE_META: Record<
  CompanyRoleValue,
  { label: string; short: string; description: string; badgeClass: string; emoji: string }
> = {
  directeur: {
    label: "Directeur d'entreprise",
    short: "Directeur",
    description: "Contrôle total : entreprise, équipe, facturation, données.",
    badgeClass: "bg-red-900 text-white hover:bg-red-900/90",
    emoji: "🏢",
  },
  responsable_exploitation: {
    label: "Responsable d'exploitation",
    short: "Responsable",
    description: "Pilote l'activité, gère l'équipe et l'opérationnel.",
    badgeClass: "bg-orange-500 text-white hover:bg-orange-500/90",
    emoji: "⚙️",
  },
  conducteur_travaux: {
    label: "Conducteur de travaux",
    short: "Conducteur",
    description: "Suivi technique des chantiers, PV, réserves, planning.",
    badgeClass: "bg-blue-600 text-white hover:bg-blue-600/90",
    emoji: "📋",
  },
  technicien: {
    label: "Technicien",
    short: "Technicien",
    description: "Terrain : chantiers assignés, photos, observations, réserves.",
    badgeClass: "bg-green-600 text-white hover:bg-green-600/90",
    emoji: "🔧",
  },
  assistant_admin: {
    label: "Assistant administratif",
    short: "Assistant",
    description: "Clients, documents, planning et préparation des PV.",
    badgeClass: "bg-purple-600 text-white hover:bg-purple-600/90",
    emoji: "📝",
  },
  lecture_seule: {
    label: "Lecture seule",
    short: "Lecture",
    description: "Consultation uniquement : aucune création ni modification.",
    badgeClass: "bg-muted text-muted-foreground hover:bg-muted/90",
    emoji: "👁️",
  },
};

/** Liste ordonnée pour les sélecteurs (du plus puissant au plus restreint). */
export const ROLE_ORDER: CompanyRoleValue[] = [
  "directeur",
  "responsable_exploitation",
  "conducteur_travaux",
  "assistant_admin",
  "technicien",
  "lecture_seule",
];

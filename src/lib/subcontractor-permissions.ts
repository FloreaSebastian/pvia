/**
 * Modèle de permissions du module Sous-traitants.
 *
 * IMPORTANT : ce modèle est TOTALEMENT indépendant des rôles internes
 * (`company_role`). Un sous-traitant n'est jamais un membre de l'entreprise :
 * il ne consomme pas de siège, n'apparaît pas dans l'équipe interne et ne
 * peut jamais hériter d'un droit interne.
 *
 * Fichier client-safe (aucun import serveur) : utilisé par l'UI admin et par
 * les gardes serveur.
 */

export const SUBCONTRACTOR_PERMISSIONS = [
  "chantier.view",
  "chantier.details",
  "chantier.notes.add",
  "chantier.documents.view",
  "chantier.documents.upload",
  "chantier.photos.view",
  "chantier.photos.add",
  "planning.view",
  "reserve.view",
  "reserve.comment",
  "reserve.lift_propose",
  "visit.view",
  "visit.fill",
  "visit.photos",
  "client.contact.view",
  "assignment.status_update",
  "assignment.message",
] as const;

export type SubcontractorPermission = (typeof SUBCONTRACTOR_PERMISSIONS)[number];

export type SubcontractorPermissionMap = Partial<Record<SubcontractorPermission, boolean>>;

export const PERMISSION_META: Record<
  SubcontractorPermission,
  { label: string; group: string; description: string }
> = {
  "chantier.view": { group: "Chantiers", label: "Voir les chantiers affectés", description: "Accès à la liste des chantiers sur lesquels il est affecté." },
  "chantier.details": { group: "Chantiers", label: "Voir la fiche chantier", description: "Adresse, description et informations d'intervention." },
  "chantier.notes.add": { group: "Chantiers", label: "Ajouter une note", description: "Ajouter un compte-rendu sur un chantier affecté." },
  "chantier.documents.view": { group: "Documents", label: "Consulter les documents", description: "Plans et documents partagés du chantier." },
  "chantier.documents.upload": { group: "Documents", label: "Déposer un document", description: "Envoyer un document sur un chantier affecté." },
  "chantier.photos.view": { group: "Photos", label: "Voir les photos", description: "Photos du chantier affecté." },
  "chantier.photos.add": { group: "Photos", label: "Ajouter des photos", description: "Prendre et envoyer des photos horodatées." },
  "planning.view": { group: "Planning", label: "Voir son planning", description: "Interventions planifiées le concernant." },
  "reserve.view": { group: "Réserves", label: "Voir les réserves", description: "Réserves des chantiers affectés." },
  "reserve.comment": { group: "Réserves", label: "Commenter une réserve", description: "Ajouter un commentaire sur une réserve." },
  "reserve.lift_propose": { group: "Réserves", label: "Proposer une levée", description: "Déclarer des travaux réalisés (validation entreprise requise)." },
  "visit.view": { group: "Visites techniques", label: "Voir les visites", description: "Visites techniques des chantiers affectés." },
  "visit.fill": { group: "Visites techniques", label: "Renseigner une visite", description: "Compléter les réponses de la visite terrain." },
  "visit.photos": { group: "Visites techniques", label: "Photos de visite", description: "Ajouter les photos obligatoires de la visite." },
  "client.contact.view": { group: "Client", label: "Voir le contact client", description: "Nom et téléphone du client uniquement (aucune donnée financière)." },
  "assignment.status_update": { group: "Intervention", label: "Mettre à jour son statut", description: "Confirmer, démarrer et clôturer son intervention." },
  "assignment.message": { group: "Intervention", label: "Échanger avec l'entreprise", description: "Fil de discussion lié à l'intervention." },
};

export const PERMISSION_GROUPS = [
  "Chantiers",
  "Planning",
  "Photos",
  "Documents",
  "Réserves",
  "Visites techniques",
  "Client",
  "Intervention",
] as const;

export type SubcontractorPreset = "terrain" | "visite_technique" | "chef_equipe" | "custom";

const TERRAIN: SubcontractorPermission[] = [
  "chantier.view",
  "chantier.details",
  "planning.view",
  "chantier.photos.view",
  "chantier.photos.add",
  "chantier.documents.view",
  "assignment.status_update",
  "assignment.message",
];

const VISITE: SubcontractorPermission[] = [
  ...TERRAIN,
  "visit.view",
  "visit.fill",
  "visit.photos",
];

const CHEF: SubcontractorPermission[] = [
  ...VISITE,
  "chantier.notes.add",
  "chantier.documents.upload",
  "reserve.view",
  "reserve.comment",
  "reserve.lift_propose",
  "client.contact.view",
];

export const PRESETS: Record<Exclude<SubcontractorPreset, "custom">, SubcontractorPermission[]> = {
  terrain: TERRAIN,
  visite_technique: VISITE,
  chef_equipe: CHEF,
};

export const PRESET_META: Record<SubcontractorPreset, { label: string; description: string }> = {
  terrain: { label: "Terrain", description: "Consultation du chantier, photos et suivi d'intervention." },
  visite_technique: { label: "Visite technique", description: "Terrain + réalisation des visites techniques." },
  chef_equipe: { label: "Chef d'équipe", description: "Visite technique + réserves, documents et contact client." },
  custom: { label: "Personnalisé", description: "Autorisations choisies une par une." },
};

export function permissionsFromPreset(preset: SubcontractorPreset): SubcontractorPermissionMap {
  if (preset === "custom") return {};
  const map: SubcontractorPermissionMap = {};
  for (const key of PRESETS[preset]) map[key] = true;
  return map;
}

/** Normalise une valeur jsonb inconnue en carte de permissions sûre. */
export function normalizePermissions(raw: unknown): SubcontractorPermissionMap {
  const out: SubcontractorPermissionMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of SUBCONTRACTOR_PERMISSIONS) {
    if ((raw as Record<string, unknown>)[key] === true) out[key] = true;
  }
  return out;
}

/**
 * Normalisation dédiée aux SURCHARGES d'affectation.
 *
 * Contrairement à `normalizePermissions`, un `false` explicite est CONSERVÉ :
 * c'est ainsi qu'un administrateur retire localement un droit hérité de la
 * relation. Toute clé inconnue et toute valeur non booléenne sont ignorées.
 */
export function normalizePermissionOverrides(raw: unknown): SubcontractorPermissionMap {
  const out: SubcontractorPermissionMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of SUBCONTRACTOR_PERMISSIONS) {
    const v = (raw as Record<string, unknown>)[key];
    if (v === true) out[key] = true;
    else if (v === false) out[key] = false;
  }
  return out;
}



/**
 * Effective = permissions de la relation, restreintes/étendues par les
 * surcharges de l'affectation chantier. Une surcharge `false` retire
 * toujours le droit (principe du moins-disant).
 */
export function effectivePermissions(
  membership: unknown,
  override?: unknown,
): SubcontractorPermissionMap {
  const base = normalizePermissions(membership);
  if (!override || typeof override !== "object") return base;
  const out = { ...base };
  for (const key of SUBCONTRACTOR_PERMISSIONS) {
    const v = (override as Record<string, unknown>)[key];
    if (v === true) out[key] = true;
    if (v === false) delete out[key];
  }
  return out;
}

export function hasPermission(map: SubcontractorPermissionMap, key: SubcontractorPermission): boolean {
  return map[key] === true;
}

export const SUBCONTRACTOR_STATUS_LABELS: Record<string, string> = {
  invited: "Invité",
  active: "Actif",
  suspended: "Suspendu",
  archived: "Archivé",
};

export const INTERVENTION_STATUS_LABELS: Record<string, string> = {
  to_plan: "À planifier",
  planned: "Planifiée",
  confirmed: "Confirmée",
  en_route: "En route",
  on_site: "Sur site",
  in_progress: "En cours",
  done: "Terminée",
  cancelled: "Annulée",
};

export const MISSION_OPTIONS = [
  { value: "travaux", label: "Travaux" },
  { value: "visite_technique", label: "Visite technique" },
  { value: "levee_reserves", label: "Levée de réserves" },
  { value: "depannage", label: "Dépannage" },
  { value: "livraison", label: "Livraison" },
  { value: "autre", label: "Autre" },
] as const;

/* --------------------------------------------------------------------------
 * Masquage des données servies au sous-traitant.
 * Le filtrage est fait AVANT l'envoi réseau : une donnée non autorisée n'est
 * jamais présente dans la réponse (jamais un simple masquage d'affichage).
 * ------------------------------------------------------------------------ */

export type MaskedChantier = {
  id: string;
  reference: string | null;
  name: string | null;
  status: string | null;
  city: string | null;
  postal_code: string | null;
  address: string | null;
  description: string | null;
};

export function maskChantier(
  chantier: Record<string, unknown> | null | undefined,
  perms: SubcontractorPermissionMap,
): MaskedChantier | null {
  if (!chantier) return null;
  const detailed = hasPermission(perms, "chantier.details");
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    id: String(chantier["id"] ?? ""),
    reference: str(chantier["reference"]),
    name: str(chantier["name"]),
    status: str(chantier["status"]),
    city: str(chantier["city"]),
    postal_code: str(chantier["postal_code"]),
    address: detailed ? str(chantier["address"]) : null,
    description: detailed ? str(chantier["description"]) : null,
  };
}

/** Contact client : rien n'est renvoyé sans la permission dédiée. */
export function maskClientContact(
  client: Record<string, unknown> | null | undefined,
  perms: SubcontractorPermissionMap,
): { name: string; phone: string | null } | null {
  if (!client || !hasPermission(perms, "client.contact.view")) return null;
  const phone = client["phone"];
  return {
    name: String(client["name"] ?? ""),
    phone: typeof phone === "string" && phone ? phone : null,
  };
}

/**
 * Visites techniques — schémas de validation partagés (client + serveur).
 * Module pur : aucun import serveur.
 */
import { z } from "zod";

export const VisitTypeSchema = z.enum(["photovoltaique", "pac_air_air", "pac_air_eau", "btp"]);

export const VisitLotSchema = z.enum([
  "photovoltaique",
  "pac_air_air",
  "pac_air_eau",
  "electricite",
  "plomberie",
  "ventilation",
  "isolation_facade",
  "toiture",
  "renovation",
]);

export const VisitStatusSchema = z.enum([
  "a_planifier",
  "planifiee",
  "en_cours",
  "a_completer",
  "terminee",
  "validee",
  "archivee",
]);

export const ConstraintLevelSchema = z.enum(["information", "a_verifier", "important", "bloquant"]);

export const ConstraintCategorySchema = z.enum([
  "acces",
  "electricite",
  "toiture",
  "structure",
  "hydraulique",
  "frigorifique",
  "securite",
  "client",
  "materiel",
  "autre",
]);

export const PhotoSkipReasonSchema = z.enum([
  "inaccessible",
  "equipement_absent",
  "client_absent",
  "danger",
  "autre",
]);

export const AnswerValueSchema = z.union([
  z.string().max(5000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(200)).max(50),
  z.null(),
]);

export const AnswerEntrySchema = z.object({
  section_key: z.string().min(1).max(80),
  field_key: z.string().min(1).max(120),
  value: AnswerValueSchema,
});

/** Étape 4 du wizard : planification. */
export const VisitPlanningSchema = z.object({
  assigned_to: z.string().uuid().nullable().optional(),
  scheduled_at: z.string().datetime({ offset: true }).nullable().optional(),
  site_contact_name: z.string().trim().max(150).optional().default(""),
  site_contact_phone: z.string().trim().max(40).optional().default(""),
  prep_notes: z.string().trim().max(5000).optional().default(""),
});

/** Chantier à créer automatiquement quand aucun chantier existant n'est retenu. */
export const NewChantierSchema = z.object({
  name: z.string().trim().max(200).optional().default(""),
  address_line1: z.string().trim().max(300).optional().default(""),
  postal_code: z.string().trim().max(20).optional().default(""),
  city: z.string().trim().max(150).optional().default(""),
  latitude: z.number().finite().nullable().optional(),
  longitude: z.number().finite().nullable().optional(),
});

export const CreateVisitSchema = z
  .object({
    companyId: z.string().uuid(),
    visit_type: VisitTypeSchema,
    client_id: z.string().uuid(),
    /** Chantier existant retenu par l'utilisateur. */
    chantier_id: z.string().uuid().nullable().optional(),
    /** Données du chantier à créer si chantier_id est absent. */
    new_chantier: NewChantierSchema.optional(),
    planning: VisitPlanningSchema.optional(),
    /** Passe outre l'avertissement de doublon de chantier. */
    force_new_chantier: z.boolean().optional().default(false),
    /** Clé générée côté client, une par tentative de soumission. */
    idempotency_key: z.string().min(8).max(80),
    /** Lots métier (visite BTP). */
    lots: z.array(VisitLotSchema).max(9).optional().default([]),
  })
  .refine((v) => !!v.chantier_id || !!v.new_chantier, {
    message: "Chantier existant ou nouveau chantier requis.",
    path: ["chantier_id"],
  })
  .refine((v) => v.visit_type !== "btp" || v.lots.length > 0, {
    message: "Choisissez au moins un lot.",
    path: ["lots"],
  });

export const VisitFiltersSchema = z.object({
  companyId: z.string().uuid(),
  search: z.string().trim().max(200).optional().default(""),
  visit_type: VisitTypeSchema.nullable().optional(),
  lot: VisitLotSchema.nullable().optional(),
  status: VisitStatusSchema.nullable().optional(),
  group: z.enum(["all", "a_reprendre"]).optional().default("all"),
  assigned_to: z.string().uuid().nullable().optional(),
  chantier_id: z.string().uuid().nullable().optional(),
  client_id: z.string().uuid().nullable().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  include_archived: z.boolean().optional().default(false),
  offset: z.number().int().min(0).max(10000).optional().default(0),
  limit: z.number().int().min(1).max(100).optional().default(30),
});

export const ConstraintPayloadSchema = z.object({
  id: z.string().uuid().optional(),
  section_key: z.string().max(80).nullable().optional(),
  category: ConstraintCategorySchema,
  level: ConstraintLevelSchema,
  title: z.string().trim().min(1, "Titre requis").max(200),
  description: z.string().trim().max(3000).optional().default(""),
  recommendation: z.string().trim().max(3000).optional().default(""),
  location: z.string().trim().max(300).optional().default(""),
  responsible: z.string().trim().max(200).optional().default(""),
  lot: VisitLotSchema.nullable().optional(),
  photo_paths: z.array(z.string().min(1).max(500)).max(10).optional().default([]),
});

export const VisitPhotoPayloadSchema = z.object({
  section_key: z.string().min(1).max(80),
  slot_key: z.string().min(1).max(160),
  storage_path: z.string().min(1).max(500),
  caption: z.string().trim().max(500).nullable().optional(),
  comment: z.string().trim().max(2000).nullable().optional(),
  latitude: z.number().finite().nullable().optional(),
  longitude: z.number().finite().nullable().optional(),
  accuracy: z.number().finite().nullable().optional(),
  taken_at: z.string().nullable().optional(),
  exif_metadata: z.record(z.string(), z.any()).nullable().optional(),
  file_hash: z.string().max(128).nullable().optional(),
  file_name: z.string().max(300).nullable().optional(),
  file_size: z.number().int().nonnegative().nullable().optional(),
});

export type CreateVisitInput = z.infer<typeof CreateVisitSchema>;
export type VisitFiltersInput = z.infer<typeof VisitFiltersSchema>;
export type ConstraintPayload = z.infer<typeof ConstraintPayloadSchema>;
export type VisitPhotoPayload = z.infer<typeof VisitPhotoPayloadSchema>;

/** Création rapide d'un client depuis l'assistant de visite technique. */
export const QuickClientSchema = z
  .object({
    companyId: z.string().uuid(),
    client_type: z.enum(["particulier", "entreprise"]).default("particulier"),
    name: z.string().trim().min(2, "Nom du client requis (2 caractères minimum).").max(200),
    company_name: z.string().trim().max(200).optional().nullable(),
    email: z
      .string()
      .trim()
      .max(254)
      .optional()
      .nullable()
      .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Adresse e-mail invalide."),
    phone: z
      .string()
      .trim()
      .max(30)
      .optional()
      .nullable()
      .refine((v) => !v || /^\+?[0-9 .-]{6,20}$/.test(v), "Numéro de téléphone invalide."),
    address_line1: z.string().trim().max(300).default(""),
    postal_code: z
      .string()
      .trim()
      .max(10)
      .default("")
      .refine((v) => !v || /^[0-9]{5}$/.test(v), "Code postal : 5 chiffres."),
    city: z.string().trim().max(150).default(""),
  });
export type QuickClientInput = z.infer<typeof QuickClientSchema>;

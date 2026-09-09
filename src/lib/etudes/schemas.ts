/** Cahiers des charges — schémas de validation partagés (client + serveur). */
import { z } from "zod";

export const StudyTypeSchema = z.enum(["photovoltaique", "pac_air_air", "pac_air_eau"]);

export const StudyStatusSchema = z.enum([
  "draft",
  "in_progress",
  "internal_review",
  "completed",
  "sent",
  "accepted",
  "refused",
  "archived",
]);

export const StudyAnswerValueSchema = z.union([
  z.string().max(5000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(200)).max(50),
  z.null(),
]);

export const StudyAnswerEntrySchema = z.object({
  section_key: z.string().min(1).max(80),
  field_key: z.string().min(1).max(120),
  value: StudyAnswerValueSchema,
});

export const CreateStudySchema = z.object({
  companyId: z.string().uuid(),
  study_type: StudyTypeSchema,
  client_id: z.string().uuid(),
  title: z.string().trim().max(200).optional().default(""),
  site_address: z.string().trim().max(300).optional().default(""),
  site_postal_code: z.string().trim().max(20).optional().default(""),
  site_city: z.string().trim().max(150).optional().default(""),
  assigned_to: z.string().uuid().nullable().optional(),
});

export const UpdateStudySchema = z.object({
  companyId: z.string().uuid(),
  studyId: z.string().uuid(),
  title: z.string().trim().max(200).optional(),
  site_address: z.string().trim().max(300).optional(),
  site_postal_code: z.string().trim().max(20).optional(),
  site_city: z.string().trim().max(150).optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  summary: z.string().trim().max(8000).optional(),
});

export const StudyFiltersSchema = z.object({
  companyId: z.string().uuid(),
  search: z.string().trim().max(200).optional().default(""),
  study_type: StudyTypeSchema.nullable().optional(),
  status: StudyStatusSchema.nullable().optional(),
  client_id: z.string().uuid().nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  include_archived: z.boolean().optional().default(false),
  offset: z.number().int().min(0).max(10000).optional().default(0),
  limit: z.number().int().min(1).max(100).optional().default(30),
});

export const StudyDocumentSchema = z.object({
  kind: z.enum(["photo", "document"]).default("document"),
  category: z.string().trim().min(1).max(80),
  label: z.string().trim().max(200).optional().default(""),
  description: z.string().trim().max(2000).optional().default(""),
  doc_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  storage_path: z.string().min(8).max(500),
  mime_type: z.string().min(3).max(120),
  size_bytes: z.number().int().min(0).max(20 * 1024 * 1024),
});

export const StudyNoteSchema = z.object({
  companyId: z.string().uuid(),
  studyId: z.string().uuid(),
  visibility: z.enum(["internal", "client"]),
  body: z.string().trim().min(1, "Note vide.").max(5000),
});

export const StudyDecisionSchema = z.object({
  companyId: z.string().uuid(),
  studyId: z.string().uuid(),
  decision: z.enum(["accepted", "refused"]),
  reason: z.string().trim().max(2000).optional().default(""),
});

export const StudyConversionSchema = z.object({
  companyId: z.string().uuid(),
  studyId: z.string().uuid(),
  create_chantier: z.boolean().default(true),
  create_visit: z.boolean().default(false),
});

/** Types MIME acceptés pour les pièces jointes d'une étude. */
export const STUDY_ALLOWED_MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const STUDY_MAX_FILE_BYTES = 10 * 1024 * 1024;

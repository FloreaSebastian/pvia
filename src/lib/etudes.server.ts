/**
 * Cahiers des charges — helpers serveur (droits, complétude, instantanés).
 * Importé uniquement par src/lib/etudes.functions.ts et le générateur PDF.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { computeProgress } from "./visites/engine";
import type { AnswerMap, VisitTemplate } from "./visites/types";
import { getStudyTemplate } from "./etudes/templates";
import { computeStudyEstimate } from "./etudes/estimate";
import { LOCKED_STUDY_STATUSES, type StudyStatus, type StudyType } from "./etudes/types";

export const STUDY_BUCKET = "pv-assets";
/** Durée de vie volontairement courte des liens de téléchargement. */
export const STUDY_SIGNED_TTL = 120;

type SB = SupabaseClient<Database>;
type StudyRow = Database["public"]["Tables"]["technical_studies"]["Row"];

/** Lecture : tout membre actif de l'entreprise. */
export async function assertStudyMember(sb: SB, companyId: string, userId: string) {
  const { data, error } = await sb.rpc("is_company_member", { _company_id: companyId, _user_id: userId });
  if (error) throw new Error("Vérification des droits impossible.");
  if (data !== true) throw new Error("Accès refusé.");
}

/** Écriture : rôle de gestion + entreprise en droit d'écrire (abonnement). */
export async function assertStudyManage(sb: SB, companyId: string, userId: string) {
  const { data, error } = await sb.rpc("can_manage_company", { _company_id: companyId, _user_id: userId });
  if (error) throw new Error("Vérification des droits impossible.");
  if (data !== true) throw new Error("Droits insuffisants.");
  const guard = await import("./plan-guard.server");
  await guard.assertCompanyWriteAccess(companyId, userId);
}

/** Administration (validation, décision commerciale, suppression). */
export async function assertStudyAdmin(sb: SB, companyId: string, userId: string) {
  const { data, error } = await sb.rpc("is_company_admin", { _company_id: companyId, _user_id: userId });
  if (error) throw new Error("Vérification des droits impossible.");
  if (data !== true) throw new Error("Droits insuffisants : action réservée à la direction.");
  const guard = await import("./plan-guard.server");
  await guard.assertCompanyWriteAccess(companyId, userId);
}

export async function loadStudyScoped(sb: SB, companyId: string, studyId: string): Promise<StudyRow> {
  const { data, error } = await sb
    .from("technical_studies")
    .select("*")
    .eq("id", studyId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error("Lecture du cahier des charges impossible.");
  if (!data) throw new Error("Cahier des charges introuvable.");
  return data as StudyRow;
}

export function isStudyLocked(status: string): boolean {
  return (LOCKED_STUDY_STATUSES as string[]).includes(status);
}

/** Écriture sur une étude précise : droits + étude non figée. */
export async function assertCanEditStudy(sb: SB, companyId: string, studyId: string, userId: string) {
  await assertStudyManage(sb, companyId, userId);
  const study = await loadStudyScoped(sb, companyId, studyId);
  if (isStudyLocked(study.status)) {
    throw new Error("Ce cahier des charges est clôturé : il ne peut plus être modifié.");
  }
  return study;
}

export async function loadStudyAnswers(sb: SB, studyId: string): Promise<AnswerMap> {
  const { data } = await sb.from("technical_study_answers").select("field_key,value").eq("study_id", studyId);
  const map: AnswerMap = {};
  for (const row of (data ?? []) as { field_key: string; value: unknown }[]) {
    map[row.field_key] = row.value as never;
  }
  return map;
}

/** Le template d'étude est structurellement compatible avec le moteur des visites. */
function asEngineTemplate(type: StudyType): VisitTemplate {
  return getStudyTemplate(type) as unknown as VisitTemplate;
}

export function computeStudyProgress(type: StudyType, answers: AnswerMap, photoSlots: Set<string>) {
  return computeProgress(asEngineTemplate(type), {
    answers,
    photoSlots,
    skippedSlots: new Set<string>(),
    constraintCount: 0,
  });
}

/** Recalcule complétude + estimation et les persiste. Retourne les valeurs à jour. */
export async function refreshStudyState(sb: SB, studyId: string) {
  const { data: study } = await sb
    .from("technical_studies")
    .select("id,company_id,study_type,status")
    .eq("id", studyId)
    .maybeSingle();
  if (!study) throw new Error("Cahier des charges introuvable.");

  const answers = await loadStudyAnswers(sb, studyId);
  const { data: docs } = await sb
    .from("technical_study_documents")
    .select("label,kind")
    .eq("study_id", studyId)
    .eq("kind", "photo");
  const photoSlots = new Set<string>((docs ?? []).map((d) => (d as { label: string | null }).label ?? "").filter(Boolean));

  const type = (study as { study_type: StudyType }).study_type;
  const progress = computeStudyProgress(type, answers, photoSlots);
  const estimate = computeStudyEstimate(type, answers);

  const patch: Record<string, unknown> = {
    completion_percent: progress.percent,
    estimate: estimate as unknown as Record<string, unknown>,
  };
  if ((study as { status: string }).status === "draft" && progress.percent > 0) patch.status = "in_progress";

  await sb.from("technical_studies").update(patch as never).eq("id", studyId);
  return { percent: progress.percent, estimate, progress, answers };
}

/**
 * Transitions autorisées du CYCLE TECHNIQUE uniquement.
 * L'axe commercial (devis) vit dans technical_studies.quote_status et n'a
 * aucune influence ici : un cahier des charges « envoyé » reste « envoyé »
 * même quand le devis est accepté.
 * `accepted`/`refused` sont des statuts hérités (avant séparation des axes) :
 * ils restent lisibles mais ne sont plus une cible de transition.
 */
const TRANSITIONS: Record<StudyStatus, StudyStatus[]> = {
  draft: ["in_progress", "archived"],
  in_progress: ["internal_review", "completed", "archived"],
  internal_review: ["in_progress", "completed", "archived"],
  completed: ["sent", "in_progress", "archived"],
  sent: ["completed", "archived"],
  accepted: ["archived"],
  refused: ["archived"],
  archived: [],
};

export function assertStudyTransition(from: string, to: StudyStatus) {
  const allowed = TRANSITIONS[from as StudyStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`Transition impossible depuis « ${from} ».`);
  }
}


/** Instantané complet figé à chaque envoi client. */
export async function buildStudySnapshot(sb: SB, studyId: string) {
  const [{ data: study }, answersRes, docsRes, notesRes] = await Promise.all([
    sb.from("technical_studies").select("*").eq("id", studyId).maybeSingle(),
    sb.from("technical_study_answers").select("section_key,field_key,value").eq("study_id", studyId),
    sb.from("technical_study_documents").select("id,kind,category,label,description,doc_date,storage_path").eq("study_id", studyId),
    // Les notes internes ne sont JAMAIS figées dans un instantané destiné au client.
    sb.from("technical_study_notes").select("body,created_at").eq("study_id", studyId).eq("visibility", "client"),
  ]);
  return {
    study: study ?? null,
    answers: answersRes.data ?? [],
    documents: docsRes.data ?? [],
    client_notes: notesRes.data ?? [],
    frozen_at: new Date().toISOString(),
  };
}

export function studyStoragePrefix(companyId: string, studyId: string): string {
  return `${companyId}/etudes/${studyId}/`;
}

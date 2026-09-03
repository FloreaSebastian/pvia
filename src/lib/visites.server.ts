/**
 * Visites techniques — helpers serveur (droits, anti-doublon, signature d'URL).
 * Importé uniquement par src/lib/visites.functions.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getVisitTemplate } from "./visites/templates";
import { computeProgress } from "./visites/engine";
import type { AnswerMap, VisitType } from "./visites/types";

export const VISIT_BUCKET = "pv-assets";
export const VISIT_SIGNED_TTL = 60 * 60; // 1 h

type SB = SupabaseClient<Database>;

export async function assertCanManage(sb: SB, companyId: string, userId: string) {
  const { data, error } = await sb.rpc("can_manage_company", { _company_id: companyId, _user_id: userId });
  if (error) throw new Error("Vérification des droits impossible.");
  if (data !== true) throw new Error("Droits insuffisants.");
  const guard = await import("./plan-guard.server");
  await guard.assertCompanyWriteAccess(companyId, userId);
  await guard.assertPlanFeature(companyId, "technical_visits", userId);
}

export async function assertIsMember(sb: SB, companyId: string, userId: string) {
  const { data, error } = await sb.rpc("is_company_member", { _company_id: companyId, _user_id: userId });
  if (error) throw new Error("Vérification des droits impossible.");
  if (data !== true) throw new Error("Accès refusé.");
}

/** Visite accessible en lecture et appartenant bien à l'entreprise passée. */
export async function loadVisitScoped(sb: SB, companyId: string, visitId: string) {
  const { data, error } = await sb
    .from("technical_visits")
    .select("*")
    .eq("id", visitId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error("Lecture de la visite impossible.");
  if (!data) throw new Error("Visite introuvable.");
  return data;
}

/** Droit d'écriture terrain : rôle de gestion OU technicien assigné, hors visite figée. */
export async function assertCanEditVisit(sb: SB, companyId: string, visitId: string, userId: string) {
  const visit = await loadVisitScoped(sb, companyId, visitId);
  const guard = await import("./plan-guard.server");
  await guard.assertCompanyWriteAccess(companyId, userId);
  await guard.assertPlanFeature(companyId, "technical_visits", userId);
  const { data, error } = await sb.rpc("can_edit_technical_visit", { _visit_id: visitId, _user_id: userId });
  if (error) throw new Error("Vérification des droits impossible.");
  if (data !== true) {
    throw new Error(
      visit.status === "validee" || visit.status === "archivee"
        ? "Cette visite est clôturée : elle ne peut plus être modifiée."
        : "Droits insuffisants pour modifier cette visite.",
    );
  }
  return visit;
}

/** Normalisation d'adresse pour la détection de doublon de chantier. */
export function normalizeAddressKey(parts: {
  address_line1?: string | null;
  postal_code?: string | null;
  city?: string | null;
}): string {
  const raw = [parts.address_line1, parts.postal_code, parts.city].filter(Boolean).join(" ");
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(rue|avenue|av|boulevard|bd|impasse|imp|chemin|ch|route|rte|allee|place|pl)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function composeAddress(line1: string, postal: string, city: string): string | null {
  const parts: string[] = [];
  if (line1.trim()) parts.push(line1.trim());
  const cp = [postal.trim(), city.trim()].filter(Boolean).join(" ");
  if (cp) parts.push(cp);
  return parts.join(", ") || null;
}

/** Nom de chantier généré automatiquement : « Photovoltaïque — M. Dupont ». */
export function buildChantierName(visitType: VisitType, clientLabel: string): string {
  const label = getVisitTemplate(visitType).label;
  const who = clientLabel.trim();
  return (who ? `${label} — ${who}` : label).slice(0, 200);
}

export interface DuplicateCandidate {
  id: string;
  name: string;
  reference: string;
  address: string | null;
  type: string | null;
  status: string;
  score: "adresse_et_type" | "adresse" | "type";
}

/**
 * Chantiers actifs du client susceptibles de correspondre.
 * Jamais de fusion automatique : l'utilisateur tranche.
 */
export async function findChantierDuplicates(
  sb: SB,
  companyId: string,
  clientId: string,
  visitType: VisitType,
  address: { address_line1?: string | null; postal_code?: string | null; city?: string | null },
): Promise<DuplicateCandidate[]> {
  const { data, error } = await sb
    .from("chantiers")
    .select("id,name,reference,address,address_line1,postal_code,city,type,status")
    .eq("company_id", companyId)
    .eq("client_id", clientId)
    .not("status", "in", "(archive,termine)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return [];

  const target = normalizeAddressKey(address);
  const chantierType = getVisitTemplate(visitType).chantierType.toLowerCase();
  const out: DuplicateCandidate[] = [];
  for (const c of data ?? []) {
    const key = normalizeAddressKey(c);
    const sameAddress = target.length > 3 && key.length > 3 && (key === target || key.includes(target) || target.includes(key));
    const sameType = (c.type ?? "").toLowerCase() === chantierType;
    if (!sameAddress && !sameType) continue;
    out.push({
      id: c.id,
      name: c.name,
      reference: c.reference,
      address: c.address,
      type: c.type,
      status: c.status,
      score: sameAddress && sameType ? "adresse_et_type" : sameAddress ? "adresse" : "type",
    });
  }
  const rank = { adresse_et_type: 0, adresse: 1, type: 2 } as const;
  return out.sort((a, b) => rank[a.score] - rank[b.score]).slice(0, 5);
}

/** Signe en lot les chemins de stockage des photos d'une visite. */
export async function signVisitPhotos<T extends { storage_path: string }>(
  sb: SB,
  rows: T[],
): Promise<(T & { signed_url: string | null })[]> {
  if (rows.length === 0) return [];
  const paths = rows.map((r) => r.storage_path);
  const { data } = await sb.storage.from(VISIT_BUCKET).createSignedUrls(paths, VISIT_SIGNED_TTL);
  const map = new Map<string, string>();
  for (const s of data ?? []) if (s.path && s.signedUrl) map.set(s.path, s.signedUrl);
  return rows.map((r) => ({ ...r, signed_url: map.get(r.storage_path) ?? null }));
}

/** Recalcule et persiste completion_percent depuis les données réellement en base. */
export async function refreshVisitCompletion(sb: SB, visitId: string): Promise<number> {
  const { data: visit } = await sb
    .from("technical_visits")
    .select("id,visit_type,status")
    .eq("id", visitId)
    .maybeSingle();
  if (!visit) return 0;

  const [answersRes, photosRes, skipsRes, constraintsRes] = await Promise.all([
    sb.from("technical_visit_answers").select("field_key,value").eq("visit_id", visitId),
    sb.from("technical_visit_photos").select("slot_key").eq("visit_id", visitId),
    sb.from("technical_visit_photo_skips").select("slot_key").eq("visit_id", visitId),
    sb.from("technical_visit_constraints").select("id").eq("visit_id", visitId),
  ]);

  const answers: AnswerMap = {};
  for (const a of answersRes.data ?? []) answers[a.field_key] = a.value as never;

  const progress = computeProgress(getVisitTemplate(visit.visit_type as VisitType), {
    answers,
    photoSlots: new Set((photosRes.data ?? []).map((p) => p.slot_key)),
    skippedSlots: new Set((skipsRes.data ?? []).map((s) => s.slot_key)),
    constraintCount: (constraintsRes.data ?? []).length,
  });

  await sb.from("technical_visits").update({ completion_percent: progress.percent }).eq("id", visitId);
  return progress.percent;
}

/** Transitions de statut autorisées (garde métier côté serveur). */
export const VISIT_TRANSITIONS: Record<string, string[]> = {
  a_planifier: ["planifiee", "en_cours", "archivee"],
  planifiee: ["a_planifier", "en_cours", "archivee"],
  en_cours: ["a_completer", "terminee", "planifiee", "archivee"],
  a_completer: ["en_cours", "terminee", "archivee"],
  terminee: ["validee", "en_cours", "archivee"],
  validee: ["archivee", "en_cours"],
  archivee: ["planifiee"],
};

export function assertTransition(from: string, to: string) {
  if (from === to) return;
  if (!VISIT_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Transition impossible : ${from} → ${to}.`);
  }
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

export const PV_DRAFT_STATUSES = ['brouillon', 'en_cours'];
export const PV_PENDING_STATUSES = ['en_attente', 'en_attente_signature', 'envoye', 'envoye_au_client'];
export const ACTIVE_CHANTIER_STATUSES = ['preparation', 'planifie', 'en_cours', 'en_attente'];
export const VISIT_DRAFT_STATUSES = ['a_planifier', 'planifiee', 'en_cours', 'a_completer'];
export const SIGNATURE_WAIT_DAYS = 7;
export function signatureCutoff(now = new Date()) {
  return new Date(now.getTime() - SIGNATURE_WAIT_DAYS * 86400000).toISOString();
}
export function dashboardDate(value: string, time = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date non renseignée';
  return date.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', ...(time ? { hour: '2-digit', minute: '2-digit' } : { year: 'numeric' }) });
}
export type DashboardPv = { id: string; numero: string; status: string; created_at: string; sent_to_client_at: string | null; chantiers: { name: string } | null; clients: { name: string } | null };
export type DashboardVisit = { id: string; reference: string; status: string; assigned_to: string | null; scheduled_at: string | null; completion_percent: number; chantiers: { name: string } | null; clients: { name: string } | null };
export type DashboardEvent = { id: string; title: string; start_at: string | null; chantier_id: string; chantiers: { name: string } | null };
export type DashboardData = {
  counts: { drafts: number; pending: number; reserves: number; chantiers: number; blocking: number; late: number; visits: number | null };
  recent: DashboardPv[]; late: DashboardPv[]; visits: DashboardVisit[]; events: DashboardEvent[];
};

/** Exact counts are independent of intentionally short preview lists. All reads use the caller's RLS client. */
export async function loadDashboard(sb: SupabaseClient<Database>, companyId: string, includeVisits: boolean, now = new Date()): Promise<DashboardData> {
  const pv = () => sb.from('pv').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  const reserves = () => sb.from('pv_reserves').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  const pvFields = 'id,numero,status,created_at,sent_to_client_at,chantiers(name),clients(name)' as const;
  const cutoff = signatureCutoff(now);
  const [drafts, pending, open, chantiers, blocking, lateCount, recent, late, events, visitCount, visits] = await Promise.all([
    pv().in('status', PV_DRAFT_STATUSES), pv().in('status', PV_PENDING_STATUSES), reserves().eq('status', 'ouverte'),
    sb.from('chantiers').select('id', { count: 'exact', head: true }).eq('company_id', companyId).in('status', ACTIVE_CHANTIER_STATUSES),
    reserves().eq('severity', 'majeure').not('status', 'in', '(validee,rejetee)'),
    pv().in('status', PV_PENDING_STATUSES).lt('sent_to_client_at', cutoff),
    sb.from('pv').select(pvFields).eq('company_id', companyId).order('created_at', { ascending: false }).order('id').limit(6),
    sb.from('pv').select(pvFields).eq('company_id', companyId).in('status', PV_PENDING_STATUSES).lt('sent_to_client_at', cutoff).order('sent_to_client_at').order('id').limit(3),
    sb.from('chantier_events').select('id,title,start_at,chantier_id,chantiers(name)').eq('company_id', companyId).gte('start_at', now.toISOString()).not('status', 'in', '(cancelled,annule,annulee,done,termine)').order('start_at').order('id').limit(5),
    includeVisits ? sb.from('technical_visits').select('id', { count: 'exact', head: true }).eq('company_id', companyId).in('status', VISIT_DRAFT_STATUSES) : Promise.resolve(null),
    includeVisits ? sb.from('technical_visits').select('id,reference,status,assigned_to,scheduled_at,completion_percent,chantiers(name),clients(name)').eq('company_id', companyId).in('status', VISIT_DRAFT_STATUSES).order('scheduled_at', { nullsFirst: false }).order('created_at', { ascending: false }).order('id').limit(5) : Promise.resolve(null),
  ]);
  for (const result of [drafts, pending, open, chantiers, blocking, lateCount, recent, late, events, visitCount, visits]) {
    if (result?.error) throw new Error('Le tableau de bord ne peut pas être chargé. Réessayez.');
  }
  const count = (r: { count: number | null }) => {
    if (r.count === null) throw new Error('Compteurs indisponibles. Réessayez.');
    return r.count;
  };
  return { counts: { drafts: count(drafts), pending: count(pending), reserves: count(open), chantiers: count(chantiers), blocking: count(blocking), late: count(lateCount), visits: visitCount ? count(visitCount) : null }, recent: recent.data ?? [], late: late.data ?? [], events: events.data ?? [], visits: visits?.data ?? [] };
}

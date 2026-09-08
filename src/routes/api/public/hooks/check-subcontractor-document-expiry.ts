/**
 * Cron — échéances des pièces administratives des sous-traitants.
 *
 * À planifier 1×/jour. Jalons : J-60, J-30, J-7, jour J, puis relance
 * hebdomadaire après expiration.
 *
 * Idempotence stricte : une ligne unique (document_id, milestone, expiry_date)
 * dans `subcontractor_document_alerts` — un rejeu du cron n'envoie rien.
 *
 * Destinataires : administrateurs internes de l'entreprise donneuse d'ordre
 * (directeur, responsable exploitation). Aucun sous-traitant notifié en V1.
 *
 * Protégé par x-cron-secret.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { docTypeLabel, formatFrDate, EXPIRY_ALERT_DAYS, EXPIRED_REMINDER_DAYS } from "@/lib/subcontractor-compliance";

function getDb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any;
}

function daysUntil(dateIso: string, now: Date): number {
  const target = Date.parse(`${dateIso.slice(0, 10)}T00:00:00Z`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86400000);
}

/** Jalon applicable, ou null si aucune alerte n'est due aujourd'hui. */
export function milestoneFor(days: number): string | null {
  if (days < 0) {
    const overdue = -days;
    if (overdue % EXPIRED_REMINDER_DAYS !== 0) return null;
    return `expired+${overdue}`;
  }
  return (EXPIRY_ALERT_DAYS as readonly number[]).includes(days) ? `j-${days}` : null;
}

async function run() {
  const db = getDb();
  const now = new Date();

  const { data: docs, error } = await db
    .from("subcontractor_documents")
    .select("id,company_id,subcontractor_company_id,doc_type,label,expiry_date,is_required,is_blocking")
    .is("archived_at", null)
    .not("expiry_date", "is", null)
    .limit(2000);
  if (error) throw new Error(error.message);

  let scanned = 0;
  let alerted = 0;
  let skipped = 0;

  for (const d of (docs ?? []) as Array<{
    id: string; company_id: string; subcontractor_company_id: string;
    doc_type: string; label: string | null; expiry_date: string;
    is_required: boolean; is_blocking: boolean;
  }>) {
    scanned++;
    if (!d.is_required) { skipped++; continue; }
    const days = daysUntil(d.expiry_date, now);
    const milestone = milestoneFor(days);
    if (!milestone) { skipped++; continue; }

    // Idempotence : la contrainte unique fait foi.
    const { error: dupErr } = await db
      .from("subcontractor_document_alerts")
      .insert({ company_id: d.company_id, document_id: d.id, milestone, expiry_date: d.expiry_date });
    if (dupErr) { skipped++; continue; }

    const { data: partner } = await db
      .from("subcontractor_companies")
      .select("name")
      .eq("id", d.subcontractor_company_id)
      .maybeSingle();

    const label = docTypeLabel(d.doc_type, d.label);
    const title =
      days < 0
        ? `Pièce expirée — ${partner?.name ?? "sous-traitant"}`
        : days === 0
          ? `Pièce expirant aujourd'hui — ${partner?.name ?? "sous-traitant"}`
          : `Pièce à renouveler — ${partner?.name ?? "sous-traitant"}`;
    const body =
      days < 0
        ? `${label} est expirée depuis le ${formatFrDate(d.expiry_date)}.${d.is_blocking ? " Les nouvelles affectations sont bloquées." : ""}`
        : `${label} expire le ${formatFrDate(d.expiry_date)} (dans ${days} jour${days > 1 ? "s" : ""}).`;

    const { data: admins } = await db
      .from("company_members")
      .select("user_id")
      .eq("company_id", d.company_id)
      .eq("status", "active")
      .in("role", ["directeur", "responsable_exploitation"]);

    let recipients = 0;
    for (const m of (admins ?? []) as { user_id: string | null }[]) {
      if (!m.user_id) continue;
      await db.from("notifications").insert({
        company_id: d.company_id,
        user_id: m.user_id,
        type: days < 0 ? "subcontractor_document_expired" : "subcontractor_document_expiring",
        title,
        body,
      });
      recipients++;
    }

    await db
      .from("subcontractor_document_alerts")
      .update({ recipients })
      .eq("document_id", d.id)
      .eq("milestone", milestone)
      .eq("expiry_date", d.expiry_date);

    await db.from("audit_logs").insert({
      company_id: d.company_id,
      user_id: null,
      entity_type: "subcontractor_document",
      entity_id: d.id,
      action: days < 0 ? "subcontractor_document.expired_alert_sent" : "subcontractor_document.expiry_alert_sent",
      metadata: {
        actor: "cron",
        milestone,
        expiry_date: d.expiry_date,
        doc_type: d.doc_type,
        subcontractor_company_id: d.subcontractor_company_id,
        recipients,
      },
    });
    alerted++;
  }

  return { scanned, alerted, skipped };
}

async function handle(request: Request) {
  const secret = request.headers.get("x-cron-secret");
  if (!secret || !process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const r = await run();
    return Response.json({ ok: true, ...r });
  } catch (e) {
    console.error("[subcontractor-document-expiry] failed", e);
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/hooks/check-subcontractor-document-expiry")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request),
    },
  },
});

/**
 * Cron — échéances des pièces administratives des sous-traitants.
 *
 * Réutilise l'architecture cron déjà en place dans PVIA (pg_cron + pg_net →
 * route `/api/public/hooks/*` protégée par `x-cron-secret`), la table
 * `notifications` et le fan-out push `sendPushToUser`, comme le job des
 * essais Stripe expirants. Aucun second système parallèle.
 *
 * Jalons : J-60, J-30, J-7, J0, puis relance hebdomadaire (J+7, J+14, …).
 * Les jours sont calculés en **date locale Europe/Paris** (DST compris).
 *
 * Idempotence : contrainte unique (document_id, milestone, expiry_date) sur
 * `subcontractor_document_alerts`. L'insertion se fait AVANT tout envoi ; un
 * rejeu du cron, un retry ou un redéploiement n'envoie donc rien de plus.
 *
 * Destinataires : administrateurs internes actifs de l'entreprise donneuse
 * d'ordre (directeur, responsable exploitation). Jamais un autre tenant,
 * jamais le sous-traitant, jamais de lien Storage dans la notification.
 *
 * Planification : une fois par jour, 8h00 Europe/Paris. pg_cron tourne en UTC :
 * le job est déclenché à 05/06/07 UTC et cette route ne travaille qu'à l'heure
 * locale cible (`RUN_HOUR_PARIS`), ce qui absorbe les bascules été/hiver.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { docTypeLabel, formatFrDate } from "@/lib/subcontractor-compliance";
import {
  parisDateString,
  parisHour,
  planAlerts,
  type PlannedAlert,
  type ScheduleDoc,
  type SchedulePartner,
  type ScheduleRule,
} from "@/lib/subcontractor-expiry-schedule";
import { sendPushToUser } from "@/lib/push.server";

/** Heure locale Paris à laquelle le travail réel est effectué. */
export const RUN_HOUR_PARIS = 8;

function getDb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any;
}

export function alertCopy(a: PlannedAlert) {
  const label = docTypeLabel(a.document.doc_type, a.document.label);
  const partner = a.partner.name;
  const date = formatFrDate(a.document.expiry_date);
  if (a.state === "expired") {
    const overdue = -a.days;
    return {
      type: "subcontractor_document_expired",
      title: `Pièce expirée — ${partner}`,
      body: `${label} est expirée depuis le ${date} (${overdue} jour${overdue > 1 ? "s" : ""}).${
        a.blocking ? " Les nouvelles affectations de ce partenaire sont bloquées." : ""
      } Ouvrez la fiche partenaire, onglet Documents, pour déposer la nouvelle version.`,
    };
  }
  if (a.state === "expiring_today") {
    return {
      type: "subcontractor_document_expiring",
      title: `Pièce expirant aujourd'hui — ${partner}`,
      body: `${label} expire aujourd'hui, le ${date}. Ouvrez la fiche partenaire, onglet Documents, pour la remplacer.`,
    };
  }
  return {
    type: "subcontractor_document_expiring",
    title: `Pièce à renouveler — ${partner}`,
    body: `${label} expire le ${date} (dans ${a.days} jour${a.days > 1 ? "s" : ""}). Ouvrez la fiche partenaire, onglet Documents, pour la remplacer.`,
  };
}

type RunResult = {
  started_at: string;
  finished_at: string;
  paris_date: string;
  paris_hour: number;
  ran: boolean;
  scanned: number;
  planned: number;
  alerts_created: number;
  skipped: number;
  duplicates: number;
  notifications: number;
  pushes: number;
  errors: number;
};

async function run(force: boolean, now = new Date()): Promise<RunResult> {
  const startedAt = new Date();
  const hour = parisHour(now);
  const base = {
    started_at: startedAt.toISOString(),
    paris_date: parisDateString(now),
    paris_hour: hour,
    scanned: 0,
    planned: 0,
    alerts_created: 0,
    skipped: 0,
    duplicates: 0,
    notifications: 0,
    pushes: 0,
    errors: 0,
  };
  if (!force && hour !== RUN_HOUR_PARIS) {
    return { ...base, ran: false, finished_at: new Date().toISOString() };
  }

  const db = getDb();

  const { data: docsRaw, error } = await db
    .from("subcontractor_documents")
    .select(
      "id,company_id,subcontractor_company_id,doc_type,label,expiry_date,is_required,is_blocking,archived_at,replaced_by_id",
    )
    .is("archived_at", null)
    .not("expiry_date", "is", null)
    .limit(5000);
  if (error) throw new Error(error.message);
  const docs = (docsRaw ?? []) as ScheduleDoc[];

  const partnerIds = [...new Set(docs.map((d) => d.subcontractor_company_id))];
  const [{ data: partnersRaw }, { data: rulesRaw }] = await Promise.all([
    partnerIds.length
      ? db.from("subcontractor_companies").select("id,name,status,archived_at").in("id", partnerIds)
      : Promise.resolve({ data: [] }),
    partnerIds.length
      ? db
          .from("subcontractor_document_rules")
          .select("subcontractor_company_id,doc_type,is_required,is_blocking")
          .in("subcontractor_company_id", partnerIds)
      : Promise.resolve({ data: [] }),
  ]);

  const { planned, skipped } = planAlerts(
    docs,
    (rulesRaw ?? []) as ScheduleRule[],
    (partnersRaw ?? []) as SchedulePartner[],
    now,
  );

  const result: RunResult = {
    ...base,
    ran: true,
    finished_at: startedAt.toISOString(),
    scanned: docs.length,
    planned: planned.length,
    skipped: skipped.length,
  };

  for (const a of planned) {
    try {
      // 1) Verrou d'idempotence AVANT tout envoi.
      const { error: dupErr } = await db.from("subcontractor_document_alerts").insert({
        company_id: a.document.company_id,
        document_id: a.document.id,
        milestone: a.milestone,
        expiry_date: a.document.expiry_date,
        recipients: 0,
      });
      if (dupErr) {
        result.duplicates++;
        continue;
      }

      const { title, body, type } = alertCopy(a);

      // 2) Destinataires recalculés côté serveur, strictement dans le tenant.
      const { data: admins } = await db
        .from("company_members")
        .select("user_id")
        .eq("company_id", a.document.company_id)
        .eq("status", "active")
        .in("role", ["directeur", "responsable_exploitation"]);

      let recipients = 0;
      for (const m of (admins ?? []) as { user_id: string | null }[]) {
        if (!m.user_id) continue;
        const { error: notifErr } = await db.from("notifications").insert({
          company_id: a.document.company_id,
          user_id: m.user_id,
          type,
          title,
          body,
        });
        if (notifErr) {
          // Échec d'un destinataire : compté, journalisé, sans bloquer les autres.
          result.errors++;
          console.error("[subcontractor-document-expiry] notification failed", {
            documentId: a.document.id,
            milestone: a.milestone,
            message: notifErr.message,
          });
          continue;
        }
        recipients++;
        result.notifications++;

        try {
          // Lien vers la FICHE partenaire, jamais une URL Storage signée.
          const r = await sendPushToUser(m.user_id, {
            title,
            body,
            url: `/sous-traitants?partenaire=${a.partner.id}&onglet=documents`,
            tag: `sc-doc-${a.document.id}-${a.milestone}`,
            data: { kind: type, subcontractorCompanyId: a.partner.id },
          });
          result.pushes += r.sent;
        } catch {
          /* push best-effort : n'empêche jamais la notification in-app */
        }
      }

      await db
        .from("subcontractor_document_alerts")
        .update({ recipients })
        .eq("document_id", a.document.id)
        .eq("milestone", a.milestone)
        .eq("expiry_date", a.document.expiry_date);

      await db.from("audit_logs").insert({
        company_id: a.document.company_id,
        user_id: null,
        entity_type: "subcontractor_document",
        entity_id: a.document.id,
        action: a.state === "expired" ? "subcontractor_document.expired_alert_sent" : "subcontractor_document.expiry_alert_sent",
        metadata: {
          actor: "cron",
          milestone: a.milestone,
          expiry_date: a.document.expiry_date,
          doc_type: a.document.doc_type,
          subcontractor_company_id: a.partner.id,
          recipients,
        },
      });
      result.alerts_created++;
    } catch (e) {
      // Une pièce en erreur ne bloque jamais les suivantes ; aucune donnée
      // sensible dans le journal (identifiants techniques uniquement).
      result.errors++;
      console.error("[subcontractor-document-expiry] document failed", {
        documentId: a.document.id,
        milestone: a.milestone,
        message: (e as Error).message,
      });
    }
  }

  result.finished_at = new Date().toISOString();
  console.log("[subcontractor-document-expiry] run", result);
  return result;
}

async function handle(request: Request) {
  const secret = request.headers.get("x-cron-secret");
  if (!secret || !process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  const force = new URL(request.url).searchParams.get("force") === "1";
  try {
    const r = await run(force);
    return Response.json({ ok: true, ...r });
  } catch (e) {
    console.error("[subcontractor-document-expiry] failed", (e as Error).message);
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

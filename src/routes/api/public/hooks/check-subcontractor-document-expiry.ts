/**
 * Cron — échéances des pièces administratives des sous-traitants.
 *
 * Réutilise l'architecture cron déjà en place dans PVIA (pg_cron + pg_net →
 * route `/api/public/hooks/*` protégée par `x-cron-secret`), la table
 * `notifications` et le fan-out push `sendPushToUser`, comme le job des
 * essais Stripe expirants. Aucun second système parallèle.
 *
 * Planification : UNE seule exécution par jour (`0 7 * * *` UTC, soit 8h00 en
 * heure d'hiver et 9h00 en heure d'été à Paris — toujours le matin). Aucun
 * garde-fou horaire ici : la DATE MÉTIER est calculée séparément en
 * `Europe/Paris` (`daysUntilParis`), donc les jalons restent justes aux
 * bascules heure d'été / heure d'hiver.
 *
 * Jalons : J-60, J-30, J-7, J0, puis relance hebdomadaire (J+7, J+14, …).
 *
 * Idempotence retry-safe :
 *  - `subcontractor_document_alerts` (unique document/jalon/échéance) porte le
 *    jalon et n'est marqué `completed_at` QUE si tous les destinataires ont
 *    été servis ;
 *  - `subcontractor_document_alert_deliveries` (unique document/jalon/échéance
 *    /destinataire/canal) porte la livraison réelle. Une reprise après échec
 *    partiel ne re-notifie donc jamais un destinataire déjà servi.
 *
 * Destinataires : administrateurs internes actifs du tenant, avec le même
 * prédicat canonique que la fonction SQL `is_company_admin`.
 *
 * Observabilité : une ligne par exécution dans `cron_job_runs`
 * (started/finished/status/compteurs/erreur).
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

export const JOB_NAME = "pvia-subcontractor-document-expiry";

/**
 * Rôles internes habilités — strictement le même prédicat que la fonction SQL
 * canonique `public.is_company_admin` (source de vérité en base).
 */
export const ADMIN_ROLES = ["directeur", "responsable_exploitation"] as const;

/** Conflit de clé unique Postgres — n'est PAS une erreur d'exécution. */
export function isUniqueViolation(err: { code?: string | null } | null): boolean {
  return err?.code === "23505";
}

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
  scanned: number;
  planned: number;
  alerts_created: number;
  alerts_resumed: number;
  alerts_completed: number;
  skipped: number;
  duplicates: number;
  notifications: number;
  already_delivered: number;
  pushes: number;
  errors: number;
};

async function run(now = new Date()): Promise<RunResult> {
  const startedAt = new Date();
  const db = getDb();

  const result: RunResult = {
    started_at: startedAt.toISOString(),
    finished_at: startedAt.toISOString(),
    paris_date: parisDateString(now),
    paris_hour: parisHour(now),
    scanned: 0,
    planned: 0,
    alerts_created: 0,
    alerts_resumed: 0,
    alerts_completed: 0,
    skipped: 0,
    duplicates: 0,
    notifications: 0,
    already_delivered: 0,
    pushes: 0,
    errors: 0,
  };

  // Journal d'exécution ouvert dès le départ (observabilité réelle).
  let runId: string | null = null;
  {
    const { data } = await db
      .from("cron_job_runs")
      .insert({ job_name: JOB_NAME, started_at: result.started_at, status: "running" })
      .select("id")
      .maybeSingle();
    runId = (data?.id as string) ?? null;
  }

  const finish = async (status: string, error?: string) => {
    result.finished_at = new Date().toISOString();
    if (runId) {
      await db
        .from("cron_job_runs")
        .update({ finished_at: result.finished_at, status, stats: result, error: error ?? null })
        .eq("id", runId);
    }
    console.log("[subcontractor-document-expiry] run", { status, ...result });
  };

  try {
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
        ? db
            .from("subcontractor_companies")
            .select("id,company_id,name,status,archived_at")
            .in("id", partnerIds)
        : Promise.resolve({ data: [] }),
      partnerIds.length
        ? db
            .from("subcontractor_document_rules")
            .select("company_id,subcontractor_company_id,doc_type,is_required,is_blocking")
            .in("subcontractor_company_id", partnerIds)
        : Promise.resolve({ data: [] }),
    ]);

    const { planned, skipped } = planAlerts(
      docs,
      (rulesRaw ?? []) as ScheduleRule[],
      (partnersRaw ?? []) as SchedulePartner[],
      now,
    );

    result.scanned = docs.length;
    result.planned = planned.length;
    result.skipped = skipped.length;

    for (const a of planned) {
      // Chaque document est traité isolément : une erreur ne stoppe pas le lot.
      try {
        const alertKey = {
          document_id: a.document.id,
          milestone: a.milestone,
          expiry_date: a.document.expiry_date as string,
        };

        // 1) Jalon : créé s'il n'existe pas. Un conflit unique n'est PAS une
        //    erreur — c'est soit un jalon déjà terminé, soit une reprise.
        const { error: alertErr } = await db
          .from("subcontractor_document_alerts")
          .insert({ company_id: a.document.company_id, recipients: 0, ...alertKey });

        let resuming = false;
        if (alertErr) {
          if (!isUniqueViolation(alertErr)) throw new Error(alertErr.message);
          const { data: existing, error: readErr } = await db
            .from("subcontractor_document_alerts")
            .select("id,completed_at")
            .eq("company_id", a.document.company_id)
            .eq("document_id", alertKey.document_id)
            .eq("milestone", alertKey.milestone)
            .eq("expiry_date", alertKey.expiry_date)
            .maybeSingle();
          if (readErr) throw new Error(readErr.message);
          if (existing?.completed_at) {
            // Jalon déjà entièrement livré : rien à refaire.
            result.duplicates++;
            continue;
          }
          resuming = true;
          result.alerts_resumed++;
        } else {
          result.alerts_created++;
        }

        const { title, body, type } = alertCopy(a);

        // 2) Destinataires recalculés côté serveur, filtrés sur le tenant de la
        //    pièce, avec le prédicat canonique de `is_company_admin`.
        const { data: admins, error: adminErr } = await db
          .from("company_members")
          .select("user_id")
          .eq("company_id", a.document.company_id)
          .eq("status", "active")
          .in("role", ADMIN_ROLES as unknown as string[]);
        if (adminErr) throw new Error(adminErr.message);

        // Livraisons déjà effectuées pour ce jalon (reprise sans doublon).
        const already = new Set<string>();
        if (resuming) {
          const { data: prior } = await db
            .from("subcontractor_document_alert_deliveries")
            .select("user_id")
            .eq("document_id", alertKey.document_id)
            .eq("milestone", alertKey.milestone)
            .eq("expiry_date", alertKey.expiry_date)
            .eq("channel", "inapp");
          for (const p of (prior ?? []) as { user_id: string }[]) already.add(p.user_id);
        }

        let delivered = already.size;
        let failed = 0;

        for (const m of (admins ?? []) as { user_id: string | null }[]) {
          if (!m.user_id) continue;
          if (already.has(m.user_id)) {
            result.already_delivered++;
            continue;
          }
          try {
            const { error: notifErr } = await db.from("notifications").insert({
              company_id: a.document.company_id,
              user_id: m.user_id,
              type,
              title,
              body,
            });
            if (notifErr) throw new Error(notifErr.message);

            // Marque la livraison APRÈS succès : c'est elle qui garantit
            // qu'une reprise ne redonnera pas la même alerte à ce destinataire.
            const { error: delErr } = await db
              .from("subcontractor_document_alert_deliveries")
              .insert({
                company_id: a.document.company_id,
                user_id: m.user_id,
                channel: "inapp",
                ...alertKey,
              });
            if (delErr && !isUniqueViolation(delErr)) throw new Error(delErr.message);

            delivered++;
            result.notifications++;
          } catch (e) {
            failed++;
            result.errors++;
            console.error("[subcontractor-document-expiry] delivery failed", {
              documentId: a.document.id,
              milestone: a.milestone,
              message: (e as Error).message,
            });
            continue;
          }

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

        // 3) Jalon terminé UNIQUEMENT si aucun destinataire n'est resté en
        //    échec — sinon il reste repris au prochain passage.
        const patch: Record<string, unknown> = { recipients: delivered };
        if (failed === 0) {
          patch.completed_at = new Date().toISOString();
          result.alerts_completed++;
        }
        await db
          .from("subcontractor_document_alerts")
          .update(patch)
          .eq("company_id", a.document.company_id)
          .eq("document_id", alertKey.document_id)
          .eq("milestone", alertKey.milestone)
          .eq("expiry_date", alertKey.expiry_date);

        if (failed === 0 && delivered > already.size) {
          await db.from("audit_logs").insert({
            company_id: a.document.company_id,
            user_id: null,
            entity_type: "subcontractor_document",
            entity_id: a.document.id,
            action:
              a.state === "expired"
                ? "subcontractor_document.expired_alert_sent"
                : "subcontractor_document.expiry_alert_sent",
            metadata: {
              actor: "cron",
              milestone: a.milestone,
              expiry_date: a.document.expiry_date,
              doc_type: a.document.doc_type,
              subcontractor_company_id: a.partner.id,
              recipients: delivered,
              resumed: resuming,
            },
          });
        }
      } catch (e) {
        result.errors++;
        console.error("[subcontractor-document-expiry] document failed", {
          documentId: a.document.id,
          milestone: a.milestone,
          message: (e as Error).message,
        });
      }
    }

    await finish(result.errors > 0 ? "partial" : "success");
    return result;
  } catch (e) {
    result.errors++;
    await finish("failed", (e as Error).message);
    throw e;
  }
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

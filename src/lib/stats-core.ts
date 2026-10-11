import { z } from "zod";
import { isoToLocalInputs, localInputToIso } from "./visites/planning";
import { PV_PENDING_STATUSES, signatureCutoff } from "./dashboard";
import { canSignAsCompany } from "./roles";
import { RESERVE_STATUSES, RESERVE_STATUS_LABEL } from "./reserve-status";

export const STATS_TYPES = ["reception", "livraison", "reserve"] as const;
export const STATS_TYPE_LABELS = {
  reception: "Réception",
  livraison: "Livraison",
  reserve: "Levée de réserve",
};
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !!localInputToIso(v, "00:00"), "Date invalide.");
export const StatsInputSchema = z
  .object({
    companyId: z.string().uuid(),
    from: day.optional(),
    to: day,
    pvType: z.enum(STATS_TYPES).optional(),
    userId: z.string().uuid().optional(),
    compare: z.boolean().default(true),
  })
  .refine((v) => !v.from || v.from <= v.to, "La date de début doit précéder la date de fin.");
export type StatsInput = z.infer<typeof StatsInputSchema>;
export type StatsRange = {
  from: string | null;
  to: string;
  start: string | null;
  end: string;
  days: number | null;
};
export function shiftDay(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function statsRange(from: string | undefined, to: string): StatsRange {
  const start = from ? localInputToIso(from, "00:00") : null;
  const end = localInputToIso(shiftDay(to, 1), "00:00");
  if (!end || (from && (!start || from > to))) throw new Error("Période invalide.");
  const days = from
    ? Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000) + 1
    : null;
  return { from: from ?? null, to, start, end, days };
}
export function previousRange(range: StatsRange): StatsRange | null {
  if (!range.from || !range.days) return null;
  return statsRange(shiftDay(range.from, -range.days), shiftDay(range.from, -1));
}
export function presetRange(preset: string, now = new Date()): { from?: string; to: string } {
  const to = isoToLocalInputs(now.toISOString()).date;
  if (preset === "all") return { to };
  if (preset === "12m") {
    const date = new Date(`${to}T12:00:00Z`);
    const originalDay = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCFullYear(date.getUTCFullYear() - 1);
    date.setUTCMonth(date.getUTCMonth() + 1, 0);
    date.setUTCDate(Math.min(originalDay, date.getUTCDate()));
    return { from: shiftDay(date.toISOString().slice(0, 10), 1), to };
  }
  return { from: shiftDay(to, -(Number(preset) - 1)), to };
}
export function rangeLabel(range: Pick<StatsRange, "from" | "to">) {
  const fmt = (v: string) =>
    new Date(`${v}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
  return `${range.from ? fmt(range.from) : "Début de l’historique"} au ${fmt(range.to)}`;
}
export function inRange(iso: string | null, range: StatsRange) {
  if (!iso) return false;
  const instant = Date.parse(iso);
  return (
    Number.isFinite(instant) &&
    (!range.start || instant >= Date.parse(range.start)) &&
    instant < Date.parse(range.end)
  );
}
export type StatsPv = {
  id: string;
  type: string;
  status: string;
  owner_id: string;
  created_at: string;
  signed_at: string | null;
  sent_to_client_at: string | null;
  pdf_generated_at: string | null;
};
export type StatsReserve = {
  id: string;
  pv_id: string;
  status: string;
  severity: string;
  created_at: string;
};
export type StatsPhoto = { id: string; pv_id: string; created_at: string };
export type StatsEmail = { id: string; pv_id: string | null; status: string; created_at: string };
export type StatsAction = {
  id: string;
  pv_id: string | null;
  user_id: string | null;
  action: string;
  created_at: string;
};
export type StatsMember = { user_id: string; name: string };
export type StatsRows = {
  pvs: StatsPv[];
  reserves: StatsReserve[];
  photos: StatsPhoto[];
  emails: StatsEmail[];
  actions: StatsAction[];
  members: StatsMember[];
};
export const STATS_DEFINITIONS = [
  "PV : créés sur la période ; signatures et statuts actuels parmi ces mêmes PV.",
  "Délai : entre création et signature, uniquement pour les signatures datées valides.",
  "Réserves, photos, emails et actions : enregistrés sur la période, même si le PV parent est plus ancien.",
  "Membre : créateur du PV pour les PV et ressources liées ; auteur des actions pour le journal.",
  "Avec un filtre type ou membre, les emails et actions sans PV parent sont exclus.",
  "PDF et envois client : dernière date enregistrée sur le PV, pas le nombre de régénérations ou renvois.",
  "À traiter aujourd’hui : encours actuel, indépendant de la période, mêmes filtres type et créateur PV.",
];
export function canExportStats(
  role: string | null,
  featureKnown: boolean,
  featureAllowed: boolean,
  loaded: boolean,
) {
  return featureKnown && featureAllowed && loaded && canSignAsCompany(role);
}
export function countVariation(
  current: number | null,
  previous: number | null | undefined,
  points = false,
) {
  if (
    current === null ||
    previous === null ||
    previous === undefined ||
    (!points && previous === 0)
  )
    return "Sans référence comparable";
  const difference = points ? current - previous : ((current - previous) / previous) * 100;
  return `${difference > 0 ? "+" : ""}${difference.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} ${points ? "points" : "%"} vs période précédente`;
}

/** Complete reads: exact count on every page; never accept a truncated or changing set. */
export async function readComplete<T>(
  page: (
    offset: number,
    limit: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown; count: number | null }>,
  label: string,
  maximum = 50_000,
) {
  const rows: T[] = [];
  let total: number | null = null;
  do {
    const result = await page(rows.length, 500);
    if (result.error || !result.data || result.count === null)
      throw new Error(`${label} indisponibles. Réessayez.`);
    if (result.count > maximum)
      throw new Error(`${label} : périmètre trop important. Réduisez la période ou les filtres.`);
    if (total !== null && total !== result.count)
      throw new Error(`${label} modifiées pendant la lecture. Actualisez.`);
    total = result.count;
    const ids = result.data.flatMap((row) => typeof row === "object" && row !== null && "id" in row ? [String(row.id)] : []);
    const previousIds = new Set(rows.flatMap((row) => typeof row === "object" && row !== null && "id" in row ? [String(row.id)] : []));
    if (new Set(ids).size !== ids.length || ids.some((id) => previousIds.has(id))) throw new Error(`${label} : lecture instable. Actualisez.`);
    rows.push(...result.data);
    if (rows.length > total || (rows.length < total && result.data.length === 0))
      throw new Error(`${label} : lecture incomplète. Réessayez.`);
  } while (rows.length < (total ?? 0));
  return rows;
}

export function computeStats(input: StatsInput, rows: StatsRows, now = new Date()) {
  const range = statsRange(input.from, input.to);
  const priorRange = input.compare ? previousRange(range) : null;
  const parents = new Map(rows.pvs.map((pv) => [pv.id, pv]));
  const matchesPv = (pv: StatsPv) =>
    (!input.pvType || pv.type === input.pvType) && (!input.userId || pv.owner_id === input.userId);
  const hasFilters = !!(input.pvType || input.userId);
  const linked = (id: string | null) => {
    if (!hasFilters) return true;
    const parent = id ? parents.get(id) : undefined;
    return !!parent && matchesPv(parent);
  };
  const selected = rows.pvs.filter(matchesPv);
  const calculate = (r: StatsRange) => {
    const cohort = selected.filter((p) => inRange(p.created_at, r));
    const signed = cohort.filter((p) => p.status === "signe" || !!p.signed_at);
    const delays = signed.flatMap((p) => {
      const hours = (Date.parse(p.signed_at ?? "") - Date.parse(p.created_at)) / 3600000;
      return Number.isFinite(hours) && hours >= 0 ? [hours] : [];
    });
    const reserves = rows.reserves.filter((p) => inRange(p.created_at, r) && linked(p.pv_id));
    const byStatus = RESERVE_STATUSES.map((key) => ({
      key,
      name: RESERVE_STATUS_LABEL[key],
      value: reserves.filter((p) => p.status === key).length,
    }));
    // Unknown statuses cannot silently masquerade as an open or closed reserve.
    if (
      reserves.some(
        (p) =>
          !(RESERVE_STATUSES as readonly string[]).includes(p.status) ||
          !["mineure", "majeure"].includes(p.severity),
      )
    )
      throw new Error(
        "Des réserves ont un état ou une gravité non reconnu. Vérification nécessaire.",
      );
    const emails = rows.emails.filter((p) => inRange(p.created_at, r) && linked(p.pv_id));
    return {
      totalPv: cohort.length,
      signedPv: signed.length,
      signatureRate: cohort.length ? (signed.length / cohort.length) * 100 : null,
      avgDelayHours: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : null,
      signaturesWithoutValidDate: signed.length - delays.length,
      reservesTotal: reserves.length,
      reservesOpen: reserves.filter((p) => p.status === "ouverte" || p.status === "en_cours")
        .length,
      reservesByStatus: byStatus,
      reservesBySeverity: ["mineure", "majeure"].map((key) => ({
        key,
        name: key === "mineure" ? "Mineures" : "Majeures",
        value: reserves.filter((p) => p.severity === key).length,
      })),
      photosTotal: rows.photos.filter((p) => inRange(p.created_at, r) && linked(p.pv_id)).length,
      emailsSent: emails.filter((p) => p.status === "sent").length,
      emailsFailed: emails.filter((p) => ["failed", "error"].includes(p.status)).length,
      pdfGenerated: selected.filter((p) => inRange(p.pdf_generated_at, r)).length,
      sentToClient: selected.filter((p) => inRange(p.sent_to_client_at, r)).length,
    };
  };
  const kpis = calculate(range);
  const currentReserves = rows.reserves.filter((p) => linked(p.pv_id));
  if (
    currentReserves.some(
      (p) =>
        !(RESERVE_STATUSES as readonly string[]).includes(p.status) ||
        !["mineure", "majeure"].includes(p.severity),
    )
  )
    throw new Error(
      "L’encours des réserves contient une donnée non reconnue. Vérification nécessaire.",
    );
  const nonClosed = (status: string) => !["validee", "rejetee"].includes(status);
  const counts = new Map<string, number>();
  for (const a of rows.actions) {
    // Member means action author here, not PV creator (explicit journal definition).
    const parent = a.pv_id ? parents.get(a.pv_id) : undefined;
    if (
      !inRange(a.created_at, range) ||
      (input.userId && a.user_id !== input.userId) ||
      (hasFilters && !parent) ||
      (input.pvType && parent?.type !== input.pvType)
    )
      continue;
    if (a.user_id) counts.set(a.user_id, (counts.get(a.user_id) ?? 0) + 1);
  }
  const names = new Map(rows.members.map((m) => [m.user_id, m.name]));
  return {
    range,
    previousRange: priorRange,
    generatedAt: now.toISOString(),
    input,
    kpis,
    previous: priorRange ? calculate(priorRange) : null,
    buckets: statsBuckets(
      selected.filter((p) => inRange(p.created_at, range)),
      range,
    ),
    members: rows.members,
    activityByUser: [...counts]
      .map(([user_id, count]) => ({
        user_id,
        name: names.get(user_id) ?? "Ancien membre / identité indisponible",
        count,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    today: {
      pendingOver7Days: selected.filter(
        (p) =>
          PV_PENDING_STATUSES.includes(p.status) &&
          !!p.sent_to_client_at &&
          Date.parse(p.sent_to_client_at) < Date.parse(signatureCutoff(now)),
      ).length,
      reservesMajor: currentReserves.filter((p) => p.severity === "majeure" && nonClosed(p.status))
        .length,
      reservesToValidate: currentReserves.filter((p) =>
        ["levee", "en_attente_validation"].includes(p.status),
      ).length,
      reservesToProcess: currentReserves.filter((p) => p.status === "ouverte").length,
    },
  };
}
export type CompanyStats = ReturnType<typeof computeStats>;
export function statsBuckets(pvs: StatsPv[], range: StatsRange) {
  const first =
    range.from ??
    (pvs.length ? pvs.map((p) => isoToLocalInputs(p.created_at).date).sort()[0] : range.to);
  const days = statsRange(first, range.to).days ?? 1;
  const unit = days <= 31 ? "jour" : days <= 120 ? "semaine" : "mois";
  const buckets: { start: string; end: string; label: string; created: number; signed: number }[] =
    [];
  let cursor = first;
  while (cursor <= range.to) {
    const nextMonth = new Date(`${cursor.slice(0, 7)}-01T12:00:00Z`);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 0);
    let end =
      unit === "jour"
        ? cursor
        : unit === "semaine"
          ? shiftDay(cursor, 6)
          : nextMonth.toISOString().slice(0, 10);
    if (end > range.to) end = range.to;
    const r = statsRange(cursor, end);
    const cohort = pvs.filter((p) => inRange(p.created_at, r));
    buckets.push({
      start: cursor,
      end,
      label:
        cursor === end
          ? rangeLabel({ from: cursor, to: end }).split(" au ")[0]
          : rangeLabel({ from: cursor, to: end }),
      created: cohort.length,
      signed: cohort.filter((p) => p.status === "signe" || !!p.signed_at).length,
    });
    cursor = shiftDay(end, 1);
    if (buckets.length > 1200)
      throw new Error("Historique trop long pour le graphique. Réduisez la période.");
  }
  return { unit, rows: buckets };
}

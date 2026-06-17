import { createServerFn } from "@tanstack/react-start";
import { ADMIN_ROLES, OWNER_ROLES, SIGN_ROLES, isAdminRole, isManageRole } from "@/lib/roles";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "./audit.server";

/* ----------------------------- helpers ----------------------------- */

const InputSchema = z.object({
  companyId: z.string().uuid(),
  days: z.number().int().min(1).max(3650).optional(),
  from: z.string().optional(), // ISO
  to: z.string().optional(),
  pvType: z.string().optional(),
  userId: z.string().uuid().optional(),
  compare: z.boolean().optional(),
});

type StatsInput = z.infer<typeof InputSchema>;

async function assertMember(companyId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("company_members")
    .select("id,role")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!data) throw new Error("Accès refusé.");
  return data.role as string;
}

function monthKey(d: string | Date) {
  const date = typeof d === "string" ? new Date(d) : d;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function resolveRange(input: { days?: number; from?: string; to?: string }) {
  const now = new Date();
  const to = input.to ? new Date(input.to) : now;
  let from: Date | null = null;
  if (input.from) from = new Date(input.from);
  else if (input.days) from = new Date(to.getTime() - input.days * 86400000);
  return { from, to };
}

type CoreKpis = {
  totalPv: number;
  signedPv: number;
  signatureRate: number;
  avgDelayHours: number;
  reservesTotal: number;
  reservesOuverte: number;
  reservesEnCours: number;
  reservesLevee: number;
  reservesEnAttenteValidation: number;
  reservesValidee: number;
  reservesRejetee: number;
  emailsSent: number;
  emailsFailed: number;
  photosTotal: number;
  pdfGenerated: number;
  sentToClient: number;
};

async function computeCoreKpis(
  companyId: string,
  from: Date | null,
  to: Date,
  pvType?: string,
  userId?: string,
): Promise<{ kpis: CoreKpis; pvIds: string[]; pvList: any[] }> {
  const fromIso = from ? from.toISOString() : null;
  const toIso = to.toISOString();

  let pvQ = supabaseAdmin
    .from("pv")
    .select("id,type,status,created_at,signed_at,owner_id,pdf_generated_at,sent_to_client_at")
    .eq("company_id", companyId);
  if (fromIso) pvQ = pvQ.gte("created_at", fromIso);
  pvQ = pvQ.lte("created_at", toIso);
  if (pvType) pvQ = pvQ.eq("type", pvType);
  if (userId) pvQ = pvQ.eq("owner_id", userId);
  const { data: pvs, error: pvErr } = await pvQ;
  if (pvErr) throw new Error(pvErr.message);
  const pvList = pvs ?? [];
  const pvIds = pvList.map((p) => p.id as string);

  const totalPv = pvList.length;
  const signedPv = pvList.filter((p) => !!p.signed_at).length;
  const signatureRate = totalPv ? (signedPv / totalPv) * 100 : 0;
  const delays = pvList
    .filter((p) => p.signed_at)
    .map((p) => (new Date(p.signed_at as string).getTime() - new Date(p.created_at as string).getTime()) / 3600000);
  const avgDelayHours = delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : 0;
  const pdfGenerated = pvList.filter((p) => !!p.pdf_generated_at).length;
  const sentToClient = pvList.filter((p) => !!p.sent_to_client_at).length;

  // Reserves
  let resQ = supabaseAdmin
    .from("pv_reserves")
    .select("id,status,severity,created_at,pv_id,owner_id")
    .eq("company_id", companyId);
  if (fromIso) resQ = resQ.gte("created_at", fromIso);
  resQ = resQ.lte("created_at", toIso);
  if (userId) resQ = resQ.eq("owner_id", userId);
  const { data: rrows } = await resQ;
  let reserves = rrows ?? [];
  if (pvType && pvIds.length === 0) reserves = [];
  else if (pvType) reserves = reserves.filter((r) => pvIds.includes(r.pv_id as string));
  const reservesByStatus = {
    ouverte: 0, en_cours: 0, levee: 0, en_attente_validation: 0, validee: 0, rejetee: 0,
  } as Record<string, number>;
  for (const r of reserves) {
    const s = (r.status as string) ?? "ouverte";
    reservesByStatus[s] = (reservesByStatus[s] ?? 0) + 1;
  }

  // Photos
  let photoQ = supabaseAdmin
    .from("pv_photos")
    .select("id,owner_id,pv_id,created_at")
    .eq("company_id", companyId);
  if (fromIso) photoQ = photoQ.gte("created_at", fromIso);
  photoQ = photoQ.lte("created_at", toIso);
  if (userId) photoQ = photoQ.eq("owner_id", userId);
  const { data: photos } = await photoQ;
  let photoRows = photos ?? [];
  if (pvType && pvIds.length === 0) photoRows = [];
  else if (pvType) photoRows = photoRows.filter((p) => pvIds.includes(p.pv_id as string));

  // Emails
  let emailQ = supabaseAdmin
    .from("email_logs")
    .select("id,status,email_type,created_at,pv_id")
    .eq("company_id", companyId);
  if (fromIso) emailQ = emailQ.gte("created_at", fromIso);
  emailQ = emailQ.lte("created_at", toIso);
  const { data: emails } = await emailQ;
  let emailRows = emails ?? [];
  if (pvType && pvIds.length) {
    emailRows = emailRows.filter((e) => !e.pv_id || pvIds.includes(e.pv_id as string));
  }
  const emailsSent = emailRows.filter((e) => e.status === "sent").length;
  const emailsFailed = emailRows.filter((e) => e.status === "failed" || e.status === "error").length;

  return {
    kpis: {
      totalPv,
      signedPv,
      signatureRate: Math.round(signatureRate * 10) / 10,
      avgDelayHours: Math.round(avgDelayHours * 10) / 10,
      reservesTotal: reserves.length,
      reservesOuverte: reservesByStatus.ouverte,
      reservesEnCours: reservesByStatus.en_cours,
      reservesLevee: reservesByStatus.levee,
      reservesEnAttenteValidation: reservesByStatus.en_attente_validation,
      reservesValidee: reservesByStatus.validee,
      reservesRejetee: reservesByStatus.rejetee,
      emailsSent,
      emailsFailed,
      photosTotal: photoRows.length,
      pdfGenerated,
      sentToClient,
    },
    pvIds,
    pvList,
  };
}

/* ----------------------------- getCompanyStats ----------------------------- */

export const getCompanyStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => InputSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertMember(data.companyId, context.userId);

    const { from, to } = resolveRange(data);
    const current = await computeCoreKpis(data.companyId, from, to, data.pvType, data.userId);

    // Previous period
    let previous: CoreKpis | null = null;
    if (data.compare !== false && from) {
      const span = to.getTime() - from.getTime();
      const prevTo = new Date(from.getTime() - 1);
      const prevFrom = new Date(prevTo.getTime() - span);
      const prev = await computeCoreKpis(data.companyId, prevFrom, prevTo, data.pvType, data.userId);
      previous = prev.kpis;
    }

    // Monthly buckets (current period)
    const monthlyMap = new Map<string, { month: string; created: number; signed: number }>();
    for (const p of current.pvList) {
      const k = monthKey(p.created_at as string);
      const e = monthlyMap.get(k) ?? { month: k, created: 0, signed: 0 };
      e.created += 1;
      if (p.signed_at) e.signed += 1;
      monthlyMap.set(k, e);
    }
    const monthly = Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month));

    // Reserves details (current)
    const fromIso = from ? from.toISOString() : null;
    const toIso = to.toISOString();
    let resQ = supabaseAdmin
      .from("pv_reserves")
      .select("id,status,severity,created_at,pv_id,owner_id")
      .eq("company_id", data.companyId);
    if (fromIso) resQ = resQ.gte("created_at", fromIso);
    resQ = resQ.lte("created_at", toIso);
    if (data.userId) resQ = resQ.eq("owner_id", data.userId);
    const { data: rrows } = await resQ;
    let reserves = rrows ?? [];
    if (data.pvType && current.pvIds.length === 0) reserves = [];
    else if (data.pvType) reserves = reserves.filter((r) => current.pvIds.includes(r.pv_id as string));

    const reservesBySeverity = { mineure: 0, majeure: 0, bloquante: 0 } as Record<string, number>;
    for (const r of reserves) {
      const s = (r.severity as string) ?? "mineure";
      reservesBySeverity[s] = (reservesBySeverity[s] ?? 0) + 1;
    }

    // Activity by user (current)
    let actQ = supabaseAdmin
      .from("audit_logs")
      .select("id,user_id,action,created_at,pv_id")
      .eq("company_id", data.companyId);
    if (fromIso) actQ = actQ.gte("created_at", fromIso);
    actQ = actQ.lte("created_at", toIso);
    if (data.userId) actQ = actQ.eq("user_id", data.userId);
    const { data: acts } = await actQ;
    let actRows = acts ?? [];
    if (data.pvType && current.pvIds.length) {
      actRows = actRows.filter((a) => !a.pv_id || current.pvIds.includes(a.pv_id as string));
    }
    const userCounts = new Map<string, number>();
    for (const a of actRows) {
      if (!a.user_id) continue;
      userCounts.set(a.user_id as string, (userCounts.get(a.user_id as string) ?? 0) + 1);
    }
    const userIds = Array.from(userCounts.keys());
    let profiles: Record<string, string> = {};
    if (userIds.length) {
      const { data: pr } = await supabaseAdmin.from("profiles").select("id,full_name").in("id", userIds);
      profiles = Object.fromEntries((pr ?? []).map((p) => [p.id, p.full_name ?? "Utilisateur"]));
    }
    const activityByUser = Array.from(userCounts.entries())
      .map(([uid, count]) => ({ user_id: uid, name: profiles[uid] ?? "Utilisateur", count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Members for filter
    const { data: rawMembers } = await supabaseAdmin
      .from("company_members")
      .select("user_id")
      .eq("company_id", data.companyId)
      .eq("status", "active");
    const ids = (rawMembers ?? []).map((m) => m.user_id).filter(Boolean) as string[];
    let memberList: { user_id: string; name: string }[] = [];
    if (ids.length) {
      const { data: pr } = await supabaseAdmin.from("profiles").select("id,full_name").in("id", ids);
      const map = Object.fromEntries((pr ?? []).map((p) => [p.id, p.full_name ?? "Utilisateur"]));
      memberList = ids.map((id) => ({ user_id: id, name: map[id] ?? "Utilisateur" }));
    }

    // Pending PVs > 7 days (company-wide, not date-bounded)
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { count: pendingOver7Days } = await supabaseAdmin
      .from("pv")
      .select("id", { count: "exact", head: true })
      .eq("company_id", data.companyId)
      .neq("status", "signe")
      .lt("created_at", sevenDaysAgo);

    return {
      range: { from: fromIso, to: toIso },
      kpis: current.kpis,
      previous,
      monthly,
      reservesByStatus: [
        { name: "Ouvertes", value: current.kpis.reservesOuverte, key: "ouverte", color: "#dc2626" },
        { name: "En cours", value: current.kpis.reservesEnCours, key: "en_cours", color: "#f59e0b" },
        { name: "Levées", value: current.kpis.reservesLevee, key: "levee", color: "#f59e0b" },
        { name: "En attente validation", value: current.kpis.reservesEnAttenteValidation, key: "en_attente_validation", color: "#fbbf24" },
        { name: "Validées client", value: current.kpis.reservesValidee, key: "validee", color: "#16a34a" },
        { name: "Rejetées", value: current.kpis.reservesRejetee, key: "rejetee", color: "#6b7280" },
      ],
      reservesBySeverity: [
        { name: "Mineure", value: reservesBySeverity.mineure },
        { name: "Majeure", value: reservesBySeverity.majeure },
        { name: "Bloquante", value: reservesBySeverity.bloquante },
      ],
      activityByUser,
      members: memberList,
      pendingOver7Days: pendingOver7Days ?? 0,
    };
  });

/* ----------------------------- Exports ----------------------------- */

function escapeCsv(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

async function loadExportContext(input: StatsInput, userId: string) {
  const role = await assertMember(input.companyId, userId);
  if (!(SIGN_ROLES as readonly string[]).includes(role as string)) {
    throw new Error("Seuls owner, admin et manager peuvent exporter les statistiques.");
  }
  // Plan gate: advanced stats export is Pro/Enterprise
  const { assertPlanFeature } = await import("./plan-guard.server");
  await assertPlanFeature(input.companyId, "advanced_stats");
  const [{ data: company }, { data: exporter }] = await Promise.all([
    supabaseAdmin.from("companies").select("name,siret,address").eq("id", input.companyId).maybeSingle(),
    supabaseAdmin.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ]);
  return { role, company, exporter };
}

export const exportCompanyStatsCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => InputSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { role, company, exporter } = await loadExportContext(data, context.userId);
    const { from, to } = resolveRange(data);
    const stats = await computeCoreKpis(data.companyId, from, to, data.pvType, data.userId);
    const k = stats.kpis;
    const rows: (string | number)[][] = [];
    rows.push(["PVIA - Export Statistiques"]);
    rows.push(["Entreprise", company?.name ?? ""]);
    rows.push(["SIRET", company?.siret ?? ""]);
    rows.push(["Période", from ? from.toISOString() : "tout", "→", to.toISOString()]);
    rows.push(["Type PV", data.pvType ?? "tous"]);
    rows.push(["Utilisateur", data.userId ?? "tous"]);
    rows.push(["Exporté le", new Date().toISOString()]);
    rows.push(["Exporté par", exporter?.full_name ?? "Utilisateur", `(rôle ${role})`]);
    rows.push([]);
    rows.push(["KPI", "Valeur"]);
    rows.push(["PV créés", k.totalPv]);
    rows.push(["PV signés", k.signedPv]);
    rows.push(["Taux de signature %", k.signatureRate]);
    rows.push(["Délai moyen signature (h)", k.avgDelayHours]);
    rows.push(["Réserves totales", k.reservesTotal]);
    rows.push(["Réserves ouvertes", k.reservesOuverte]);
    rows.push(["Réserves en cours", k.reservesEnCours]);
    rows.push(["Réserves levées", k.reservesLevee]);
    rows.push(["Réserves en attente validation", k.reservesEnAttenteValidation]);
    rows.push(["Réserves validées client", k.reservesValidee]);
    rows.push(["Réserves rejetées", k.reservesRejetee]);
    rows.push(["Emails envoyés", k.emailsSent]);
    rows.push(["Emails échoués", k.emailsFailed]);
    rows.push(["Photos ajoutées", k.photosTotal]);
    rows.push(["PDF générés", k.pdfGenerated]);
    rows.push(["Envoyés au client", k.sentToClient]);

    const csv = rows.map((r) => r.map((c) => escapeCsv(c as any)).join(",")).join("\n");
    await writeAuditLog({
      companyId: data.companyId,
      userId: context.userId,
      action: "audit.exported",
      entityType: "stats",
      metadata: { format: "csv", from: from?.toISOString() ?? null, to: to.toISOString(), pvType: data.pvType ?? null },
    });
    const fileName = `pvia-statistiques-${new Date().toISOString().slice(0, 10)}.csv`;
    return { csv, fileName };
  });

export const exportCompanyStatsPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => InputSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { role, company, exporter } = await loadExportContext(data, context.userId);
    const { from, to } = resolveRange(data);
    const cur = await computeCoreKpis(data.companyId, from, to, data.pvType, data.userId);
    let prev: CoreKpis | null = null;
    if (from) {
      const span = to.getTime() - from.getTime();
      const prevTo = new Date(from.getTime() - 1);
      const prevFrom = new Date(prevTo.getTime() - span);
      const p = await computeCoreKpis(data.companyId, prevFrom, prevTo, data.pvType, data.userId);
      prev = p.kpis;
    }
    const k = cur.kpis;

    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const PAGE_W = 595, PAGE_H = 842, M = 48;
    let page = doc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - M;
    const sanitize = (s: string) =>
      s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[^\x00-\xff]/g, "?");
    const draw = (text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number } = {}) => {
      const size = opts.size ?? 10;
      const f = opts.bold ? bold : font;
      const [r, g, b] = opts.color ?? [0.06, 0.09, 0.16];
      const x = M + (opts.indent ?? 0);
      if (y < M + 40) {
        page = doc.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - M;
      }
      page.drawText(sanitize(text), { x, y, size, font: f, color: rgb(r, g, b) });
      y -= size + 4;
    };
    const sep = () => {
      y -= 4;
      page.drawLine({ start: { x: M, y }, end: { x: PAGE_W - M, y }, thickness: 0.5, color: rgb(0.86, 0.88, 0.91) });
      y -= 10;
    };
    const fromLabel = from ? new Date(from).toLocaleDateString("fr-FR") : "Début";
    const toLabel = new Date(to).toLocaleDateString("fr-FR");

    draw(`${company?.name || "PVIA"} — Rapport statistiques`, { size: 18, bold: true });
    if (company?.siret) draw(`SIRET : ${company.siret}`, { size: 9, color: [0.42, 0.45, 0.52] });
    if (company?.address) draw(company.address, { size: 9, color: [0.42, 0.45, 0.52] });
    y -= 4;
    draw(`Période : ${fromLabel} → ${toLabel}`, { size: 10 });
    if (data.pvType) draw(`Type de PV : ${data.pvType}`, { size: 10 });
    draw(`Export effectué le ${new Date().toLocaleString("fr-FR")}`, { size: 9, color: [0.42, 0.45, 0.52] });
    draw(`Par : ${exporter?.full_name || "Utilisateur"} (rôle ${role})`, { size: 9, color: [0.42, 0.45, 0.52] });
    sep();

    draw("Indicateurs clés", { size: 13, bold: true });
    y -= 4;
    const fmtDelta = (curV: number, prevV: number | undefined) => {
      if (prev == null || prevV === undefined) return "";
      if (prevV === 0 && curV === 0) return " (=)";
      if (prevV === 0) return " (nouveau)";
      const pct = ((curV - prevV) / prevV) * 100;
      const sign = pct > 0 ? "+" : "";
      return ` (${sign}${pct.toFixed(1)}% vs période précédente)`;
    };
    const lines: [string, number, number | undefined][] = [
      ["PV créés", k.totalPv, prev?.totalPv],
      ["PV signés", k.signedPv, prev?.signedPv],
      ["Taux de signature", k.signatureRate, prev?.signatureRate],
      ["Délai moyen signature (h)", k.avgDelayHours, prev?.avgDelayHours],
      ["Réserves totales", k.reservesTotal, prev?.reservesTotal],
      ["Réserves ouvertes", k.reservesOuverte, prev?.reservesOuverte],
      ["Réserves en cours", k.reservesEnCours, prev?.reservesEnCours],
      ["Réserves levées", k.reservesLevee, prev?.reservesLevee],
      ["Réserves en attente validation", k.reservesEnAttenteValidation, prev?.reservesEnAttenteValidation],
      ["Réserves validées client", k.reservesValidee, prev?.reservesValidee],
      ["Réserves rejetées", k.reservesRejetee, prev?.reservesRejetee],
      ["Emails envoyés", k.emailsSent, prev?.emailsSent],
      ["Emails échoués", k.emailsFailed, prev?.emailsFailed],
      ["Photos ajoutées", k.photosTotal, prev?.photosTotal],
      ["PDF générés", k.pdfGenerated, prev?.pdfGenerated],
      ["Envoyés au client", k.sentToClient, prev?.sentToClient],
    ];
    for (const [label, cur2, pv2] of lines) {
      draw(`• ${label} : ${cur2}${fmtDelta(cur2, pv2)}`, { size: 10 });
    }

    sep();
    draw("Évolution mensuelle (PV créés / signés)", { size: 13, bold: true });
    const monthlyMap = new Map<string, { created: number; signed: number }>();
    for (const p of cur.pvList) {
      const k2 = monthKey(p.created_at as string);
      const e = monthlyMap.get(k2) ?? { created: 0, signed: 0 };
      e.created += 1;
      if (p.signed_at) e.signed += 1;
      monthlyMap.set(k2, e);
    }
    const sortedMonths = Array.from(monthlyMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    if (!sortedMonths.length) draw("Aucune donnée sur la période.", { size: 10, color: [0.42, 0.45, 0.52] });
    for (const [mk, mv] of sortedMonths) {
      draw(`${mk} : ${mv.created} créés · ${mv.signed} signés`, { size: 10, indent: 6 });
    }

    const bytes = await doc.save();
    const fileName = `pvia-statistiques-${new Date().toISOString().slice(0, 10)}.pdf`;
    const path = `${data.companyId}/exports/${fileName}`;
    await supabaseAdmin.storage.from("pv-assets").upload(path, bytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    const { data: signed } = await supabaseAdmin.storage.from("pv-assets").createSignedUrl(path, 600);

    await writeAuditLog({
      companyId: data.companyId,
      userId: context.userId,
      action: "audit.exported",
      entityType: "stats",
      metadata: { format: "pdf", from: from?.toISOString() ?? null, to: to.toISOString(), pvType: data.pvType ?? null },
    });

    return { url: signed?.signedUrl ?? null, fileName };
  });

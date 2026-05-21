import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const InputSchema = z.object({
  companyId: z.string().uuid(),
  days: z.number().int().min(1).max(3650).optional(), // null => all
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  pvType: z.string().optional(),
  userId: z.string().uuid().optional(),
});

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

export const getCompanyStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => InputSchema.parse(i))
  .handler(async ({ data, context }) => {
    await assertMember(data.companyId, context.userId);

    // Compute date range
    const now = new Date();
    let fromDate: Date | null = null;
    let toDate: Date = data.to ? new Date(data.to) : now;
    if (data.from) fromDate = new Date(data.from);
    else if (data.days) {
      fromDate = new Date(now.getTime() - data.days * 86400000);
    }
    const fromIso = fromDate ? fromDate.toISOString() : null;
    const toIso = toDate.toISOString();

    // ----- PV -----
    let pvQ = supabaseAdmin
      .from("pv")
      .select("id,type,status,created_at,signed_at,owner_id,pdf_generated_at,sent_to_client_at")
      .eq("company_id", data.companyId);
    if (fromIso) pvQ = pvQ.gte("created_at", fromIso);
    pvQ = pvQ.lte("created_at", toIso);
    if (data.pvType) pvQ = pvQ.eq("type", data.pvType);
    if (data.userId) pvQ = pvQ.eq("owner_id", data.userId);
    const { data: pvs, error: pvErr } = await pvQ;
    if (pvErr) throw new Error(pvErr.message);
    const pvList = pvs ?? [];

    const pvIds = pvList.map((p) => p.id);

    // Monthly buckets (created and signed)
    const monthlyMap = new Map<string, { month: string; created: number; signed: number }>();
    for (const p of pvList) {
      const k = monthKey(p.created_at as string);
      const e = monthlyMap.get(k) ?? { month: k, created: 0, signed: 0 };
      e.created += 1;
      if (p.signed_at) e.signed += 1;
      monthlyMap.set(k, e);
    }
    const monthly = Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month));

    const totalPv = pvList.length;
    const signedPv = pvList.filter((p) => !!p.signed_at).length;
    const signatureRate = totalPv ? (signedPv / totalPv) * 100 : 0;

    // Avg delay create -> sign (hours)
    const delays = pvList
      .filter((p) => p.signed_at)
      .map((p) => (new Date(p.signed_at as string).getTime() - new Date(p.created_at as string).getTime()) / 3600000);
    const avgDelayHours = delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : 0;

    const pdfGenerated = pvList.filter((p) => !!p.pdf_generated_at).length;
    const sentToClient = pvList.filter((p) => !!p.sent_to_client_at).length;

    // ----- Reserves -----
    let resQ = supabaseAdmin
      .from("pv_reserves")
      .select("id,status,severity,created_at,pv_id,owner_id")
      .eq("company_id", data.companyId);
    if (fromIso) resQ = resQ.gte("created_at", fromIso);
    resQ = resQ.lte("created_at", toIso);
    if (data.userId) resQ = resQ.eq("owner_id", data.userId);
    if (pvIds.length === 0 && data.pvType) {
      // no pv matches type filter -> no reserves
    }
    const { data: rrows } = await resQ;
    let reserves = rrows ?? [];
    if (data.pvType && pvIds.length) {
      reserves = reserves.filter((r) => pvIds.includes(r.pv_id as string));
    }

    const reservesByStatus = { ouverte: 0, levee: 0, validee: 0 } as Record<string, number>;
    for (const r of reserves) {
      const s = (r.status as string) ?? "ouverte";
      reservesByStatus[s] = (reservesByStatus[s] ?? 0) + 1;
    }
    const reservesBySeverity = { mineure: 0, majeure: 0, bloquante: 0 } as Record<string, number>;
    for (const r of reserves) {
      const s = (r.severity as string) ?? "mineure";
      reservesBySeverity[s] = (reservesBySeverity[s] ?? 0) + 1;
    }

    // ----- Photos -----
    let photoQ = supabaseAdmin
      .from("pv_photos")
      .select("id,owner_id,pv_id,created_at", { count: "exact" })
      .eq("company_id", data.companyId);
    if (fromIso) photoQ = photoQ.gte("created_at", fromIso);
    photoQ = photoQ.lte("created_at", toIso);
    if (data.userId) photoQ = photoQ.eq("owner_id", data.userId);
    const { data: photos, count: photosCount } = await photoQ;
    let photosTotal = photosCount ?? 0;
    let photoRows = photos ?? [];
    if (data.pvType && pvIds.length) {
      photoRows = photoRows.filter((p) => pvIds.includes(p.pv_id as string));
      photosTotal = photoRows.length;
    }

    // ----- Emails -----
    let emailQ = supabaseAdmin
      .from("email_logs")
      .select("id,status,email_type,created_at,pv_id")
      .eq("company_id", data.companyId);
    if (fromIso) emailQ = emailQ.gte("created_at", fromIso);
    emailQ = emailQ.lte("created_at", toIso);
    const { data: emails } = await emailQ;
    let emailRows = emails ?? [];
    if (data.pvType && pvIds.length) {
      emailRows = emailRows.filter((e) => !e.pv_id || pvIds.includes(e.pv_id as string));
    }
    const emailsSent = emailRows.filter((e) => e.status === "sent").length;
    const emailsFailed = emailRows.filter((e) => e.status === "failed" || e.status === "error").length;

    // ----- Activity by user (from audit_logs) -----
    let actQ = supabaseAdmin
      .from("audit_logs")
      .select("id,user_id,action,created_at,pv_id")
      .eq("company_id", data.companyId);
    if (fromIso) actQ = actQ.gte("created_at", fromIso);
    actQ = actQ.lte("created_at", toIso);
    if (data.userId) actQ = actQ.eq("user_id", data.userId);
    const { data: acts } = await actQ;
    let actRows = acts ?? [];
    if (data.pvType && pvIds.length) {
      actRows = actRows.filter((a) => !a.pv_id || pvIds.includes(a.pv_id as string));
    }

    const userCounts = new Map<string, number>();
    for (const a of actRows) {
      if (!a.user_id) continue;
      userCounts.set(a.user_id as string, (userCounts.get(a.user_id as string) ?? 0) + 1);
    }

    // Hydrate user names
    const userIds = Array.from(userCounts.keys());
    let profiles: Record<string, string> = {};
    if (userIds.length) {
      const { data: pr } = await supabaseAdmin
        .from("profiles")
        .select("id,full_name")
        .in("id", userIds);
      profiles = Object.fromEntries((pr ?? []).map((p) => [p.id, p.full_name ?? "Utilisateur"]));
    }
    const activityByUser = Array.from(userCounts.entries())
      .map(([uid, count]) => ({ user_id: uid, name: profiles[uid] ?? "Utilisateur", count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Members list (for the filter)
    const { data: members } = await supabaseAdmin
      .from("company_members")
      .select("user_id,profiles:profiles!company_members_user_id_fkey(full_name)")
      .eq("company_id", data.companyId)
      .eq("status", "active");
    // Fallback (no FK declared): manual fetch
    let memberList: { user_id: string; name: string }[] = [];
    if (members && members.length && (members[0] as any).profiles) {
      memberList = (members as any[]).map((m) => ({
        user_id: m.user_id,
        name: m.profiles?.full_name ?? "Utilisateur",
      }));
    } else {
      const { data: rawMembers } = await supabaseAdmin
        .from("company_members")
        .select("user_id")
        .eq("company_id", data.companyId)
        .eq("status", "active");
      const ids = (rawMembers ?? []).map((m) => m.user_id).filter(Boolean) as string[];
      if (ids.length) {
        const { data: pr } = await supabaseAdmin
          .from("profiles")
          .select("id,full_name")
          .in("id", ids);
        const map = Object.fromEntries((pr ?? []).map((p) => [p.id, p.full_name ?? "Utilisateur"]));
        memberList = ids.map((id) => ({ user_id: id, name: map[id] ?? "Utilisateur" }));
      }
    }

    return {
      range: { from: fromIso, to: toIso },
      kpis: {
        totalPv,
        signedPv,
        signatureRate: Math.round(signatureRate * 10) / 10,
        avgDelayHours: Math.round(avgDelayHours * 10) / 10,
        reservesTotal: reserves.length,
        reservesOuverte: reservesByStatus.ouverte,
        reservesLevee: reservesByStatus.levee,
        reservesValidee: reservesByStatus.validee,
        emailsSent,
        emailsFailed,
        photosTotal,
        pdfGenerated,
        sentToClient,
      },
      monthly,
      reservesByStatus: [
        { name: "Ouvertes", value: reservesByStatus.ouverte, key: "ouverte" },
        { name: "Levées", value: reservesByStatus.levee, key: "levee" },
        { name: "Validées", value: reservesByStatus.validee, key: "validee" },
      ],
      reservesBySeverity: [
        { name: "Mineure", value: reservesBySeverity.mineure },
        { name: "Majeure", value: reservesBySeverity.majeure },
        { name: "Bloquante", value: reservesBySeverity.bloquante },
      ],
      activityByUser,
      members: memberList,
    };
  });

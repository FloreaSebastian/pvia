import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { canSignAsCompany } from "./roles";
import {
  StatsInputSchema,
  computeStats,
  readComplete,
  previousRange,
  statsRange,
  type StatsInput,
  type StatsRows,
} from "./stats-core";
import { buildStatsCsv, buildStatsPdf, persistStatsPdf } from "./stats-export";

type Client = SupabaseClient<Database>;
async function authorized(input: StatsInput, sb: Client, userId: string, exporting = false) {
  const { data, error } = await sb
    .from("company_members")
    .select("role")
    .eq("company_id", input.companyId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (error || !data) throw new Error("Accès entreprise non confirmé. Réessayez.");
  if (exporting && !canSignAsCompany(data.role))
    throw new Error("Export réservé aux Directeur, Responsable et Conducteur.");
  const { assertPlanFeature } = await import("./plan-guard.server");
  await assertPlanFeature(input.companyId, "advanced_stats", userId);
  // Company-wide aggregates include restricted audit/email rows. Membership and feature are checked above; every privileged read is tenant-scoped.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
async function loadStats(sb: Client, input: StatsInput) {
  const companyId = input.companyId;
  const range = statsRange(input.from, input.to);
  const prior = input.compare ? previousRange(range) : null;
  const lower = prior?.start ?? range.start;
  const pvs = await readComplete(
    (offset, limit) =>
      sb
        .from("pv")
        .select("id,type,status,owner_id,created_at,signed_at,sent_to_client_at,pdf_generated_at", {
          count: "exact",
        })
        .eq("company_id", companyId)
        .order("id")
        .range(offset, offset + limit - 1),
    "PV",
  );
  const period = <T extends { gte: (c: string, v: string) => T; lt: (c: string, v: string) => T }>(
    q: T,
  ) => {
    if (lower) q = q.gte("created_at", lower);
    return q.lt("created_at", range.end);
  };
  const [reserves, photos, emails, actions, memberships, company] = await Promise.all([
    readComplete(
      (o, n) =>
        sb
          .from("pv_reserves")
          .select("id,pv_id,status,severity,created_at", { count: "exact" })
          .eq("company_id", companyId)
          .order("id")
          .range(o, o + n - 1),
      "Réserves",
    ),
    readComplete(
      (o, n) =>
        period(
          sb
            .from("pv_photos")
            .select("id,pv_id,created_at", { count: "exact" })
            .eq("company_id", companyId),
        )
          .order("id")
          .range(o, o + n - 1),
      "Photos",
    ),
    readComplete(
      (o, n) =>
        period(
          sb
            .from("email_logs")
            .select("id,pv_id,status,created_at", { count: "exact" })
            .eq("company_id", companyId),
        )
          .order("id")
          .range(o, o + n - 1),
      "Communications",
    ),
    readComplete(
      (o, n) =>
        period(
          sb
            .from("audit_logs")
            .select("id,pv_id,user_id,action,created_at", { count: "exact" })
            .eq("company_id", companyId),
        )
          .order("id")
          .range(o, o + n - 1),
      "Journal d’actions",
    ),
    readComplete(
      (o, n) =>
        sb
          .from("company_members")
          .select("id,user_id", { count: "exact" })
          .eq("company_id", companyId)
          .eq("status", "active")
          .order("id")
          .range(o, o + n - 1),
      "Membres",
    ),
    sb.from("companies").select("name").eq("id", companyId).single(),
  ]);
  if (company.error || !company.data) throw new Error("Identité de l’entreprise indisponible.");
  const ids = memberships.flatMap((m) => (m.user_id ? [m.user_id] : []));
  if (input.userId && !ids.includes(input.userId))
    throw new Error("Le membre sélectionné n’appartient plus à cette entreprise.");
  const members: StatsRows["members"] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const group = ids.slice(i, i + 200);
    const profiles = await readComplete(
      (o, n) =>
        sb
          .from("profiles")
          .select("id,full_name", { count: "exact" })
          .in("id", group)
          .order("id")
          .range(o, o + n - 1),
      "Identités membres",
    );
    const map = new Map(profiles.map((p) => [p.id, p.full_name]));
    members.push(
      ...group.map((user_id) => ({
        user_id,
        name: map.get(user_id) || "Membre sans nom renseigné",
      })),
    );
  }
  return {
    ...computeStats(input, { pvs, reserves, photos, emails, actions, members }),
    companyName: company.data.name,
  };
}
export const getCompanyStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => StatsInputSchema.parse(i))
  .handler(async ({ data, context }) => {
    const sb = await authorized(data, context.supabase, context.userId);
    return loadStats(sb, data);
  });
export const exportCompanyStatsCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => StatsInputSchema.parse(i))
  .handler(async ({ data, context }) => {
    const sb = await authorized(data, context.supabase, context.userId, true);
    const stats = await loadStats(sb, data);
    const csv = buildStatsCsv(stats, stats.companyName);
    const { writeAuditLog } = await import("./audit.server");
    await writeAuditLog({
      companyId: data.companyId,
      userId: context.userId,
      action: "audit.exported",
      entityType: "stats",
      metadata: { format: "csv", ...data },
    });
    return { csv, fileName: `pvia-statistiques-${data.to}.csv` };
  });
export const exportCompanyStatsPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => StatsInputSchema.parse(i))
  .handler(async ({ data, context }) => {
    const sb = await authorized(data, context.supabase, context.userId, true);
    const stats = await loadStats(sb, data);
    const bytes = await buildStatsPdf(stats, stats.companyName);
    const fileName = `pvia-statistiques-${data.to}.pdf`;
    const path = `${data.companyId}/exports/${crypto.randomUUID()}-${fileName}`;
    const url = await persistStatsPdf(
      () =>
        sb.storage
          .from("pv-assets")
          .upload(path, bytes, { contentType: "application/pdf", upsert: false }),
      () => sb.storage.from("pv-assets").createSignedUrl(path, 600),
    );
    const { writeAuditLog } = await import("./audit.server");
    await writeAuditLog({
      companyId: data.companyId,
      userId: context.userId,
      action: "audit.exported",
      entityType: "stats",
      metadata: { format: "pdf", ...data },
    });
    return { url, fileName };
  });

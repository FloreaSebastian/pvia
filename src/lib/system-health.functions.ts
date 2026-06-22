/**
 * System health audit — détecte automatiquement les incohérences de données
 * et les états métier suspects à l'échelle de la plateforme.
 *
 * Réservé aux platform admins (les routes /admin/* PVIA sont scopées
 * `platform_admin` ; un directeur d'entreprise n'a pas vocation à voir les
 * données d'autres tenants).
 *
 * Toutes les requêtes utilisent `supabaseAdmin` car l'audit traverse les
 * tenants ; l'accès est gardé par `is_platform_admin()`.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type HealthSeverity = "ok" | "warning" | "critical";

export type HealthCheck = {
  /** Identifiant stable du contrôle (ex: "photos.orphan_no_pv"). */
  id: string;
  /** Catégorie d'affichage (Photos, PDF, Réserves, Levées, PV, Chantiers, Emails, OTP). */
  category: string;
  /** Libellé court (FR). */
  label: string;
  /** Sévérité du résultat. */
  severity: HealthSeverity;
  /** Nombre de lignes problématiques détectées. */
  count: number;
  /** Détail libre (échantillon d'IDs, message d'erreur, etc.). */
  details?: Record<string, unknown> | null;
};

export type SystemHealthResult = {
  status: HealthSeverity;
  totalChecks: number;
  passedChecks: number;
  warnings: number;
  critical: number;
  generatedAt: string;
  durationMs: number;
  details: HealthCheck[];
};

const SAMPLE = 5;

export const runSystemHealthAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SystemHealthResult> => {
    const { supabase, userId } = context;

    // Gate : platform_admin uniquement
    const { data: isAdmin } = await supabase.rpc("is_platform_admin", { _user_id: userId });
    if (!isAdmin) {
      throw new Error("Accès refusé : platform admin uniquement.");
    }

    // À partir d'ici, on a besoin de service_role pour traverser tous les tenants.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const started = Date.now();
    const checks: HealthCheck[] = [];

    const push = (
      id: string,
      category: string,
      label: string,
      count: number,
      sampleIds?: string[] | null,
      severity: HealthSeverity = "ok",
    ) => {
      const sev: HealthSeverity =
        count === 0 ? "ok" : severity === "ok" ? "warning" : severity;
      checks.push({
        id,
        category,
        label,
        severity: sev,
        count,
        details: count === 0 ? null : { sample: sampleIds?.slice(0, SAMPLE) ?? [] },
      });
    };

    // ─────────── PHOTOS ───────────
    {
      // Photos sans PV (pv_id pointant vers un PV inexistant)
      const { data: photos } = await supabaseAdmin
        .from("pv_photos")
        .select("id,pv_id,reserve_id")
        .limit(20000);
      const pvIds = Array.from(new Set((photos ?? []).map((p) => p.pv_id).filter(Boolean)));
      const reserveIds = Array.from(
        new Set((photos ?? []).map((p) => p.reserve_id).filter(Boolean) as string[]),
      );
      let existingPv = new Set<string>();
      let existingReserves = new Set<string>();
      if (pvIds.length) {
        const { data: pvRows } = await supabaseAdmin
          .from("pv")
          .select("id")
          .in("id", pvIds as string[]);
        existingPv = new Set((pvRows ?? []).map((r) => r.id));
      }
      if (reserveIds.length) {
        const { data: rRows } = await supabaseAdmin
          .from("pv_reserves")
          .select("id")
          .in("id", reserveIds);
        existingReserves = new Set((rRows ?? []).map((r) => r.id));
      }
      const orphanNoPv = (photos ?? []).filter((p) => !existingPv.has(p.pv_id as string));
      const orphanNoReserve = (photos ?? []).filter(
        (p) => p.reserve_id && !existingReserves.has(p.reserve_id as string),
      );
      push("photos.orphan_no_pv", "Photos", "Photos rattachées à un PV inexistant",
        orphanNoPv.length, orphanNoPv.map((p) => p.id), "critical");
      push("photos.orphan_no_reserve", "Photos",
        "Photos liées à une réserve supprimée",
        orphanNoReserve.length, orphanNoReserve.map((p) => p.id), "warning");
    }

    // ─────────── PV ───────────
    {
      const { data: pvs } = await supabaseAdmin
        .from("pv")
        .select("id,status,chantier_id,pdf_url,signed_at")
        .limit(20000);
      const noChantier = (pvs ?? []).filter((p) => !p.chantier_id);
      const signedNoPdf = (pvs ?? []).filter(
        (p) => p.status === "signe" && !p.pdf_url,
      );
      push("pv.no_chantier", "PV", "PV sans chantier rattaché",
        noChantier.length, noChantier.map((p) => p.id), "warning");
      push("pv.signed_no_pdf", "PV", "PV signés sans PDF généré",
        signedNoPdf.length, signedNoPdf.map((p) => p.id), "critical");
    }

    // ─────────── RÉSERVES ───────────
    {
      const { data: reserves } = await supabaseAdmin
        .from("pv_reserves")
        .select("id,pv_id,status,lifted_at")
        .limit(50000);
      const pvIds = Array.from(new Set((reserves ?? []).map((r) => r.pv_id).filter(Boolean)));
      let chantierByPv = new Map<string, string | null>();
      if (pvIds.length) {
        const { data: pvRows } = await supabaseAdmin
          .from("pv")
          .select("id,chantier_id")
          .in("id", pvIds as string[]);
        chantierByPv = new Map((pvRows ?? []).map((r) => [r.id, r.chantier_id]));
      }
      const noPv = (reserves ?? []).filter((r) => !chantierByPv.has(r.pv_id as string));
      const noChantier = (reserves ?? []).filter(
        (r) => chantierByPv.has(r.pv_id as string) && !chantierByPv.get(r.pv_id as string),
      );

      // Réserve "levee" sans aucun item de rapport associé
      const liftedIds = (reserves ?? []).filter((r) => r.status === "levee").map((r) => r.id);
      let liftedWithoutReport: string[] = [];
      if (liftedIds.length) {
        const { data: items } = await supabaseAdmin
          .from("reserve_lift_items")
          .select("reserve_id")
          .in("reserve_id", liftedIds);
        const present = new Set((items ?? []).map((i) => i.reserve_id));
        liftedWithoutReport = liftedIds.filter((id) => !present.has(id));
      }

      push("reserves.no_pv", "Réserves", "Réserves rattachées à un PV inexistant",
        noPv.length, noPv.map((r) => r.id), "critical");
      push("reserves.no_chantier", "Réserves", "Réserves sans chantier (via PV)",
        noChantier.length, noChantier.map((r) => r.id), "warning");
      push("reserves.lifted_no_report", "Réserves",
        "Réserves « levée » sans rapport de levée associé",
        liftedWithoutReport.length, liftedWithoutReport, "warning");
    }

    // ─────────── LEVÉES (reserve_lift_reports) ───────────
    {
      const { data: reports } = await supabaseAdmin
        .from("reserve_lift_reports")
        .select("id,status,pdf_url,pdf_client_url,pdf_internal_url,signed_at,client_validated_at")
        .limit(20000);
      const reportIds = (reports ?? []).map((r) => r.id);
      let itemsByReport = new Map<string, number>();
      if (reportIds.length) {
        const { data: items } = await supabaseAdmin
          .from("reserve_lift_items")
          .select("id,report_id,reserve_id")
          .in("report_id", reportIds);
        for (const it of items ?? []) {
          itemsByReport.set(it.report_id, (itemsByReport.get(it.report_id) ?? 0) + 1);
        }
        // item sans reserve_id (FK is NOT NULL → improbable, mais on vérifie l'orphelin)
        const reserveIds = Array.from(new Set((items ?? []).map((i) => i.reserve_id)));
        const { data: existing } = await supabaseAdmin
          .from("pv_reserves")
          .select("id")
          .in("id", reserveIds);
        const existingSet = new Set((existing ?? []).map((r) => r.id));
        const orphanItems = (items ?? []).filter((i) => !existingSet.has(i.reserve_id));
        push("lift.item_orphan", "Levées",
          "Items de levée pointant vers une réserve supprimée",
          orphanItems.length, orphanItems.map((i) => i.id), "critical");
      } else {
        push("lift.item_orphan", "Levées",
          "Items de levée pointant vers une réserve supprimée", 0, [], "warning");
      }

      const noItem = (reports ?? []).filter((r) => !itemsByReport.has(r.id));
      const signedNoPdf = (reports ?? []).filter(
        (r) => r.status === "signe" && !r.pdf_url && !r.pdf_client_url && !r.pdf_internal_url,
      );
      const validatedNoClientPdf = (reports ?? []).filter(
        (r) => r.client_validated_at && !r.pdf_client_url,
      );
      const validatedNoInternalPdf = (reports ?? []).filter(
        (r) => r.client_validated_at && !r.pdf_internal_url,
      );

      push("lift.report_no_item", "Levées", "Rapports de levée sans aucun item",
        noItem.length, noItem.map((r) => r.id), "warning");
      push("lift.signed_no_pdf", "Levées", "Levées signées sans aucun PDF",
        signedNoPdf.length, signedNoPdf.map((r) => r.id), "critical");
      push("lift.client_validated_no_pdf_client", "PDF",
        "Levées validées client sans PDF client",
        validatedNoClientPdf.length, validatedNoClientPdf.map((r) => r.id), "warning");
      push("lift.client_validated_no_pdf_internal", "PDF",
        "Levées validées client sans PDF interne",
        validatedNoInternalPdf.length, validatedNoInternalPdf.map((r) => r.id), "warning");
    }

    // ─────────── CHANTIERS ───────────
    {
      const { data: chantiers } = await supabaseAdmin
        .from("chantiers")
        .select("id,status,received_at,closed_at,closure_origin")
        .limit(20000);
      const allIds = (chantiers ?? []).map((c) => c.id);

      // Récupère tous les PV + réserves pour ces chantiers
      let pvByChantier = new Map<string, { id: string; status: string }[]>();
      if (allIds.length) {
        const { data: pvs } = await supabaseAdmin
          .from("pv")
          .select("id,chantier_id,status")
          .in("chantier_id", allIds);
        for (const p of pvs ?? []) {
          if (!p.chantier_id) continue;
          const arr = pvByChantier.get(p.chantier_id) ?? [];
          arr.push({ id: p.id, status: p.status });
          pvByChantier.set(p.chantier_id, arr);
        }
      }
      // Toutes réserves indexées par pv_id
      const allPvIds = Array.from(
        new Set(Array.from(pvByChantier.values()).flat().map((p) => p.id)),
      );
      const reservesByPv = new Map<string, { status: string }[]>();
      if (allPvIds.length) {
        const { data: reserves } = await supabaseAdmin
          .from("pv_reserves")
          .select("pv_id,status")
          .in("pv_id", allPvIds);
        for (const r of reserves ?? []) {
          const arr = reservesByPv.get(r.pv_id) ?? [];
          arr.push({ status: r.status });
          reservesByPv.set(r.pv_id, arr);
        }
      }

      const termineWithOpen: string[] = [];
      const receptionneNoSignedPv: string[] = [];
      const enCoursAllValidated: string[] = [];
      for (const c of chantiers ?? []) {
        const pvs = pvByChantier.get(c.id) ?? [];
        const reserves = pvs.flatMap((p) => reservesByPv.get(p.id) ?? []);
        const hasOpenReserve = reserves.some(
          (r) => r.status !== "validee" && r.status !== "rejetee",
        );
        const hasReserves = reserves.length > 0;
        const allValidated = hasReserves && reserves.every((r) => r.status === "validee");
        const hasSignedPv = pvs.some((p) => p.status === "signe");

        if ((c.status === "termine" || c.status === "archive") && hasOpenReserve) {
          termineWithOpen.push(c.id);
        }
        if (c.status === "receptionne" && !hasSignedPv) {
          receptionneNoSignedPv.push(c.id);
        }
        if (c.status === "en_cours" && allValidated) {
          enCoursAllValidated.push(c.id);
        }
      }

      push("chantier.termine_with_open_reserve", "Chantiers",
        "Chantiers terminés avec réserves encore ouvertes",
        termineWithOpen.length, termineWithOpen, "critical");
      push("chantier.receptionne_no_signed_pv", "Chantiers",
        "Chantiers réceptionnés sans aucun PV signé",
        receptionneNoSignedPv.length, receptionneNoSignedPv, "critical");
      push("chantier.en_cours_all_validated", "Chantiers",
        "Chantiers « en cours » alors que toutes les réserves sont validées",
        enCoursAllValidated.length, enCoursAllValidated, "warning");
    }

    // ─────────── EMAILS ───────────
    {
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const { data: failed } = await supabaseAdmin
        .from("email_logs")
        .select("id")
        .in("status", ["failed", "error"])
        .gte("created_at", since)
        .limit(2000);
      const { data: pending } = await supabaseAdmin
        .from("email_logs")
        .select("id,created_at")
        .eq("status", "pending")
        .lt("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
        .limit(2000);
      const { data: blocked } = await supabaseAdmin
        .from("email_logs")
        .select("id")
        .eq("status", "blocked")
        .gte("created_at", since)
        .limit(2000);

      push("emails.failed_7d", "Emails", "Emails en erreur (7 derniers jours)",
        failed?.length ?? 0, (failed ?? []).map((e) => e.id), "warning");
      push("emails.stuck_pending", "Emails", "Emails « pending » depuis plus de 30 min",
        pending?.length ?? 0, (pending ?? []).map((e) => e.id), "critical");
      push("emails.blocked_7d", "Emails", "Emails bloqués (7 derniers jours)",
        blocked?.length ?? 0, (blocked ?? []).map((e) => e.id), "warning");
    }

    // ─────────── OTP ───────────
    {
      const now = new Date().toISOString();
      const { data: expiredNotUsed } = await supabaseAdmin
        .from("pv_signature_otps")
        .select("id")
        .lt("expires_at", now)
        .is("used_at", null)
        .lt("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
        .limit(2000);
      // OTP "incohérent" : used_at posé alors qu'expiré avant utilisation
      const { data: usedAfterExpiry } = await supabaseAdmin
        .from("pv_signature_otps")
        .select("id,used_at,expires_at")
        .not("used_at", "is", null)
        .limit(5000);
      const incoherent = (usedAfterExpiry ?? []).filter(
        (o) => o.used_at && o.expires_at && new Date(o.used_at) > new Date(o.expires_at),
      );

      push("otp.expired_not_cleaned", "OTP",
        "OTP expirés et non nettoyés (> 24h)",
        expiredNotUsed?.length ?? 0,
        (expiredNotUsed ?? []).map((o) => o.id),
        "warning");
      push("otp.used_after_expiry", "OTP",
        "OTP utilisés après expiration (incohérent)",
        incoherent.length, incoherent.map((o) => o.id), "critical");
    }

    // Agrégat
    const warnings = checks.filter((c) => c.severity === "warning").length;
    const critical = checks.filter((c) => c.severity === "critical").length;
    const passed = checks.filter((c) => c.severity === "ok").length;
    const status: HealthSeverity =
      critical > 0 ? "critical" : warnings > 0 ? "warning" : "ok";

    return {
      status,
      totalChecks: checks.length,
      passedChecks: passed,
      warnings,
      critical,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      details: checks,
    };
  });

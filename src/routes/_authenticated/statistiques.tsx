import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatisticsView } from "@/components/stats/StatisticsView";
import { useCompany } from "@/hooks/use-company";
import { useAuth } from "@/hooks/use-auth";
import { useSubscription } from "@/hooks/use-subscription";
import { useBillingGate } from "@/components/billing/BillingGate";
import { isAdminRole } from "@/lib/roles";
import { createStatsScope } from "@/lib/stats-scope";
import {
  getCompanyStats,
  exportCompanyStatsCsv,
  exportCompanyStatsPdf,
} from "@/lib/stats.functions";
import { StatsInputSchema, canExportStats, presetRange, type StatsInput } from "@/lib/stats-core";

export const Route = createFileRoute("/_authenticated/statistiques")({
  component: StatistiquesPage,
  head: () => ({
    meta: [
      { title: "Statistiques de réception et signatures — PVIA" },
      {
        name: "description",
        content:
          "Suivi des PV, signatures, réserves et communications de votre entreprise avec périodes Paris et exports cohérents.",
      },
      { property: "og:title", content: "Statistiques de réception et signatures — PVIA" },
      {
        property: "og:description",
        content: "Pilotez les réceptions, signatures et réserves de votre entreprise.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});
function StatistiquesPage() {
  const company = useCompany();
  const { user, loading: authLoading } = useAuth();
  const billing = useSubscription();
  const gate = useBillingGate();
  const identity = [
    company.activeCompanyId,
    user?.id,
    company.activeRole,
    company.status,
    billing.isSuccess,
    billing.isError,
    billing.hasFeature("advanced_stats"),
    billing.blocked,
    gate.writeKnown,
  ].join(":");
  if (authLoading || company.status === "loading" || company.status === "idle")
    return (
      <p role="status" className="py-8 text-sm text-muted-foreground">
        Vérification de votre entreprise…
      </p>
    );
  if (!company.activeCompanyId || !user || !company.activeRole)
    return (
      <div className="space-y-3 py-8">
        <h1 className="text-2xl font-semibold">Statistiques</h1>
        <p className="text-sm">
          {company.status === "error"
            ? "Accès entreprise indisponible."
            : "Aucune entreprise active."}
        </p>
        <Button className="min-h-11" variant="outline" onClick={() => void company.refresh()}>
          Vérifier à nouveau
        </Button>
      </div>
    );
  if (billing.isPending || (!gate.writeKnown && !billing.isError && !billing.blocked))
    return (
      <p role="status" className="py-8 text-sm">
        Vérification de votre accès aux statistiques…
      </p>
    );
  if (billing.isError)
    return (
      <div role="alert" className="space-y-3 py-8">
        <p>Votre accès aux statistiques n’a pas pu être vérifié.</p>
        <Button className="min-h-11" onClick={() => void billing.refetch()}>
          Réessayer
        </Button>
      </div>
    );
  if (!billing.hasFeature("advanced_stats") || billing.blocked || !gate.writeKnown)
    return (
      <div className="space-y-3 py-8">
        <h1 className="text-2xl font-semibold">Statistiques</h1>
        <p className="text-sm">
          Les statistiques avancées nécessitent une formule active et un accès entreprise confirmé.
        </p>
        {isAdminRole(company.activeRole) ? (
          <Button asChild className="min-h-11">
            <Link to="/billing">Voir les formules</Link>
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Contactez un administrateur de votre entreprise.
          </p>
        )}
      </div>
    );
  return (
    <StatistiquesContent
      key={identity}
      companyId={company.activeCompanyId}
      userId={user.id}
      role={company.activeRole}
      identity={identity}
      companyName={
        company.memberships.find((m) => m.company_id === company.activeCompanyId)?.company?.name ??
        "Votre entreprise"
      }
    />
  );
}
function StatistiquesContent({
  companyId,
  userId: authUserId,
  role,
  identity,
  companyName,
}: {
  companyId: string;
  userId: string;
  role: string;
  identity: string;
  companyName: string;
}) {
  const fetchStats = useServerFn(getCompanyStats);
  const exportCsv = useServerFn(exportCompanyStatsCsv);
  const exportPdf = useServerFn(exportCompanyStatsPdf);
  const [preset, setPreset] = useState("30");
  const [filters, setFilters] = useState<StatsInput>(() => ({
    companyId,
    ...presetRange("30"),
    compare: true,
  }));
  const [exporting, setExporting] = useState(false);
  const parsed = StatsInputSchema.safeParse(filters);
  const valid = parsed.success;
  const scope = JSON.stringify([identity, filters]);
  const scopeGuard = useRef(createStatsScope());
  scopeGuard.current.set(scope);
  useEffect(() => {
    const guard = scopeGuard.current;
    return () => {
      guard.dispose();
    };
  }, []);
  const statsQuery = useQuery({
    queryKey: ["statistics-v2", companyId, authUserId, role, identity, filters],
    queryFn: () => fetchStats({ data: StatsInputSchema.parse(filters) }),
    enabled: valid,
    staleTime: 30_000,
    retry: 1,
  });
  const loaded = valid && statsQuery.isSuccess && !statsQuery.isFetching;
  const allowedExport = canExportStats(role, true, true, loaded);
  async function onExport(format: "csv" | "pdf") {
    if (!allowedExport || exporting) return;
    const input = StatsInputSchema.parse(filters);
    const current = scopeGuard.current.capture();
    setExporting(true);
    try {
      if (format === "csv") {
        const res = await exportCsv({ data: input });
        if (!current()) return;
        const url = URL.createObjectURL(new Blob([res.csv], { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = res.fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast.success("CSV téléchargé.");
      } else {
        const res = await exportPdf({ data: input });
        if (!current()) return;
        const a = document.createElement("a");
        a.href = res.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.click();
        toast.success("PDF prêt.");
      }
    } catch {
      if (current()) toast.error("L’export n’a pas abouti. Réessayez.");
    } finally {
      if (current()) setExporting(false);
    }
  }
  useEffect(() => {
    setExporting(false);
  }, [scope]);
  return (
    <StatisticsView
      companyName={statsQuery.data?.companyName ?? companyName}
      stats={valid ? statsQuery.data : undefined}
      input={filters}
      preset={preset}
      members={statsQuery.data?.members ?? []}
      loading={statsQuery.isFetching || statsQuery.isPending}
      error={
        !valid
          ? "Période ou filtres invalides."
          : statsQuery.error instanceof Error
            ? statsQuery.error.message
            : undefined
      }
      canExport={allowedExport}
      exporting={exporting}
      onRefresh={() => {
        if (!statsQuery.isFetching && valid) void statsQuery.refetch();
      }}
      onExport={(format) => void onExport(format)}
      onPreset={(value) => {
        setPreset(value);
        if (value !== "custom")
          setFilters((prev) => ({
            ...prev,
            ...presetRange(value),
            from: presetRange(value).from,
            compare: value === "all" ? false : prev.compare,
          }));
      }}
      onFilters={(next) =>
        setFilters((prev) => ({
          ...prev,
          pvType: next.pvType,
          userId: next.userId,
          compare: next.compare,
        }))
      }
      onDates={(from, to) => setFilters((prev) => ({ ...prev, from, to }))}
      onReset={() => {
        setPreset("30");
        setFilters({ companyId, ...presetRange("30"), compare: true });
      }}
    />
  );
}

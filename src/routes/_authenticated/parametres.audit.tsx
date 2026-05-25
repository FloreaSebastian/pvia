import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Activity, Search, Download, Loader2, ShieldCheck, Webhook, Mail,
  ChevronLeft, ChevronRight, FileText, UserCircle2, Filter,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useCompany } from "@/hooks/use-company";
import { supabase } from "@/integrations/supabase/client";
import { listCompanyAuditLogs, exportCompanyAuditPdf } from "@/lib/audit.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/parametres/audit")({
  component: AuditMonitoring,
  head: () => ({ meta: [{ title: "Audit & monitoring — Paramètres PVIA" }] }),
});

const CATEGORIES = [
  { id: "all",      label: "Tout" },
  { id: "pv",       label: "PV" },
  { id: "reserve",  label: "Réserves" },
  { id: "photo",    label: "Photos" },
  { id: "member",   label: "Membres" },
  { id: "client",   label: "Client" },
  { id: "user",     label: "Compte" },
  { id: "company",  label: "Entreprise" },
  { id: "audit",    label: "Audit" },
];

const PAGE_SIZE = 50;

function AuditMonitoring() {
  const { activeCompanyId } = useCompany();
  const listFn = useServerFn(listCompanyAuditLogs);
  const exportFn = useServerFn(exportCompanyAuditPdf);

  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { const t = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(0); }, [category, debounced]);

  const auditQuery = useQuery({
    queryKey: ["company-audit", activeCompanyId, category, debounced, page],
    queryFn: () => listFn({
      data: {
        companyId: activeCompanyId!,
        category,
        search: debounced || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      },
    }),
    enabled: !!activeCompanyId,
  });

  const webhookQuery = useQuery({
    queryKey: ["webhook-stats", activeCompanyId],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data } = await supabase
        .from("webhook_deliveries")
        .select("status")
        .eq("company_id", activeCompanyId!)
        .gte("created_at", since);
      const rows = data ?? [];
      return {
        total: rows.length,
        delivered: rows.filter((r) => r.status === "delivered").length,
        failed: rows.filter((r) => r.status === "failed").length,
        pending: rows.filter((r) => r.status === "pending").length,
      };
    },
    enabled: !!activeCompanyId,
  });

  const emailQuery = useQuery({
    queryKey: ["email-stats", activeCompanyId],
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const { data } = await supabase
        .from("email_logs")
        .select("status")
        .eq("company_id", activeCompanyId!)
        .gte("created_at", since);
      const rows = data ?? [];
      return {
        total: rows.length,
        sent: rows.filter((r) => r.status === "sent").length,
        failed: rows.filter((r) => r.status === "failed").length,
      };
    },
    enabled: !!activeCompanyId,
  });

  const logs = auditQuery.data?.logs ?? [];
  const total = auditQuery.data?.total ?? 0;
  const hasMore = auditQuery.data?.hasMore ?? false;
  const canSeeDetails = auditQuery.data?.canSeeDetails ?? false;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function handleExport() {
    if (!activeCompanyId) return;
    setExporting(true);
    try {
      const { url } = await exportFn({ data: { companyId: activeCompanyId, category, search: debounced || undefined } });
      if (url) {
        window.open(url, "_blank", "noopener");
        toast.success("Export généré.");
      } else {
        toast.error("Impossible de générer le PDF.");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur lors de l'export.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Health stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Événements (filtre)"
          value={auditQuery.isLoading ? "…" : total.toLocaleString("fr-FR")}
          hint="Sur le périmètre filtré"
        />
        <StatCard
          icon={<Webhook className="h-4 w-4" />}
          label="Webhooks 24h"
          value={webhookQuery.isLoading ? "…" : `${webhookQuery.data?.delivered ?? 0}/${webhookQuery.data?.total ?? 0}`}
          hint={
            webhookQuery.data && webhookQuery.data.failed > 0
              ? `${webhookQuery.data.failed} échec(s)`
              : "Aucun incident"
          }
          tone={webhookQuery.data && webhookQuery.data.failed > 0 ? "warning" : "ok"}
        />
        <StatCard
          icon={<Mail className="h-4 w-4" />}
          label="Emails 7j"
          value={emailQuery.isLoading ? "…" : `${emailQuery.data?.sent ?? 0}/${emailQuery.data?.total ?? 0}`}
          hint={
            emailQuery.data && emailQuery.data.failed > 0
              ? `${emailQuery.data.failed} échec(s)`
              : "Aucun incident"
          }
          tone={emailQuery.data && emailQuery.data.failed > 0 ? "warning" : "ok"}
        />
      </div>

      {/* Audit log */}
      <Card className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Journal d'activité</h2>
            {!canSeeDetails && (
              <Badge variant="secondary" className="ml-2 text-[10px]">Lecture limitée</Badge>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting || !logs.length}>
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Exporter PDF
          </Button>
        </div>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une action, une entité…"
              className="h-9 pl-8"
            />
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <Filter className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-xs transition-colors",
                  category === c.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted/50",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {auditQuery.isLoading ? (
          <div className="grid h-40 place-items-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
            <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">Aucun événement</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Modifiez les filtres ou patientez : l'activité apparaît ici en temps réel.
            </p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {logs.map((log) => <LogRow key={log.id} log={log} canSeeDetails={canSeeDetails} />)}
            </ul>
            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {total.toLocaleString("fr-FR")} événement(s) — page {page + 1} / {pageCount}
              </p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="outline" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function StatCard({
  icon, label, value, hint, tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "ok" | "warning";
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={cn(
          "grid h-7 w-7 place-items-center rounded-lg",
          tone === "warning" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-primary/10 text-primary",
        )}>{icon}</span>
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && (
        <div className={cn(
          "mt-1 text-xs",
          tone === "warning" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
        )}>{hint}</div>
      )}
    </Card>
  );
}

type Log = {
  id: string;
  action: string;
  entity_type: string;
  pv_id: string | null;
  pv_numero: string | null;
  user_name: string | null;
  created_at: string;
  ip_address: string | null;
  metadata: any;
};

function actionTone(action: string): "ok" | "warn" | "muted" {
  if (action.includes("delete") || action.includes("failed") || action.includes("removed") || action.includes("revoked")) return "warn";
  if (action.includes("signed") || action.includes("success") || action.includes("joined") || action.includes("completed") || action.includes("lifted")) return "ok";
  return "muted";
}

function LogRow({ log, canSeeDetails }: { log: Log; canSeeDetails: boolean }) {
  const tone = actionTone(log.action);
  const meta = useMemo(() => {
    if (!log.metadata || typeof log.metadata !== "object") return null;
    const keys = Object.keys(log.metadata);
    if (!keys.length) return null;
    return keys.slice(0, 3).map((k) => `${k}: ${String(log.metadata[k]).slice(0, 60)}`).join(" · ");
  }, [log.metadata]);
  return (
    <li className="flex items-start gap-3 py-3">
      <span
        className={cn(
          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
          tone === "ok" && "bg-emerald-500",
          tone === "warn" && "bg-amber-500",
          tone === "muted" && "bg-muted-foreground/40",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-mono text-xs font-medium">{log.action}</span>
          {log.pv_numero && (
            <Badge variant="outline" className="gap-1 text-[10px]">
              <FileText className="h-3 w-3" /> {log.pv_numero}
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <UserCircle2 className="h-3 w-3" />
            {log.user_name ?? "Système"}
          </span>
          <span>·</span>
          <time>{new Date(log.created_at).toLocaleString("fr-FR")}</time>
          {canSeeDetails && log.ip_address && (<><span>·</span><span className="font-mono">{log.ip_address}</span></>)}
        </div>
        {meta && <p className="mt-1 truncate text-xs text-muted-foreground/80">{meta}</p>}
      </div>
    </li>
  );
}

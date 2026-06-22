import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/PageHeader";
import { Loader2, RefreshCw, ShieldCheck, AlertTriangle, AlertOctagon, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { runSystemHealthAudit, type SystemHealthResult, type HealthCheck } from "@/lib/system-health.functions";

export const Route = createFileRoute("/_authenticated/admin/system-health")({
  component: SystemHealthPage,
  head: () => ({ meta: [{ title: "Santé système — PVIA" }] }),
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/login" });
    const { isPlatformAdminEmail } = await import("@/lib/platform-admin");
    if (!isPlatformAdminEmail(user.email)) throw redirect({ to: "/admin/forbidden" });
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "platform_admin")
      .maybeSingle();
    if (!data) throw redirect({ to: "/admin/forbidden" });
  },
});

function SeverityBadge({ severity }: { severity: HealthCheck["severity"] }) {
  if (severity === "ok") return <Badge variant="secondary" className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-300">OK</Badge>;
  if (severity === "warning") return <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-300">Warning</Badge>;
  return <Badge variant="destructive">Critique</Badge>;
}

function StatusKpi({ result }: { result: SystemHealthResult }) {
  const tone =
    result.status === "critical"
      ? "border-destructive/40 bg-destructive/5"
      : result.status === "warning"
      ? "border-amber-500/40 bg-amber-500/5"
      : "border-emerald-600/40 bg-emerald-600/5";
  const Icon =
    result.status === "critical" ? AlertOctagon
    : result.status === "warning" ? AlertTriangle
    : CheckCircle2;
  const label =
    result.status === "critical" ? "Critique"
    : result.status === "warning" ? "Avertissements"
    : "Tout est OK";
  return (
    <Card className={`p-6 border ${tone}`}>
      <div className="flex items-center gap-3">
        <Icon className="h-8 w-8" />
        <div>
          <div className="text-2xl font-bold">{label}</div>
          <div className="text-sm text-muted-foreground">
            {result.passedChecks}/{result.totalChecks} contrôles OK · {result.warnings} warning(s) · {result.critical} critique(s)
          </div>
        </div>
      </div>
    </Card>
  );
}

function SystemHealthPage() {
  const runFn = useServerFn(runSystemHealthAudit);
  const [result, setResult] = useState<SystemHealthResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function runAudit() {
    setLoading(true);
    try {
      const r = await runFn();
      setResult(r);
      if (r.status === "critical") toast.error(`${r.critical} contrôle(s) critique(s) détecté(s).`);
      else if (r.status === "warning") toast.warning(`${r.warnings} avertissement(s).`);
      else toast.success("Aucune anomalie détectée.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Audit impossible.");
    } finally {
      setLoading(false);
    }
  }

  const grouped = result
    ? result.details.reduce<Record<string, HealthCheck[]>>((acc, c) => {
        (acc[c.category] ??= []).push(c);
        return acc;
      }, {})
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Admin</span>}
        title="Santé système"
        description="Audit automatique de cohérence des données et des workflows métier."
        actions={
          <Button onClick={runAudit} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Lancer un audit
          </Button>
        }
      />

      {!result && !loading && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Aucun audit lancé pour l'instant. Cliquez sur « Lancer un audit » pour évaluer
          l'état de la plateforme.
        </Card>
      )}

      {loading && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
          Audit en cours…
        </Card>
      )}

      {result && (
        <>
          <StatusKpi result={result} />
          <div className="text-xs text-muted-foreground">
            Audit du {new Date(result.generatedAt).toLocaleString("fr-FR")} · durée {result.durationMs} ms
          </div>

          {Object.entries(grouped ?? {}).map(([category, items]) => (
            <Card key={category} className="p-4">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {category}
              </h3>
              <div className="divide-y divide-border">
                {items.map((c) => (
                  <div key={c.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{c.label}</div>
                      <div className="text-xs text-muted-foreground">{c.id}</div>
                      {c.details?.sample && c.details.sample.length > 0 && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Échantillon : {c.details.sample.join(", ")}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm tabular-nums">{c.count}</span>
                      <SeverityBadge severity={c.severity} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

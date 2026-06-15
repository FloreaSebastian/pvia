import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getGoLiveStatus, type GoLiveStatus } from "@/lib/go-live.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
} from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";

export const Route = createFileRoute("/_authenticated/admin/go-live/")({
  component: Page,
  head: () => ({ meta: [{ title: "Go-Live — PVIA" }] }),
  beforeLoad: async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
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

const VERDICT_META: Record<
  GoLiveStatus["verdict"],
  { label: string; cls: string; icon: typeof ShieldCheck }
> = {
  blocked: {
    label: "Bloqué",
    cls: "bg-destructive/15 text-destructive border-destructive/30",
    icon: ShieldX,
  },
  ready_with_warnings: {
    label: "Prêt sous réserve",
    cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    icon: ShieldAlert,
  },
  ready_for_production: {
    label: "Prêt publication",
    cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    icon: ShieldCheck,
  },
};

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

function CfgRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
      ) : (
        <XCircle className="h-4 w-4 text-destructive" />
      )}
      <span>{label}</span>
    </div>
  );
}

function Page() {
  const fn = useServerFn(getGoLiveStatus);
  const [data, setData] = useState<GoLiveStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setData(await fn());
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  if (loading || !data) {
    return (
      <div className="grid place-items-center py-20">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const v = VERDICT_META[data.verdict];
  const VIcon = v.icon;

  return (
    <div>
      <PageHeader
        title="Go-Live"
        description="Décision de publication production basée sur les signaux temps réel."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load}>
              Actualiser
            </Button>
            <Button asChild size="sm">
              <Link to="/admin/go-live/report">
                <FileText className="mr-1.5 h-4 w-4" /> Rapport complet
              </Link>
            </Button>
          </div>
        }
      />

      <Card className={`mb-6 border-2 p-6 ${v.cls}`}>
        <div className="flex items-center gap-3">
          <VIcon className="h-8 w-8" />
          <div>
            <div className="text-xs uppercase tracking-wider opacity-80">Décision</div>
            <div className="text-2xl font-bold">{v.label}</div>
          </div>
        </div>
        {data.blockers.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm">
            {data.blockers.map((b, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <ShieldX className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}
        {data.warnings.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm opacity-90">
            {data.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Checklist & activité
      </h2>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Checklist"
          value={`${data.checklist.pct}%`}
          sub={`${data.checklist.passed}/${data.checklist.total} réussis · ${data.checklist.failed} échec(s)`}
        />
        <Stat
          label="Entreprises"
          value={data.totals.companies}
          sub={`${data.totals.pvSigned} PV signés / ${data.totals.pvTotal}`}
        />
        <Stat
          label="Erreurs critiques"
          value={data.appErrors.criticalOpen}
          sub={`${data.appErrors.last24h} erreurs 24 h`}
        />
        <Stat
          label="Dernier test"
          value={
            data.lastTestedAt ? new Date(data.lastTestedAt).toLocaleDateString("fr-FR") : "—"
          }
          sub={
            data.lastTestedAt
              ? new Date(data.lastTestedAt).toLocaleTimeString("fr-FR")
              : "Aucun test enregistré"
          }
        />
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Files
      </h2>
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 text-sm font-semibold">Emails</div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">sent {data.emails.sent}</Badge>
            <Badge variant="secondary">retry {data.emails.retrying}</Badge>
            <Badge variant={data.emails.failed ? "destructive" : "secondary"}>
              failed {data.emails.failed}
            </Badge>
            <Badge variant={data.emails.dead ? "destructive" : "secondary"}>
              dead {data.emails.dead}
            </Badge>
          </div>
        </Card>
        <Card className="p-4">
          <div className="mb-2 text-sm font-semibold">Webhooks</div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">delivered {data.webhooks.delivered}</Badge>
            <Badge variant="secondary">pending {data.webhooks.pending}</Badge>
            <Badge variant="secondary">retry {data.webhooks.retrying}</Badge>
            <Badge variant={data.webhooks.failed ? "destructive" : "secondary"}>
              failed {data.webhooks.failed}
            </Badge>
            <Badge variant={data.webhooks.dead ? "destructive" : "secondary"}>
              dead {data.webhooks.dead}
            </Badge>
          </div>
        </Card>
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Configuration
      </h2>
      <Card className="p-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <CfgRow ok={data.config.stripe} label="Stripe (clé présente)" />
          <CfgRow ok={data.config.resend} label="Resend (clé présente)" />
          <CfgRow ok={data.config.vapid} label="Push VAPID" />
          <CfgRow ok={data.config.cronSecret} label="CRON_SECRET" />
          <CfgRow ok={data.config.publicAppUrl} label="PUBLIC_APP_URL" />
        </div>
      </Card>

      <p className="mt-6 text-xs text-muted-foreground">
        Snapshot généré à {new Date(data.generatedAt).toLocaleString("fr-FR")}.
      </p>
    </div>
  );
}

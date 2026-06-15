import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getGoLiveReport, type GoLiveReport } from "@/lib/go-live-report.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Download, Printer, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";

export const Route = createFileRoute("/_authenticated/admin/go-live/report")({
  component: Page,
  head: () => ({ meta: [{ title: "Rapport Go-Live — PVIA" }] }),
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

const DECISION_LABEL: Record<GoLiveReport["decision"], string> = {
  blocked: "Bloqué",
  ready_with_warnings: "Prêt sous réserve",
  ready_for_production: "Prêt publication",
};

function toMarkdown(r: GoLiveReport): string {
  const lines: string[] = [];
  lines.push(`# Rapport Go-Live PVIA`);
  lines.push(`Généré le ${new Date(r.generatedAt).toLocaleString("fr-FR")}`);
  lines.push("");
  lines.push(`## Décision : **${DECISION_LABEL[r.decision]}**`);
  lines.push("");
  lines.push(`## Sécurité`);
  lines.push(`- Anciens rôles \`admin\` : ${r.security.legacyAdminRoles}`);
  lines.push(`- platform_admin : ${r.security.platformAdmins}`);
  lines.push(`- Impersonations ouvertes : ${r.security.impersonationOpen}`);
  lines.push("");
  lines.push(`## Conformité`);
  lines.push(`- Items : ${r.compliance.done}/${r.compliance.total} (${r.compliance.pct}%)`);
  lines.push("");
  lines.push(`## Emails`);
  lines.push(
    `- sent ${r.emails.sent} · retry ${r.emails.retrying} · failed ${r.emails.failed} · dead ${r.emails.dead}`,
  );
  lines.push("");
  lines.push(`## Webhooks`);
  lines.push(
    `- delivered ${r.webhooks.delivered} · pending ${r.webhooks.pending} · retry ${r.webhooks.retrying} · failed ${r.webhooks.failed} · dead ${r.webhooks.dead} · enabled ${r.webhooks.enabled}`,
  );
  lines.push("");
  lines.push(`## Stripe`);
  lines.push(
    `- sandbox: ${r.stripe.sandboxKey ? "OK" : "absent"} · live: ${r.stripe.liveKey ? "OK" : "absent"}`,
  );
  lines.push(`- Abonnements actifs : ${r.stripe.activeSubs} · trialing : ${r.stripe.trialingSubs}`);
  lines.push("");
  lines.push(`## Stockage`);
  lines.push(`- pv-assets : ${r.storage.pvAssetsAvailable ? "OK" : "KO"}`);
  lines.push(`- company-logos : ${r.storage.logosAvailable ? "OK" : "KO"}`);
  lines.push("");
  lines.push(`## PV / Signatures`);
  lines.push(`- PV total : ${r.pv.total} · signés : ${r.pv.signed} · verrouillés : ${r.pv.locked}`);
  lines.push(`- Signatures distantes : ${r.pv.remoteSignatures} · sur place : ${r.pv.onsiteSignatures}`);
  lines.push(`- Réserves ouvertes : ${r.pv.reservesOpen} · levées/validées : ${r.pv.reservesLifted}`);
  lines.push("");
  lines.push(`## Risques restants`);
  if (r.risks.length === 0) lines.push("- Aucun risque détecté.");
  else for (const x of r.risks) lines.push(`- ${x}`);
  lines.push("");
  return lines.join("\n");
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      <div className="space-y-1 text-sm">{children}</div>
    </Card>
  );
}

function Page() {
  const fn = useServerFn(getGoLiveReport);
  const [data, setData] = useState<GoLiveReport | null>(null);

  useEffect(() => {
    fn().then(setData).catch(console.error);
  }, [fn]);

  if (!data) {
    return (
      <div className="grid place-items-center py-20">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const downloadMd = () => {
    const md = toMarkdown(data);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pvia-go-live-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="Rapport Go-Live"
        description="Vue consolidée pour décision publication."
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/go-live">
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Retour
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="mr-1.5 h-4 w-4" /> Imprimer
            </Button>
            <Button size="sm" onClick={downloadMd}>
              <Download className="mr-1.5 h-4 w-4" /> Markdown
            </Button>
          </div>
        }
      />

      <Card className="mb-6 p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Décision finale</div>
        <div className="mt-1 text-2xl font-bold">
          <Badge
            variant={data.decision === "ready_for_production" ? "default" : data.decision === "blocked" ? "destructive" : "secondary"}
            className="text-base"
          >
            {DECISION_LABEL[data.decision]}
          </Badge>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Block title="Sécurité">
          <div>Anciens rôles admin : <strong>{data.security.legacyAdminRoles}</strong></div>
          <div>platform_admin : <strong>{data.security.platformAdmins}</strong></div>
          <div>Impersonations ouvertes : <strong>{data.security.impersonationOpen}</strong></div>
        </Block>
        <Block title="Conformité CNIL">
          <div>{data.compliance.done}/{data.compliance.total} items ({data.compliance.pct}%)</div>
        </Block>
        <Block title="Emails">
          <div>sent : {data.emails.sent}</div>
          <div>retrying : {data.emails.retrying}</div>
          <div className={data.emails.failed ? "text-destructive" : ""}>failed : {data.emails.failed}</div>
          <div className={data.emails.dead ? "text-destructive font-semibold" : ""}>dead : {data.emails.dead}</div>
        </Block>
        <Block title="Webhooks">
          <div>delivered : {data.webhooks.delivered}</div>
          <div>pending : {data.webhooks.pending}</div>
          <div>retrying : {data.webhooks.retrying}</div>
          <div className={data.webhooks.failed ? "text-destructive" : ""}>failed : {data.webhooks.failed}</div>
          <div className={data.webhooks.dead ? "text-destructive font-semibold" : ""}>dead : {data.webhooks.dead}</div>
          <div>endpoints activés : {data.webhooks.enabled}</div>
        </Block>
        <Block title="Stripe">
          <div>Sandbox : {data.stripe.sandboxKey ? "OK" : "absent"}</div>
          <div>Live : {data.stripe.liveKey ? "OK" : "absent"}</div>
          <div>Actifs : {data.stripe.activeSubs} · Trial : {data.stripe.trialingSubs}</div>
        </Block>
        <Block title="Stockage">
          <div>pv-assets : {data.storage.pvAssetsAvailable ? "OK" : "KO"}</div>
          <div>company-logos : {data.storage.logosAvailable ? "OK" : "KO"}</div>
        </Block>
        <Block title="PV / Signatures">
          <div>Total : {data.pv.total} · Signés : {data.pv.signed} · Verrouillés : {data.pv.locked}</div>
          <div>Distantes : {data.pv.remoteSignatures} · Sur place : {data.pv.onsiteSignatures}</div>
          <div>Réserves ouvertes : {data.pv.reservesOpen} · Levées : {data.pv.reservesLifted}</div>
        </Block>
        <Block title="Risques restants">
          {data.risks.length === 0 ? (
            <div className="text-emerald-700 dark:text-emerald-300">Aucun risque détecté.</div>
          ) : (
            <ul className="list-disc pl-5">
              {data.risks.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </Block>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Généré le {new Date(data.generatedAt).toLocaleString("fr-FR")}.
      </p>
    </div>
  );
}

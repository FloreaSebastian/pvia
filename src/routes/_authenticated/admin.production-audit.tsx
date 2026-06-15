import * as React from "react";
import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/PageHeader";
import { AlertTriangle, ShieldAlert, ShieldX, Info, FileText, Printer } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/production-audit")({
  component: Page,
  head: () => ({ meta: [{ title: "Audit production — PVIA" }] }),
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/login" });
    const { isPlatformAdminEmail } = await import("@/lib/platform-admin");
    if (!isPlatformAdminEmail(user.email)) throw redirect({ to: "/admin/forbidden" });
    const { data } = await supabase
      .from("user_roles").select("role")
      .eq("user_id", user.id).eq("role", "platform_admin").maybeSingle();
    if (!data) throw redirect({ to: "/admin/forbidden" });
  },
});

type Sev = "critique" | "majeur" | "mineur";
type Finding = {
  id: string;
  sev: Sev;
  domain: "Workflow PV" | "Stripe" | "Emails" | "Multi-tenant";
  title: string;
  file: string;
  detail?: string;
  fix?: string;
};

const FINDINGS: Finding[] = [
  // ====== CRITIQUES — toutes résolues ======
  // WF-C1/C2/C3, ST-C1/C2/C3/C4, EM-C1/C2 : voir migrations 20260615210605 + sprint final.

  // ====== MAJEURS — tous résolus (sprint final) ======
  // ST-M1, ST-M3 : webhook past_due + auto-suspend (migration 20260615211937).
  // ST-M2 : adminResyncStripeSubscription → recovery réelle via Stripe API
  //   + audits stripe.subscription_recovered / _failed. Bouton "Réparer
  //   abonnement" sur /admin/support/$companyId.
  // ST-M4 : notifySubscriptionStatusChange dans webhook + audit granulaire
  //   (stripe.subscription_activated / trialing / past_due / canceled / unpaid)
  //   + push fanout owners/admins + notifications app.
  // ST-M5 : singleton Stripe via getStripeClient(env) (per-isolate, par env).
  //   Webhook utilise désormais supabaseAdmin partagé (dynamic import) au lieu
  //   d'un createClient dupliqué. getStripeSingletonStats() pour mesure.
  // ST-M6 : APP_ENV explicite (src/lib/app-env.server.ts + VITE_APP_ENV) ;
  //   fallback hostname conservé. Exposé dans /api/public/health/deep
  //   ("app_env") et /admin/go-live (config.appEnv / appEnvExplicit).
  // EM-M1 : sweepStaleEmailFailures() promeut les échecs non-rejouables
  //   (PDF en pièce jointe) vers status='dead' après 30 min, branché dans
  //   /api/public/hooks/drain-emails. Monitoring déjà unifié (retry +
  //   mark resolved) sur /admin/monitoring.
  // EM-M2, EM-M3 : email-throttle (60s idempotence).
  // WF-M1→M8 : visibilité erreurs + TOCTOU (Phase 2).
  // MT-M1, MT-M2 : storage policies + email_logs platform-admin only.

  // ====== MINEURS — ne pas traiter dans ce sprint ======
  { id: "WF-m1", sev: "mineur", domain: "Workflow PV", title: "OTP onsite orphelin bypass `pv_id`",
    file: "src/lib/signature-otp.server.ts:152-157",
    detail: "Check `if (opts.expectedPvId && otp.pv_id && ...)` : si otp.pv_id reste null (update échoué), le check passe.",
    fix: "Throw si pv_id null à la consommation onsite." },

  // ====== MINEURS — ne pas traiter dans ce sprint ======
  { id: "WF-m1", sev: "mineur", domain: "Workflow PV", title: "OTP onsite orphelin bypass `pv_id`",
    file: "src/lib/signature-otp.server.ts:152-157",
    detail: "Check `if (opts.expectedPvId && otp.pv_id && ...)` : si otp.pv_id reste null (update échoué), le check passe.",
    fix: "Throw si pv_id null à la consommation onsite." },
  { id: "WF-m2", sev: "mineur", domain: "Workflow PV", title: "OTP générable sur PV signé",
    file: "src/lib/sign.functions.ts:361-371",
    detail: "sendRemoteClientOtp ne vérifie pas status='en_attente'.",
    fix: "Ajouter check status." },
  { id: "WF-m3", sev: "mineur", domain: "Workflow PV", title: "Navigation step non bloquée pendant soumission",
    file: "src/routes/_authenticated/pv.new.tsx:1227",
    detail: "Bouton final disabled OK mais Précédent/Suivant ne checkent pas `saving`." },
  { id: "WF-m4", sev: "mineur", domain: "Workflow PV", title: "Catch vides dans PDF levée",
    file: "src/lib/reserve-lift.server.ts:168, 268",
    detail: "Logo fetch + photo embed catch ignoré sans log." },
  { id: "ST-m1", sev: "mineur", domain: "Stripe", title: "Fallback lookup_key/lovable_external_id non documenté",
    file: "src/lib/stripe.server.ts:75-79",
    detail: "Si null, log silencieux, Stripe croit l'événement traité." },
  { id: "ST-m2", sev: "mineur", domain: "Stripe", title: "assertCompanyAdmin dupliqué",
    file: "src/lib/billing.functions.ts:12-36 vs webhooks.functions.ts:29-51" },
  { id: "ST-m3", sev: "mineur", domain: "Stripe", title: "Portail ouvert sans vérifier statut actif",
    file: "src/lib/billing.functions.ts:132" },
  { id: "ST-m4", sev: "mineur", domain: "Stripe", title: "drainPending silencieux sans alerting",
    file: "src/lib/webhooks.server.ts:124", detail: "void ... .catch(()=>null) : backlog invisible." },
  { id: "EM-m1", sev: "mineur", domain: "Emails", title: "catch silencieux dans logAttempt",
    file: "src/lib/email.server.ts:81-96, 170-186, 253-269" },
  { id: "EM-m2", sev: "mineur", domain: "Emails", title: "drainFailedEmails sans lock distribué",
    file: "src/lib/retry.server.ts:62", detail: "Double cron simultané = doubles envois possibles avant UPDATE." },
  { id: "EM-m3", sev: "mineur", domain: "Emails", title: "Résolution admin écrase error_message",
    file: "src/lib/monitoring.functions.ts:220", detail: "Perte de l'historique d'erreur originale." },
  { id: "MT-m1", sev: "mineur", domain: "Multi-tenant", title: "push_subscriptions sans filtre company_id",
    file: "migration 20260521174941:19-24",
    detail: "Filtre user_id only. Aucune fuite métier mais pollue après changement de company." },
  { id: "MT-m2", sev: "mineur", domain: "Multi-tenant", title: "retry.server.ts global non documenté",
    file: "src/lib/retry.server.ts:64-67",
    detail: "Fonction globale (toutes companies). OK car cron-only, mais à documenter." },
];

const sevColor: Record<Sev, string> = {
  critique: "bg-red-100 text-red-900 border-red-300",
  majeur: "bg-orange-100 text-orange-900 border-orange-300",
  mineur: "bg-yellow-50 text-yellow-900 border-yellow-300",
};

const sevIcon: Record<Sev, React.ReactNode> = {
  critique: <ShieldX className="h-4 w-4" />,
  majeur: <ShieldAlert className="h-4 w-4" />,
  mineur: <Info className="h-4 w-4" />,
};

function Section({ sev, title }: { sev: Sev; title: string }) {
  const items = FINDINGS.filter((f) => f.sev === sev);
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold flex items-center gap-2">
        {sevIcon[sev]} {title} <Badge variant="outline">{items.length}</Badge>
      </h2>
      <div className="space-y-2">
        {items.map((f) => (
          <Card key={f.id} className={`p-4 border-l-4 ${sevColor[f.sev]}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs px-1.5 py-0.5 bg-background rounded border">{f.id}</span>
                  <Badge variant="secondary">{f.domain}</Badge>
                </div>
                <div className="font-medium">{f.title}</div>
                <div className="text-xs font-mono text-muted-foreground mt-1">{f.file}</div>
                {f.detail && <p className="text-sm mt-2">{f.detail}</p>}
                {f.fix && <p className="text-sm mt-1"><span className="font-semibold">Correctif :</span> {f.fix}</p>}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

function Page() {
  const counts = {
    critique: FINDINGS.filter((f) => f.sev === "critique").length,
    majeur: FINDINGS.filter((f) => f.sev === "majeur").length,
    mineur: FINDINGS.filter((f) => f.sev === "mineur").length,
  };

  // Score: 100 − 15*crit − 5*maj − 1*min, borné [0;100]
  const score = Math.max(0, Math.min(100, 100 - 15 * counts.critique - 5 * counts.majeur - 1 * counts.mineur));

  const verdict =
    counts.critique > 0 ? { label: "NON PRÊT", color: "bg-red-600 text-white" }
    : counts.majeur > 2 ? { label: "PRÊT SOUS RÉSERVE", color: "bg-orange-500 text-white" }
    : { label: "PRÊT PRODUCTION", color: "bg-green-600 text-white" };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <PageHeader
        title="Audit production"
        description="Rapport honnête issu d'un audit code statique multi-domaines (workflows, Stripe, emails, multi-tenant)."
      />

      <div className="flex flex-wrap gap-2 print:hidden">
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-2" /> Imprimer / PDF
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link to="/admin/go-live">
            <FileText className="h-4 w-4 mr-2" /> Go-Live status
          </Link>
        </Button>
      </div>

      <Card className="p-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 items-center">
          <div>
            <div className="text-xs text-muted-foreground">Score global</div>
            <div className="text-4xl font-bold">{score}<span className="text-xl text-muted-foreground">/100</span></div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Critiques</div>
            <div className="text-3xl font-bold text-red-600">{counts.critique}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Majeurs</div>
            <div className="text-3xl font-bold text-orange-600">{counts.majeur}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Mineurs</div>
            <div className="text-3xl font-bold text-yellow-600">{counts.mineur}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Verdict</div>
            <div className={`inline-block px-3 py-1.5 rounded-md font-semibold mt-1 ${verdict.color}`}>
              {verdict.label}
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-4 bg-amber-50 border-amber-200">
        <div className="flex gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold mb-1">Conclusion</p>
            <p>
              {counts.critique} bugs critiques bloquent une mise en production immédiate. Les races condition sur la signature
              (WF-C1, WF-C2) et le webhook Stripe incomplet (ST-C1, ST-C2) peuvent provoquer des doublons de signatures,
              d'OTP, d'abonnements non créés ou non annulés en silence. À corriger avant tout client réel.
            </p>
            <p className="mt-2">
              Les {counts.majeur} bugs majeurs ne bloquent pas mais créent un risque opérationnel élevé (échecs silencieux,
              fuite admin platform sur email_logs, pas de suspension auto Stripe, deux emails métier jamais envoyés).
            </p>
            <p className="mt-2">
              Les {counts.mineur} mineurs sont des poches de dette technique : logs manquants, idempotence partielle,
              policies obsolètes non droppées. À traiter en sprint suivant.
            </p>
          </div>
        </div>
      </Card>

      <Section sev="critique" title="Critiques (bloquants prod)" />
      <Section sev="majeur" title="Majeurs (risque opérationnel élevé)" />
      <Section sev="mineur" title="Mineurs (dette technique)" />

      <Card className="p-4">
        <h3 className="font-semibold mb-2">Méthodologie</h3>
        <ul className="text-sm space-y-1 list-disc pl-5 text-muted-foreground">
          <li>Audit code statique en 4 axes parallèles : workflows PV/signature, Stripe, Resend/emails, RLS multi-tenant.</li>
          <li>Lecture seule — aucun bug corrigé dans ce sprint, conformément à la demande.</li>
          <li>Score calculé : 100 − 15·critique − 5·majeur − 1·mineur (borné [0;100]).</li>
          <li>Tests d'intégration runtime non exécutés ; le rapport est une analyse de code, complémentaire au Go-Live status.</li>
        </ul>
      </Card>
    </div>
  );
}

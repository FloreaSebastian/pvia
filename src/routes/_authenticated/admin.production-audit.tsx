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
  detail: string;
  fix?: string;
};

const FINDINGS: Finding[] = [
  // CRITIQUES — Workflows
  { id: "WF-C1", sev: "critique", domain: "Workflow PV", title: "Race condition : double signature distante",
    file: "src/lib/sign.functions.ts:241-284",
    detail: "Le check `if (pv.client_signature) throw` et l'UPDATE qui écrit la signature sont deux opérations séparées (TOCTOU). Deux requêtes concurrentes peuvent passer le guard et écrire deux signatures.",
    fix: "UPDATE conditionnel: `.eq('status','en_attente').is('client_signature', null)` + vérifier rowsAffected === 1." },
  { id: "WF-C2", sev: "critique", domain: "Workflow PV", title: "OTP signature réutilisable (TOCTOU)",
    file: "src/lib/signature-otp.server.ts:97-127",
    detail: "Lecture de `used_at` puis UPDATE non atomique. Deux requêtes simultanées consomment le même OTP. Idem pour `attempts` : 5 requêtes parallèles contournent le plafond brute-force.",
    fix: "UPDATE atomique: `UPDATE ... SET used_at = now() WHERE id = ? AND used_at IS NULL` + check rowcount." },
  { id: "WF-C3", sev: "critique", domain: "Workflow PV", title: "Doublon numéro de levée de réserves",
    file: "src/lib/reserve-lift.functions.ts:56-65",
    detail: "`generateLiftNumber` fait COUNT(*) puis construit le numéro hors transaction. Deux créations concurrentes génèrent le même `PV-001-LR-01`.",
    fix: "RPC atomique côté Postgres (comme `generate_next_pv_number`) ou contrainte UNIQUE + retry." },

  // CRITIQUES — Stripe
  { id: "ST-C1", sev: "critique", domain: "Stripe", title: "`checkout.session.completed` non géré",
    file: "src/routes/api/public/payments/webhook.ts:117-131",
    detail: "Le switch ne gère que customer.subscription.* et invoice.payment_failed. Si Stripe envoie d'abord checkout.session.completed avant subscription.created (latence), aucune ligne `subscriptions` n'est créée.",
    fix: "Ajouter case 'checkout.session.completed' avec resolve via stripe.subscriptions.retrieve." },
  { id: "ST-C2", sev: "critique", domain: "Stripe", title: "`markCanceled` sans upsert idempotent",
    file: "src/routes/api/public/payments/webhook.ts:66-87",
    detail: "UPDATE seul, sans onConflict. Si l'ordre des webhooks est inversé (deleted avant created), l'update échoue silencieusement, la subscription reste active en base.",
    fix: "Utiliser upsert avec onConflict: 'stripe_subscription_id'." },
  { id: "ST-C3", sev: "critique", domain: "Stripe", title: "`markCanceled` n'écrit pas d'audit_log",
    file: "src/routes/api/public/payments/webhook.ts:66-87",
    detail: "Aucune trace auditée d'une annulation d'abonnement. Contraste avec upsertSubscription qui audit correctement.",
    fix: "Ajouter insert audit_logs `subscription.canceled`." },
  { id: "ST-C4", sev: "critique", domain: "Stripe", title: "Variables d'env webhook sans guard runtime",
    file: "src/routes/api/public/payments/webhook.ts:5-11",
    detail: "Le `!` force l'assertion TS mais ne lève pas si la var est undefined → client Supabase invalide, erreurs silencieuses.",
    fix: "Throw explicite si env var manquante." },

  // CRITIQUES — Emails
  { id: "EM-C1", sev: "critique", domain: "Emails", title: "Notification client `reserve_lift_request` jamais envoyée",
    file: "src/lib/email-registry.server.ts:37 (aucun appelant)",
    detail: "Type d'email déclaré dans le registre mais jamais émis. Le client ne reçoit aucune notification proactive quand une levée est prête à valider.",
    fix: "Implémenter l'envoi dans createReserveLift après signature entreprise." },
  { id: "EM-C2", sev: "critique", domain: "Emails", title: "Email `billing_past_due` jamais envoyé",
    file: "src/lib/email-registry.server.ts:43 (aucun appelant)",
    detail: "Le webhook Stripe invoice.payment_failed n'envoie aucun email au client. Perte de revenu silencieuse.",
    fix: "Brancher l'envoi dans notifyPaymentFailed du webhook." },

  // MAJEURS — Workflows
  { id: "WF-M1", sev: "majeur", domain: "Workflow PV", title: "Échec insert réserves silencieux",
    file: "src/lib/pv-create.functions.ts:333-335",
    detail: "console.error mais pas de throw. Le PV est créé signé, le PDF généré sans réserves, l'email envoyé. Document légal incomplet sans trace.",
    fix: "Throw + rollback ou statut 'failed'." },
  { id: "WF-M2", sev: "majeur", domain: "Workflow PV", title: "Update `sign_token_hash` sans error check",
    file: "src/lib/pv-create.functions.ts:397-406",
    detail: "Si l'UPDATE échoue, le PV est `en_attente` avec un hash invalide → lien de signature mort, impossible à déboguer côté client.",
    fix: "Destructurer { error } et throw." },
  { id: "WF-M3", sev: "majeur", domain: "Workflow PV", title: "Insert `reserve_lift_items` sans check",
    file: "src/lib/reserve-lift.functions.ts:174-181",
    detail: "Échec d'insertion → rapport 'signe' sans items, PDF incohérent avec l'audit.",
    fix: "Vérifier { error } et throw." },
  { id: "WF-M4", sev: "majeur", domain: "Workflow PV", title: "Update statut réserves sans check",
    file: "src/lib/reserve-lift.functions.ts:186 ; src/lib/client-reserve-lift.functions.ts:262-266",
    detail: "Si l'UPDATE échoue, le rapport est créé 'levé' mais les réserves restent 'ouverte' en DB. Incohérence métier non loguée.",
    fix: "Capturer error + audit." },
  { id: "WF-M5", sev: "majeur", domain: "Workflow PV", title: "`pdf_url` non enregistré sans erreur",
    file: "src/lib/reserve-lift.server.ts:416-419",
    detail: "Si l'UPDATE pdf_url échoue, la fonction retourne un path valide mais la DB reste null → UI affiche 'PDF indisponible' alors que le fichier existe.",
    fix: "Vérifier { error }." },
  { id: "WF-M6", sev: "majeur", domain: "Workflow PV", title: "OTP marqué utilisé côté code mais pas en DB",
    file: "src/lib/signature-otp.server.ts:122-127",
    detail: "Si l'UPDATE échoue, la fn retourne `used_at: now()` mais la DB garde null → OTP réutilisable.",
    fix: "Throw si error ou rowcount !== 1." },
  { id: "WF-M7", sev: "majeur", domain: "Workflow PV", title: "Double validation client (TOCTOU)",
    file: "src/lib/client-reserve-lift.functions.ts:242-252",
    detail: "Check `client_validated_at == null` puis UPDATE → deux double-clics passent.",
    fix: "UPDATE conditionnel `.is('client_validated_at', null)` + check rowcount." },
  { id: "WF-M8", sev: "majeur", domain: "Workflow PV", title: "Échec email signé non reporté",
    file: "src/lib/pv-create.functions.ts:373-385",
    detail: "deliverSignedPv() try/catch console.error uniquement. L'appelant reçoit { ok: true } sans savoir que le client n'a pas reçu le PV.",
    fix: "Ajouter audit log + flag dans la réponse." },

  // MAJEURS — Stripe
  { id: "ST-M1", sev: "majeur", domain: "Stripe", title: "`invoice.payment_failed` ne met pas à jour subscriptions.status",
    file: "src/routes/api/public/payments/webhook.ts:89-111",
    detail: "Notification + audit OK mais pas d'UPDATE subscriptions.status=past_due. Si subscription.updated arrive après, base temporairement incohérente.",
    fix: "Mettre à jour subscriptions.status à past_due." },
  { id: "ST-M2", sev: "majeur", domain: "Stripe", title: "`companyId` absent d'invoice.metadata → silencieux",
    file: "src/routes/api/public/payments/webhook.ts:89-92",
    detail: "Les metadata d'invoice ne sont pas auto-héritées de la subscription. Si absent, return silencieux → échec de paiement invisible.",
    fix: "Récupérer la subscription via invoice.subscription puis lire ses metadata." },
  { id: "ST-M3", sev: "majeur", domain: "Stripe", title: "Pas de suspension automatique d'entreprise",
    file: "webhook.ts + src/lib/plan-guard.server.ts:100-114",
    detail: "Aucun handler ne met à jour companies.suspended_at sur annulation/impayé. Suspension uniquement manuelle via admin support.",
    fix: "Suspendre automatiquement après N échecs ou status='canceled' depuis >N jours." },
  { id: "ST-M4", sev: "majeur", domain: "Stripe", title: "Pas de notification sur subscription.updated",
    file: "src/routes/api/public/payments/webhook.ts:118-121",
    detail: "Réactivation, fin de trial, upgrade : aucune notification push créée.",
    fix: "Détecter transitions de status et créer notification." },
  { id: "ST-M5", sev: "majeur", domain: "Stripe", title: "Singleton Supabase dans webhook serverless",
    file: "src/routes/api/public/payments/webhook.ts:5-11",
    detail: "let _supabase module-level. Risque de state corruption entre requêtes concurrentes en Worker.",
    fix: "Utiliser supabaseAdmin importé depuis @/integrations/supabase/client.server." },
  { id: "ST-M6", sev: "majeur", domain: "Stripe", title: "Détection env par hostname spoofable",
    file: "src/lib/stripe.ts:6-14",
    detail: "Un domaine custom sur un projet preview (sans '-dev') basculera en mode live → vraies transactions accidentelles.",
    fix: "Détecter via env var explicite côté serveur." },

  // MAJEURS — Emails
  { id: "EM-M1", sev: "majeur", domain: "Emails", title: "Emails avec pièce jointe sans retry ni dead-letter",
    file: "src/lib/email.server.ts:363-465 ; src/lib/reserve-lift-email.server.ts:71-143",
    detail: "PV signé et levée validée : pas de next_retry_at, pas de statut 'dead', aucune alerte admin. Visibilité uniquement via scraping monitoring.",
    fix: "Stocker payload (sans le PDF binaire, le re-générer) + pipeline retry unifié." },
  { id: "EM-M2", sev: "majeur", domain: "Emails", title: "Renvoi manuel sans idempotence",
    file: "src/lib/signed-email.functions.ts:35 ; src/lib/reserve-lift.functions.ts:317",
    detail: "Aucun délai minimum entre 2 envois. Double-clic UI = 2 PDF envoyés.",
    fix: "Garde rate-limit + check email_logs récent." },
  { id: "EM-M3", sev: "majeur", domain: "Emails", title: "Invitation membre : double-clic possible",
    file: "src/lib/invites.functions.ts:102-127",
    detail: "Upsert membre OK mais sendEmailWithRetryLog sans check de log récent → 2 emails d'invitation possibles.",
    fix: "Vérifier email_logs récent (< 1 min) avant envoi." },

  // MAJEURS — Multi-tenant
  { id: "MT-M1", sev: "majeur", domain: "Multi-tenant", title: "Collision policies email_logs (admin platform voit tout)",
    file: "migration 20260527100544 + 20260521155143",
    detail: "Deux policies SELECT s'additionnent en OR. has_role('admin') donne accès à TOUS les email_logs inter-company.",
    fix: "Dropper email_logs_admin_select ou la restreindre à platform_admin + audit." },
  { id: "MT-M2", sev: "majeur", domain: "Multi-tenant", title: "Anciennes policies storage `_own` non droppées",
    file: "supabase/migrations/20260521141842 vs 20260527085159",
    detail: "Les policies pv_assets_*_own (filtre uid au lieu de company_id) ne sont pas explicitement droppées. Si encore actives en prod, accès cross-company via ancien chemin.",
    fix: "Migration DROP POLICY IF EXISTS pour les 4 policies _own." },

  // MINEURS
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

const sevIcon: Record<Sev, JSX.Element> = {
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

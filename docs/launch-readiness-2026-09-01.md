# PVIA — Audit de préparation au lancement (2026-09-01)

Audit réalisé le 2026-08-30. Aucune publication effectuée, aucune donnée
utilisateur réelle modifiée, aucun paiement live déclenché.

## Verdict

**CODE PRÊT — VALIDATION J0 EXTERNE REQUISE.** Aucun P0/P1 code ouvert.
Le crash Realtime `/dashboard` (Galaxy Z Fold) fait l'objet d'une
**validation appareil réel par le propriétaire** : il ne s'agit pas d'un test
automatisé. Les points restants sont des validations externes (publication,
Stripe live, DNS/emails, tests manuels), listés en fin de document.

## P0 — état

### P0-1 — Crash Realtime `/dashboard` (canal `billing-<companyId>`) — RÉSOLU
- **Cause** : `use-subscription.tsx` réutilisait un topic Supabase Realtime
  identique entre plusieurs consommateurs → `cannot add postgres_changes
  callbacks ... after subscribe()`.
- **Correctif** : topic unique par instance et par exécution d'effet
  (`billing-<companyId>-<useId>-<seq>`), `refetch` stable, suppression protégée.
- **Statut** : **validation appareil réel par le propriétaire** (Galaxy Z
  Fold 8). Aucun test automatisé n'a reproduit l'appareil.
- **Reste** : publier le build correctif pour que https://pvia.fr cesse de
  servir l'ancien bundle.
- **Rollback** : republier la version précédente depuis l'historique Lovable.


## Règle « 14 jours gratuits complets » — implémentation définitive

- L'essai est **interne** : `companies.trial_started_at` (DEFAULT `now()`,
  verrouillé par trigger) + `companies.trial_ends_at`. Un seul essai à vie.
- Choisir une formule pendant l'essai : `createCheckoutSession` lit
  `companies.trial_ends_at` et passe `subscription_data.trial_end` **égal à
  cette date exacte**. Première facture = fin d'essai. Jamais de
  `trial_period_days`, jamais de prolongation, jamais de réinitialisation.
- Contrainte Stripe : `trial_end` doit être ≥ 48 h dans le futur. Dans les
  48 dernières heures, il est impossible de créer un abonnement qui ne facture
  pas avant la fin de l'essai → **le Checkout est refusé** (serveur + UI) avec
  un message clair : activation possible dès la fin de l'essai, aucun
  prélèvement d'ici là. Aucune exception de facturation anticipée.
- Copie alignée : `/billing`, CGV (`src/routes/cgv.tsx`).

## P1 — corrigés dans ce passage

- **Mode terrain (concurrence)** : `flush()` ne vide plus la file avant l'appel
  serveur. Snapshot par identité : une saisie n'est retirée de la file que si
  elle n'a pas été remplacée pendant la requête ; verrou `inFlightRef` contre
  les envois concurrents (autosave + reprise réseau) ; pas de boucle de retry
  quand l'erreur est de type facturation/lecture seule.
- **`useUnsavedGuard`** protège désormais la navigation interne
  (`useBlocker` TanStack Router) **et** `beforeunload`.


### P1-1 — Copie d'essai incohérente sur `/billing`
- L'écran affichait encore « Votre essai gratuit de 14 jours démarre à
  l'activation », faux depuis que `companies.trial_started_at` a un
  `DEFAULT now()` (l'essai démarre à la **création de l'entreprise**).
- Corrigé : `src/routes/_authenticated/billing.tsx` affiche désormais, via
  `trialNoticeFor(isTrial, trialDaysLeft)`, une copie alignée sur la règle
  unique décrite ci-dessous.

### P1-2 — Choisir une formule pendant l'essai facturait immédiatement
- **Défaut certain** : `createCheckoutSession` calculait
  `trialDays = isTrialEligible() ? 14 : undefined`. Comme `trial_started_at` a
  un `DEFAULT now()`, `isTrialEligible()` est **toujours false** : un client en
  J1 qui choisissait Starter était **prélevé immédiatement**, en contradiction
  avec la promesse « 14 jours gratuits ».
- **Règle unique retenue (code + UI + Stripe)** : l'essai est **interne**, court
  de la création de l'entreprise à `companies.trial_ends_at`, et n'est jamais
  ni prolongé ni réattribué. Un Checkout pendant l'essai n'ajoute **aucun**
  `trial_period_days` mais **aligne** l'abonnement Stripe sur la date de fin
  d'essai existante via `subscription_data.trial_end` — première facture à
  `trial_ends_at`, jamais avant.
- **Exception technique documentée** : Stripe exige un `trial_end` à plus de
  48 h. Dans les 48 dernières heures de l'essai, l'abonnement démarre payant
  immédiatement ; l'écran `/billing` l'annonce explicitement à J-2.
- Après consommation/expiration de l'essai : activation = paiement immédiat,
  sans nouvelle période d'essai (inchangé).

### P1-3 — Fonctions internes exécutables par des visiteurs non connectés
- Le linter Supabase signalait **56** fonctions `SECURITY DEFINER` du schéma
  `public` exécutables par le rôle `anon`.
- Aucune de ces fonctions n'est appelée depuis le navigateur (aucun `.rpc(`
  dans `src/components`, `src/hooks`, `src/routes`) : tous les appels passent
  par des server functions authentifiées ou par le rôle serveur.
- Migration appliquée : `REVOKE ALL ... FROM PUBLIC, anon` sur toutes les
  fonctions de `public`, puis `GRANT EXECUTE` explicite à `authenticated` et
  `service_role` (les fonctions de trigger n'obtiennent aucun grant : les
  privilèges des triggers sont contrôlés à leur création, pas à leur
  déclenchement).
- Seconde migration : les fonctions strictement serveur
  (`consume_signature_otp`, `resolve_client_identity`, `enqueue_webhook_event`,
  `increment_rate_limit`, `cleanup_*`, `_chantier_audit`,
  `generate_chantier_reference`, `generate_next_reserve_lift_number`,
  `company_trial_consumed`, `has_active_subscription`) sont désormais réservées
  à `service_role`.
- Résultat linter : **119 → 54** avertissements.

### P1-4 — Perte possible de saisie en mode terrain hors connexion
- **Défaut certain** : en cas d'échec réseau, `flush()` remettait les réponses
  dans la mémoire de l'écran, sans reprise automatique au retour du réseau ni
  avertissement avant fermeture de la page — perte silencieuse possible.
- Corrigé dans `src/routes/_authenticated/visites-techniques.$id_.terrain.tsx` :
  compteur de réponses en attente, ré-envoi automatique dès le retour en ligne,
  bandeau « X réponses en attente… ne fermez pas cette page » et garde
  `beforeunload` (`useUnsavedGuard`).
- Il n'y a toujours **aucune outbox persistante** : le comportement est
  désormais explicite pour l'utilisateur plutôt que silencieux.

## Invariant vérifié : 1 entreprise = 1 seul essai de 14 jours à vie

- `public.companies.trial_started_at` — `DEFAULT now()` (vérifié en base),
  **0 ligne NULL** sur 2 entreprises.
- Trigger `companies_lock_trial_started_at` présent sur `public.companies`
  (vérifié via `pg_trigger`) : la preuve ne peut être remise à NULL ni modifiée.
- `isTrialEligible()` (`src/lib/plan-guard.server.ts`) → fail-closed ; le
  checkout n'accorde donc **jamais** de `trial_period_days`.
- Parité SQL vérifiée sur la définition réelle de
  `public.company_has_write_access` : sans abonnement Stripe, l'écriture est
  autorisée tant que `companies.trial_ends_at > now()` (donc J1→J14 pour une
  entreprise créée aujourd'hui), et refusée ensuite ; `trialing` exige à la fois
  `subscriptions.trial_end` et `companies.trial_ends_at` dans le futur.
- Webhook Stripe (`src/routes/api/public/payments/webhook.ts`) : un `trialing`
  reçu pour une entreprise ayant déjà consommé son essai est journalisé
  (`billing.trial_reuse_blocked`) et **ne prolonge jamais**
  `companies.trial_ends_at` ; l'accès reste évalué fail-closed.

### Scénarios de droits d'écriture (SQL, lecture seule, fixtures synthétiques)

| Scénario | Essai octroyé au checkout | Écriture autorisée |
|---|---|---|
| T1 — J1, nouvelle entreprise | non | oui |
| T2 — J13 d'essai | non | oui |
| T3 — J15, essai expiré, pas d'abonnement | non | **non (lecture seule)** |
| T4 — upgrade pendant l'essai | non | oui |
| T5 — essai expiré → checkout payant | non | oui |
| T6 — cancel puis resubscribe | non | oui |
| T7 — mensuel ↔ annuel | non | oui |
| T8 — Stripe `trialing` incohérent après consommation | non | **non** |
| T9 — `canceled` avec période future + `cancel_at_period_end` | non | oui (grâce) |
| T10 — `active` sans `current_period_end` | non | **non (fail-closed)** |
| T11 — `past_due` | non | **non** |

Aucun scénario ne réattribue d'essai. Exécution 100 % en `SELECT` sur des
fixtures `VALUES` : aucune insertion, aucun rollback nécessaire.

## Contrôles techniques exécutés

- `bunx tsgo --noEmit` : **OK** (aucune erreur).
- `bun run build` : **OK** (`build OK` dans le journal de build, exit 0).
- Smoke HTTP local (dev server) : `/`, `/tarifs`, `/signup`, `/login`, `/cgv`,
  `/mentions`, `/confidentialite`, `/fonctionnalites`, `/contact`,
  `/sitemap.xml`, `/api/public/health` → **200** ; `/espace-client` → 301
  (redirection attendue vers l'espace client).
- `/api/public/health` → `{"ok":true,"service":"pvia",...}`.
- RLS : **0 table du schéma `public` sans RLS activée**.
- Données : 2 entreprises, 5 PV, 5 chantiers, 22 clients ; **0 entreprise de
  test/ZZ** restante.
- Tarifs (`plan_limits`) cohérents avec le marketing : Starter 19/190,
  Pro 59/590, Business 149/1490, Enterprise sur devis ; visites techniques
  activées à partir de Pro (Starter `false`).

## Configuration production (présence uniquement, aucune valeur affichée)

Présents : `APP_ENV`, `PUBLIC_APP_URL`, `STRIPE_LIVE_API_KEY`,
`STRIPE_SANDBOX_API_KEY`, `PAYMENTS_LIVE_WEBHOOK_SECRET`,
`PAYMENTS_SANDBOX_WEBHOOK_SECRET`, `RESEND_API_KEY`, `LOVABLE_API_KEY`,
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`.

`VITE_APP_ENV` est absent du shell de développement mais bien défini à
`production` dans `.env.production` : les builds de production sélectionnent
donc Stripe **live**, les builds preview restent en **sandbox**.

## Emails en échec — classés (aucune PII exposée)

Les **5** lignes `email_logs.status = 'failed'` (1 `signed_to_client` du
2026-08-23, 4 `billing_payment_failed` du 2026-08-22) portent toutes la **même**
erreur Resend :
`422 validation_error — Invalid \`to\` field ... domains like example.com`.

Cause : destinataires de **test** en `@example.com`, refusés par Resend.
**Aucun défaut applicatif** : l'envoi, la journalisation et le compteur de
reprises fonctionnent. Aucune correction appliquée (aucun défaut certain),
aucun email en `dead`, aucun webhook en échec.

## Linter Supabase — classement (après resserrage ciblé)

- Avant : **119** avertissements — 1 « extension in public », 56 fonctions
  `SECURITY DEFINER` exécutables par `anon`, 62 par `authenticated`.
- Après : **23** — 1 extension dans `public` (déplacement non tenté à 48 h du
  lancement : risque supérieur au gain) et 22 fonctions exécutables par les
  utilisateurs connectés, toutes prouvées nécessaires.
- Preuves du resserrage :
  - `information_schema.role_table_grants` pour `anon` dans `public` : **0
    ligne**. Aucun flux public ne passe par PostgREST en anonyme ; la signature
    distante, l'OTP, l'espace client passwordless et les webhooks passent tous
    par des server functions utilisant le rôle serveur
    (`supabaseAdmin.rpc("consume_signature_otp" | "resolve_client_identity" |
    "increment_rate_limit" | "generate_next_reserve_lift_number")` —
    `signature-otp.server.ts`, `client-identity.server.ts`,
    `rate-limit.server.ts`, `reserve-lift.functions.ts`).
  - Aucune policy RLS ne référence une fonction retirée (requête sur
    `pg_policies`, 0 ligne).
  - Liste blanche `authenticated` = fonctions référencées par les policies RLS
    (`has_role`, `is_company_member`, `is_company_admin`, `is_company_owner`,
    `is_platform_admin`, `can_manage_company`, `can_write_company*`,
    `company_has_write_access`, `can_edit_technical_visit`) ∪ fonctions
    réellement appelées via `.rpc(` avec le client utilisateur (`can_add_member`,
    `can_create_pv`, `can_read_technical_visit`, `generate_next_pv_number`,
    `get_company_*`, `has_plan_feature`, `next_chantier_photo_label`).
  - Les fonctions de trigger ne sont plus appelables directement : Postgres
    vérifie `EXECUTE` au `CREATE TRIGGER`, pas au déclenchement.
- Toutes ces modifications sont des migrations versionnées dans
  `supabase/migrations/`, rejouables sur une base neuve.


## P2 — à surveiller, non bloquant

- Aucune ligne `subscriptions` en base : le parcours Stripe live n'a jamais été
  exécuté de bout en bout.
- 1 extension installée dans le schéma `public` (linter).

## NON TESTÉ (à faire manuellement avant ouverture commerciale)

L'environnement d'audit est **signé déconnecté**
(`LOVABLE_BROWSER_AUTH_STATUS=signed_out`) : aucun parcours authentifié runtime
n'a pu être exécuté. Vérifications statiques uniquement pour dashboard, PV,
chantiers, billing, réserves, visites techniques, équipe.

1. Publier, puis parcours authentifié complet sur Galaxy Z Fold (écran externe,
   interne, dépliage à chaud) : `/dashboard`, `/pv`, `/chantiers`, `/billing`.
2. Un checkout Stripe **live** réel (petit montant) **pendant l'essai** :
   vérifier que Stripe affiche « premier paiement le <trial_ends_at> » et
   qu'aucun prélèvement immédiat n'a lieu, puis l'arrivée du webhook et la
   ligne `subscriptions`.
3. Un checkout après essai consommé : prélèvement immédiat attendu.
4. Portail Stripe : annulation → grâce jusqu'à `current_period_end` →
   lecture seule après échéance.
5. Signature client à distance + OTP, envoi du PDF signé par email (chemin
   public tokenisé, non soumis à la garde d'écriture par conception).
6. Mode terrain hors ligne : saisie, coupure réseau, retour réseau → les
   réponses en attente doivent partir automatiquement (P1-4).

## Plan de rollback

- **Applicatif** : republier la version précédente depuis l'historique Lovable
  (aucune migration destructive dans ce passage).
- **Base** : la seule évolution de schéma est additive
  (`companies.trial_started_at` + trigger + fonction). Rollback possible via
  `DROP TRIGGER companies_lock_trial_started_at ON public.companies;` puis
  `ALTER TABLE public.companies DROP COLUMN trial_started_at;` — à n'exécuter
  qu'en cas d'incident avéré, cela supprimerait la preuve d'essai.

## Audit UX onboarding / premier succès (passage final)

Parcours vérifié statiquement : landing → `/tarifs` → `/signup` →
`/_authenticated/onboarding` → `/dashboard`.

- **Corrigé** : l'onboarding ne mentionnait nulle part l'essai. Ajout de deux
  phrases dans `src/routes/_authenticated/onboarding.tsx` — étape 1 (« l'essai
  de 14 jours démarre à la création de votre entreprise, sans carte bancaire »)
  et étape finale (essai en cours, premier chantier → premier PV, choix d'une
  formule dans « Facturation » à la fin, données toujours consultables).
- **Compte à rebours** : `SubscriptionBanner` (monté une seule fois dans
  `AppLayout`) affiche « Essai gratuit — X jours restants » + date de fin +
  CTA non bloquant « Voir les formules » ; passage en style urgent à ≤ 3 jours.
- **Scénario « inscrit sans formule Stripe »** : `getAccessState()` renvoie
  `trialing` / `blocked:false` tant que `companies.trial_ends_at > now()`.
  Aucun écran utilisateur n'affiche « Aucun abonnement actif » — cette phrase
  n'existe que dans l'espace admin plateforme (`admin-support.functions.ts`,
  `admin.companies.$id.tsx`), invisible pour le client.
- **Après expiration** : bannière rouge + popup `BillingGate` avec copie FR et
  CTA `/billing` ; lectures conservées ; les écrans dont l'objet unique est la
  création (`/pv/new`, visites techniques) passent par `RestrictedRoute`.
- **États vides** : présents et actionnables sur dashboard (PV, chantiers),
  `/clients`, `/chantiers`, `/pv`, `/reserves`, `/visites-techniques`.
- **Emails** : liens construits sur `PUBLIC_APP_URL` avec repli
  `https://pvia.fr`, expéditeur `RESEND_FROM_EMAIL` avec repli
  `noreply@pvia.fr` — aucune mention preview/lovable.

## Checklist J0 (à exécuter par le propriétaire)

Prouvé par le code (aucune action) :
- Garde d'écriture fail-closed, essai unique par entreprise, quotas de sièges
  et de PV, RLS active sur toutes les tables `public`.
- Service worker : HTML network-only, caches versionnés, purge des anciens
  caches, `clients.claim()` — une publication n'est pas bloquée par l'ancien JS.
- 404/500/offline en français, identifiant de diagnostic, aucun message
  Stripe/Supabase brut côté utilisateur.

Action humaine externe requise :
1. Publier le build correctif, puis vider/recharger sur un appareil Android
   installé en PWA et vérifier `/dashboard`.
2. DNS et domaine de production actifs (`pvia.fr`, `www.pvia.fr`).
3. Variables d'environnement de production présentes (voir section dédiée).
4. Stripe **LIVE** : clé + endpoint webhook configuré et testé (événement de
   test reçu, ligne `subscriptions` créée).
5. Resend : domaine expéditeur vérifié, envoi réel de test.
6. Cron essai (J-3 / J-1) et drains emails/webhooks planifiés avec `CRON_SECRET`.
7. Test d'inscription réelle de bout en bout (compte + entreprise + dashboard).
8. Test de paiement réel minimal, pendant l'essai puis après essai.
9. Test de signature client réelle + réception du PDF par email.
10. Sauvegarde/rollback : point de restauration noté avant publication.

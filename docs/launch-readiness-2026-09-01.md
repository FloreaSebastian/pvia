# PVIA — Audit de préparation au lancement (2026-09-01)

Audit réalisé le 2026-08-30. Aucune publication effectuée, aucune donnée
utilisateur réelle modifiée, aucun paiement live déclenché.

## Verdict

**GO SOUS RÉSERVE** — le code est prêt, mais la version actuellement **publiée
sur https://pvia.fr est périmée** et contient encore le crash Realtime corrigé
depuis. La publication d'un build à jour est une action obligatoire avant
lancement (P0-1 ci-dessous).

## P0 — bloquants

### P0-1 — Production publie encore un bundle contenant le crash Realtime
- **Preuve** : `public.app_errors`, 30 occurrences le 2026-08-30 entre 06:00 et
  06:26 UTC, route `/dashboard`, message
  `cannot add \`postgres_changes\` callbacks for realtime:billing-<companyId> after \`subscribe()\``,
  stack pointant vers `https://pvia.fr/assets/index-m2R6A5oa.js`.
- **Analyse** : le topic du canal est `billing-<companyId>` **sans suffixe**.
  Le code source actuel (`src/hooks/use-subscription.tsx`) génère
  `billing-<companyId>-<useId>-<seq>`, unique par instance et par exécution
  d'effet. Les erreurs proviennent donc du bundle publié, pas du code courant.
- **Action obligatoire** : publier le build courant, puis re-tester
  `/dashboard` sur le Galaxy Z Fold (plié/déplié) et vérifier qu'aucune
  nouvelle ligne `app_errors` avec ce message n'apparaît.
- **Rollback** : republier la version précédente depuis l'historique Lovable.

## P1 — corrigés dans ce passage

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

## P2 — à surveiller, non bloquant

- 5 emails en statut `failed` (dernier le 2026-08-23) : à inspecter dans le
  cockpit admin ; aucun email en `dead`, aucun webhook en échec.
- 119 avertissements du linter Supabase, préexistants et hors périmètre de
  cette mission.
- Aucune ligne `subscriptions` en base : le parcours Stripe live n'a jamais été
  exécuté de bout en bout.

## Tests manuels restants (obligatoires avant ouverture commerciale)

1. Publier, puis parcours authentifié complet sur Galaxy Z Fold (écran externe,
   interne, dépliage à chaud) : `/dashboard`, `/pv`, `/chantiers`, `/billing`.
2. Un checkout Stripe **live** réel (petit montant) : vérifier l'absence
   d'essai, l'arrivée du webhook, la ligne `subscriptions` et le passage en
   écriture autorisée.
3. Portail Stripe : annulation → grâce jusqu'à `current_period_end` →
   lecture seule après échéance.
4. Signature client à distance + OTP, envoi du PDF signé par email.
5. Mode terrain hors ligne : saisie, retour réseau, absence de perte de données
   (aucune outbox persistante, cf. `docs/subscription-write-access-audit.md`).

## Plan de rollback

- **Applicatif** : republier la version précédente depuis l'historique Lovable
  (aucune migration destructive dans ce passage).
- **Base** : la seule évolution de schéma est additive
  (`companies.trial_started_at` + trigger + fonction). Rollback possible via
  `DROP TRIGGER companies_lock_trial_started_at ON public.companies;` puis
  `ALTER TABLE public.companies DROP COLUMN trial_started_at;` — à n'exécuter
  qu'en cas d'incident avéré, cela supprimerait la preuve d'essai.

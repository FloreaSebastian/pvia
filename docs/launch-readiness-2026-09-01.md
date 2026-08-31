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

## TVA — audit et corrections (passage facturation)

### Règle retenue (unique, code / UI / Stripe)

Tous les tarifs PVIA sont des montants **HT** destinés à une clientèle
professionnelle. La TVA française **20 %** s'ajoute au prix HT :

| Formule    | HT / mois | TVA 20 % | TTC / mois | HT / an  | TVA 20 % | TTC / an   |
| ---------- | --------- | -------- | ---------- | -------- | -------- | ---------- |
| Starter    | 19,00 €   | 3,80 €   | 22,80 €    | 190,00 € | 38,00 €  | 228,00 €   |
| Pro        | 59,00 €   | 11,80 €  | 70,80 €    | 590,00 € | 118,00 € | 708,00 €   |
| Business   | 149,00 €  | 29,80 €  | 178,80 €   | 1 490,00 €| 298,00 € | 1 788,00 € |
| Entreprise | sur devis | —        | —          | sur devis| —        | —          |

Vérifié : les prix Stripe correspondent bien aux montants HT affichés
(1900 / 5900 / 14900 centimes en mensuel, 19000 / 59000 / 149000 en annuel).
Aucun tarif économique n'a été modifié.

### Corrections appliquées

- **Stripe (sandbox + live)** : `tax_behavior` passé de `unspecified` à
  `exclusive` sur tous les Prices (les montants sont donc traités comme HT et
  la TVA est ajoutée, jamais extraite). Tax codes déjà corrects
  (`txcd_10103001`, SaaS). Aucun paiement effectué.
- **Checkout** (`src/lib/billing.functions.ts`) : ajout de
  `automatic_tax: { enabled: true }`, `billing_address_collection: "required"`,
  `customer_update: { address: "auto", name: "auto" }` et
  `tax_id_collection: { enabled: true, required: "if_supported" }`.
  Stripe calcule, affiche et facture la TVA ; l'adresse et le numéro de TVA
  sont persistés sur le Customer, donc les renouvellements restent corrects.
  Aucune taxe n'est codée en dur côté application. La logique d'essai
  (`trial_end` aligné sur `companies.trial_ends_at`) est inchangée.
- **UI** : helpers `VAT_RATE`, `VAT_RATE_LABEL`, `vatBreakdown()`,
  `formatEurCents()` dans `src/lib/plans.ts`. Affichage « soit X € TTC (TVA
  20 %) » sur `/billing` (abonnement en cours, essai, cartes de formules) et
  sur `/tarifs` ; mention « Prix HT, TVA 20 % en sus » sur l'aperçu tarifaire
  de la page d'accueil et bandeau explicatif sur `/billing`.
- **CGV** (`src/routes/cgv.tsx`) : article 3 réécrit « Tarifs, TVA & paiement »
  — prix HT, TVA 20 % en sus avec exemple chiffré, affichage HT/TVA/TTC avant
  paiement et sur facture, autoliquidation UE hors France, Entreprise HT.

### Preuve de calcul (environnement test, aucun paiement)

`tax.calculations` Stripe sandbox, client FR, ligne 1900 c HT exclusive :
`HT = 1900`, `TVA = 380` (taux `20.0`), `TTC = 2280` — conforme au tableau.
La session Checkout de test créée pour la vérification a été expirée et le
client de test supprimé.

### Action externe obligatoire avant encaissement réel (P0)

`tax.registrations` est **vide en LIVE** (et l'était en sandbox). Sans
enregistrement TVA France actif, Stripe Tax calcule **0 €** de TVA même avec
`automatic_tax` activé.

À faire par le propriétaire dans le Dashboard Stripe **live** :
1. Renseigner l'adresse complète du siège (origine) et le numéro de TVA
   intracommunautaire de l'entreprise.
2. Ajouter l'enregistrement fiscal : Tax → Registrations → France (régime
   standard), avec la date d'effet correspondant à l'immatriculation réelle.
3. Vérifier que les factures Stripe affichent HT / TVA 20 % / TTC et les
   mentions légales (numéro de TVA du vendeur).
4. Effectuer un premier paiement réel de contrôle et vérifier la facture.

Tant que le point 2 n'est pas fait, la TVA ne sera pas collectée en production.

## TVA — passe corrective (revue du diff fdd3af0)

Aucun paiement réel, aucune modification live d'objets Stripe, aucune publication.

### 1. Formulation « 20 % » — corrigée (indicative, non universelle)
Les helpers `VAT_RATE` / `vatBreakdown()` restent fixes à 20 % **pour l'affichage
uniquement** et sont désormais documentés comme tels (`src/lib/plans.ts`, nouvelle
constante `VAT_DISCLAIMER`). Tous les textes disent maintenant « TTC indicatif
pour une facturation en France au taux actuel de 20 % ; le montant fiscal
définitif est calculé par Stripe selon l'adresse et le statut TVA » :
`/billing`, `Pricing.tsx`, `PricingPreview.tsx`. L'autoliquidation UE reste
mentionnée. Plus aucune promesse « TVA 20 % » comme résultat universel.

### 2. `tax_id_collection.required` — supporté (preuve runtime)
- SDK `stripe@22.0.2`, API `2026-03-25.dahlia` : type
  `SessionCreateParams.TaxIdCollection.required?: 'if_supported' | 'never'`.
- Session **sandbox** créée via les paramètres EXACTS de production
  (`mode=subscription`, `automatic_tax`, `billing_address_collection=required`,
  `customer_update`, `tax_id_collection`) : `status=open`, réponse
  `tax_id_collection: {"enabled":true,"required":"if_supported"}`,
  `automatic_tax.status=requires_location_inputs` (normal : adresse non encore
  saisie). Session expirée et customer de test supprimé. Paramètre conservé.

### 3. Périmètre réel du `tax_behavior=exclusive`
Inventaire complet des Prices des deux comptes (lecture seule) :

| Env | Prices | Détail |
|-----|--------|--------|
| Sandbox | 8 | 6 PVIA actifs + 2 **inactifs** : `enterprise_monthly` (199 €, produit PVIA Entreprise) et un ancien Price PVIA Pro 49 € sans lookup_key |
| Live | 8 | idem (mêmes 2 inactifs) |

Tous en `exclusive`. **Aucun Price d'un autre produit/compte tiers n'a été
touché** : les 2 Prices hors périmètre initial appartiennent à PVIA et sont
inactifs. Aucune modification supplémentaire effectuée pendant cette passe.

### 4. Lookup keys et montants (vérifiés en sandbox ET live)
`starter_monthly` 1900 / `starter_annual` 19000 · `pro_monthly` 5900 /
`pro_annual` 59000 · `business_monthly` 14900 / `business_annual` 149000
(centimes, EUR, HT). Annuel = 10 mensualités → « 2 mois offerts » exact.

### 5. Factures — formulation conditionnée
Plus aucune promesse « détaillée sur chaque facture » : les textes indiquent que
Stripe calcule la taxe au paiement et la reprend sur la facture, ce qui ne
deviendra effectif en production qu'après enregistrement fiscal actif.

### 6. CGV
Article 3 : « La TVA au taux légal applicable s'ajoute au prix HT ; à titre
indicatif, le taux normal en France est actuellement de 20 % » + mention
explicite que les TTC du site sont indicatifs avant calcul Stripe.

### 7. Garde LIVE fail-closed (nouveau)
`assertTaxComplianceReady(env, stripe)` dans `src/lib/stripe.server.ts`, appelée
au début de `createCheckoutSession` : en **live uniquement**, elle vérifie via
`tax.registrations.list({status:'active'})` la présence d'un enregistrement
**FR actif**, avec cache 10 min par isolate (coût négligeable) et fail-closed
en cas d'erreur API. Message FR neutre invitant à contacter contact@pvia.fr.
Sandbox/dev jamais bloqués.

Preuve runtime : `sandbox: registration FR active=true → garde PASSE` ;
`live: registration FR active=false → garde BLOQUE`. Aucun enregistrement live
n'a été créé (P0 externe, action du propriétaire dans Stripe).

### 8. Vérifications finales
`bunx tsgo --noEmit` : OK. Scripts d'audit temporaires supprimés.

### Verdict TVA
**GO CODE / NO-GO ENCAISSEMENT LIVE** : le code est conforme et désormais
protégé — aucun paiement live ne peut passer sans TVA. Le lancement commercial
reste bloqué tant que le propriétaire n'a pas activé l'enregistrement TVA France
dans Stripe LIVE (puis vérifié une facture réelle HT / TVA / TTC).

---

## Passe finale pré-lancement (audit ciblé, sans publication)

### 1. Message de garde TVA — corrigé
`TAX_NOT_READY_MESSAGE` ne promet plus d'activation manuelle (aucun workflow
conforme implémenté). Nouveau texte : « Le paiement est momentanément
indisponible pendant la finalisation de la configuration fiscale. Réessayez
ultérieurement ou contactez contact@pvia.fr. »

### 2. Inventaire des chemins de création/modification d'abonnement Stripe
- `stripe.checkout.sessions.create` → `src/lib/billing.functions.ts` (unique) —
  précédé de `assertTaxComplianceReady()`.
- `stripe.billingPortal.sessions.create` → `src/lib/billing.functions.ts`.
- Aucune occurrence de `subscriptions.create/update`, `paymentIntents.*`,
  `invoices.*` dans `src/`.
- Portail : `billingPortal.configurations.list` (lecture seule, sandbox + live)
  renvoie **0 configuration explicite** → configuration Stripe par défaut. Le
  portail ne peut pas créer un abonnement ; le changement de formule
  (`subscription_update`) nécessite une configuration produits explicite, non
  présente. À re-vérifier côté tableau de bord Stripe avant encaissement.

### 3. Propagation de l'erreur de garde jusqu'à /billing — prouvée en runtime
Un appel réel de fonction serveur (`assertPasswordFallbackAllowed`, erreur
volontaire) montre que le message d'erreur serveur arrive **intact** côté
navigateur (pas de page 500 générique). Le message TVA (152 caractères, aucun
motif technique) traverse donc `safeBillingMessage()` et s'affiche tel quel
dans le toast de `/billing`.

### 4. Environnement (valeurs non secrètes)
- `APP_ENV=production`, `VITE_APP_ENV=production` (fichier `.env.production`)
  → LIVE uniquement en production ; preview/local restent sandbox.
- **Défaut corrigé (P0)** : `PUBLIC_APP_URL` vaut `pvia.fr` — **sans schéma**.
  Les liens d'emails auraient été relatifs/inexploitables. Ajout de
  `src/lib/app-url.server.ts` (`getPublicAppUrl()`) qui normalise (ajout de
  `https://`, suppression du slash final, `http://` toléré uniquement en local)
  et remplacement des 10 usages (signature, invitation, PV, réserves, portail
  client, calendrier, emails billing). Recommandation propriétaire : corriger
  aussi la valeur du secret en `https://pvia.fr`.
- Expéditeur : `RESEND_FROM_EMAIL` sinon repli `PVIA <noreply@pvia.fr>`.

### 5. Emails
Toutes les URLs générées passent désormais par `getPublicAppUrl()` → domaine
`https://pvia.fr` en production, jamais `lovable.app`/`localhost`. Aucun email
réel n'a été envoyé.

### 6. SEO / indexation
`sitemap.xml` servi (URLs `https://pvia.fr/...`), `robots.txt` bloque les zones
authentifiées et à token. **Correction P1** : ajout de
`robots: noindex, nofollow` sur `/invite/$token` et `/sign/pv/$token` (les
autres pages sensibles en avaient déjà).

### 7. Sessions / cookies
Cookie de session client : `HttpOnly`, `Secure` (hors localhost), `SameSite=Lax`,
`Path=/`. Aucun token journalisé dans les chemins inspectés.

### 8. Migrations
142 fichiers versionnés ; les dernières versions appliquées en base
(`20260830072043`, `072005`, `070955`) correspondent aux fichiers du dépôt.
Aucune divergence détectée. Aucune donnée métier modifiée.

### 9. app_errors (48 h)
Une seule signature : le crash Realtime `cannot add postgres_changes ... after
subscribe()` (`/dashboard`), **dernière occurrence 2026-08-30 06:26 UTC**,
antérieure au correctif validé sur appareil réel. Aucune nouvelle erreur P0/P1
depuis.

### 10. Vérifications
`bunx tsgo --noEmit` : OK. `bun run build` : OK (build propre).
Smoke HTTP 200 : `/`, `/tarifs`, `/login`, `/signup`, `/cgv`, `/mentions`,
`/api/public/health`. Responsive 320 / 390 / 1440 sur `/`, `/tarifs`, `/login` :
aucun débordement horizontal, aucune `pageerror`. Aucun test authentifié réalisé
(pas de session disponible dans l'environnement).

### 11. Checklist courte
**J-2 (fait)** : correctifs TVA, URL publique, noindex tokens, typecheck+build,
smoke public.
**J-1 (propriétaire)** : corriger la valeur du secret `PUBLIC_APP_URL` en
`https://pvia.fr` ; activer l'enregistrement TVA France dans Stripe LIVE ;
vérifier la configuration du Billing Portal (pas de changement de formule non
désiré) ; tester connexion + email réel (signature, invitation).
**J0** : publication, puis un achat live réel de contrôle (facture HT / TVA /
TTC) et surveillance `app_errors`.

### Verdict strict
- **GO CODE** — typecheck, build, smoke et corrections P0/P1 effectués.
- **GO/NO-GO PUBLICATION : GO sous réserve** de la correction du secret
  `PUBLIC_APP_URL` (les liens emails dépendent du repli code, désormais sûr,
  mais la valeur doit être propre).
- **NO-GO ENCAISSEMENT** — tant que l'enregistrement TVA France LIVE n'est pas
  actif, la garde bloque volontairement tout paiement live.

---
---

## Passe finale pré-publication — 31/08/2026 12:40 UTC

Périmètre : **aucune publication, aucun paiement, aucune écriture Stripe**
(sandbox comme LIVE). Toutes les lectures Stripe ci-dessous sont des appels
`retrieve` / `list` uniquement. Le fait que le go-live Stripe soit marqué
« completed » **n'autorise pas** l'encaissement : voir §4.

### 1. PUBLIC_APP_URL
La variable existe déjà côté projet ; l'outillage dont je dispose ne peut que
*créer* une variable absente, pas écraser une valeur existante. **Je ne l'ai
donc pas modifiée et je ne prétends pas l'avoir fait.**

Emplacement exact pour le propriétaire : **Project Settings → Secrets →
`PUBLIC_APP_URL`** → valeur `https://pvia.fr` (schéma inclus, sans slash final).

Le helper reste fail-safe indépendamment de cette valeur.
Preuve exécutée (`bun test tests/unit/app-url.test.ts` → **6 pass / 0 fail /
14 assertions**) :

| Entrée | Sortie |
| --- | --- |
| `'pvia.fr'` | `https://pvia.fr` |
| `'https://pvia.fr/'` | `https://pvia.fr` |
| `''`, `'   '`, `undefined`, `null` | `https://pvia.fr` |
| `'http://pvia.fr'` | `https://pvia.fr` (forçage https hors local) |
| `'http://localhost:8080'` | inchangé (dev) |

Aucune entrée testée ne produit d'URL relative → **le secret mal formé ne peut
pas casser un lien email**. Point de propreté, non bloquant.

### 2. Usages de PUBLIC_APP_URL et liens sortants
`process.env.PUBLIC_APP_URL` n'est lu qu'à **4 endroits** :
`app-url.server.ts:33` (normalisation), `app-env.server.ts:20` (heuristique
d'environnement), `go-live.functions.ts:138-170` (rapport admin interne),
`api/public/health.deep.ts:81` (présence booléenne).

Les **11** modules construisant des liens envoyés hors application passent tous
par `getPublicAppUrl()` : `sign.functions`, `invites.functions`,
`client-portal.functions`, `calendar.functions`, `enterprise-auth.functions`,
`pv-create.functions`, `email.server`, `billing-email.server`,
`reserve-email.server`, `reserve-lift-validation-email.server`
(+ `app-url.server` lui-même). Aucun lien construit hors de ce helper.
**Aucune correction nécessaire.**

### 3. Stripe Billing Portal — audit read-only
`billingPortal.configurations.list` exécuté sur les deux comptes :

- **Sandbox** (`acct_1TZZ0yPOYS9fvO25`, FR) : **1** configuration,
  `bpc_1UAUK8POYS9fvO25wTwVqzIk`, `active: true`, `is_default: true` →
  `subscription_update.enabled: **false**`, `default_allowed_updates: []`,
  `subscription_pause.enabled: false`, `subscription_cancel: true / at_period_end`.
  Le changement de formule via portail est donc **désactivé** en sandbox.
- **LIVE** (`acct_1TaruUAhyA8e2Fra`, FR, `charges_enabled: true`) :
  **0 configuration** retournée. L'API ne renvoie pas la configuration
  implicite par défaut du compte : **la configuration LIVE réellement
  appliquée n'est pas prouvable en lecture seule**.

Le code n'envoie aucun paramètre `configuration` à
`billingPortal.sessions.create` (`billing.functions.ts:257`) : le portail LIVE
suivra donc le défaut du compte, inconnu. **Ce point n'est PAS prouvé →
validation manuelle obligatoire avant encaissement.**

**Risque à noter** : le chemin portail (`createPortalSession`) n'est
volontairement pas couvert par la garde TVA (§5), car il ne crée pas
d'abonnement. Si le portail LIVE autorisait « Switch plans », un changement de
formule pourrait contourner la garde fiscale. Vérification propriétaire :
*Stripe Dashboard LIVE → Settings → Billing → Customer portal* → « Customers
can switch plans » **désactivé**.

### 4. TVA France LIVE (lecture seule)
`tax.registrations.list({ limit: 100 })`, **tous statuts confondus** :

- Sandbox → `[{ country: "FR", status: "active" }]`
- **LIVE → `[]` (aucun enregistrement, ni actif ni programmé)**

Rien n'a été créé. → **NO-GO ENCAISSEMENT maintenu**, indépendamment du statut
« go-live completed » du connecteur Stripe.

### 5. Chemins de création d'abonnement / checkout (recherche repo entière)
Inventaire exhaustif des appels Stripe du dépôt :

| Fichier:ligne | Appel | Nature |
| --- | --- | --- |
| `billing.functions.ts:180` | `checkout.sessions.create` | **seule création d'abonnement** |
| `billing.functions.ts:257` | `billingPortal.sessions.create` | gestion (voir §3) |
| `billing.functions.ts:96` | `prices.list` | lecture |
| `billing.functions.ts:130` | `customers.create` | client, même handler gardé |
| `billing.functions.ts:368` | `subscriptions.list` | lecture (resync) |
| `api/public/payments/webhook.ts:261` | `subscriptions.retrieve` | lecture |
| `admin-platform.functions.ts:440/456` | `customers.search`, `subscriptions.list` | lecture |

Aucune occurrence de `subscriptions.create/update`, `paymentIntents.*`,
`invoices.*`. **Aucune Edge Function Supabase** (`supabase/functions` absent).
Aucune route publique ni chemin service-role ne crée d'abonnement.

La garde `assertTaxComplianceReady(env, stripe)` est appelée à
`billing.functions.ts:92`, dans le **même handler linéaire**, **avant** la
création du client (l.130) et de la session (l.180) — aucun retour anticipé ni
branche alternative entre les deux. Couverture confirmée.

### 6. Emails — templates et rendus dynamiques
Recherche globale `lovable.app` / `localhost` / `127.0.0.1` sur `src` et
`public` : **aucune occurrence dans un contenu email**. Les correspondances
restantes sont exclusivement techniques : détection d'environnement
(`analytics.ts`, `app-env.server.ts`, `stripe.ts`, `pwa.ts`), garde SSRF
(`webhooks.server.ts:49`), flag cookie `Secure` (`client-auth.server.ts:79`),
commentaires.

URL absolues codées en dur dans `src` : `https://pvia.fr` (38 — canonical, OG,
JSON-LD, sitemap) et uniquement des tiers légitimes (`api.resend.com`,
`js.stripe.com`, `connector-gateway.lovable.dev`, `api-adresse.data.gouv.fr`,
`recherche-entreprises.api.gouv.fr`, `fonts.googleapis.com`, `schema.org`,
`cnil.fr`, webhooks Slack/Discord/Zapier saisis par l'utilisateur).
`https://votre-app.com` est un simple `placeholder` de champ de saisie
(`parametres.api.tsx:308`). **Aucun email réel envoyé.**

### 7. SEO / routes à token
`noindex, nofollow` vérifié présent sur **les 10** routes publiques sensibles :
`invite/$token`, `sign/pv/$token`, `verify`, `client/verify`, `client/login`,
`client/dashboard`, `client/historique`, `client/profil`, `client/pv/$id`,
`client/pv/$id/levee-reserves/$liftId`.

`public/robots.txt` complété cette passe : ajout de `/visites-techniques`,
`/onboarding`, `/account-suspended` (en plus de `/client/` et `/verify`).
Vérifié servi en HTTP 200.

`sitemap.xml` : **29 URL**, toutes marketing/légales publiques ; filtrage sur
`token|client/|verify|dashboard|admin|billing|invite|sign/|parametres` →
**aucune correspondance**.

### 8. app_errors jusqu'au 31/08/2026
Agrégation sur 10 jours :

- **Ancien incident (clos)** : `cannot add postgres_changes callbacks for
  realtime:billing-…` — 30 occurrences, `critical`,
  `client:react-boundary:/dashboard`, **toutes le 2026-08-30 entre 06:00 et
  07:00 UTC**, antérieures au correctif `useId()` validé sur appareil réel.
  Non rouvert.
- **Ancien bruit de déploiement (clos)** : `Invalid server function ID` —
  22/08, `error`, dû à des IDs de server functions périmés lors d'un rebuild.
  Aucune récurrence depuis.
- **Nouveau depuis le dernier audit : AUCUN.** Zéro erreur enregistrée après le
  2026-08-30 07:00 UTC.

### 9. Vérifications (clean build)
`rm -rf .output dist node_modules/.vite .tanstack` puis :
- `bunx tsgo --noEmit` → **OK**, 0 erreur.
- `bun run build` → **OK**, built in 18.79 s.
- `bun test tests/unit/app-url.test.ts` → **6/6**.

Smoke HTTP, **200 sur les 12** : `/`, `/tarifs`, `/login`, `/signup`, `/cgv`,
`/mentions`, `/confidentialite`, `/fonctionnalites`, `/contact`,
`/sitemap.xml`, `/robots.txt`, `/api/public/health`.

Responsive Playwright 320 / 390 / 1440 px sur `/`, `/tarifs`, `/login`,
`/signup` : `scrollWidth - innerWidth = 0` sur les 12 combinaisons, **aucune
`pageerror`**.

**Aucun test authentifié réalisé** (pas de session disponible) — rien n'est
affirmé sur les parcours connectés.

### VERDICT FINAL SÉPARÉ

| Domaine | Verdict | Motif |
| --- | --- | --- |
| **CODE** | **GO** | Typecheck, clean build, tests unitaires, 12 smokes, responsive : tous verts. Aucun P0/P1 ouvert. |
| **PUBLICATION** | **GO** | Rien dans le code ne bloque la mise en ligne. La garde fiscale bloque le seul Checkout LIVE — comportement voulu, pas un défaut. |
| **EMAILS** | **GO** | Tous les liens sont absolus et https par construction, repli `https://pvia.fr` prouvé par test. Réserve non bloquante : aucun envoi réel bout-en-bout vérifié. |
| **ENCAISSEMENT** | **NO-GO** | Enregistrement TVA France LIVE **inexistant** (vérifié en lecture seule ce jour) **et** configuration Billing Portal LIVE non prouvable. |

### Actions humaines réellement restantes
1. **Project Settings → Secrets** : `PUBLIC_APP_URL` = `https://pvia.fr`
   (propreté ; le repli code est déjà sûr — non bloquant).
2. **Stripe LIVE → Tax → Registrations** : créer l'enregistrement TVA France.
   Bloquant encaissement.
3. **Stripe LIVE → Settings → Billing → Customer portal** : confirmer
   « Customers can switch plans » désactivé. Bloquant encaissement.
4. **Après publication** : un achat live de contrôle (vérifier facture
   HT / TVA 20 % / TTC), un email réel bout-en-bout (invitation + signature),
   puis surveillance `app_errors`.

---

## ADDENDUM — 2026-08-31 22:20 UTC — Reconnexion des paiements intégrés

**Contexte** : l'intégration de paiements avait été déconnectée, supprimant les
identifiants des anciens comptes (`acct_1TZZ0yPOYS9fvO25` sandbox,
`acct_1TaruUAhyA8e2Fra` live). Toute référence à ces comptes dans les sections
précédentes de ce rapport est désormais **obsolète**.

### Faits vérifiés ce jour

1. **Reconnexion effectuée** : nouvel environnement de test provisionné
   (compte sandbox `acct_1U9lLkGuX3HCQ2i6`). Aucune configuration manuelle.
2. **Catalogue recréé dans le nouveau compte test** — identifiants de prix
   identiques à ceux attendus par le code (`src/lib/billing.functions.ts`,
   résolution par `lookup_keys`) :
   - `pvia_essentiel` → `starter_monthly` (19,00 €/mois HT), `starter_annual` (190,00 €/an HT)
   - `pvia_pro` → `pro_monthly` (59,00 €/mois HT), `pro_annual` (590,00 €/an HT)
   - `pvia_business` → `business_monthly` (149,00 €/mois HT), `business_annual` (1 490,00 €/an HT)
   - Code fiscal `txcd_10103001` (services logiciels) sur les 3 produits.
3. **Checkout / portail** : aucun changement de code requis — les lookup keys
   correspondent. La garde TVA `assertTaxComplianceReady` et
   `automatic_tax: { enabled: true }` restent en place.
4. **Go-live (statut lu ce jour)** : étape 1 « claim account » en cours ;
   étapes 2–5 non démarrées. Aucune clé live, aucun webhook live.

### Verdicts mis à jour (2026-08-31 22:20 UTC)

| Axe | Verdict | Détail |
|---|---|---|
| **CODE / PUBLICATION** | **GO** | Build OK, checkout test fonctionnel dès connexion. |
| **ENCAISSEMENT TEST** | **GO** | Catalogue test complet ; carte 4242… utilisable en preview. |
| **ENCAISSEMENT LIVE** | **NO-GO** | Go-live non complété : claim du compte, onboarding, installation de l'app et provisionnement des clés live restants. L'enregistrement TVA France LIVE devra être **recréé** sur le nouveau compte (l'ancien enregistrement a disparu avec l'ancienne intégration). |

### Actions restantes (propriétaire)

1. Onglet Paiements → terminer les étapes de mise en production (claim + onboarding).
2. Sur le compte live : activer l'enregistrement TVA France (Tax → Registrations) et configurer le Billing Portal (switching désactivé).
3. Publier pour synchroniser le catalogue vers le live, puis achat réel de contrôle J0.

---

## AUDIT & FINALISATION STRIPE / BILLING — 2026-09-01

### 1. Ce qui était déjà conforme (vérifié, non modifié)

| Exigence | Preuve |
|---|---|
| Essai 14 j unique par entreprise | `companies.trial_started_at` + trigger `companies_lock_trial_started_at`, `company_trial_consumed()`, audit `billing.trial_reuse_blocked` dans le webhook |
| Lecture seule après essai/résiliation | `computeAccessState` (TS) et `company_has_write_access` (SQL) en parité ; lectures jamais bloquées |
| Blocage backend réel (pas seulement UI) | Toutes les policies d'écriture passent par `can_write_company*` → `company_has_write_access` (chantiers, pv, réserves, photos, documents, clients, visites, levées, membres) |
| Quotas sièges / PV | `enforce_member_seat_quota` (verrou consultatif, anti-course), `can_create_pv`, `get_company_pv_count_current_period` |
| Prix et plans côté serveur | `plan_limits` = source de vérité ; résolution Stripe par `lookup_key` (stable sandbox ↔ live) |
| Idempotence webhook | Table `stripe_webhook_events` (conflit clé primaire → événement ignoré + audit) |
| Prix HT + TVA | `tax_behavior=exclusive`, `automatic_tax`, garde `assertTaxComplianceReady` en live |

### 2. Défauts trouvés et corrigés ce jour

1. **Périodicité affichée fausse** — la page `/billing` affichait « Facturation
   mensuelle/annuelle » d'après le sélecteur d'interface, pas d'après
   l'abonnement réel. Ajout des colonnes `subscriptions.price_id` et
   `subscriptions.billing_interval`, alimentées par le webhook et par la
   resynchronisation Stripe ; l'encart « Votre abonnement » utilise désormais
   la périodicité réellement facturée.
2. **Événements Stripe manquants** — `invoice.paid` /
   `invoice.payment_succeeded` (régularisation après impayé),
   `customer.subscription.trial_will_end`, `paused`, `resumed` n'étaient pas
   traités. Une entreprise qui régularisait restait en lecture seule jusqu'au
   prochain `subscription.updated`. Désormais resynchronisation immédiate
   depuis Stripe.
3. **Événements hors séquence** — un `customer.subscription.updated` retardé
   pouvait écraser un état plus récent. Au-delà de 60 s d'âge, l'abonnement est
   relu chez Stripe (source de vérité) avant écriture.
4. **Message trompeur à la résiliation** — le webhook posait
   `companies.suspended_at`, ce qui affichait « Compte suspendu » (motif
   support/plateforme) au lieu de « Abonnement résilié ». Supprimé : la lecture
   seule est déjà garantie par la RLS et le garde serveur. Audit
   `billing.read_only_after_cancel` conservé. Aucune entreprise n'était
   concernée en base (0 ligne suspendue).

### 3. Tests automatisés ajoutés

`tests/unit/access-state.test.ts` — 18 scénarios sur la matrice d'accès
(essai en cours / expiré / absent, réutilisation d'essai refusée, `active` sans
échéance → fail-closed, tolérance de synchro 3 j, `past_due`, `unpaid`,
`incomplete`, `incomplete_expired`, `paused`, statut inconnu, résiliation
programmée vs immédiate). Résultat : **24 tests unitaires OK** (avec
`app-url.test.ts`), typecheck propre.

### 4. Points restants hors code (propriétaire)

- Go-live paiements (claim du compte + onboarding) : non fait → encaissement
  réel impossible.
- Enregistrement TVA France sur le compte live : à créer.
- Billing Portal live : configuration à valider (annulation, moyen de paiement,
  changement de formule).

**Verdict** : CODE/BILLING **GO** — ENCAISSEMENT LIVE **NO-GO** (actions
propriétaire ci-dessus).

---

## Configuration TVA France — Stripe Sandbox (31/08/2026, 22:5x CEST)

Réalisé par API sur le compte sandbox `acct_1U9lLkGuX3HCQ2i6` :

- **Tax settings** : `head_office.address.country = FR`, `defaults.tax_behavior = exclusive`,
  `defaults.tax_code = txcd_10103001` (SaaS), statut `active`.
- **Registration TVA France** : créée et **active**
  (`country=FR`, `country_options.fr.type=standard`, `place_of_supply_scheme=standard`).
- **Vérification Checkout (session de test réelle, puis expirée)** :
  plan Business annuel 1 490,00 € HT → **1 788,00 € TTC**,
  `total_details.amount_tax = 298,00 €`, taux `VAT France 20 %`,
  `inclusive: false`, `taxability_reason: standard_rated`,
  `automatic_tax.status = complete`.
  → le Checkout affiche bien HT + TVA 20 % + total TTC pour un client France.
- Note : les Prices ont `tax_behavior: unspecified` ; Stripe applique alors le
  défaut du compte (`exclusive`), ce que la session de test confirme (TVA ajoutée
  au-dessus du prix HT, jamais incluse).

### Non réalisable par API (action propriétaire requise, dashboard Stripe)

- Informations légales du compte : raison sociale, forme juridique, SIREN/TVA
  intracommunautaire, adresse du siège complète, e-mail/URL de support,
  libellé de relevé bancaire. L'API renvoie
  « key does not have access to account » : ces champs se règlent uniquement
  dans le dashboard Stripe (Settings → Business).
- Mentions légales de facture (footer, numéro de TVA affiché) : Settings →
  Invoicing → Invoice template.
- Le même travail (registration TVA FR + infos légales) devra être refait sur le
  compte **LIVE** après le go-live ; `assertTaxComplianceReady()` bloque tout
  encaissement live tant que la registration FR n'y est pas active.

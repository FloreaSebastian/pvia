# PVIA — Accès en écriture & abonnement (document de référence)

Ce document est la référence unique pour toute nouvelle fonctionnalité PVIA.
Règle générale : **lecture toujours autorisée, écriture métier réservée à un
abonnement valide (essai 14 jours glissants inclus)**.

## 1. Règles d'architecture (obligatoires)

1. **Mutation métier via server function** → appeler
   `assertCompanyWriteAccess(companyId, userId)` **avant** toute vérification de
   feature/quota et avant toute écriture.
2. **Accès direct au client Supabase (navigateur)** → la table DOIT avoir une
   policy RLS `INSERT/UPDATE/DELETE` utilisant
   `company_has_write_access()` / `can_write_company*()`.
3. **Lecture / historique / export / PDF déjà généré** → toujours autorisé,
   jamais gardé.
4. **Compte, sécurité, facturation, préparation de réactivation** → exceptions
   documentées ci-dessous (paramètres non consommateurs).
5. **Workflow public / client par token** → garde spécifique au token
   (validité, expiration, appartenance). Ne PAS dépendre du write access
   entreprise : le client final ne doit pas être pénalisé.
6. **Toute nouvelle feature** → tests des 4 états : `active`, `trialing`,
   `expired`, `past_due`.

## 2. Source de vérité de l'accès

| Couche | Implémentation |
| --- | --- |
| Serveur (server functions) | `src/lib/plan-guard.server.ts` → `getCompanyAccess()` / `assertCompanyWriteAccess()` |
| Base (RLS) | `public.company_has_write_access(uuid)` + `can_write_company`, `can_write_company_member`, `can_write_company_admin` |
| UI | `useSubscription()` → `WriteAccessGate`, `LockedActionButton`, `useBlockedActionGuard()` |

### Matrice des statuts (identique serveur et SQL)

| Situation | Écriture |
| --- | --- |
| `suspended_at` non nul, ou `support_status = 'blocked'` | ❌ |
| Aucune ligne `subscriptions` | ✅ tant que `companies.trial_ends_at > now()` (défaut `now() + 14 jours` ; backfill unique déjà effectué). `trial_ends_at` NULL ⇒ ❌ **fail-closed** : aucun fallback dérivé de `created_at` n'existe dans le code ni dans le SQL |
| `trialing` | ✅ tant que `subscriptions.trial_end > now()` (null ⇒ ❌, fail-closed) |
| `active` | ✅ uniquement si `current_period_end` est renseigné (NULL ⇒ ❌ fail-closed) et n'est pas périmé de plus de 3 jours (SQL : `current_period_end IS NOT NULL AND current_period_end > now() - interval '3 days'`). Tolérance destinée au délai normal du webhook de renouvellement ; au-delà, la ligne est considérée non synchronisée ⇒ ❌ |
| `canceled` | ✅ **uniquement** si `cancel_at_period_end = true` ET `current_period_end > now()` (résiliation programmée synchronisée par webhook). Toute autre résiliation ⇒ ❌ |
| `past_due`, `unpaid`, `incomplete`, `incomplete_expired`, `paused`, statut inconnu | ❌ |

Tous les champs de date sont `timestamptz` ; les comparaisons utilisent
l'horloge serveur (`now()` en SQL, `Date.now()` côté serveur). L'essai est
strictement glissant : expiration à l'instant exact `trial_ends_at`, pas à
minuit.

L'état est calculé **par entreprise** (`companyId`). Un utilisateur membre de
plusieurs entreprises obtient un état distinct par entreprise (clé de cache
React Query `["billing", activeCompanyId]`).

## 3. Tables métier — protection RLS

Gardées par `company_has_write_access` / `can_write_company*` :
`chantiers`, `chantier_documents`, `chantier_events`, `chantier_notes`,
`chantier_photos`, `clients`, `pv`, `pv_documents`, `pv_photos`, `pv_reserves`,
`reserve_lift_reports`, `reserve_lift_items`, `reserve_lift_item_photos`,
`technical_visits`, `technical_visit_answers`, `technical_visit_constraints`,
`technical_visit_photos`, `technical_visit_photo_skips` (via
`can_edit_technical_visit`, qui appelle lui-même `company_has_write_access`),
`company_members`, `compliance_checklist_items`.

Exceptions intentionnelles (non consommatrices / hors activité métier) :

| Table | Raison |
| --- | --- |
| `companies`, `company_settings`, `company_branding_versions` | Paramètres de compte : logo, numérotation, destinataires email — nécessaires pour préparer une réactivation |
| `subscriptions`, `stripe_webhook_events` | Facturation (service_role / webhook) |
| `profiles`, `user_preferences`, `user_roles`, `push_subscriptions` | Compte et sécurité utilisateur |
| `notifications`, `email_logs`, `analytics_events`, `app_errors`, `audit_logs` | Télémétrie et journalisation système |
| `api_keys`, `webhooks`, `webhook_deliveries`, `integration_calendar_tokens` | Intégrations/compte ; les écritures métier qu'elles déclenchent restent gardées |
| `client_auth_codes`, `client_sessions`, `client_identities`, `pv_signature_otps`, `enterprise_auth_codes`, `rate_limits` | Workflows d'authentification (token/OTP), gardés par leur propre logique |
| `plan_limits`, `launch_checklist_items`, `support_notes`, `impersonation_sessions` | Plateforme / admin PVIA |

## 4. Storage

| Bucket | Visibilité | Écriture |
| --- | --- | --- |
| `pv-assets` (photos chantier, visites techniques, signatures, documents, PDF, réserves) | privé | upload : `can_write_company_member` ; update/delete : `can_write_company` ; lecture : membre de l'entreprise |
| `company-logos` | lecture publique | **aucune policy d'écriture sur `storage.objects` pour ce bucket** : ni `anon` ni `authenticated` ne peuvent uploader/modifier/supprimer directement. Les écritures passent exclusivement par `company-logo.functions.ts` (`requireSupabaseAuth` + contrôle admin d'entreprise) avec `supabaseAdmin`. Exception de compte assumée (branding) |

## 5. Mutations serveur — classification

| Domaine (fichiers) | Protection |
| --- | --- |
| `chantiers.functions.ts`, `chantier-detail.functions.ts`, `chantier-photos.functions.ts`, `chantier-dossier*.ts` | `assertCompanyWriteAccess` (y compris `reopenChantier`) ; exports/PDF non gardés (lecture) |
| `clients.functions.ts`, `clients-import.functions.ts` | `assertCompanyWriteAccess` |
| `pv-create.functions.ts`, `pv-status.functions.ts`, `reserves.functions.ts`, `reserve-lift.functions.ts` | `assertCompanyWriteAccess` |
| `sign.functions.ts` (`sendPvToClient`), `sign-onsite.functions.ts`, `signed-email.functions.ts` | `assertCompanyWriteAccess` — nouvelle exploitation initiée par l'entreprise |
| `sign.functions.ts` (`getPvByToken`, `signPvByToken`, OTP client), `client-reserve-lift.functions.ts` (validation/refus client), `client-auth.functions.ts`, `client-portal.functions.ts` (lecture) | **Exception voulue** : workflow client déjà engagé, garde par token/session client |
| `visites.functions.ts` / `visites.server.ts` | `assertCanManage` / `assertCanEditVisit` → `assertCompanyWriteAccess` + feature `technical_visits` |
| `work-reference.functions.ts` | `assertCompanyWriteAccess` (extraction ET application) |
| `branding*.functions.ts`, `pv-numbering.functions.ts`, `pv-email-settings.functions.ts`, `calendar.functions.ts`, `push*.functions.ts`, `user-auth.functions.ts` | Exception : paramètres de compte/sécurité, non consommateurs |
| `billing.functions.ts` | Exception : doit rester accessible en accès restreint |
| `admin-*.functions.ts`, `compliance.functions.ts`, `go-live*.ts`, `monitoring.functions.ts`, `system-health.functions.ts`, `launch-checklist.functions.ts` | Plateforme : `requirePlatformAdmin` |
| Toutes les fonctions de lecture/export/PDF | Non gardées (consultation garantie) |

### Décisions métier documentées

- **Renvoi d'un PV signé par email** (`signed-email.functions.ts`) : bloqué en
  accès restreint. C'est une nouvelle action sortante initiée par l'entreprise.
  Le client conserve l'accès au document via son espace client et les liens
  déjà envoyés.
- **Consultation/téléchargement d'un PDF existant** : toujours autorisé, pour
  l'entreprise comme pour le client.
- **Signature client via lien déjà envoyé** : reste fonctionnelle même si
  l'entreprise expire après l'envoi.
- **Nouvelle signature terrain / nouveau lien de signature** : bloqués.

## 6. Quotas

- Quota PV : `get_company_pv_count_current_period()` compte les PV créés depuis
  le **début du mois calendaire** (`date_trunc('month', now())`). Règle choisie
  volontairement : un upgrade/proration Stripe modifie
  `subscriptions.current_period_start`, ce qui remettait auparavant le quota à
  zéro en milieu de période. La fenêtre est désormais stable et indépendante des
  changements d'abonnement. L'historique des PV n'est jamais supprimé.
- Sièges : `enforce_member_seat_quota` (trigger, verrou consultatif par
  entreprise) + `can_add_member()`.
- Visites techniques : `plan_limits.can_technical_visits` (Pro et supérieur),
  vérifié côté serveur.

## 6 bis. Synchronisation Stripe

- Webhook `src/routes/api/public/payments/webhook.ts` (`/api/public/payments/webhook?env=…`) :
  signature vérifiée, idempotence via `stripe_webhook_events`. Événements traités :
  `checkout.session.completed`, `customer.subscription.created/updated`
  (upsert de `status`, `plan`, `current_period_start/end`, `cancel_at_period_end`,
  `trial_end`), `customer.subscription.deleted` (→ `canceled`),
  `invoice.payment_failed` (→ `past_due`).
- **Aucun cron de réconciliation Stripe n'existe.** C'est la raison de la
  tolérance de 3 jours sur `active` : elle absorbe un retard de webhook sans
  autoriser une écriture illimitée si la synchro est cassée.
- Retour Checkout/Portail : `/billing?status=success&session_id=…` déclenche
  `syncSubscriptionFromStripe` (admin d'entreprise) qui relit l'abonnement chez
  Stripe et met la ligne à jour. La sélection privilégie une subscription
  exploitable (`active`/`trialing`), puis régularisable (`past_due`/`unpaid`/
  `paused`), puis `incomplete`, et seulement en dernier recours une ancienne
  `canceled` — même plus récente — pour ne pas bloquer une réactivation, puis invalide `["billing", activeCompanyId]`.
  L'utilisateur retrouve l'écriture sans se déconnecter.

## 7. Chemins externes / API / intégrations

| Chemin | État prouvé |
| --- | --- |
| `api_keys` (`createApiKey`, `listApiKeys`, `revokeApiKey`) | Gestion admin uniquement. Le helper `validateApiKeyHeader` **n'a aucun appelant** dans le code : aucune route n'accepte aujourd'hui une clé API, donc aucun chemin d'écriture métier externe |
| `webhooks` / `webhook_deliveries` | Sortants uniquement (`enqueue_webhook_event`, drain). Ne créent pas de contenu métier |
| Routes `src/routes/api/public/*` | `health`, `health.deep`, `auth/send-email-hook`, `calendar/$token` (lecture ICS par token), `payments/webhook`, `hooks/*` (crons internes : emails, rappels, drain, essais expirants). Aucune ne crée de PV/chantier/client pour le compte d'un utilisateur |
| Écritures Supabase directes depuis le navigateur | Couvertes par les policies RLS gardées (section 3) |

## 8. Tests exécutés (SQL, rôle `authenticated`, entreprise de test)

| Scénario | Résultat |
| --- | --- |
| Essai valide — INSERT chantier | ✅ autorisé |
| Essai expiré — INSERT chantier | ❌ refusé (RLS) |
| Essai expiré — UPDATE chantier | 0 ligne modifiée |
| Essai expiré — INSERT PV | ❌ refusé (RLS) |
| Essai expiré — DELETE chantier | 0 ligne supprimée |
| Essai expiré — SELECT chantiers | ✅ lecture conservée |
| Essai expiré — UPDATE `company_settings` | ✅ autorisé (exception compte) |

Transaction annulée : aucune donnée de test résiduelle.

## 9. Checklist pour toute nouvelle mutation

- [ ] `assertCompanyWriteAccess` appelé avant feature/quota ?
- [ ] Table couverte par une policy RLS d'écriture gardée ?
- [ ] Action de modification/suppression gardée côté UI
      (`WriteAccessGate` / `useBlockedActionGuard`) ?
- [ ] Lecture/export non impactés ?
- [ ] Testé en `active`, `trialing`, `expired`, `past_due` ?

## 10. Écritures directes navigateur (audit exhaustif)

Recomptage fiable (recherche multi-lignes `rg -U --multiline-dotall` sur
`src/components`, `src/routes` non-serveur et `src/hooks`, couvrant
`.from(...).insert/update/upsert/delete()`, `storage.from(...).upload/remove/
move/copy()` et `supabase.rpc(...)`) : **18 écritures navigateur**, réparties
comme suit (la RLS reste l'autorité finale ; le pré-check UI évite l'erreur
technique). Le chiffre précédent (26) comptait des lignes de code, pas des
appels, et omettait `VisitPhotoSlotCard`.

| Fichier | Écritures | Pré-check UI |
| --- | --- | --- |
| `equipe.tsx` | 4 (retrait, rôle, suspension, annulation d'invitation) | `deny()` sur chacune ; création via UI verrouillée |
| `pv.$id.tsx` | 3 (suppression PV + dépendants) | `deny("supprimer le PV")` |
| `pv.index.tsx` | 1 (suppression PV) | `deny("supprimer un PV")` |
| `pv.new.tsx` | 1 (rattachement documents brouillon) | route entièrement gardée (`RestrictedRoute`) |
| `chantiers.$id.tsx` | 1 (upload document Storage) | `deny("ajouter un document")` |
| `chantiers.calendrier.tsx` | 1 (préférence de couleur d'affichage) | **exception assumée** : paramètre d'affichage, non métier. Toutes les mutations d'événements (création, édition, statut, duplication, suppression, drag/resize) sont gardées |
| `ChantierPhotosTab.tsx` | 1 (upload Storage) | `requireWrite` avant ouverture du formulaire, avant envoi et avant suppression |
| `VisitPhotoSlotCard.tsx` | 1 (upload Storage photo de visite) | `requireWrite` avant upload ; motif d'impossibilité, annulation et suppression également gardés (server functions) |
| `parametres.index.tsx` | 2 (profil, `company_settings`) | **exception assumée** : compte/paramètres (section 3) |
| `NotificationsBell.tsx` | 2 (marquage lu) | **exception assumée** : UX de lecture |
| `UserPreferencesProvider.tsx` | 1 (`user_preferences`) | **exception assumée** : préférences utilisateur |

`VisitConstraintsPanel` n'écrit pas directement (server functions
`saveVisitConstraint` / `deleteVisitConstraint`), mais appelle quand même
`requireWrite` avant l'appel.

### Limite connue — détection des erreurs RLS

PostgREST renvoie un message générique (`new row violates row-level security
policy for table ...`) qui **ne nomme pas** `company_has_write_access`. On ne
peut donc pas déduire de façon fiable « abonnement expiré » d'une erreur RLS :
l'UX vient du pré-check (`useBillingGate.requireWrite`,
`useBlockedActionGuard`) et des server functions
(`SUBSCRIPTION_REQUIRED:<state>`). Une erreur RLS générique reste affichée
comme une erreur technique neutre — pas de fausse attribution à l'abonnement.

### Mode terrain (visite technique)

Aucune file d'attente hors-ligne persistante. Si un enregistrement échoue pour
raison d'abonnement, les saisies sont restaurées **en mémoire** et le message
distingue deux cas : entrée déjà en lecture seule (aucune saisie perdue) vs.
échec après saisie (modifications non enregistrées, perdues en quittant).

### `/billing` — état `incomplete`

Le bouton « Régulariser mon abonnement » n'est rendu que si un
`stripe_customer_id` existe. Sans client Stripe exploitable, l'utilisateur voit
les formules et « Voir les options » (checkout) : aucun bouton mort.

### Tests non effectués

Runtime authentifié, transitions Stripe réelles (portail, réactivation) et
rejeu hors-ligne restent non testés dans cet environnement.

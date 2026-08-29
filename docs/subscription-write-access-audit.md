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
| Aucune ligne `subscriptions` | ✅ tant que `companies.trial_ends_at > now()` (défaut `now() + 14 jours`, legacy `created_at + 14 jours`) |
| `trialing` | ✅ tant que `subscriptions.trial_end > now()` (null ⇒ ❌, fail-closed) |
| `active` | ✅ |
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
| `company-logos` | public | asset de compte (branding) — exception assumée |

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
  `subscriptions.current_period_start`, ou depuis le début du mois calendaire
  si aucune période n'est connue. L'historique n'est pas supprimé lors d'un
  upgrade : seule la fenêtre de comptage suit la période de facturation.
- Sièges : `enforce_member_seat_quota` (trigger, verrou consultatif par
  entreprise) + `can_add_member()`.
- Visites techniques : `plan_limits.can_technical_visits` (Pro et supérieur),
  vérifié côté serveur.

## 7. Tests exécutés (SQL, rôle `authenticated`, entreprise de test)

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

## 8. Checklist pour toute nouvelle mutation

- [ ] `assertCompanyWriteAccess` appelé avant feature/quota ?
- [ ] Table couverte par une policy RLS d'écriture gardée ?
- [ ] Action de modification/suppression gardée côté UI
      (`WriteAccessGate` / `useBlockedActionGuard`) ?
- [ ] Lecture/export non impactés ?
- [ ] Testé en `active`, `trialing`, `expired`, `past_due` ?

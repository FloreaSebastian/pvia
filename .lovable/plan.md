# Onboarding obligatoire PVIA

## Objectif

Forcer chaque nouvel utilisateur à compléter son profil personnel + les infos de son entreprise avant d'accéder à l'app. Centraliser ensuite ces données pour qu'elles soient réutilisées partout (PDF, emails, branding, exports).

---

## 1. Migration SQL

**Table `profiles`** — ajouter :
- `first_name text`, `last_name text`, `phone text`, `job_title text`, `avatar_url text` (existe déjà ?), `onboarding_completed_at timestamptz`

**Table `companies`** — ajouter :
- `siren text`, `legal_form text`, `address_line1 text`, `address_line2 text`, `postal_code text`, `city text`, `country text default 'FR'`, `website text`, `vat_number text`, `onboarding_completed_at timestamptz`
- (garder `siret`, `address`, `phone`, `email`, `logo_url` existants pour rétro-compat)

**Index** : `idx_companies_siren`, `idx_companies_siret`.

**RLS** : inchangée — les policies existantes (`is_company_admin` pour update, `auth.uid() = id` pour profiles) couvrent déjà les besoins.

---

## 2. Server functions

### `src/lib/onboarding.functions.ts`
- `getOnboardingStatus()` — retourne `{ profileComplete, companyComplete, activeCompanyId }`. Profil complet = `first_name`, `last_name`, `phone`, `job_title` + `onboarding_completed_at`. Entreprise complète = `name`, `siret` ou `siren`, `address_line1`, `postal_code`, `city`, + `onboarding_completed_at`.
- `completeProfile({ first_name, last_name, phone, job_title, avatar_url? })` — valide via Zod, met à jour `profiles`, set `onboarding_completed_at`, audit log `onboarding.profile_completed`.
- `completeCompany({ companyId, ...fields })` — vérifie `is_company_admin`, valide via Zod (SIREN 9 chiffres, SIRET 14, code postal FR, etc.), met à jour `companies`, audit log `onboarding.company_completed` et `onboarding.completed`.

### `src/lib/siren.functions.ts`
- `lookupCompanyBySirenOrSiret({ query })` — nettoie espaces, valide 9 ou 14 chiffres, appelle l'API publique **Recherche d'Entreprises** (`https://recherche-entreprises.api.gouv.fr/search?q=<siren>`) — gratuite, sans clé, maintenue par data.gouv. Retourne `{ name, siren, siret, legal_form, address_line1, postal_code, city, naf_label }`. Rate-limit serveur (`enforceRateLimit` 20/min/IP). Audit log `onboarding.company_lookup`. Fallback : retour `{ found: false, error }` → l'UI passe en mode manuel.

### `src/lib/branding.server.ts` + `branding.functions.ts`
- `getCompanyBranding(companyId)` — helper central qui retourne `{ name, siren, siret, legal_form, address, address_line1, postal_code, city, country, email, phone, website, vat_number, logo_url }`. Utilisé dans `pdf.server.ts`, `email.server.ts`, `signed-email.functions.ts`, etc. Remplace les `select(...).eq('id', companyId)` dispersés.

---

## 3. Routes & flow

### Nouvelle route `/onboarding` (sous `_authenticated`)
Fichier : `src/routes/_authenticated/onboarding.tsx`. Wizard 6 étapes avec `FieldStepper` :
1. Bienvenue (CTA "Commencer")
2. Profil perso (form Zod + react-hook-form)
3. Recherche SIREN/SIRET (input avec debounce 500ms, bouton "Saisir manuellement")
4. Vérif / édition infos entreprise (préremplies)
5. Logo + site web (optionnels)
6. Confirmation → redirect `/dashboard`

Sauvegarde auto à chaque étape (les server fns gèrent les updates partiels).

### Garde dans `_authenticated.tsx`
Ajouter un check : après `useAuth`, query `getOnboardingStatus`. Si `!profileComplete || !companyComplete` ET la route actuelle n'est pas dans la whitelist → `navigate({ to: '/onboarding' })`.

**Whitelist** (accessibles avant onboarding) :
- `/onboarding`, `/billing`, `/logout` (action), route support si elle existe.

Logout reste un bouton qui appelle `supabase.auth.signOut()` — toujours accessible via le layout.

### Login/signup
Aucun changement de logique métier — la redirection se fait via le garde `_authenticated`. Les pages publiques (signup, login, verify) restent intactes.

---

## 4. Réutilisation des données entreprise

Refactor des appels Supabase dispersés vers `getCompanyBranding`:
- `src/lib/pdf.server.ts` (génération PV)
- `src/lib/email.server.ts` (emails clients)
- `src/lib/signed-email.functions.ts`
- `src/components/client/...` (espace client header)
- Éventuels exports stats/audit

Pas de changement de comportement — juste centralisation.

---

## 5. Audit logs

Ajouter au `AuditActionEnum` (Zod) dans `audit.functions.ts` :
- `onboarding.started`, `onboarding.profile_completed`, `onboarding.company_lookup`, `onboarding.company_completed`, `onboarding.completed`, `company.updated_from_siren`

---

## 6. UX

- Design cohérent avec `AuthShell` / `Card` existants
- `Progress` en haut, `FieldStepper` avec labels FR
- Validation inline avec messages clairs
- État de loading sur la recherche SIREN ("Recherche en cours…")
- Message d'erreur si API indispo : "Entreprise introuvable — vous pouvez saisir les informations manuellement"
- Bouton "Précédent / Suivant" + "Enregistrer et terminer" à la dernière étape

---

## 7. Sécurité

- `completeCompany` vérifie `is_company_admin` côté serveur (server fn) — un user simple ne peut pas modifier l'entreprise
- Un user simple invité dans une équipe existante voit seulement l'étape profil (l'entreprise est déjà complète → skip)
- `lookupCompanyBySirenOrSiret` rate-limité (20/min/IP)
- Zod sur tous les inputs

---

## 8. API SIREN/SIRET

**API utilisée** : `https://recherche-entreprises.api.gouv.fr/search` — service public officiel data.gouv.fr, gratuit, sans clé, sans quota strict. Donnée Sirene/INSEE.

Limites :
- Pas de SLA garanti — d'où le fallback manuel
- Données publiques uniquement (pas d'entreprises non-diffusibles)

---

## 9. Tests bout en bout

1. Créer un compte → valider email → être redirigé vers `/onboarding` (pas `/dashboard`)
2. Remplir profil → étape suivante
3. Taper un SIRET valide (ex: `552100554` Carrefour) → données préremplies
4. Modifier, valider → redirigé vers `/dashboard`
5. Se déconnecter et reconnecter → va direct au dashboard (onboarding done)
6. Inviter un membre → il signup → onboarding profil uniquement (entreprise déjà OK)

---

## 10. Ne pas casser

OTP client, Stripe, multi-tenant, push, PWA, signatures, PDF, audit, RLS existantes, invitations équipe. La garde `_authenticated` n'affecte pas les routes publiques (`/sign.pv.$token`, `/client.*`, `/invite.$token`).

---

## Livrables

- 1 migration SQL (colonnes profiles + companies)
- 3 server function files : `onboarding.functions.ts`, `siren.functions.ts`, `branding.functions.ts`
- 1 server helper : `branding.server.ts`
- 1 route : `/onboarding` + composants wizard
- Refacto léger : `_authenticated.tsx` (garde), `pdf.server.ts` / `email.server.ts` (utiliser `getCompanyBranding`)
- Ajouts `AuditActionEnum`

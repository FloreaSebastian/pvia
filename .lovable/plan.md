# Refonte métier du PV de réception

Objectif : aligner `/pv/new` sur un vrai PV de réception (CAPEB), avec autocomplete adresse, référence devis/BC, choix avec/sans réserves, workflow dynamique, suivi auto de levée et PDF conforme.

---

## 1. Migrations SQL

**Table `pv` — colonnes ajoutées**
- `reception_with_reserves boolean NOT NULL DEFAULT false`
- `work_reference_type text` (`devis` | `bon_commande` | `marche` | `manuel`)
- `work_reference_number text`
- `work_reference_date date`
- `work_reference_amount numeric(12,2)`
- `reserve_completion_delay text` (ex : « 30 jours »)
- `reserve_due_date date`
- `chantier_postal_code text`, `chantier_city text` (déjà `address`, `latitude`, `longitude` côté `chantiers` ; on duplique sur `pv` pour snapshot PV)

**Table `pv_reserves` — colonnes ajoutées**
- `nature text` (typologie courte : finitions / sécurité / conformité…)
- `work_to_execute text`
- `due_date date`
- `lifted_at timestamptz`

**Table `chantiers` — colonnes ajoutées (si manquantes)**
- `postal_code text`, `city text`, `latitude double precision`, `longitude double precision`

**Suivi de levée**
- Réutiliser `reserve_lift_reports` existant. Ajouter colonne `reserve_lift_status` sur `pv` :
  `text NOT NULL DEFAULT 'none'` valeurs : `none` | `pending` | `partial` | `completed`.
- Trigger `pv` après `INSERT` : si `reception_with_reserves` → set `reserve_lift_status='pending'`.
- Trigger `pv_reserves` après `UPDATE status` : recalcule `reserve_lift_status` du PV parent (none/pending/partial/completed).

Pas de changement RLS.

---

## 2. Server functions

**Nouveau `src/lib/address.functions.ts`**
- `searchAddressSuggestions({ query })` : `createServerFn` POST, middleware auth.
- Validation : `query` trim, min 3, max 200.
- Rate limit via `rate_limits` (bucket `address_search`, key = userId, 30 req / 60s).
- Appel `https://api-adresse.data.gouv.fr/search/?q=...&limit=5&autocomplete=1`.
- Retourne `[{ label, address, postalCode, city, latitude, longitude }]`.

**Modif `src/lib/pv-create.functions.ts`**
- Schema entrée ajoute : `reception_with_reserves`, `work_reference_*`, `reserve_completion_delay`, `reserve_due_date`, `chantier_address`, `chantier_postal_code`, `chantier_city`, `chantier_latitude`, `chantier_longitude`. Réserves enrichies (`nature`, `work_to_execute`, `due_date`).
- Validation serveur autoritative :
  - Si `reception_with_reserves === false` → ignorer `reserves` et `photos` (forcer `[]`).
  - Si `true` → exiger ≥ 1 réserve avec `description` et `work_to_execute`.
- Insert pv avec nouveaux champs. Insert réserves enrichies.
- Pas de génération du PV de levée ; trigger DB pose `reserve_lift_status='pending'`.
- Audit : ajouter `metadata.reception_with_reserves`.

**Modif `src/lib/pdf.server.ts`**
- Titre : `PROCÈS-VERBAL DE RÉCEPTION DES TRAVAUX`.
- Bloc « Au titre du {type} n° {number} en date du {date} » si `work_reference_*`.
- Déclaration : `La réception est prononcée sans réserve.` ou `... avec réserves.`.
- Si avec réserves : section « État des réserves » (nature, description, travaux à exécuter, délai, échéance).
- Bloc délai global + date limite.
- Footer mention exemplaires / version numérique PVIA.

---

## 3. Frontend `/pv/new`

**Nouveau composant `src/components/pv/AddressAutocomplete.tsx`**
- Input contrôlé + debounce 250ms + dropdown suggestions.
- Appelle `searchAddressSuggestions` via `useServerFn`.
- onSelect → remplit `address`, `postal_code`, `city`, `latitude`, `longitude`.
- Fallback saisie manuelle si 0 suggestion.

**Refonte `src/routes/_authenticated/pv.new.tsx`**

État ajouté : `receptionWithReserves: boolean | null`, `workRef: {type, number, date, amount}`, `reserveDelay`, `reserveDueDate`, champs adresse étendus, réserves enrichies.

Stepper dynamique :
- `null` (pas encore choisi) : Entreprise → Client → Chantier → Travaux → **Décision réserves** → Signatures → Aperçu
- `false` : Entreprise → Client → Chantier → Travaux → Signatures → Aperçu
- `true` : Entreprise → Client → Chantier → Travaux → Réserves → Photos → Signatures → Aperçu

Étape **Décision réserves** : 2 cards (« Sans réserve » / « Avec réserves »). Si bascule `true → false` et réserves saisies → `confirm()` avant purge.

Étape **Travaux** enrichie : select type référence (devis / bon de commande / marché / manuel), n°, date, montant, description.

Étape **Chantier** : `AddressAutocomplete` + champs CP/ville auto, lat/long cachés.

Étape **Réserves** : pour chaque réserve, champs `description`, `nature`, `work_to_execute`, `severity`, `due_date`. + champs PV-level `reserve_completion_delay` et `reserve_due_date`.

Soumission : envoie tous les nouveaux champs ; bloque si `receptionWithReserves === null`.

**Modif `src/routes/_authenticated/pv.$id.tsx`**
- Afficher référence travaux, déclaration réception, délai/échéance réserves.
- Badge `reserve_lift_status` + CTA conditionnel « Préparer la levée de réserves » (déjà partiel, à harmoniser).

**Modif `src/routes/_authenticated/reserves.tsx`**
- Afficher `nature`, `work_to_execute`, `due_date`. Filtre par `reserve_lift_status` du PV parent.

---

## 4. UX

- Cards radio grandes au choix réserves (icônes Check / AlertTriangle).
- Résumé latéral dynamique (déjà présent) montrant : référence travaux, type réception, nb réserves.
- Mobile-friendly : stepper compact, autocomplete plein écran sur mobile.
- Wording métier (« maître d'ouvrage », « entreprise titulaire », « délai global »).
- Autosave conservé tel quel (mêmes clés étendues).

---

## 5. Sécurité serveur

`createPv` :
- Whitelist stricte des champs.
- Si `reception_with_reserves=false` → `reserves=[]`, `photos=[]` (ignore tentative manipulation).
- Si `true` → exige ≥ 1 réserve valide (description + work_to_execute non vides), sinon `Error('Réserves manquantes.')`.
- Génération suivi levée **uniquement** via trigger DB, jamais via input client.
- Rate limit `address_search` côté serveur.

---

## 6. Fichiers touchés

Nouveaux :
- `src/lib/address.functions.ts`
- `src/components/pv/AddressAutocomplete.tsx`
- `supabase/migrations/<ts>_pv_reception_metier.sql`

Modifiés :
- `src/lib/pv-create.functions.ts`
- `src/lib/pdf.server.ts`
- `src/routes/_authenticated/pv.new.tsx`
- `src/routes/_authenticated/pv.$id.tsx`
- `src/routes/_authenticated/reserves.tsx`

---

## 7. Tests manuels livrés

- Recherche adresse « 10 rue de » → suggestions, sélection remplit CP/ville/coords.
- PV sans réserve : stepper saute Réserves/Photos, PDF mentionne « sans réserve », `reserve_lift_status='none'`.
- PV avec réserves : ≥ 1 réserve obligatoire, PDF affiche état + délai, `reserve_lift_status='pending'`.
- Bascule avec→sans réserves : confirmation puis purge locale.
- Tentative POST direct `reserves` avec `reception_with_reserves=false` → ignoré côté serveur.
- Levée complète des réserves → `reserve_lift_status='completed'` (trigger DB).
- Référence devis affichée dans PDF + page PV.

---

## Notes techniques

- API adresse data.gouv : libre, sans clé, quota raisonnable, parfait pour autocomplete.
- Triggers DB pour `reserve_lift_status` évitent toute incohérence côté code.
- Pas de table devis créée : on stocke uniquement les champs `work_reference_*` sur PV. Migration vers vraie table devis = travail futur.
- PDF reste pdf-lib (pas de refonte template, juste sections ajoutées).

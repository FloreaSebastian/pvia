## Objectif

Refactorer `/pv/new` et `/pv/:id` pour numérotation auto serveur, type fixé, et ajouter un flux complet de **Levée de réserves** (table dédiée, PDF, audit, push, webhooks).

---

## 1. Migrations SQL

**Migration A — Numérotation**
- `ALTER TABLE company_settings ADD COLUMN pv_number_prefix text NOT NULL DEFAULT 'PV'`
- `pv_number_include_year boolean DEFAULT true`
- `pv_number_next integer DEFAULT 1`
- `pv_number_digits integer DEFAULT 5`
- `pv_number_separator text DEFAULT '-'`
- `ALTER TABLE pv ADD CONSTRAINT pv_company_numero_unique UNIQUE (company_id, numero)`
- RPC `generate_next_pv_number(_company_id uuid) RETURNS text` — `SECURITY DEFINER`, `FOR UPDATE` sur la ligne `company_settings`, incrémente `pv_number_next`, retourne le numéro formaté. Auto-insert ligne settings si absente.

**Migration B — Levée de réserves**
- Table `reserve_lift_reports` (id, company_id, pv_id, numero, status [`brouillon`|`signe`], comment, company_signature, client_signature, signed_at, pdf_url, created_by, timestamps)
- Table `reserve_lift_items` (id, report_id, reserve_id, old_status, new_status, comment, photo_urls text[], created_at)
- RLS : SELECT membres actifs ; INSERT/UPDATE manager+ via `can_manage_company` ; DELETE admin+
- Triggers webhook `reserve_lift.created`, `reserve_lift.signed`
- Numérotation : réutiliser la séquence PV avec suffixe `-LR-NN` calculé serveur (compte des reports existants pour ce `pv_id`)

---

## 2. Server functions

**Modif `src/lib/pv-create.functions.ts`**
- Retirer `numero` et `type` du schema d'entrée
- Forcer `type = 'reception'`
- Appeler RPC `generate_next_pv_number(companyId)` en début de handler
- Retry léger en cas de collision unique (1 retry)

**Nouveau `src/lib/reserve-lift.functions.ts`**
- `createReserveLift({ pvId, comment, reserveIds[], photos[], clientSignature?, companySignature, requireClientSignature })`
- Vérifie membership + manage_company + PV appartient à la company
- Insert report + items, update `pv_reserves.status='levee'` pour les sélectionnées
- Upload photos via service role dans `pv-assets/{companyId}/lifts/{reportId}/...`
- Génère PDF via nouveau `buildAndStoreReserveLiftPdf(reportId)`
- Audit `reserve_lift.created`, `reserve_lift.signed`, `reserve.lifted`, et `pv.all_reserves_lifted` si plus aucune réserve ouverte
- Push fan-out + webhooks (auto via triggers DB)

**Nouveau `src/lib/reserve-lift.server.ts`**
- Helpers validation photo/signature (réutilise ceux de `pv-create.server.ts`)
- `buildAndStoreReserveLiftPdf(reportId)` — pdf-lib, calque sur `pdf.server.ts`

---

## 3. Frontend

**`src/routes/_authenticated/pv.new.tsx`**
- Supprimer champ `numero` (input) → afficher "Numéro attribué à la création" en read-only avec preview live calculée
- Supprimer sélecteur `type` → bandeau fixe "Procès-verbal de réception de travaux"
- Ne plus envoyer `numero`/`type` à `createPv`

**Nouveau `src/routes/_authenticated/parametres.numerotation.tsx`**
- Form édition des 5 champs `pv_number_*`
- Preview live `PV-2026-00001`
- Ajouter entrée dans `parametres.tsx` (nav settings)

**Nouveau `src/routes/_authenticated/pv.$id.levee-reserves.tsx`**
- Liste réserves ouvertes (checkbox sélection)
- Champ commentaire global + commentaire/photos par réserve
- Signature entreprise (obligatoire), signature client (toggle obligatoire/optionnel)
- Submit → `createReserveLift` → redirect `/pv/:id`

**Modif `src/routes/_authenticated/pv.$id.tsx`**
- Bloc "Réserves" avec statut (aucune / ouvertes / partielles / toutes levées)
- CTA "Créer une levée de réserves" si ouvertes
- Liste des levées existantes + lien PDF

**Modif `src/routes/_authenticated/reserves.tsx`**
- Action inline "Lever la réserve" (raccourci vers `/pv/:id/levee-reserves` avec preselect)
- Filtre statut ouvertes/levées/validées (si pas déjà présent)

---

## 4. Audit / Push / Webhooks

Ajouter actions dans `AuditAction` union (`audit.server.ts`) :
- `reserve_lift.created`, `reserve_lift.signed`
- `reserve.status_lifted`, `pv.has_open_reserves`, `pv.all_reserves_lifted`

Push via `firePushToCompany` dans `createReserveLift`.

Webhooks : trigger DB sur `reserve_lift_reports` (INSERT → `reserve_lift.created`; UPDATE status=signe → `reserve_lift.signed`). `reserve.lifted` déjà géré par `webhook_on_reserve_event`. Ajouter event `pv.reserves_completed` côté createReserveLift (appel `enqueue_webhook_event` via RPC ou helper).

---

## 5. Tests manuels (livrés à l'utilisateur en fin)

- Création PV → numéro auto attribué, unique, croissant
- 2 créations simultanées (double-click) → pas de doublon
- Settings numérotation → preview live, sauvegarde, nouveau PV suit le format
- PV signé avec réserves → bloc réserves affiche "ouvertes"
- Levée de réserves brouillon → signé → réserves passent à `levee`, PDF généré
- Levée partielle puis 2e levée → `all_reserves_lifted` déclenché à la fin
- `/admin/monitoring` voit `reserve_lift.created`, `reserve_lift.signed`, `push.sent`, webhook `reserve_lift.created`

---

## Notes techniques

- Numérotation : la RPC verrouille via `SELECT ... FOR UPDATE` la ligne `company_settings`. Auto-INSERT si manquante avec les valeurs par défaut.
- Contrainte unique sert de filet de sécurité ; retry une seule fois en cas de collision (impossible si RPC OK).
- Type PV : `'reception'` enum-like en DB existant ; on whitelist côté server, ignore tout input client.
- PDF levée : signature client optionnelle selon flag `require_client_signature` stocké dans `reserve_lift_reports.metadata` (ajouter colonne `metadata jsonb`).
- Pas de modifications RLS sur tables existantes.
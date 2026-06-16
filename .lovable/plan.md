# Refonte Clients & Chantiers (BTP)

Travail volumineux — je propose de le livrer en **3 lots** pour rester revue-able. Tu valides le plan global, puis je peux soit tout livrer d'un coup, soit lot par lot.

---

## Lot 1 — Adresse intelligente (Clients & Chantiers)

### Base de données
Migration ajoutant aux deux tables :
- `address_line1 text`, `postal_code text`, `city text`, `latitude double precision`, `longitude double precision`
- Garder l'`address` existante (recomposée serveur-side à chaque update)

### Backend
- Réutiliser `searchAddressSuggestions` déjà utilisé pour les PV (api-adresse.data.gouv.fr)
- Étendre `clients.functions.ts` et `chantiers.functions.ts` :
  - validation Zod des champs adresse
  - recomposition `address = "address_line1, postal_code city"`
  - audit `client.address_updated` / `chantier.address_updated` si changement

### UI
- Remplacer le champ texte `address` par `<AddressAutocomplete>` (composant existant) dans :
  - formulaire client (`/clients`)
  - formulaire chantier (`/chantiers`)
- Affichage : ville + CP dans les cartes, adresse complète en détail

---

## Lot 2 — Fiche chantier `/chantiers/$id` + tables associées

### Migrations (3 tables + RLS + GRANTs)
- `chantier_events` (timeline + calendrier unifiés)
- `chantier_notes` (visibility internal/client, priority, reminder)
- `chantier_documents` (file_url via bucket `pv-assets` réutilisé, category)

RLS :
- SELECT : `is_company_member`
- INSERT/UPDATE : `can_manage_company` (owner/admin/manager)
- DELETE : `is_company_admin` (owner/admin)

### Triggers auto-événements
Triggers `AFTER INSERT/UPDATE` sur `pv` et `pv_reserves` qui insèrent dans `chantier_events` quand `chantier_id IS NOT NULL` :
- pv.created → "PV créé"
- pv.signed → "PV signé"
- reserve.created → "Réserve créée"
- reserve.lifted → "Réserve levée"

### Server functions (`chantier-detail.functions.ts`)
- `getChantierDetail({ id })` → résumé + timeline + notes + docs + stats avancement
- `createChantierEvent`, `updateChantierEvent`, `deleteChantierEvent`
- `createChantierNote`, `updateChantierNote`, `deleteChantierNote`
- `uploadChantierDocument`, `deleteChantierDocument`
Toutes protégées par `requireSupabaseAuth` + RBAC.

### Route `/chantiers/$id` (sections)
A. Résumé (nom, client, adresse, statut, dates, %avancement, prochain/dernier événement)
B. Timeline (événements triés DESC, icône par type)
C. Notes (toggle internal/client, priority badge)
D. Documents (upload, catégorie, preview)
E. Historique = sous-set de la timeline (filter `event_type IN ('system_*')`)

### Navigation
- `/chantiers` : ligne cliquable → `/chantiers/$id`
- Boutons "Calendrier", "Nouvel événement"

---

## Lot 3 — Calendrier `/chantiers/calendrier`

### UI
- Vue mois / semaine / jour / liste (mobile)
- Filtres : chantier, client, type, statut
- Couleurs par `event_type` (mapping CSS tokens)
- Création / édition événement via dialog
- Click événement → ouvre détail + lien vers `/chantiers/$id`

### Implémentation
- Composant calendrier custom léger (mois + semaine) — pas de dépendance lourde
- Liste pour mobile (group by date)
- Server fn `listChantierEvents({ from, to, filters })`

---

## Considérations techniques

- **Bucket fichiers** : réutiliser `pv-assets` avec prefix `chantiers/{id}/` (pas de nouveau bucket)
- **Compatibilité** : ancienne colonne `address` conservée et auto-recomposée ; aucun code legacy cassé
- **PV ↔ chantier** : la liaison `pv.chantier_id` existe déjà — uniquement les triggers à ajouter
- **Avancement %** : calculé = `events terminés / events totaux` (simple v1, ajustable plus tard)
- **RLS** : toutes les tables `company_id` scoped + GRANT explicites

## Risques / à clarifier
1. **Avancement %** : tu préfères calcul auto (events) ou champ manuel sur chantier ?
2. **Bucket** : OK pour réutiliser `pv-assets` ou tu veux un bucket `chantier-docs` séparé ?
3. **Lots** : je livre tout en une fois (~15-20 fichiers + 2 migrations) ou lot par lot avec validation entre chaque ?

Réponds à ces 3 points et je lance.

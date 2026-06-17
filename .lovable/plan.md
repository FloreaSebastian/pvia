# Refonte module Réserves

Travail volumineux : DB, server functions, UI cartes/tableau, dashboard, export, notifications. Découpé en 3 lots livrables séquentiellement pour limiter la casse.

## Lot A — Base de données & sécurité (migration)

Ajouter à `pv_reserves` :
- `assigned_to uuid` (référence `auth.users`)
- `due_date date`
- `priority text` (low / normal / high)
- Étendre les statuts autorisés : `ouverte`, `en_cours`, `levee`, `en_attente_validation`, `validee`, `rejetee` (sans casser l'existant — `levee` et `validee` restent valides)
- Index sur `(company_id, status)`, `(assigned_to)`, `(due_date)`

Trigger notification :
- À l'assignation → notif au responsable
- À la création si assignée → notif
- Au passage `levee` → notif owner PV
- Au passage `validee` → notif owner PV

RLS : conserver, vérifier que `assigned_to` peut lire/modifier sa réserve.

## Lot B — Server functions & sécurité rôles

`src/lib/reserves.functions.ts` étendu :
- `updateReserveStatus` — règles par rôle :
  - `technicien` : peut passer `ouverte → en_cours → levee`
  - `conducteur_travaux` / `responsable_exploitation` / `directeur` : tous statuts
  - `assistant_admin` : lecture + suivi, pas de transition technique
  - `lecture_seule` : aucune mutation
- `assignReserve({ id, assignedTo, dueDate, priority })` — conducteur+
- `bulkUpdateReserves` — actions groupées (status, assignation, échéance)
- `exportReservesCsv` — retourne CSV string filtré
- `deleteReserve` — directeur/responsable_exploitation uniquement, refus si PV signé (déjà en place, à conserver)
- Audit : chaque action loggée

## Lot C — UI `/reserves`

Refonte de `src/routes/_authenticated/reserves.tsx` :

**Header dashboard** : 5 cartes cliquables (ouvertes / bloquantes / en retard / à valider / validées)

**Toolbar** :
- Barre de recherche (description, nature, travaux, n° PV)
- Filtres avancés : statut, gravité, échéance dépassée, PV, chantier, client
- Filtres rapides (chips) : Ouvertes / Bloquantes / En retard / À lever / Validées
- Switch vue cartes / tableau
- Bouton Export CSV

**Vue cartes** enrichie :
- Gravité + statut (badges colorés)
- Description tronquée 2 lignes + "Voir plus"
- PV / chantier / client
- Échéance + badge retard
- Responsable assigné
- Actions : Lever, Voir PV, Assigner, Modifier échéance

**Vue tableau** : PV / Client / Chantier / Gravité / Statut / Échéance / Responsable / Actions

**Sélection multiple** + actions groupées (marquer levées, assigner, modifier échéance, export sélection)

**Modale d'assignation** : sélecteur membre actif de la company, datepicker, priorité

## Hors scope (mentionné mais pas livré ici)

- Modification des sections réserves dans `/pv/:id` (pas urgent, formulaire actuel fonctionne ; je ne touche qu'à `/reserves`)
- Refonte du flow `levee-reserves` (existant, fonctionnel)
- Notifications push (l'infra notifications DB existe déjà ; les triggers couvrent l'essentiel)

## Livraison

Je propose de livrer **les 3 lots en une seule passe** car ils sont fortement couplés (UI dépend des nouveaux champs et server functions). Risque : passe longue, mais cohérente.

**Confirme-moi : on part en une passe, ou je découpe (Lot A seul d'abord, puis B+C) ?**

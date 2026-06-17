# Réserves dans PV — refonte intégrée

Travail très volumineux. Je propose un plan découpé en 3 lots avec un scope réaliste pour cette passe (Lot 1 + Lot 2). Lot 3 (PDF + workflow complet validation client) sera livré ensuite.

## Lot 1 — Harmonisation & UI PV (livré cette passe)

**Statuts** : créer `src/lib/reserve-status.ts` (constantes + libellés + tons + helpers) et l'utiliser partout (`/reserves`, `/pv/:id`, `/pv/:id/levee-reserves`).

**Section réserves dans `/pv/:id`** :
- Masquer si aucune réserve
- Carte enrichie par réserve : statut / gravité / priorité / responsable / échéance + badge retard / description / travaux / photos miniatures
- Boutons : Lever (lien existant) / Assigner (modale partagée) / Détails (popover ou drawer)

**Modal détail réserve** : nouveau composant `ReserveDetailDialog` qui affiche tous les champs, l'historique (lecture de `audit_logs` filtrés sur `entity_type=reserve` + `entity_id`), et les actions disponibles selon le rôle (assigner, en cours, lever, rejeter, en attente validation, valider).

## Lot 2 — Server functions étendues + calendrier (livré cette passe)

**Server functions** (`src/lib/reserves.functions.ts`) :
- Étendre `updateReserveStatus` :
  - Technicien : peut passer `ouverte → en_cours → levee` UNIQUEMENT pour les réserves qui lui sont assignées
  - Rejet (`rejetee`) requiert un motif (champ optionnel `reason`)
- Nouvelle `rejectReserve({ id, reason })` — conducteur+
- À l'assignation avec échéance → créer/mettre à jour un événement `chantier_events` (type `controle_qualite`, lié au responsable)
- Au passage `validee` → marquer l'événement lié `termine`
- Au passage `rejetee` → créer événement SAV

**Notifications** : trigger SQL pour `reserve_lifted`, `reserve_validated`, `reserve_rejected` (assignment déjà fait au lot précédent).

**Échéance proche/dépassée** : non livré ici (nécessite un cron job ; on a déjà le calcul côté UI).

## Lot 3 (HORS scope cette passe — à livrer ensuite)

- Refonte PDF PV : ajouter colonnes statut/gravité/priorité/responsable/échéance/travaux
- Refonte PDF levée : statut avant/après, photos avant/après, motif rejet
- Flow validation client complet côté client.* (rejet avec motif, signature, etc.)
- Cron job pour notifications "échéance proche/dépassée"
- Templates email réserves (créés/levées/rejetées)

**Raison** : les PDF (`pdf.functions.ts` + templates) et le flow client (`client.pv.$id...tsx`, `client-reserve-lift.functions.ts`) sont chacun ~300-500 lignes à toucher et ont leur propre logique de rendu. Les inclure ferait exploser la passe et augmenterait fortement le risque de régression.

## Livrables cette passe

1. `src/lib/reserve-status.ts` (nouveau)
2. `src/lib/reserves.functions.ts` (étendu : `rejectReserve`, technicien-assigné, event calendrier)
3. `src/components/pv/ReserveDetailDialog.tsx` (nouveau)
4. `src/routes/_authenticated/pv.$id.tsx` (section réserves enrichie)
5. `src/routes/_authenticated/reserves.tsx` (utilise les helpers harmonisés)
6. Migration SQL : trigger notifs `reserve_lifted` / `reserve_validated` / `reserve_rejected`, et création auto d'événement calendrier à l'assignation avec échéance

Confirme : on part sur Lot 1 + Lot 2 cette passe, Lot 3 (PDF + flow client + cron) la passe suivante ?

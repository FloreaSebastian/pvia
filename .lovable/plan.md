# Refonte métier — Réserve enrichie + Dossier chantier

Ce chantier est volumineux. Je propose de le livrer en **2 lots indépendants**, chacun shippable seul, mobile-first, sans casser l'existant.

---

## LOT 1 — Fiche réserve "dossier complet"

**Cible** : `src/components/pv/ReserveDetailDialog.tsx` (déjà existant) → refonte en vue structurée + mobile bottom-sheet.

### Sections affichées (accordéons repliables sur mobile)

1. **Réserve** — nature, description, gravité, priorité, statut, échéance, responsable, travaux, PV/chantier/client (liens).
2. **Photos constat initial** — requête `pv_photos` filtrées `reserve_id = reserve.id`. Grille 2 col mobile, badges GPS, lightbox via `PhotoLightboxDialog`, bouton carte si GPS.
3. **Levées liées** — `reserve_lift_items` join `reserve_lift_reports` filtrées par `reserve_id`. Pour chaque levée : numéro, dates, statut, mode validation, intervenant, validation client, motif rejet, commentaire.
4. **Photos après intervention** — `reserve_lift_item_photos` `photo_type='after'` groupées par levée.
5. **Mode comparatif Avant / Après** — toggle dédié, 2 colonnes desktop / vertical mobile.
6. **Actions contextuelles** (selon statut) — Lever, Voir levée, Renvoyer client, PDF client, PDF interne, Export expertise, Nouvelle tentative.
7. **Timeline courte** — reconstruite depuis `audit_logs` filtrés (`reserve` + `reserve_lift` liés).

### Nouveaux fichiers
- `src/lib/reserve-detail.functions.ts` — `getReserveDossier({ companyId, reserveId })` : retourne `{ reserve, pv, chantier, client, photosBefore, lifts:[{report, items, photosAfter}], timeline }`.
- `src/components/pv/ReserveBeforeAfterGrid.tsx` — galerie comparative réutilisable.

### Fichiers modifiés
- `src/components/pv/ReserveDetailDialog.tsx` — refonte UI, bottom-sheet mobile via `Sheet side="bottom"`, accordéons.

---

## LOT 2 — Dossier chantier

**Cible** : `src/routes/_authenticated/chantiers.$id.tsx`. Ajout d'un onglet **Dossier** (Tabs existants).

### Sous-onglets (mobile = accordéons)

1. **Résumé** — KPIs compacts (PV, réserves ouvertes/validées, levées, statut, dates).
2. **PV** — liste cartes (numéro, statut, avec/sans réserve, PDF).
3. **Réserves** — groupées par PV, avec accès direct à `ReserveDetailDialog`.
4. **Levées** — toutes les `reserve_lift_reports` du chantier.
5. **Photos** — galerie unifiée par source (PV / constat / après / docs) avec lightbox.
6. **Documents** — PDF PV signés, PDF levées (client/interne), exports expertise, `chantier_documents`.
7. **Emails** — `email_logs` filtrés par chantier/PV.
8. **Historique** — timeline unifiée depuis `audit_logs` (chantier + PV + réserves + levées).

### Export dossier chantier (ZIP)
- Bouton **"Exporter dossier chantier"** réservé rôles `directeur` / `responsable_exploitation` / `conducteur_travaux`.
- Server fn calquée sur `exportReserveLiftExpertise` mais agrégée chantier.

### Nouveaux fichiers
- `src/lib/chantier-dossier.functions.ts` — `getChantierDossier` + `exportChantierDossier` (ZIP).
- `src/components/chantier/DossierTab.tsx` — conteneur onglet (lazy-loaded).
- `src/components/chantier/DossierSummary.tsx`
- `src/components/chantier/DossierPvList.tsx`
- `src/components/chantier/DossierReserves.tsx`
- `src/components/chantier/DossierLifts.tsx`
- `src/components/chantier/DossierGallery.tsx`
- `src/components/chantier/DossierDocuments.tsx`
- `src/components/chantier/DossierEmails.tsx`
- `src/components/chantier/DossierTimeline.tsx`

### Fichiers modifiés
- `src/routes/_authenticated/chantiers.$id.tsx` — ajout onglet "Dossier".

---

## Sécurité
- Toutes les server fns sous `requireSupabaseAuth` + check `get_company_role`.
- Export ZIP : check rôle, audit log.
- Jamais d'URL signée PDF interne ni GPS exact côté client (client portal hors scope ici).

## Stack
- Pas de nouveau package : `JSZip` déjà utilisé. Réutilisation `Sheet`, `Tabs`, `Accordion`, `Dialog`, `PhotoLightboxDialog`.
- Loaders via TanStack Query (`ensureQueryData` + `useSuspenseQuery`), conforme template.

## Estimation
- Lot 1 : ~1 fichier modifié, 2 créés, ~600 lignes.
- Lot 2 : 1 modifié, 10 créés, ~1500 lignes.
- TypeScript strict OK, mobile testé 360/390/430.

---

## Question avant implémentation

**Veux-tu que je livre les 2 lots d'un seul coup**, ou **uniquement le Lot 1** (Réserve enrichie) en premier pour valider l'ergonomie avant d'attaquer le Dossier chantier ?

Mon conseil : **Lot 1 d'abord** — plus petit, validable en 1 session, et la fiche réserve est réutilisée dans le Lot 2.

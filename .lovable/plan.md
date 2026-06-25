# Référence chantier unique (CH####XX) + amélioration du dossier

## Objectif
Donner à chaque chantier une **référence immuable** au format `CH####XX` (4 chiffres séquentiels + 2 lettres aléatoires A–Z), utilisée partout : UI, recherche, photos, documents, PDF, exports ZIP, audit, emails. **Aucune régression** : on conserve les cartes du dossier chantier, on enrichit leur contenu.

---

## Lot 1 — Données & génération

### Migration SQL
1. `ALTER TABLE public.chantiers ADD COLUMN reference varchar(16);`
2. Fonction `public.generate_chantier_reference(_company_id uuid)` :
   - Verrouille un compteur par société dans `company_settings` (nouvelle colonne `chantier_reference_next int DEFAULT 1`).
   - Boucle jusqu'à trouver une combinaison `CH` + 4 chiffres (`lpad`) + 2 lettres aléatoires non utilisée (`UNIQUE` sur `(company_id, reference)`).
3. Backfill : pour chaque chantier sans référence, en ordre `created_at`, assigner `CH0001AA`, `CH0002AB`, … (lettres déterministes basées sur l'index, garanties uniques).
4. `ALTER TABLE … ALTER COLUMN reference SET NOT NULL;`
5. `CREATE UNIQUE INDEX chantiers_company_reference_uq ON public.chantiers (company_id, reference);`
6. Trigger `BEFORE INSERT` : si `reference IS NULL`, appelle `generate_chantier_reference`.
7. Trigger `BEFORE UPDATE` : bloque toute modification de `reference` (immuable).
8. Bloc d'audit : `chantier.reference_assigned` à la création.

### Code serveur
- `src/lib/chantiers.functions.ts` : retirer la génération côté JS (faite en DB), exposer la référence dans les retours.
- `src/lib/chantier-detail.functions.ts` : inclure `reference` dans le `select`.
- `src/lib/audit.server.ts` : enrichir les `metadata` chantier avec `reference` + `name`.

---

## Lot 2 — Affichage & recherche

### Affichage
- **Liste chantiers** (`src/routes/_authenticated/chantiers.index.tsx`) : badge `CH0007PV` en tête de chaque carte.
- **Fiche chantier** (`src/routes/_authenticated/chantiers.$id.tsx`) : premier bloc du dossier réécrit en `Référence / Nom / Client / Adresse / Statut / Type`.
- **Liste PV** (`src/routes/_authenticated/pv.index.tsx`) : afficher la référence chantier sous le numéro PV.
- **Réserves** (`src/routes/_authenticated/reserves.tsx`) et `ReserveDetailDialog` : ligne "Chantier : CH0007PV — Villa Marius".

### Recherche
- Étendre les filtres existants (`chantiers.index`, `pv.index`, recherche globale) à `reference` (ILIKE `%term%`). Match exact sur `CH####XX` redirige directement vers la fiche chantier.

---

## Lot 3 — Photos & documents

### Photos chantier
- `src/lib/chantier-photos.functions.ts` :
  - Storage path : `${companyId}/chantiers/${reference}/${section}/${uuid}.jpg` (section = `avant|pendant|fin`).
  - Métadonnée `display_name` = `CH0007PV-AVANT-001` (compteur par section, calculé via `count + 1`).
  - Le nom physique reste un UUID ; l'UI affiche `display_name`.
- `ChantierPhotosTab.tsx` : afficher le `display_name`, jamais l'URL.

### Documents
- `chantier_documents` : nouveau champ `display_name` ; à l'upload, préfixer `${reference}-` au nom original.
- `pv_documents`, exports : nom de fichier `CH0007PV-PV-${numero}.pdf`.

### PDF
- `src/lib/pdf.functions.ts` / `pdf.server.ts` : en-tête et pied de page de chaque page → `Référence : CH0007PV — Villa Marius`. Pas de logique métier modifiée.

---

## Lot 4 — Exports & dossier chantier

### Export ZIP
- `src/lib/chantier-dossier.functions.ts` : `exportChantierDossier` (nouveau)
  - Nom : `${reference}-${slug(name)}.zip`
  - Arborescence : `Photos/{Avant,Pendant,Fin}/`, `Documents/`, `PV/`, `Réserves/`, `Levées/`.
  - Réutilise JSZip (déjà présent). Check de rôle (`directeur` / `responsable_exploitation` / `conducteur_travaux`).

### Dossier chantier (UI) — on garde les cartes
- `DossierTab.tsx` / `DossierSummary.tsx` :
  - Bloc identité enrichi (référence en tête, gros, mono).
  - Grille KPI 2×4 cliquable (PV, Réserves, Ouvertes, Levées, Photos, Documents, Emails, Évènements). Chaque carte → switch d'onglet/sous-onglet.
  - Design conservé : coins arrondis, ombre légère, fond blanc, icône colorée, gros chiffre, libellé petit.

---

## Lot 5 — Audit, emails, compatibilité

- `writeAuditLog` chantier : injecter automatiquement `{ chantier_reference, chantier_name }` dans `metadata`.
- Emails (réserves, levées, PV) : variable `{{chantier_reference}}` dans les templates + objet ("Chantier CH0007PV — …").
- Anciens liens (`/chantiers/:id`) : inchangés. Nouveau résolveur `/chantiers/ref/:reference` qui redirige vers l'`id` (utile pour la recherche directe par référence).

---

## Détails techniques

```text
CH | 0007 | PV
   ^^^^    ^^
   seq     2 lettres A–Z aléatoires (collisions résolues par retry en DB)
```

- Unicité scoping : `(company_id, reference)` — la séquence est par société, pas globale.
- Immuabilité : trigger DB + pas d'UI d'édition.
- Backfill : déterministe, exécuté dans la même migration, transactionnel.
- Pas de nouveau package. JSZip déjà utilisé.
- TypeScript strict : `reference: string` non null partout après migration ; types Supabase régénérés après l'approbation.

---

## Livrables

1. Migration SQL (colonne, unique index, fonction de génération, triggers, backfill).
2. Server fns mises à jour : `chantiers.functions.ts`, `chantier-detail.functions.ts`, `chantier-photos.functions.ts`, `chantier-dossier.functions.ts` (nouveau export ZIP).
3. UI : `chantiers.index`, `chantiers.$id`, `DossierTab`/`DossierSummary`, `ChantierPhotosTab`, `pv.index`, `reserves`, `ReserveDetailDialog`.
4. PDF : en-tête/pied avec référence.
5. Audit + emails : référence injectée.
6. Test E2E rapide : `tests/e2e/chantier-flow.spec.ts` étendu pour vérifier la présence de la référence sur la fiche et dans la liste.

---

## Question avant exécution

Le périmètre est volumineux (~15 fichiers + migration + PDF + ZIP). Je propose de découper la livraison :

- **Phase A (cette session)** : Lots 1 + 2 (migration, génération, affichage, recherche) — base solide, visible immédiatement.
- **Phase B** : Lots 3 + 4 (photos, documents, PDF, export ZIP, dossier enrichi).
- **Phase C** : Lot 5 (audit/emails) + tests E2E.

**Tu veux que je lance Phase A seule, ou tout d'un bloc ?** Mon conseil : Phase A d'abord pour valider le format de référence et le backfill sur tes données réelles avant de propager dans les PDF/exports.

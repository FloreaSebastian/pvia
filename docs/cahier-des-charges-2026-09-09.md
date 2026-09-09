# PVIA — Rubrique « Cahiers des charges » (pré-étude avant-vente)

Date : 2026-09-09

## 1. Audit préalable (aucune duplication)

Réutilisé tel quel, sans système parallèle :

- moteur de questionnaires `src/lib/visites/engine.ts` (conditionnalité, blocs répétables, complétude) et `VisitFieldInput` (cibles 44 px) ;
- clients / chantiers / visites techniques existants (conversion seulement, jamais automatique) ;
- Storage privé `pv-assets` (policies préfixe `company_id`), PDF `pdf-lib`, e-mail avec retry/log, `writeAuditLog` ;
- gardes `assertCompanyWriteAccess` et rôles canoniques (`MANAGE_ROLES`, admin) — **aucune nouvelle tarification, aucun gate commercial ajouté**.

Constat : aucun module de pré-étude avant-vente n'existait ; les visites techniques sont rattachées à un chantier, donc situées **après** le cahier des charges.

## 2. Base de données (migration additive)

`technical_studies`, `technical_study_answers`, `technical_study_documents`, `technical_study_notes`, `technical_study_versions` :
RLS multi-tenant, GRANT explicites, index, triggers `updated_at`, référence auto `CDC-AAAA-#####`.
Fonctions SECURITY DEFINER créées avec EXECUTE révoqué pour `PUBLIC`/`anon`/`authenticated`.
Linter : 25 warnings, tous préexistants (extension `public`, fonctions SECURITY DEFINER antérieures).

## 3. Fonctionnel livré

- 3 questionnaires métier : photovoltaïque, PAC air/eau, PAC air/air (blocs répétables par pièce).
- Cycle : brouillon → en cours → validation interne → validé → envoyé → accepté/refusé → archivé.
- Autosave des réponses, complétude en %, photos par emplacement, documents PDF/JPEG/PNG/WebP (10 Mo), liens signés courts.
- Estimation **indicative** (puissance, production, budget, vigilances) avec avertissement non contractuel systématique.
- Notes internes (jamais envoyées) et notes client, synthèse, PDF entreprise, envoi e-mail au client, versionnage à chaque envoi.
- Décision commerciale, duplication, archivage, suppression (admin), historique d'audit.
- Conversion **explicite** en chantier (et optionnellement visite technique) : aucun chantier créé à la création.
- Espace client : « Mes cahiers des charges » + téléchargement PDF via lien signé 120 s, filtré par relations non suspendues.
- Navigation : entrée « Cahiers des charges » placée avant « Visites techniques ».

## 4. Sécurité

Toutes les écritures passent par des server functions authentifiées : garde rôle + tenant + `assertCompanyWriteAccess` (lecture seule si abonnement expiré). Chemins Storage vérifiés côté serveur (`company/etudes/study/`), MIME et taille contrôlés, message d'accès identique pour « inexistant » et « interdit » côté client.

## 5. Tests

- `bun test tests/unit` : **162 tests, 0 échec, 443 assertions, 14 fichiers** (dont `tests/unit/etudes-estimate.test.ts`).
- `bunx tsgo --noEmit` : OK. Build : OK.

## 6. Points BLOCKED

- Parcours authentifié réel (création → envoi → espace client) : session navigateur indisponible (`signed_out`).
- Réception e-mail réelle et rendu PDF sur appareil : non vérifiés.
- Aucune publication lancée dans ce tour ; Stripe LIVE, abonnements et données réelles non touchés.

---

# Audit de cohérence et corrections — 2026-09-10

## A. Défauts réels trouvés et corrigés

| # | Défaut | Preuve | Correction |
|---|--------|--------|-----------|
| 1 | Statut technique et statut commercial mélangés (`accepted`/`refused` dans le cycle du cahier des charges) | lecture `src/lib/etudes.server.ts` | Axe commercial séparé : colonnes `quote_*`, `src/lib/etudes/workflow.ts`, transitions techniques ne créent plus `accepted/refused` (anciens statuts restent lisibles) |
| 2 | Conversion possible sans devis accepté | lecture `convertStudy` | `assertConversionAllowed` appliqué **côté serveur** + boutons masqués |
| 3 | Conversion en chantier impossible en pratique : statut `"prepare"` hors du CHECK `chantiers_status_check` | migration `20260617153111` | statut corrigé en `"preparation"`, `owner_id` ajouté |
| 4 | Visite créée avec `reference: ""` alors que la colonne a un défaut `VT####` | migration `20260824122752` | champ retiré, référence générée par la base |
| 5 | Double conversion pouvait créer deux visites | absence de clé d'idempotence | clé déterministe `etude:<id>` + reprise sur conflit `23505` + suppression compensatoire du chantier créé |
| 6 | Visite technique exige un chantier (`chantier_id NOT NULL`) mais l'UI permettait « visite sans chantier » | schéma | le chantier est créé ou réutilisé automatiquement, jamais dupliqué |
| 7 | Upload direct Storage pouvait laisser un fichier orphelin si l'enregistrement échouait | lecture route détail | suppression compensatoire du fichier |
| 8 | Autosave : une réponse en échec était perdue | lecture route détail | remise en file + bouton « Réessayer » |
| 9 | PDF : portée non contractuelle insuffisamment explicite | lecture `etudes-pdf.server.ts` | section « Portee du document » (ni devis, ni engagement, ni validation technique) |
| 10 | Questionnaires PAC/PV incomplets | lecture templates | champs ajoutés (bilan énergétique, températures de base, émetteurs, ECS, acoustique, alimentation dédiée, gainable conditionnel, etc.) |

## B. Suivi de devis (facultatif)

`quote_status` (`to_prepare`, `prepared`, `sent`, `follow_up`, `accepted`, `refused`, `expired`), référence, montants HT/TTC, dates, commentaire.
Le tableau de bord du dossier affiche une **prochaine action** unique. Le chantier n'est créé qu'après devis accepté.

## C. Niveaux de preuve (strictement distingués)

- **Testé automatiquement** : workflow, garde de conversion, prochaine action, séparation des axes — `tests/unit/etudes-workflow.test.ts`. Total : **173 tests, 0 échec, 471 assertions, 15 fichiers**. `bunx tsgo --noEmit` OK, `bun run build` OK.
- **Vérifié par lecture de code/schéma** : RLS et GRANT, IDOR portail client (`etudes-client.functions.ts` : scope client, entreprise non suspendue, statuts visibles, lien signé 120 s), notes internes jamais exportées, chemins Storage préfixés par tenant.
- **Non testé en exécution** : parcours authentifié complet, réception d'e-mail réelle, rendu PDF sur appareil, responsive sur matériel physique, conversion exécutée en base réelle.
- **BLOCKED** : session navigateur `signed_out`, donc aucun E2E connecté possible dans ce tour.

## D. Non touché

Stripe (test et LIVE), abonnements, paiements, clients et données réelles. Aucune publication lancée.

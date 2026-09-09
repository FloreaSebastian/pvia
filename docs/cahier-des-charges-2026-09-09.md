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

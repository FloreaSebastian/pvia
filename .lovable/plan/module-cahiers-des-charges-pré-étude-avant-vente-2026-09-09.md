# Module « Cahiers des charges » (pré-étude avant-vente)

## Audit de l'existant (fait avant toute proposition)

| Brique | Existant réutilisable | Conséquence pour le module |
|---|---|---|
| Formulaires métier | `src/lib/visites/` : moteur de templates (types, engine, templates PV / PAC air-air / PAC air-eau), conditionnalité `visibleIf`, blocs répétables, calcul de complétude | On réutilise le **même moteur** : nouveaux templates d'étude, pas de nouveau système |
| Données visites | `technical_visits` + `technical_visit_answers` (clé/valeur), `_photos`, `_constraints`, `_photo_skips` | Même modèle : table maître fine + réponses clé/valeur (pas de table à 150 colonnes) |
| Clients | `clients` (particulier/pro, archivage, identités espace client) | Réutilisé tel quel, aucun champ ajouté |
| Chantiers / visites | `chantiers` (référence `CH####XX`), visite technique rattachée à un chantier | L'étude ne crée **rien** automatiquement ; conversion explicite plus tard |
| Fichiers | bucket privé `pv-assets`, liens signés courts, sniff MIME (`file-sniff.ts`), compression image | Documents d'étude dans le même bucket, mêmes règles |
| PDF | `pdf.server.ts` + `processing-status.server.ts` (statut génération, reprise d'erreur) | Même pipeline, nouveau gabarit d'étude |
| Emails | `email-sender.server.ts`, `email-registry.server.ts`, throttle | Nouveau modèle d'email enregistré dans le registre |
| Audit | `audit_logs` + `writeAuditLog` | Toutes les actions d'étude y sont tracées |
| Rôles | `company_role` (directeur, responsable, conducteur, assistant, technicien, lecture seule) + `RouteRoleGuard` + gardes serveur | Permissions dérivées des rôles existants, **contrôle serveur systématique** |
| Abonnement | `assertCompanyWritable` / `assertSubscriptionUsable` | Lecture toujours permise, écritures bloquées en lecture seule. **Aucune modification Stripe ni des plans** |
| UI | `PageHeader`, `Stepper`, `CollapsibleSection`, `StatusBadge`, `SaveStatusBadge`, autosave, `VisitFieldInput`, `VisitPhotoSlotCard`, BottomNav | Réutilisés — cohérence visuelle immédiate |

**Risques de régression identifiés** : navigation principale (ajout d'un groupe), moteur de templates partagé avec les visites (on l'étend sans le modifier), `audit_logs` et quotas PV (non touchés). Migrations **additives uniquement**.

## Décisions d'architecture

- Tables : `technical_studies` (maître), `technical_study_answers` (clé/valeur), `technical_study_documents`, `technical_study_notes` (interne/client), `technical_study_versions` (instantané JSON à chaque envoi). Pas de table par métier : le métier vit dans les templates de code, comme pour les visites.
- Statuts : `draft, in_progress, internal_review, completed, sent, accepted, refused, archived`.
- Référence : `CDC-AAAA-#####` par entreprise, générée en base (même approche que la numérotation PV).
- Pré-dimensionnement : calculé dans un module pur testé, toujours affiché comme **estimation indicative**, jamais comme garantie.
- Isolation : RLS par `company_id` sur toutes les tables, plus vérification serveur d'appartenance dans chaque fonction.

## Lots de livraison

### Lot 1 — Fondations
Migration additive : tables ci-dessus, contraintes, index, GRANT, RLS multi-entreprise, trigger `updated_at`, séquence de référence. Templates métier (PV, PAC air/eau, PAC air/air) dans `src/lib/etudes/templates/`, réutilisant le moteur des visites. Fonctions serveur CRUD + complétude + gardes de rôle et d'abonnement.

### Lot 2 — Liste et création
Page `/cahiers-des-charges` : tableau responsive (référence, client, adresse, type, dimension principale, responsable, dates, statut, complétude, actions), filtres par métier et statut, recherche client/adresse/référence/téléphone/email, tris. Création en 2 temps : choix du métier (3 cartes), puis client existant ou nouveau. Navigation : nouveau groupe **PRÉPARER** (Cahiers des charges → Visites techniques → Chantiers), le cahier des charges en premier.

### Lot 3 — L'étude
Navigation latérale desktop / onglets mobiles adaptés au métier : Aperçu, Client, Besoin, Bâtiment, Technique, Photos & documents, Dimensionnement, Observations, Synthèse, PDF, Historique. Champs conditionnels, sections repliables, blocs répétables (pans de toiture, pièces), autosave, progression, appareil photo natif, zéro débordement de 320 px au desktop.

### Lot 4 — Documents, notes, synthèse
Dépôt PDF/JPG/PNG catégorisés (facture, toiture, tableau électrique, compteur, plans…) avec description, date, auteur ; liens signés courts. Notes internes vs notes client strictement séparées, la note interne n'entre jamais dans le PDF ni dans l'espace client. Écran de synthèse par métier avec points de vigilance et prochaine étape.

### Lot 5 — Validation, PDF, envoi
Soumission pour validation, approbation / demande de correction commentée, finalisation. PDF professionnel repris du branding entreprise (page de garde + 11 chapitres + mention de non-engagement). Envoi au client par email avec message personnalisable, traçabilité destinataire/date/statut. Nouvelle version figée à chaque envoi.

### Lot 6 — Suite du parcours
Action interne « Projet commercialement accepté » proposant : créer le chantier, créer la visite technique, les deux, ou plus tard. Pré-remplissage complet de la visite technique depuis l'étude. Timeline d'historique, duplication d'étude avec nouvelle référence, rubrique « Mes études » dans l'espace client (synthèse + PDF uniquement), bloc pipeline sur le tableau de bord basé uniquement sur des données réelles.

### Lot 7 — Vérifications
Tests unitaires (complétude, pré-dimensionnement, permissions, séparation notes, statuts), essais réels de bout en bout sur les trois métiers, autosave, upload, PDF, envoi, isolation entreprise A/B par appel direct des fonctions serveur, contrôle responsive 320 px / tablette / desktop. Rapport final : fichiers créés et modifiés, migrations, tables, RLS, fonctions serveur, tests et résultats, limites restantes.

## Ce qui ne sera pas touché
Facturation Stripe, plans et quotas, visites techniques, chantiers, PV, réserves et sous-traitants restent inchangés ; les migrations n'ajoutent que du nouveau.

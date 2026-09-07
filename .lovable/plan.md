# Module « Sous-traitants » PVIA

## Ce que l'audit de l'existant montre

- Deux parcours d'authentification déjà en place : professionnel (compte Lovable Cloud + code à 6 chiffres) et client (session par cookie, sans compte). Les codes sont hachés, limités en fréquence, neutres contre l'énumération.
- Les collaborateurs internes passent par `company_members` avec 6 rôles métier (directeur, responsable, conducteur, technicien, assistant, lecture seule) et des invitations à jeton haché.
- Chantiers, PV, réserves, photos, documents, visites techniques, notifications, journal d'audit, calendrier et quotas existent déjà et sont protégés par des règles d'accès en base + gardes serveur (`assertSubscriptionUsable`, `assertPlanFeature`, journal de quota PV immuable).

Le module sous-traitant se branche sur tout cela sans rien dupliquer, et sans jamais réutiliser les droits d'un membre interne.

## Découpage proposé (5 lots livrés dans l'ordre)

### Lot 1 — Fondations (base de données + sécurité)
Nouvelles tables : entreprises sous-traitantes, utilisateurs sous-traitants (rattachés au même système de comptes), relations entreprise↔sous-traitant, permissions (générales + exceptions par chantier), affectations aux chantiers (mission, date, heure, statut d'intervention), invitations à jeton haché à usage unique, fil d'échanges par intervention.
Règles d'accès en base pour chaque table + index sur entreprise, sous-traitant, utilisateur, chantier, statut, dates. Migration non destructive, aucune colonne existante supprimée.
Une seule fonction serveur d'autorisation : compte actif → relation active → affectation au chantier → permission demandée → abonnement/formule de l'entreprise propriétaire → quota. Toute lecture/écriture sous-traitant passe par elle.

### Lot 2 — Espace administrateur
Rubrique « Sous-traitants » dans la navigation (réservée directeur/responsable) : liste avec recherche et filtres, création en 5 étapes (entreprise → utilisateur → permissions → chantiers → invitation), fiche détaillée (infos, utilisateurs, chantiers, missions, permissions, activité), suspension/archivage/révocation, modèles de permissions (Terrain, Visite technique, Chef d'équipe, Personnalisé).

### Lot 3 — Connexion et espace sous-traitant
Troisième onglet sur la page de connexion, redirection dédiée, sélecteur d'entreprise quand la personne travaille pour plusieurs entreprises, contexte actif conservé et revérifié côté serveur à chaque action.
Espace mobile-first : accueil (interventions du jour, à faire, chantiers actifs, activité récente), mes interventions, chantiers affectés, planning, documents, mon compte, notifications. Aucune donnée financière, aucune liste globale.

### Lot 4 — Intégration dans l'existant
Bloc « Sous-traitants » dans la fiche chantier (séparé de l'équipe interne, badge dédié), interventions visibles dans le calendrier de l'entreprise, affectation d'une visite technique à un sous-traitant qui la réalise dans le formulaire existant, réserves et photos via les composants déjà en place, notifications dans les deux sens, journal d'audit avec le nom lisible de l'acteur.

### Lot 5 — Audit runtime et rapport
Scénarios réels rejoués : accès refusé à un chantier non affecté, changement d'identifiant dans l'URL, retrait d'un chantier ou d'une permission avec effet immédiat, utilisateur suspendu, invitation réutilisée, visite technique sans droit ou hors formule, entreprise en lecture seule, quota PV atteint, même email avec plusieurs types d'accès, coordonnées client non renvoyées quand elles ne sont pas autorisées. Contrôle d'affichage 320 px, Fold, mobile, tablette, desktop. Puis le rapport en 12 points demandé.

## Règles tenues du début à la fin

- Un sous-traitant n'est jamais un membre interne et n'hérite d'aucun de ses droits.
- L'entreprise active vient toujours de la session vérifiée côté serveur, jamais du navigateur.
- Aucune création interdite par la formule, l'état d'abonnement ou le quota ne devient possible via l'espace sous-traitant : ce sont exactement les mêmes contrôles.
- Pas de suppression physique quand un historique existe : suspension, archivage, révocation.
- Aucun paiement, abonnement réel ou donnée réelle n'est modifié pour les tests.

## Points à confirmer

- Les sièges d'équipe payants ne sont pas consommés par les sous-traitants (ils ne sont pas des membres). Je pars sur ce principe sauf avis contraire.
- Le module est disponible pour toutes les formules, mais la visite technique reste réservée aux formules qui l'incluent.

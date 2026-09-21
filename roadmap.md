# Roadmap PVIA

## Solar Studio V2

- [x] P0-A — Cadre UX (rail d'étapes, barre haute, panneau contextuel repliable, barre de synthèse Implantation, mode Rapide/Expert)
- [x] P0-A.1 — Corrections d'audit (roadmap restaurée, étape bloquée explicite, état de sauvegarde global)
- [x] P0-B — Toiture (dessin polygone multi-pans, sommets éditables, obstacles dessinables, marges par arête) — dessin sur carte non rejoué en local (clé Google restreinte au domaine de production)
- [x] P0-B.1 — Corrections d'audit : conversion explicite obligatoire (aucune perte de pans/implantation), écritures toiture et obstacles atomiques et versionnées, brouillon d'obstacle (type/hauteur/marge) avant enregistrement, état « modifié » et garde-fou de sortie, undo/redo toiture dans la barre haute, contours dégénérés refusés et lecture défensive des pans
- [x] P0-C — Auto-placement V2 + variantes (marges par arête réelles, 4 rôles de variantes, objectif impossible, aperçu non persisté, apply signature + geometry_version)
- [ ] P0-D — Édition manuelle (sélection, drag & drop, snap, validation temps réel)
- [ ] P1 — 3D synchronisée + résultats/exports
- [ ] P2 — Conception électrique + ombrage/irradiance
- [ ] P3 — Financier / autoconsommation / ROI

## Historique

### Facturation / Stripe

- [x] Reconnecter Stripe (sandbox provisionné via intégration intégrée)
- [x] Créer les produits/prix PVIA (Essentiel/Pro/Business, mensuel+annuel, EUR HT) dans le nouveau compte test
- [x] Vérifier que le checkout/portail existants pointent sur les nouveaux lookup keys
- [x] Mettre à jour docs/launch-readiness-2026-09-01.md (reconnexion, état TVA live, portail)

### Module Sous-traitants (2026-09-07)

- [x] Fondations base de données, isolation multi-entreprise et permissions dédiées
- [x] Espace administrateur /sous-traitants (entreprises partenaires, invitations, autorisations)
- [x] Connexion sous-traitant par code (onglet dédié sur /login) et acceptation d'invitation
- [x] Portail mobile /sous-traitant (interventions, chantiers, photos, comptes-rendus, échanges)
- [x] Durcissement des règles d'accès aux affectations (écriture réservée aux administrateurs)
- [ ] Tests E2E authentifiés du portail (BLOCKED : pas de session navigateur disponible en environnement)

## Dette connue

- [ ] Avertissement React « state update … hasn't mounted yet » au chargement de Solar Studio (antérieur à P0-A, sans impact visible)
- [ ] Dette lint historique (mise en forme Prettier et `any` dans d'anciens tests) : `bun run lint` inutilisable comme garde-fou global

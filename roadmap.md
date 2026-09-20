# Roadmap PVIA

## Solar Studio V2

- [x] P0-A — Cadre UX (rail d'étapes, barre haute, panneau contextuel repliable, barre de synthèse Implantation, mode Rapide/Expert)
- [x] P0-A.1 — Corrections d'audit (roadmap restaurée, étape bloquée explicite, état de sauvegarde global)
- [ ] P0-B — Toiture (dessin polygone multi-pans, sommets éditables, obstacles dessinables, marges par arête)
- [ ] P0-C — Auto-placement V2 + variantes (moteur déjà validé, à brancher sur le nouveau cadre)
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

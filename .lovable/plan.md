# Solar Studio — Smart PV Layout Engine

## Audit de l'existant (fait, rien à refaire)

Ce qui fonctionne et sera réutilisé tel quel :

- Bâtiment paramétrique (monopente, deux pans, quatre pans, terrasse), pans avec azimut, inclinaison, surface, contour et repère local (u,v) — `src/lib/solar/roof.ts`, `types.ts`
- Repère métrique local et outils polygonaux de base (aire, point-dans-polygone) — `geo.ts`
- Obstacles (11 types, position, emprise, hauteur), zones (interdite, prioritaire, technique, passage, réservée), cotes terrain, snapping, mesures — tables `solar_obstacles`, `solar_zones`, `solar_measurements`
- Carte Google validée en production, alignement, transparence, balayage, split view — **non touchée**
- Sauvegarde, versions (`solar_model_versions`), provenance, hash, synthèse vers le cahier des charges
- Vue 3D et plan 2D SVG

Limites réelles constatées, à corriger par cette phase :

- `layout.ts` ne fait qu'une grille unique depuis le coin bas-gauche : une seule origine, un seul alignement, une seule orientation, pas de variantes, pas d'objectif de puissance, zones prioritaires ignorées, marges non profilées
- Le rétrécissement de contour (`insetPolygon`) tire les sommets vers le centre : faux sur trapèze et concave
- Aucun catalogue exploitable côté interface, aucune notion de profil de règles, aucun statut de validité par panneau
- Undo/redo ne couvre que les paramètres du bâtiment, pas l'implantation
- Pas de déplacement manuel des panneaux

## Ce qui sera construit

### Étape 1 — Moteur métier indépendant (`src/lib/solar-layout/`)

Pur TypeScript, sans React, Three.js ni Google : testable seul, déterministe, versionné (`LAYOUT_ENGINE_VERSION`).

- `polygon/` : opérations polygonales réelles — offset vers l'intérieur correct (convexe, concave, trapèze), soustraction d'emprises, découpage en régions disjointes, test de recouvrement
- `usable-area/` : zone exploitable = contour du pan − marges rive/faîtage/noue/arêtier − obstacles dilatés de leur marge − zones interdites − passages techniques. Les zones prioritaires sont conservées comme préférence, pas comme filtre
- `rules/` : profils de règles configurables et versionnés (aucune valeur imposée par défaut ; l'entreprise saisit les siennes)
- `generate/` : pose en grille par région, portrait et paysage, balayage d'origines et d'offsets (gauche / centré / droite, bas / centré / haut), rangées irrégulières autorisées, matrices multiples autour d'un obstacle central
- `target/` : maximum toiture, puissance cible exacte, approche la plus proche (sous ou au-dessus, au choix), répartition multi-pans selon priorité utilisateur
- `score/` : critères explicites et affichables (écart à la cible, nombre de modules, taux d'occupation, nombre de matrices, compacité, alignement, modules isolés). Aucun « score IA »
- `validate/` : statut par module (valide, avertissement, invalide) avec cause, distance mesurée et seuil du profil ; correction proposée = position valide la plus proche
- Entrée : pans, module, contraintes, objectif, stratégie. Sortie : plusieurs `LayoutCandidate` réellement différents (les doublons sont fusionnés)

Exécution dans un Web Worker avec annulation, pour ne jamais bloquer la 3D ni la carte.

### Étape 2 — Données

Migration additive :

- Catalogue de modules enrichi (fabricant, référence, Wc, dimensions, épaisseur, technologie, Voc, Vmp, Isc, Imp, coefficient de température, source de fiche, date) — champs optionnels, jamais inventés ; favoris entreprise et dernier module utilisé
- Profils de règles par entreprise, versionnés
- Variantes d'implantation enregistrées, référençant la version de géométrie du bâtiment (la maison n'est jamais dupliquée) et conservant module, profil + version, version du moteur, stratégie, puissance cible, auteur, date
- Panneaux : identifiant stable, statut de validité, champs réservés (irradiance, ombrage, production) laissés vides tant que le moteur solaire n'existe pas
- Enregistrement d'une implantation en une seule opération atomique, avec détection d'une version plus récente éditée par quelqu'un d'autre

### Étape 3 — Interface

- Bouton **Ajouter des panneaux** : choix du module (recherche, filtres fabricant et puissance, favoris), puis objectif 3 / 6 / 9 kWc / Maximum / Personnalisé, puis orientation Automatique / Portrait / Paysage (Mixte présent mais désactivé par défaut)
- **Optimiser** : cartes de variantes (A, B, C…), aperçu immédiat au survol/toucher sans enregistrer, encart « Pourquoi cette proposition ? » en critères lisibles, tableau **Comparer**
- Objectif inatteignable : maximum réel affiché, avec les trois issues (utiliser le maximum, modifier les contraintes, ajouter un pan)
- Édition manuelle : glisser-déposer avec accrochage (rangée, colonne, voisin, espacement, rive) et guides, multi-sélection, aligner/distribuer, ajouter, dupliquer, supprimer, tourner. Un panneau invalide est marqué et expliqué, jamais supprimé automatiquement, avec **Corriger** et aperçu avant application
- Outils de dessin : zone interdite, passage technique, zone prioritaire
- Compteurs permanents : panneaux, kWc, pans, erreurs, avertissements ; objectif live « 5,5 / 6,0 kWc » avec complément automatique
- Changement de module ou d'orientation : tout est recalculé, jamais d'anciennes dimensions conservées silencieusement
- Déplacement d'un obstacle ou modification d'une cote : revalidation immédiate des panneaux concernés
- Undo/redo couvrant toute l'implantation, une génération complète s'annulant en une seule action ; sauvegarde au relâché, jamais pendant le glissement
- Mobile : parcours en feuille du bas (pan → panneaux → module → puissance → orientation → variantes), validé à 390 px sans régression ; tablette optimisée pour l'édition

### Étape 4 — Continuité PVIA

- Variante appliquée → synthèse photovoltaïque du cahier des charges mise à jour automatiquement (panneaux, module, kWc, orientation, inclinaison)
- Visite technique : reprise exacte de l'implantation, puis revalidation après correction terrain

### Étape 5 — Tests

- Tests unitaires : rectangle, triangle, trapèze, concave, petite et grande toiture, cheminée centrale, deux obstacles, zone interdite, passage, portrait, paysage, maximum, cible exacte, cible impossible, multi-pans, marges, grand et petit module
- Tests de propriété : aucun panneau hors zone, aucun chevauchement, aucune collision, aucune coordonnée invalide, puissance exacte
- Tests de déterminisme et mesures de performance réelles (temps moyen, temps max, nombre de candidats)
- Test runtime sur pvia.fr : pan Sud → module 500 Wc → 6 kWc → Optimiser → choix → déplacement → collision → correction → 9 kWc → enregistrement → rechargement

## Hors périmètre

Stripe, abonnements, authentification, intégration Google Maps, workflow devis, cahiers PAC, chantiers. Aucune notion de production, d'irradiance ou d'ombrage : cette phase optimise la géométrie, les contraintes, la puissance et l'ergonomie — rien d'autre.

## Livraison

Je propose de livrer en trois passes vérifiables : (1) moteur + tests, (2) données + interface d'optimisation et variantes, (3) édition manuelle + intégrations + tests runtime. Le rapport final distinguera test automatisé, test runtime, vérifié visuellement, non testé, bloqué.

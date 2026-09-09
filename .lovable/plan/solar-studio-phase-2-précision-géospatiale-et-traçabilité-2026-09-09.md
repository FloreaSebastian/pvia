# Solar Studio — Phase 2 : précision géospatiale et traçabilité

## 1. Audit de la fondation (lecture du code réel)

| Sujet | État constaté |
|---|---|
| Moteur 3D | Three.js + React Three Fiber + drei, chargés en lazy sur une route `ssr: false`. |
| Repère de scène | Déjà local et métrique : origine = point géocodé, x = Est, y = Nord, z = hauteur (`src/lib/solar/geo.ts`). **Aucune coordonnée géographique n'entre dans WebGL** — le point 2 de la demande est donc déjà respecté sur le principe ; il manque l'altitude de référence, le CRS et des fonctions nommées. |
| Toitures | Paramétriques (monopente / deux pans / quatre pans / terrasse), pans avec repère (u,v), azimut, pente, surface. Pas de contour libre, pas d'arêtes nommées. |
| Panneaux / obstacles | Placés en coordonnées (u,v) du pan ; obstacles en boîtes paramétriques. |
| Données | 13 tables `solar_*` avec RLS et grants. `solar_models` porte déjà adresse/lat/lon/origine/qualité ; `solar_data_sources` porte provider/dataset/date/licence ; `solar_measurements` existe mais sans provenance multi-valeurs ni vérification terrain. |
| Autosave | Enregistrement par action côté serveur + undo/redo local ; pas de détection de conflit ni de version géométrique. |
| Tests | 20 tests de géométrie purs (`tests/unit/solar-geometry.test.ts`). |

Corrections d'architecture nécessaires : altitude/CRS absents, provenance réduite à un champ `data_source`, aucune notion de géométrie source vs corrigée, aucun terrain, aucune carte.

## 2. Découpage proposé (3 lots livrés dans cet ordre)

### Lot 2A — Socle géospatial, provenance et carte
- Module `src/lib/solar/crs.ts` : CRS source / CRS de travail / transformation, `projectCoordinate`, `unprojectCoordinate`, `worldToLocal`, `localToWorld`. Toute conversion passe par là ; aucune conversion dans un composant.
- Ajout à `solar_models` : `origin_altitude_m`, `source_crs`, `working_crs`, `geometry_version`, `geometry_hash`, `located_confirmed_at/by`.
- Nouvelle table `solar_provenance` : `source_type` (AUTO/LIDAR/MNS/MNH/MAP/MANUAL/FIELD/DRONE/IMPORT), `source_provider`, `source_dataset`, `source_date`, `confidence`, `verification_status`, `verified_at/by`, `verification_method`, `field_measurement_id`, rattachée à toute entité (pan, obstacle, cote, bâtiment). Le booléen `verified` est remplacé.
- Localisation du projet : reprise adresse/CP/ville/GPS du cahier des charges ; sinon bouton « Localiser le bâtiment », recherche d'adresse, marqueur, puis « Confirmer le bâtiment ». Jamais de choix automatique sur résultat ambigu.
- Carte MapLibre GL : modes PLAN / ORTHOPHOTO / 3D / PLAN+3D, caméra synchronisée, attribution affichée.
- Badge « Qualité du modèle » permanent en tête de studio + fiche détaillée élément par élément (pas de score unique).
- Mode SOURCES : coloration des éléments selon leur origine.

### Lot 2B — Fournisseurs, jobs, terrain et cache
- Interfaces génériques `GeocodingProvider`, `ImageryProvider`, `ElevationProvider`, `SurfaceModelProvider`, `TerrainModelProvider`, `HeightModelProvider`, `LidarProvider`, `BuildingFootprintProvider`. Chaque réponse porte provider, dataset, version/date, CRS, résolution, emprise, licence, qualité.
- Un seul connecteur serveur `IgnGeoProvider` : URL, version, timeout, retry borné, cache, erreurs, attribution, logs. `checkCoverage(projectLocation)` avant toute proposition de source.
- Écran « Données du site » : adresse, position, orthophoto, MNT, MNS, MNH, LiDAR HD, bâtiment — disponible / indisponible, avec « Actualiser » et « Importer dans le modèle ».
- Table `solar_processing_jobs` (QUEUED/PROCESSING/COMPLETED/FAILED ; types FETCH_ELEVATION, FETCH_LIDAR, GENERATE_TERRAIN, DETECT_ROOF, GENERATE_SURFACE), idempotents, rejouables, versionnés ; suivi d'étapes côté UI (« Étape 2/4 »), jamais de spinner sans fin.
- Cache géographique clé (zone, dataset, version, date, paramètres) avec attribution conservée ; données publiques mutualisables, corrections/mesures/modèles strictement privés à l'entreprise.
- Terrain local maillé autour du bâtiment (MNT), bâtiment posé dessus ; niveaux de détail : zone bâtiment / zone proche / zone lointaine.
- Failover : réseau ou IGN indisponible → « Donnée géographique temporairement indisponible » et édition manuelle complète conservée.

### Lot 2C — Géométrie dérivée, mesures et vérification
- Empreinte bâtiment : contour fournisseur affiché sur l'orthophoto, acceptable / déplaçable / corrigeable ; géométrie source **et** géométrie utilisateur conservées, action « Revenir à la géométrie source » avec aperçu.
- Détection de pans par ajustement de plan robuste (RANSAC déterministe) : normale, pente, azimut, altitude, contour réel (trapèze, triangle, polygone), nombre de points, qualité d'ajustement, confiance élevée/moyenne/faible. Arêtes dérivées : faîtage, arêtier, noue, égout, comme entités.
- Mode comparaison AVANT / APRÈS avec différences chiffrées, sans gagnant automatique ; « Appliquer » ou « Conserver l'actuel ».
- Répercussion sur les panneaux : reprojection, vérification, marquage « 3 panneaux doivent être repositionnés », jamais de suppression automatique.
- Outil mesure : distance, distance horizontale, distance 3D, hauteur, dénivelé, angle, pente, surface ; snapping (endpoint, midpoint, edge, intersection, projection, parallèle, perpendiculaire, surface, pan) avec repère visuel.
- Cotes de projet : une cote conserve estimation / mesure terrain / valeur retenue, sans jamais perdre l'ancienne valeur ; contrainte terrain applicable à une arête avec aperçu avant application.
- Précision : calculs en pleine précision, arrondi uniquement à l'affichage ; unités m / cm / mm / m² / ° au choix, stockage SI.
- Inspecteur de pan (surface, azimut, inclinaison, altitudes égout/faîtage, source, état, mesures terrain x/y), historique des opérations, version géométrique + empreinte (hash) pour lier les futures analyses, détection de conflit multi-onglets.
- Obstacles rattachés au pan ou au site avec provenance et statut ; « obstacle potentiel », « végétation potentielle » et bâtiments voisins simplifiés (emprise + hauteur) proposés à la confirmation utilisateur.
- Mobile : fiche contextuelle au tap, aucun débordement à 320 px. Tablette : mode plein écran « Relevé » (sélection d'arête, mesure, correction, validation, photo).

## 3. Tests prévus
Fixtures numériques à géométrie connue (rectangle 10 × 6 = 60 m², longueur de rampant, azimut) avec tolérances explicites ; toit plat, deux pans, quatre pans, pan asymétrique, trapèze, bâtiment tourné, terrain en pente, coordonnées éloignées ; round-trip WGS84 → projection → local → WGS84 avec erreur mesurée et documentée ; snapping, mesure, correction de cote, undo/redo ; scénario de performance mesuré (10 pans, 30 obstacles, 100 panneaux, terrain) ; contrôles RLS croisés sur toutes les nouvelles tables.

## 4. Hors périmètre de cette phase
Ombrage annuel, PVGIS, production, autoconsommation, batterie, MPPT, rentabilité, PDF avancé, workflow complet de visite technique. Les entités reçoivent seulement les champs de vérification nécessaires.

## 5. Limites techniques annoncées d'avance
Le serveur tourne sur un runtime edge : aucun découpage LiDAR brut (LAZ) ni traitement raster lourd n'y est possible. Le pipeline LiDAR sera donc structuré en jobs avec un adaptateur, mais l'étape de crop/classification restera **non connectée** tant qu'un service de traitement externe n'existe pas ; l'interface indiquera honnêtement « indisponible » plutôt que de simuler des points. La couverture IGN (LiDAR HD notamment) est partielle en France : tout le parcours reste utilisable sans aucune source externe.

## 6. Rapport final
À la fin de chaque lot, rapport distinguant : testé automatiquement, testé runtime, vérifié visuellement, vérifié par lecture, non testé, bloqué. Aucune affirmation de précision LiDAR réelle sans comparaison réelle.

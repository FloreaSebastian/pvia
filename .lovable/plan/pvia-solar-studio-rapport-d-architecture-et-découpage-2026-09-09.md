# PVIA Solar Studio — Rapport d'architecture et découpage

## 1. État réel du projet (audit)

| Domaine | Constat |
|---|---|
| Modélisation / 3D / carte | **Rien n'existe.** Aucune dépendance Three.js, MapLibre, Leaflet, proj4, geojson. Aucun composant géométrique. Le champ « canvas » trouvé est uniquement la signature manuscrite. |
| Cahier des charges PV | `technical_studies` + réponses clé/valeur, moteur de questionnaires `src/lib/visites/engine.ts`, estimation indicative pure `src/lib/etudes/estimate.ts` (facteurs orientation/ombrage déclaratifs), PDF `etudes-pdf.server.ts`, portail client, suivi devis séparé du statut technique. |
| Géodonnées | Géocodage déjà en place côté serveur : `address.functions.ts` → api-adresse.data.gouv.fr (BAN, sans clé). `chantiers` et photos PV portent déjà latitude/longitude. Aucune orthophoto, aucun LiDAR. |
| Fichiers | Bucket privé unique `pv-assets`, chemins préfixés `company_id`, liens signés 120 s, sniff MIME, compression image. |
| Sécurité | RLS multi-tenant systématique, gardes serveur `is_company_member` / `can_manage_company` / `is_company_admin` + `assertCompanyWriteAccess` (abonnement). Rôles `company_role` existants. |
| Runtime | TanStack Start, SSR par défaut, worker Cloudflare pour le serveur. Conséquence forte : **aucun calcul lourd côté serveur** (pas de traitement LiDAR natif, pas de sharp/GDAL). |

## 2. Choix techniques et justification

- **Three.js + React Three Fiber + drei** : seule pile 3D mature pour React 19 ; la scène doit être montée sur une route `ssr: false` (WebGL n'existe pas côté worker).
- **three-mesh-bvh** : indispensable pour un ombrage réellement calculé par lancer de rayons ; sans lui le raycasting est inutilisable au-delà de quelques dizaines de panneaux.
- **MapLibre GL** (phase 2, pas fondation) : fond ortho IGN en tuiles WMTS, sous licence Etalab avec attribution affichée.
- **Web Workers** : ombrage annuel et auto-layout hors du thread UI. Le worker reçoit une géométrie sérialisée, jamais des objets React.
- **Pas de WebAssembly, pas de moteur physique, pas de bibliothèque CAD** en fondation : rien ne le justifie encore.
- **Aucune géométrie en coordonnées WGS84 dans la scène** : origine locale du projet (ENU métrique) + géoréférence conservée à part.

## 3. Modèle de données (migration additive)

Tables : `solar_models`, `solar_model_versions`, `solar_buildings`, `solar_roof_planes`, `solar_obstacles`, `solar_zones`, `solar_arrays`, `solar_modules_placed`, `solar_module_catalog`, `solar_electrical_groups`, `solar_cable_routes`, `solar_measurements`, `solar_analysis_runs`, `solar_data_sources`, `solar_attachments`.

Règles communes : `company_id` + `study_id` + `model_id` sur chaque ligne, RLS calquée sur les études, GRANT explicites, `updated_at`, `schema_version` sur toute colonne JSONB (polygones, sommets), provenance obligatoire (`source`, `source_ref`, `source_date`, `verified_by`, `verified_at`).

Un modèle vit **au niveau du dossier**, pas de l'étude figée : la visite technique et le chantier réutilisent le même `model_id` via de nouvelles versions.

## 4. Architecture logicielle (modulaire, pas un gros composant)

```text
src/lib/solar/
  geo/          origine locale, ENU <-> WGS84, unités
  model/        types du jumeau, schéma JSON versionné, validation
  roof/         toitures paramétriques, pans, arêtes, recalcul
  layout/       grille, contraintes, auto-layout, scoring
  sun/          position solaire (déterministe, testée)
  shading/      lancer de rayons BVH, exécuté en worker
  production/   moteur de prévision, séparé du rendu
  providers/    IGN, PVGIS, catalogue modules (interfaces + adaptateurs)
  rules/        profils de contraintes configurables (jamais en dur)
src/lib/solar.functions.ts / solar.server.ts   accès données + droits
src/components/solar/   Scene, Toolbar, Inspector, Plan2D, viewmodes
src/workers/solar-shading.worker.ts
```

Le state d'édition est un store dédié (commandes + undo/redo), pas du `useState` dispersé. Chaque action est une commande sérialisable → autosave par deltas et historique gratuits.

## 5. Fournisseurs de données

Interface `GeoDataProvider` (ortho, cadastre, altimétrie) et `SolarResourceProvider` (irradiation). Adaptateurs : IGN Géoplateforme, PVGIS, plus tard drone/import. Appels **uniquement côté serveur** (cache, version d'API, date de source, repli), jamais depuis un composant. Attribution affichée. Aucun scraping.

## 6. Confiance et provenance

Niveaux de modèle : `pre_etude`, `lidar`, `terrain_verifie`, `drone`. Provenance par donnée : automatique, LiDAR, satellite, mesure manuelle, visite technique, drone, import, corrigé utilisateur. Jamais de précision chiffrée inventée ; la précision officielle d'une source est stockée telle quelle.

## 7. Risques techniques réellement identifiés

1. **Worker Cloudflare** : pas de traitement LiDAR/raster lourd possible. Le découpage LiDAR exigera soit un service externe, soit une simplification côté navigateur sur emprise réduite. À trancher en phase 2, pas maintenant.
2. **Poids du bundle** : Three.js + drei ≈ 600 Ko. Obligatoirement chargé en lazy sur la route Solar Studio uniquement.
3. **SSR** : toute fuite d'import WebGL dans une route SSR casse le rendu. Isolation stricte des modules.
4. **Coût de l'ombrage** : sans BVH ni échantillonnage adapté, une simulation annuelle bloque l'onglet. Deux niveaux de calcul : aperçu temps réel, analyse précise à la demande.
5. **Mobile 320 px** : édition CAD impossible ; mode consultation/terrain restreint, pas la même UI.
6. **Disponibilité IGN** : couverture LiDAR HD partielle en France. Le parcours doit fonctionner sans, dès la fondation.
7. **Régression** : le module Cahier des charges est en production. Migrations additives seulement, Solar Studio en route séparée.

## 8. Découpage en phases

**Phase 1 — Fondation (objet de la prochaine passe)**
Migration additive du socle (`solar_models`, versions, bâtiments, pans, obstacles, zones, arrays, modules placés, catalogue, sources) + RLS/GRANT. Route `ssr: false` `/cahiers-des-charges/$id/solar-studio` accessible depuis une section « Modélisation 3D » du cahier des charges PV. Scène R3F, repère local, sol, création du site depuis l'adresse géocodée. Toiture paramétrique (monopente, deux pans, quatre pans, terrasse) éditable par sommets. Obstacles paramétriques. Catalogue de modules réels. Placement manuel + grille sur un pan. Autosave par commandes, undo/redo, statut d'enregistrement. Retour de synthèse vers le cahier des charges (panneaux, kWc, surface, orientation, inclinaison, qualité du modèle).

**Phase 2 — Précision** : ortho IGN, cadastre, altimétrie, LiDAR, mesures, provenance et qualité.

**Phase 3 — Solaire** : position soleil, sliders heure/saison, ombrage BVH en worker, heatmap, PVGIS, moteur de production.

**Phase 4 — Optimisation** : auto-layout, variantes A–E, scoring explicable, comparateur.

**Phase 5 — Technique** : électrique, câblage, mode client, PDF enrichi, vérification terrain en visite technique.

**Phase 6 — Avancé** : imports drone/LiDAR, auto-détection assistée, analyse sous-module.

Chaque phase : tests unitaires des moteurs purs, contrôle d'isolation entreprise A/B, responsive 320 px, et rapport honnête des limites (testé / relu / non testé / bloqué).

## 9. Ce qui fonctionne dès la fondation, sans fournisseur

Géocodage BAN, saisie de toiture, obstacles, catalogue modules, implantation, kWc, surfaces, sauvegarde, undo/redo, synthèse dans le cahier des charges.

## 10. Ce qui nécessite un fournisseur ou un traitement supplémentaire

Ortho/cadastre/LiDAR IGN, irradiation PVGIS, production horaire, imports drone, auto-détection. Aucun de ces éléments ne sera simulé par une valeur inventée.

## 11. Non touché

Stripe, abonnements, PV, réserves, chantiers, sous-traitants, visites techniques existantes. Aucune création automatique de chantier.

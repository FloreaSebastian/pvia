# Solar Studio — Expérience carte Google + designer PV (rapport honnête)

Date : 2026-09-10

## Principe non négociable

Google fournit **l'image de repérage**. PVIA fournit **la géométrie et la mesure**.
Aucun contour, maillage ni cote n'est dérivé de l'imagerie Google : les sources techniques
restent LiDAR/IGN, relevé terrain, drone, import utilisateur ou modèle paramétrique PVIA.
La restriction est écrite dans `src/lib/solar/map/provider.ts` et affichée sous la carte.

## Livré

| Élément | Fichier |
| --- | --- |
| Abstraction fournisseur visuel, couches, attribution, clés, comptage d'usage | `src/lib/solar/map/provider.ts` |
| Superposition pure PVIA (pans, faîtages, obstacles, panneaux), accrochage, mesures | `src/lib/solar/map/overlay-model.ts` |
| Carte client-only, overlay canvas, modes, balayage, mesure, repère déplaçable | `src/components/solar/map/GoogleMapView.tsx` |
| Recherche d'adresse Places + disponibilité Street View (passerelle serveur) | `src/lib/solar-maps.functions.ts` |
| Panneau d'expérience carte (recherche, confirmation, réglages, vue double) | `src/components/solar/map/SiteMapCard.tsx` |
| Bascule Carte / Modèle 3D dans le studio | `src/routes/_authenticated/cahiers-des-charges.$id_.solar-studio.tsx` |
| Tests | `tests/unit/solar-map.test.ts` |

Points de conception :
- clé navigateur uniquement pour l'affichage ; Places et Street View passent par la passerelle serveur authentifiée et contrôlée par tenant ;
- aucun outil de dessin Google : sélection, accrochage et mesures sont calculés en mètres locaux PVIA ;
- comptage local des appels facturables (chargement carte, recherche, 3D, Street View) affiché à l'utilisateur ;
- vue double carte + plan 2D, opacité, mode contour et balayage Google ↔ modèle ;
- si la clé est absente, la carte affiche un état explicite au lieu d'un bouton cassé.

## TESTÉ AUTOMATIQUEMENT

- 222 tests / 664 assertions (`bun run test:unit`), dont 10 nouveaux sur projection au sol,
  faîtage/obstacle/panneau, accrochage coin/rive/hors tolérance, mesures distance et surface,
  refus des mesures incomplètes, et absence de « Google » comme source de géométrie.
- Typecheck complet sans erreur.

## VÉRIFIÉ PAR LECTURE

- Passerelle Google appelée uniquement côté serveur avec `LOVABLE_API_KEY` + `GOOGLE_MAPS_API_KEY` ;
  aucune clé serveur exposée au navigateur.
- Gardes tenant (`assertSolarMember`) sur les deux fonctions serveur cartographiques.
- Attribution et restriction de licence affichées sous la carte.

## NON TESTÉ / BLOQUÉ

- **BLOQUÉ** : rendu réel de la carte, Satellite/Hybride, inclinaison 3D, recherche Places et
  Street View — aucune session authentifiée disponible pour ouvrir Solar Studio.
- **NON TESTÉ** : coût réel des appels, comportement sur mobile/tablette physique,
  précision de l'accrochage à fort zoom, performance avec plusieurs centaines de panneaux.
- **LIMITE CONNUE — production** : la connexion Google Maps gérée par la plateforme n'autorise que
  les domaines `*.lovable.app`. Sur `pvia.fr`, `www.pvia.fr` et `app.pvia.fr`, la carte **ne se chargera pas**
  tant qu'une connexion avec une clé Google propre, autorisée pour ces domaines, n'aura pas été créée.
- La 3D photoréaliste est ici une vue satellite inclinée ; le rendu photoréaliste Google
  n'est pas activé et ne doit pas être présenté comme tel.

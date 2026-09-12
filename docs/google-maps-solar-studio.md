# Google Maps — configuration production Solar Studio

Date : 2026-09-10. Aucune clé complète n'apparaît dans ce document.

## 1. APIs réellement utilisées

| Usage PVIA | API Google | Appel |
| --- | --- | --- |
| Fond de carte, satellite, hybride, vue inclinée | Maps JavaScript API | navigateur, clé publique restreinte |
| Recherche d'adresse | Places API (New) — `places:searchText` | serveur, via passerelle Lovable |
| Disponibilité vue de rue | Street View Static — metadata | serveur, via passerelle Lovable |

Non utilisés : Photorealistic 3D Maps (`maps3d`), Drawing library, Geocoding
direct, Directions, Routes. La couche « Vue inclinée » est une vue satellite
avec `tilt: 45` — ce n'est pas de la 3D photoréaliste, et l'interface ne la
présente plus comme telle.

## 2. Séparation des clés

- **Clé navigateur** : servie à la demande aux utilisateurs authentifiés depuis
  le secret serveur `GOOGLE_API_KEY` (repli : `VITE_GOOGLE_MAPS_BROWSER_KEY`,
  puis `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY`). Publique par
  construction ; sa sécurité repose uniquement sur les restrictions Google.
- **Clé serveur** : utilisée par la passerelle Lovable pour Places et Street
  View. Jamais exposée au navigateur, jamais journalisée.
- **Style optionnel** : `VITE_GOOGLE_MAPS_MAP_ID` (aucun Map ID par défaut).

La connexion Google gérée par Lovable n'autorise que `*.lovable.app` et
`*.lovableproject.com`. Elle **ne fonctionne pas** sur `pvia.fr`, `www.pvia.fr`
ni `app.pvia.fr` : une clé PVIA dédiée est obligatoire en production.

## 3. Restrictions à appliquer à la clé navigateur

Referrers HTTP à autoriser, et rien d'autre :

```
https://pvia.fr/*
https://www.pvia.fr/*
https://app.pvia.fr/*
http://localhost:8080/*
```

Restrictions d'API : **Maps JavaScript API uniquement**. La clé navigateur ne
doit pas être autorisée pour Places, Geocoding ni Routes.

Quotas et surveillance recommandés côté Google Cloud : plafond quotidien par
API, alerte budget, alerte sur pic de requêtes.

## 4. Maîtrise des coûts côté application

- Chargement unique de l'API par session (`loaderPromise` module-level).
- Recherche d'adresse déclenchée uniquement par Entrée ou le bouton, minimum
  3 caractères, 6 résultats maximum, champs minimaux demandés.
- Les coordonnées viennent directement de Places : aucun géocodage supplémentaire.
- Compteur local par jour : chargements de carte, recherches, vue de rue,
  passages en vue inclinée, affiché sous la carte.

## 5. Dégradation et diagnostic

- Les erreurs Google (`RefererNotAllowedMapError`, `ApiNotActivatedMapError`,
  `InvalidKeyMapError`, quota, échec de script…) sont traduites en messages
  compréhensibles ; le refus de clé est capté par `gm_authFailure`.
- En cas d'échec, le message précise que le modèle technique PVIA reste
  utilisable ; les autres onglets ne sont jamais bloqués.
- Un bloc « Diagnostic cartographie » indique : présence de clé (masquée),
  origine de la clé, domaine courant et compatibilité, API chargée, style,
  3D photoréaliste (non utilisée), dernière erreur.

## 6. État de validation

CODE PRÊT / CONFIGURATION GOOGLE MANQUANTE / NON TESTÉ EN PRODUCTION

Aucune clé PVIA dédiée n'est configurée à ce jour : le chargement réel de la
carte sur `pvia.fr` n'a donc pas pu être vérifié.

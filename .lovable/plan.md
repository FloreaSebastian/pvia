# P2-A — Conception électrique (strings / MPPT / onduleurs)

## Audit préalable (constaté)
- Aucun catalogue onduleur / micro / hybride n'existe (ni table, ni code) : à créer.
- Données électriques panneau déjà présentes dans les variantes / révisions catalogue : `voc_v`, `vmp_v`, `isc_a`, `imp_a`, `temp_coeff_voc_pct_per_c`, `temp_coeff_isc_pct_per_c`, `temp_coeff_pmax_pct_per_c` (+ `tc_voc`/`tc_isc` sur une table legacy, unité à confirmer lors de l'implémentation — jamais convertie implicitement).
- Seul `geometry_version` protège l'implantation : aucun `layout_version` / `layout_hash`. Un déplacement de panneaux sans modification toiture n'est pas détectable → à ajouter.
- `solar_apply_layout` (5 arguments, SECURITY DEFINER, `can_manage_company`) reste l'unique RPC d'application ; il sera étendu, pas dupliqué.
- Étape « Électrique » actuellement marquée indisponible dans le rail.

## Découpage en 4 lots (validation complète après chaque lot)

### Lot 1 — Versioning d'implantation + schéma (migration additive)
- `solar_models` : ajout `layout_version int default 0`, `layout_hash text`.
- `solar_apply_layout` : recalcule atomiquement `layout_hash` (SQL déterministe sur arrays/modules/snapshots/règles/engine) et incrémente `layout_version` en fin de transaction réussie. Signature inchangée.
- Nouvelles tables (GRANT + RLS, lecture membres, écriture via RPC seulement) :
  - `solar_inverter_manufacturers`, `solar_inverter_variants` (type string/hybride/micro, phase, AC, MPPT, entrées/MPPT, Vdc max, plage MPPT, tension démarrage, courants MPPT/entrée, Isc max, DC max/ratio, entrées micro, provenance, datasheet — tout nullable sauf identité), `solar_inverter_revisions` (snapshot immuable).
  - `solar_electrical_designs` (snapshots onduleur + modules électriques + températures/source + geometry/layout version/hash + engine version + warnings + signature), `solar_electrical_strings`, `solar_electrical_assignments` (module → string/MPPT ou canal micro, unicité module par design).
  - RPC `solar_apply_electrical_design` : transaction unique, `can_manage_company`, abonnement utilisable, versions attendues, refus stale avec message exact.
- Catalogue initial : **vide**. Aucune fiche onduleur inventée ; ajout de références manuelles entreprise (provenance « manuel ») via l'UI. Si vous souhaitez des références constructeur pré-chargées, il faudra fournir les fiches techniques.

### Lot 2 — Moteur électrique pur (`src/lib/solar-electrical/`)
- Températures Tmin/Tmax + source obligatoires, aucun défaut silencieux.
- Calculs string/MPPT/onduleur (Voc froid, Vmp chaud, Isc/Imp, parallèles, ratio DC/AC, limites inclusives). Donnée absente ⇒ « Non vérifiable », jamais PASS.
- Auto-stringing déterministe (≤ 3 variantes : Recommandée / Câblage simple / Alternative), micro-onduleurs par canal réel, hybride traité comme string + badge.
- Signature + token couvrant layout/geometry hashes, révisions panneau/onduleur, températures, engine version.
- Tests obligatoires listés (Voc froid, Vmp chaud, MPPT inclusif, Vdc, courants, doublons, non-affectés, 2 orientations, micro 1/2 entrées, hybride, déterminisme, 1000 modules, stale, permissions).

### Lot 3 — Serveur
- `solar-electrical.functions.ts` : compute lecture seule, save rejouant le moteur côté serveur, refus signature inventée, stale, permissions, abonnement (`assertSubscriptionUsable`).
- CRUD référence onduleur manuelle entreprise (rôles manage).

### Lot 4 — UX + Résultats/PDF
- Déblocage de l'étape Électrique : choix onduleur, températures, « Proposer un câblage », variantes, tableau MPPT/strings, plan coloré par string/entrée micro + légende + sélection, aucune édition de position.
- Édition manuelle : réaffectation, créer/supprimer string vide, rééquilibrer, undo/redo local, recalcul immédiat, une seule sauvegarde, garde de sortie existante réutilisée.
- Résultats + PDF technique (détail strings) + PDF client (référence onduleur + AC).

## Limites assumées
- Pas de production kWh/an, irradiance, ombrage (P2-B), ni batterie, ni schéma unifilaire.
- Tests navigateur réels : NON TESTÉ s'il n'y a pas de session disponible ; aucune écriture sur données client.
- Rien n'est publié.

Je propose d'enchaîner les 4 lots dans cette passe, en m'arrêtant avec un rapport si un lot échoue à la validation.

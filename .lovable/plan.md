
# Calendrier Mobile V3 — Refonte façon Google Agenda

Refonte **uniquement mobile** (`<lg`) du fichier `src/routes/_authenticated/chantiers.calendrier.tsx`. Le desktop reste **inchangé**. Aucune migration SQL, aucune server function modifiée.

---

## 1. Cartes événements lisibles (mobile)

Nouveau rendu sur 3 lignes dans `TimeGridView` quand `isMobile` :

```text
🏗 Villa Dupont          ← chantier (line-clamp-1, font-semibold)
09h00 → 11h00            ← horaire (text-xs, tabular-nums)
Réception PV             ← type label (text-xs opacity-90)
```

- Priorité d'affichage : **chantier > type > heure** (fallback titre si pas de chantier).
- Pas de troncature à 1 caractère : on retire le titre court, on garde lignes 1/2/3 avec `line-clamp-1`.
- Hauteur minimum **70 px** sur mobile (idéal 80) — quel que soit la durée. Desktop garde l'ancien `minH`.

## 2. Palette métier centralisée

Nouvelle map `BUSINESS_COLORS` qui remplace l'usage actuel de `TYPE_TO_COLOR` aléatoire :

| Type                                 | Couleur | Hex      |
|--------------------------------------|---------|----------|
| `system_pv_created/signed`, `pv*`    | 🟦 Bleu  | #2563eb |
| `reception`                          | 🟩 Vert  | #10b981 |
| `intervention`, `pose`, `visite_technique`, `debut_travaux`, `livraison_materiel`, `controle_qualite` | 🟨 Jaune | #eab308 |
| `system_reserve_created/lifted`      | 🟧 Orange| #f97316 |
| `sav`                                | 🟥 Rouge | #ef4444 |
| `retard`                             | ⬛ Noir  | #1f2937 |
| `rappel`, `appel_client`, `remarque` | 🟪 Violet| #8b5cf6 |

`colorOf()` route vers cette palette quand `mode === "type"`. Le mode `chantier` (couleur perso) reste dispo via Filtres. La légende dans le panneau Filtres est mise à jour.

## 3. Chevauchements — règle « +N autres »

Dans `TimeGridView`, calcul du *clustering* déjà présent. Sur mobile, si un cluster contient **>2** events :

- Afficher les 2 premiers (par heure de début) plein format.
- Remplacer les autres par un seul bloc compact `+N autres` (même colonne, même hauteur cumulée).
- Tap → ouvre un **Bottom Sheet** listant tous les events du cluster (titre + horaire + type), chaque ligne tap → ouvre la fiche événement.

Desktop : comportement actuel conservé.

## 4. Vue Jour comme vue principale mobile

- **Auto-scroll** vers l'heure courante au montage de la vue Jour (mobile uniquement) — déjà partiellement présent, on s'assure que l'heure courante est centrée et qu'on scroll uniquement à l'ouverture, pas à chaque rerender.
- **Ligne rouge « now »** : composant `<NowLine />` (1 px `bg-red-500` + pastille 8 px à gauche), positionné via `topForTime(now)`. Refresh toutes les minutes.
- En vue Semaine/3j la ligne n'apparaît que dans la colonne d'aujourd'hui.

## 5. Vue 3 jours = J / J+1 / J+2

Déjà ajoutée en V2 mais ancrée sur le cursor. On confirme **J / J+1 / J+2** (anchor = `cursor`, pas `startOfWeek`). Pas de changement supplémentaire.

## 6. Colonnes plus aérées

- Retirer les bordures verticales internes mobile (`divide-x` → `divide-none lg:divide-x`).
- Quadrillage horizontal : 1 ligne par heure seulement (pas demi-heures sur mobile).
- Padding interne event card : `p-2` mobile (au lieu de `p-1`).

## 7. Header mobile compact

Une seule zone, hauteur réduite :

```text
[Jour|3j|Sem|Mois]   18 juin   < Aujourd'hui >
[🔍 Recherche…………………………………] [Filtres]
```

- `py-2` au lieu de `py-3`, suppression de la marge entre les deux lignes.
- Le bouton `+` reste dans le PageHeader (déjà fait en V2), pas de FAB concurrent du PV central.

## 8. Bottom Sheet « Fiche événement » mobile

Nouveau composant interne `EventBottomSheet` (basé sur `Sheet side="bottom"`).

Contenu :
- Titre + pastille couleur
- Type (label métier)
- Date + horaire
- Chantier (lien)
- Client (lien)
- Responsable
- Description
- Actions : **Modifier · Voir chantier · Voir client · Supprimer**

Sur mobile, tap event → ce sheet (au lieu du `Dialog` actuel). Desktop garde le Dialog.

## 9. Hors-scope (intentionnel)

- Pas de refonte desktop.
- Pas de virtualisation lourde.
- Pas de modification des appels backend (events shape inchangé).
- Pas de changement du module Réserves/Chantiers ailleurs (mais la palette `BUSINESS_COLORS` pourra être réutilisée plus tard — exportée par sécurité).

---

## Plan d'exécution (1 seul fichier modifié)

`src/routes/_authenticated/chantiers.calendrier.tsx` :

1. Ajouter `BUSINESS_COLORS` + nouveau `colorOf()`.
2. Ajouter `<NowLine />` + auto-scroll « once » sur vue Jour mobile.
3. Refactor render event card mobile (3 lignes + min-h 70).
4. Cluster overflow `+N autres` + sheet liste.
5. `EventBottomSheet` + branchement tap mobile.
6. Compact header + nettoyage bordures mobile.

TypeScript strict. Pas de nouveau package.

---

**Estimation impact** : ~250 lignes ajoutées / ~120 modifiées dans un seul fichier. Aucun risque backend. Desktop pixel-identique.

Veux-tu que je lance l'implémentation telle quelle, ou ajuster un point (palette, hauteur min, BottomSheet vs Dialog plein écran) avant ?

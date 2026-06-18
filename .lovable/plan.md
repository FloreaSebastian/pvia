## Calendrier Mobile V2 — Plan

Scope: refonte UX mobile du calendrier (`src/routes/_authenticated/chantiers.calendrier.tsx`, 2357 lignes) sans casser le desktop. Les changements sont presque tous présentation/UX ; pas de modif backend.

### 1. Vues disponibles
- Retirer "5 jours" du sélecteur (UI + persistance).
- Ajouter une vraie vue **3 jours** (`view: "week"`, `weekDays: 3`, ancré sur la date courante : `cursor → cursor+2`, pas un `startOfWeek`).
- Liste finale : Jour · 3 jours · Semaine · Mois (+ Équipe / Personnalisé restent desktop).
- Persistance `pvia.cal.defaultView` : `day | week3 | week | month`. Migration des anciennes valeurs (`week5` → `week`).
- Fallback : mobile = `day`, desktop = `month` (déjà en place).

### 2. Comportement tactile des événements (mobile)
- Sur mobile (`useIsMobile`), désactiver `draggable` natif HTML5.
- Nouveau handler : `onPointerDown` démarre un timer 700 ms. Si le doigt bouge avant → annule (= tap). Si le timer expire :
  - active mode "drag" (state local `mobileDragId`), vibration `navigator.vibrate?.(20)`, classe visuelle (ring + scale + opacity).
  - le déplacement utilise pointermove/up sur le conteneur jour : on capture le drop sur la colonne survolée (réutilise le même `applyMove` que le drag desktop).
- `onClick` (tap court) → ouvre Bottom Sheet détails.
- Desktop : on garde HTML5 drag & drop existant inchangé.

### 3. Bottom Sheet détails événement
- Nouveau composant interne `EventBottomSheet` (basé `Sheet side="bottom"` déjà importé) :
  - Titre, type (badge couleur), date, heure début/fin, chantier, client, responsable, description.
  - Actions : Modifier (ouvre le dialog existant), Voir chantier (`/chantiers/$id`), Voir client (`/clients?...`), Supprimer (si `canWrite`).
- Sur desktop, comportement clic actuel inchangé (popover / dialog existant). Sur mobile, le tap déclenche le sheet.

### 4. Chevauchements
- Dans le rendu jour/semaine/3-jours : grouper les événements qui se chevauchent par colonne de jour (algorithme simple : tri par début, regrouper si `start < prevEnd`).
- Si un cluster dépasse 2 visibles : afficher les 2 premiers + bloc `+N autres` cliquable → ouvre une liste (Bottom Sheet sur mobile, popover sur desktop) qui liste tous les événements du cluster ; tap → ouvre le Bottom Sheet détail.

### 5. Cartes événements lisibles
- `min-h-[48px]` mobile, padding 8px, line-height resserrée.
- Layout : pastille couleur 4px à gauche, heure (text-xs), titre tronqué sur 2 lignes (`line-clamp-2`).
- Ne jamais tronquer à 1 caractère : retirer toute logique qui force `truncate` à largeur 0 ; garantir min-width contenu.

### 6. Légende couleurs
- Dans le panneau Filtres : ajouter section "Légende" listant les types (PV, Intervention, SAV, Réserve bloquante, Réception) avec leur couleur. Source : mapping existant `EVENT_TYPE_COLORS` (vérifier nom réel et compléter au besoin).

### 7. Bouton flottant
- Retirer le FAB `+` mobile du calendrier. Remplacer par un bouton icône discret dans le header (à côté du bouton Filtres). Le bouton central "Nouveau PV" de BottomNav reste seul gros bouton.

### 8. Barre d'outils mobile
- Ordre imposé sur `lg:hidden` : (1) sélecteur Vue, (2) date courante, (3) bloc `<` Aujourd'hui `>`, (4) recherche, (5) Filtres.
- Le sélecteur Vue mobile devient un segmented control 4 options : Jour | 3j | Sem | Mois.

### 9. Filtres mobile
- Tout dans un Sheet repliable (déjà existant) : type, chantier, client, responsable, statut, "couleur type/chantier", légende.
- Aucune option avancée hors du sheet sur mobile.

### 10. Responsive & perf
- Tester via Playwright à 360 / 390 / 430 px : pas d'overflow horizontal, pas de double scroll.
- `useMemo` sur clusters par jour ; `React.memo` sur la carte événement ; éviter recalculs sur drag.

### Détails techniques
- Fichier principal : `src/routes/_authenticated/chantiers.calendrier.tsx`. Pas de nouveau fichier route ; sous-composants extraits en haut du fichier (ou dans `src/components/calendar/` si trop long).
- Hook : `useIsMobile()` (`src/hooks/use-mobile.tsx`).
- UI : `Sheet` (déjà importé) pour Bottom Sheet, `Button`, `Badge`, `cn`.
- Pas de migration SQL, pas de changement aux server functions.

### Tests Playwright
Scénarios couverts post-refactor : tap = ouverture, appui long 700 ms = drag, création via header, recherche, filtres, vues Jour/3j/Sem/Mois, navigation vers chantier/client. Captures à 360/390/430.

### Hors scope
- Pas de modification des events backend ni des permissions.
- Pas de refonte desktop : on conserve l'expérience actuelle ≥ `lg`.
- Pas de virtualisation lourde (à n'introduire que si le profilage l'exige).

## Objectif

Remplacer la navigation vers `/pv/:id/levee-reserves` par une **popup workflow** (Dialog desktop / Sheet bottom mobile) ouverte depuis les boutons "Lever" / "Préparer la levée" sur la fiche PV et la page Réserves. La page existante reste accessible en fallback.

## Architecture

**Nouveau composant :** `src/components/pv/ReserveLiftWorkflowDialog.tsx`
- Dialog responsive (Dialog desktop, Sheet `side="bottom"` sur mobile via `useIsMobile`)
- Stepper horizontal compact, navigation Précédent/Suivant
- Réutilise la logique GPS/EXIF/`tryGetGps`/`readExif`/`sanitizeExifForUpload` (extraite dans `src/lib/photo-exif.ts` pour partage avec la page existante)
- Réutilise `createReserveLift` server fn (aucun changement backend nécessaire — tout est déjà en place)

**Props :**
```ts
{ open: boolean; onOpenChange: (o:boolean)=>void;
  pvId: string; pvNumero: string;
  reserves: Reserve[];           // ouvertes/en_cours/rejetée
  preselectedReserveId?: string;
  chantierLabel?: string; clientLabel?: string;
  onCompleted?: (reportId: string) => void }
```

## Étapes du stepper

1. **Réserves** — sélection (préselection si `preselectedReserveId`), affiche desc/sévérité/statut
2. **Photos AVANT** — par réserve sélectionnée, upload + capture mobile (`capture="environment"`), preview, badge GPS/Non géoloc.
3. **Intervention** — Textarea "Travaux réalisés" par réserve (**obligatoire**)
4. **Photos APRÈS** — même UI que step 2
5. **Signature intervenant** — nom + signature tactile (obligatoires par défaut, toggle "Inclure")
6. **Signature entreprise** — signature tactile (obligatoire)
7. **Résumé & envoi** — récap + bouton "Finaliser et envoyer au client"

Bouton "Suivant" désactivé tant que les validations d'étape ne passent pas, avec message inline.

## Validations bloquantes (finalisation)

Par réserve sélectionnée :
- ≥ 1 photo AVANT
- ≥ 1 photo APRÈS
- commentaire intervention non vide

Global :
- nom intervenant + signature intervenant non vides
- signature entreprise non vide

Tous les messages d'erreur via `toast.error` clair + bandeau dans la popup.

## Intégration

**`src/routes/_authenticated/pv.$id.tsx`** :
- État `liftDialogOpen` + `preselectedReserveId`
- Remplacer `<Link to="/pv/$id/levee-reserves">` par `<Button onClick={() => openDialog()}>` pour :
  - bouton "Préparer la levée" (l.737)
  - bouton "Lever" par réserve (l.798) → set `preselectedReserveId`
- Garde clauses + toasts : "Aucune réserve ouverte à lever.", "Cette réserve est déjà validée.", "Cette réserve est en attente de validation.", "Droits insuffisants." (via `canSignAsCompany`)
- Après `onCompleted` → `router.invalidate()` pour rafraîchir le statut

**`src/routes/_authenticated/reserves.tsx`** (l.458) :
- Idem : remplacer Link par bouton ouvrant la popup (charger PV à la volée, ou naviguer vers fiche PV avec `?openLift=<reserveId>` puis auto-open)

## Sécurité rôles

Le bouton est masqué/désactivé selon `canSignAsCompany(role)` (déjà importé via `@/lib/roles`). Toast "Droits insuffisants." si tentative. La server fn `createReserveLift` reste l'autorité (aucune mutation directe browser).

## Compatibilité

- Page `/pv/:id/levee-reserves` conservée intacte (fallback, multi-réserves batch)
- Refactor minimal : extraire helpers EXIF dans `src/lib/photo-exif.ts` et les ré-utiliser depuis la page existante

## Fichiers

**Créés :**
- `src/components/pv/ReserveLiftWorkflowDialog.tsx` (~500 lignes)
- `src/lib/photo-exif.ts` (helpers GPS/EXIF extraits)

**Modifiés :**
- `src/routes/_authenticated/pv.$id.tsx` (boutons → popup)
- `src/routes/_authenticated/reserves.tsx` (bouton "Lever" → navigue avec auto-open)
- `src/routes/_authenticated/pv.$id.levee-reserves.tsx` (import depuis photo-exif.ts)

## Hors scope (déjà en place)

- `createReserveLift` (génération report + items + photos + PDFs + email client) ✅
- Email client validation ✅
- Signature client espace client ✅
- Cascade rejet client → status `rejetee` (trigger DB) ✅
- PDF client/interne ✅

Aucune migration SQL nécessaire.
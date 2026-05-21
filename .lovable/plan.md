# Mode terrain mobile PVIA

Objectif : permettre à un technicien de créer un PV complet depuis son téléphone, avec photos caméra, réserves, signature client, brouillon auto et mode offline simple.

## 1. Base de données

Migration SQL :

- `pv` : ajout colonnes
  - `is_field_draft boolean default false` (marque les brouillons terrain)
  - `latitude double precision`
  - `longitude double precision`
  - `field_last_saved_at timestamptz` (heartbeat brouillon auto)
- `pv_photos` : ajout colonne
  - `kind text default 'autre'` (avant / apres / reserve / autre)
- RLS : les policies actuelles `is_company_member` / `can_manage_company` couvrent déjà CRUD ; pas de changement. La règle "user ne peut pas supprimer" est déjà gérée par `pv_delete = can_manage_company` (owner/admin/manager).
- Storage : bucket `pv-assets` déjà présent, on stocke sous `{company_id}/pv/{pvId}/field/{uuid}.jpg`.

## 2. Server functions (`src/lib/field.functions.ts`)

Toutes protégées par `requireSupabaseAuth` + vérification `is_company_member`.

- `createFieldDraft({ chantierId?, clientId? })` → crée un PV `status='brouillon'`, `is_field_draft=true`, numéro auto `PV-TERRAIN-{yyyymmdd}-{n}`, retourne l'id.
- `saveFieldDraft({ pvId, patch })` → update partiel (description, observations, lat/lng, reception_date), met à jour `field_last_saved_at`. Appelé par autosave 5s.
- `addFieldPhoto({ pvId, dataUrl, kind, caption })` → décode base64, upload Storage, insert `pv_photos`.
- `addFieldReserve({ pvId, description, severity })` → insert `pv_reserves` (status='ouverte').
- `signFieldPv({ pvId, companySignature, clientSignature, clientName })` → set signatures, `status='signe'`, `signed_at=now()`, déclenche `buildAndStorePvPdf` (réutilise pdf.server).
- `listFieldDrafts()` → liste des brouillons terrain de la company.

## 3. Frontend — routes

- `src/routes/_authenticated/terrain.tsx` — accueil mode terrain
  - Header sticky compact, bouton plein-écran "Créer un PV terrain"
  - Liste des brouillons en cours (reprise)
  - Liste "Synchronisations en attente" (lue depuis IndexedDB)
  - Badge "Hors ligne" si `!navigator.onLine`

- `src/routes/_authenticated/terrain.$id.tsx` — éditeur terrain stepper
  - Étapes : Infos → Photos → Réserves → Signatures → Récap
  - Navigation en bas (gros boutons Précédent/Suivant), fab "Sauver"
  - Autosave 5s via `saveFieldDraft`
  - Bouton "Position chantier" → `navigator.geolocation.getCurrentPosition`, non bloquant

## 4. Frontend — composants `src/components/field/`

- `FieldShell.tsx` — layout mobile-first, status bar (online/offline, dernier save), bouton retour.
- `FieldStepper.tsx` — indicateur d'étape simple (1/5 …).
- `FieldPhotoCapture.tsx` — `<input type="file" accept="image/*" capture="environment">`, compression via canvas (max 1600px, qualité 0.75), preview, sélection `kind`, caption, upload via `addFieldPhoto`. Fallback offline → push en queue IndexedDB.
- `FieldReserveQuickAdd.tsx` — textarea + sélecteur sévérité + bouton "Dictée" (`webkitSpeechRecognition` si dispo, sinon caché).
- `FieldSignaturePad.tsx` — wrapper `react-signature-canvas` plein écran (rotation paysage suggérée), boutons Effacer / Valider, deux pads (entreprise + client) + champ nom client.

## 5. Offline simple (`src/lib/field-offline.ts`)

Mini-wrapper IndexedDB (sans dep, via `idb-keyval` style maison) :
- Stores : `field_queue` (mutations en attente : photo / reserve / save).
- `enqueue(op)` quand la server fn échoue (offline détecté).
- `flushQueue()` rejoue tout quand `window.online` repasse vrai.
- Hook `useOfflineQueue()` → expose `count`, `isOnline`, déclenche flush automatique.

Le brouillon PV lui-même reste serveur (besoin d'un id). Si offline au démarrage, on bloque la création et on affiche "Connecte-toi pour créer un brouillon, puis tu pourras continuer hors ligne". Les photos/réserves ajoutées ensuite sont mises en queue.

## 6. Sidebar

`src/components/app/AppLayout.tsx` :
- Ajouter dans `mainNav` une entrée "Mode terrain" → `/terrain` (icône `Smartphone`).
- Sous "Mode terrain" (ou dans la page terrain elle-même) : liens "Brouillons terrain" et badge "Synchronisations en attente" (compteur live).

## 7. Sécurité

- Toutes les server fn vérifient `is_company_member(company_id, userId)` avant écriture.
- `signFieldPv` : seul owner du brouillon ou `can_manage_company` peut signer (cohérent avec RLS `pv_update`).
- Suppression : pas de `deleteFieldDraft` exposée au rôle `user` (UI cache le bouton si rôle = user, RLS bloque côté DB).
- `latitude/longitude` : enregistrés seulement si l'utilisateur clique le bouton.

## 8. Détails techniques

```text
src/
  lib/
    field.functions.ts      (server fns)
    field-offline.ts        (IndexedDB queue)
  hooks/
    use-online-status.tsx
    use-field-autosave.tsx
  components/
    field/
      FieldShell.tsx
      FieldStepper.tsx
      FieldPhotoCapture.tsx
      FieldReserveQuickAdd.tsx
      FieldSignaturePad.tsx
  routes/_authenticated/
    terrain.tsx
    terrain.$id.tsx
```

Migration : `supabase/migrations/<ts>_field_mode.sql`.

## 9. Ce qui sera réellement fonctionnel

- Capture photo native (iOS Safari + Android Chrome via `capture="environment"`).
- Compression côté client.
- Upload Storage + insertion `pv_photos`.
- Réserves rapides + sévérité.
- Signature tactile entreprise + client.
- PDF final auto-régénéré (via `buildAndStorePvPdf` existant).
- Autosave 5s.
- Géoloc optionnelle non bloquante.
- Détection online/offline + queue IndexedDB pour photos/réserves/saves.

## 10. Limites / partiel

- Dictée vocale : seulement navigateurs supportant `webkitSpeechRecognition` (Chrome Android, Safari iOS 14.5+). Masqué sinon.
- Création initiale d'un brouillon nécessite la connexion (besoin d'un PV id côté serveur).
- Pas de conflict resolution avancée si plusieurs onglets éditent le même brouillon.
- iOS Safari : `capture` ouvre la caméra mais peut proposer la galerie ; comportement natif normal.
- PDF régénéré seulement à la signature (pas à chaque autosave).

## 11. Test

1. Ouvrir `/terrain` sur mobile (ou DevTools mode mobile).
2. "Créer un PV terrain" → entre dans `/terrain/{id}`.
3. Prendre 2-3 photos (avant/après), ajouter une réserve, signer.
4. Couper le réseau (DevTools offline), ajouter une photo → doit apparaître dans "Sync en attente".
5. Réactiver le réseau → la queue se vide automatiquement.
6. Le PV signé apparaît dans `/pv` avec PDF téléchargeable.

# Workflow signature PVIA — distance vs sur place

C'est un chantier important (DB + server + UI + emails + audit). Voici le plan que je propose avant de toucher au code.

## 1. Migration DB

Nouvelles colonnes sur `pv` :
- `signature_mode` text check in ('remote','onsite'), nullable jusqu'à choix
- `client_identity_verified_at` timestamptz
- `client_identity_verified_by` text ('email'|'sms')
- `client_identity_email` text
- `client_identity_phone` text
- `client_otp_verified` boolean default false
- `locked_at` timestamptz (set quand status='signe')

Nouveau statut autorisé : `en_attente_signature_client` (déjà utilisé partiellement comme `en_attente`, on garde un alias).

Nouvelle table `pv_onsite_otp` :
- id, pv_id, email, code_hash, expires_at (10 min), attempts (max 5), used_at, created_at, ip, ua
- RLS : membre de la company du PV peut insert/select

Sur `company_settings` :
- `pv_email_recipients` text[] (CC additionnels)
- `pv_email_cc` text[] (alias bcc)
- `send_signed_pv_to_company` boolean default true
- `company_signed_email` text (email principal pour copies)

Trigger : si `status` passe à 'signe' → set `locked_at = now()`.

## 2. Server functions (src/lib/)

**Nouveaux (`sign-onsite.functions.ts`)**
- `sendOnsiteClientOtp({ pvId, email })` — génère OTP, hash, insert, email
- `verifyOnsiteClientOtp({ pvId, code })` — vérifie, marque `client_otp_verified=true`, `client_identity_verified_*`
- `finalizeOnsiteSignedPv({ pvId, companySignature, clientSignature })` — exige otp_verified, signature_mode='onsite', set status='signe', génère PDF, envoie emails

**Modifs (`sign.functions.ts`)**
- `sendPvToClient` (distance) : exige `signature_mode='remote'` et `company_signature` présente, set status='en_attente_signature_client'
- `signPvByToken` : déjà OK, mais ajoute envoi email entreprise + CC après signature

**Modifs (`pv-create.functions.ts`)**
- Accepter `signature_mode` à la création
- Si onsite + status='signe' demandé → exiger `client_otp_verified=true` (vérifier en DB)

**Nouveaux helpers**
- `lockSignedPv` (interne) appelée par triggers/handlers
- `resendSignedPvEmail({ pvId })` — réenvoie PDF signé
- Guard partagé `assertNotLocked(pv)` → throw `PV_LOCKED_SIGNED` dans toutes les fns update/delete (update/delete pv, photos, reserves)

**`email.server.ts`**
- `deliverSignedPv` existe — étendre pour inclure CC depuis `company_settings.pv_email_cc` et copie entreprise
- Nouveau template `renderOnsiteOtpEmail`

## 3. UI

**`/pv/new`**
- Étape Signatures : RadioGroup "Mode de signature" (distance / sur place) — obligatoire avant les pads
- Mode distance : pad entreprise uniquement + champ email client + bouton "Envoyer pour signature"
- Mode sur place : pad entreprise + pad client + bloc OTP (envoyer code, saisir, valider) + badge "Client confirmé ✓"
- Bouton "Valider & signer" actif seulement si :
  - distance : signature entreprise + email
  - sur place : 2 signatures + OTP verifié

**`/pv/$id`**
- Si `status='signe'` → badge "PV signé — verrouillé", masquer boutons supprimer/modifier
- Bouton "Renvoyer PDF signé" appelle `resendSignedPvEmail`

**`/parametres/notifications`**
- Section "Envoi automatique des PV signés"
  - email principal entreprise
  - emails en copie (multi)
  - toggle copie entreprise

## 4. Audit & notifications

Actions audit ajoutées (déjà partiellement en place) :
- pv.signature_mode_selected, pv.remote_signature_sent, pv.onsite_otp_sent, pv.onsite_otp_verified, pv.signed_locked, pv.signed_email_sent, pv.signed_email_resent, pv.delete_blocked_signed

Notifications push existantes étendues (déjà en place pour signe/sent).

## 5. Tests manuels

Workflow distance complet, workflow sur place complet, tentative delete PV signé → erreur, tentative update PV signé → erreur, brouillon reste modifiable.

---

## ⚠️ Avant de partir

C'est ~10-15 fichiers modifiés/créés + 1 migration DB + 1 nouvelle table. Quelques décisions à confirmer :

**Q1 — Statut intermédiaire** : tu as déjà `en_attente` dans le code (utilisé par `sendPvToClient`). Je propose de **réutiliser `en_attente`** comme alias de `en_attente_signature_client` plutôt que d'ajouter un nouveau statut (évite migration de données). OK ?

**Q2 — OTP onsite sur le même appareil** : le client saisit son email sur l'appareil de l'entreprise, reçoit un code par mail, le saisit. Tu confirmes que l'email client est obligatoirement collecté à cette étape (même si pas de `client_id` rattaché) ?

**Q3 — Verrouillage** : "impossible de modifier les champs principaux" — je verrouille **toutes** les mutations sur pv/photos/reserves quand status='signe', sauf création de levée de réserves. OK ?

**Q4 — Paramètres notifications** : tu préfères que je mette la section "Envoi PV signés" dans `/parametres/notifications` (existant) ou `/parametres/branding` ? Je propose **notifications**.

Dis-moi go ou ajuste, et j'enchaîne en une passe.
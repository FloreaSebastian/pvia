# Espace client PVIA — Magic code (passwordless)

Système d'authentification dédié aux **clients** (destinataires des PV), **totalement séparé** du système `auth.users` Supabase (qui reste réservé aux pros BTP). Les clients existent déjà dans la table `clients` — on s'appuie dessus.

## 1. Schéma base de données

Deux nouvelles tables côté Supabase, **verrouillées par RLS deny-all** (uniquement le service role y accède, jamais le client browser).

```text
client_auth_codes
  id uuid pk
  client_id uuid  -- FK logique vers clients.id (NULL si email orphelin)
  email text       -- normalisé lowercase
  code_hash text   -- SHA-256(code + id), jamais le code en clair
  expires_at timestamptz   -- now() + 10 min
  attempts int default 0   -- incrémenté à chaque verify raté (max 5)
  used_at timestamptz      -- NULL tant que non consommé
  created_at timestamptz
  ip_address text
  user_agent text
  index (email, created_at desc)

client_sessions
  id uuid pk
  token_hash text unique   -- SHA-256(token), token jamais stocké en clair
  client_id uuid           -- nullable si email sans match clients
  email text
  expires_at timestamptz   -- now() + 30 jours (sliding)
  created_at timestamptz
  last_seen_at timestamptz
  revoked_at timestamptz   -- logout / révocation
  ip_address text
  user_agent text
  index (token_hash), index (client_id, revoked_at)
```

RLS : `ENABLE ROW LEVEL SECURITY` + **aucune policy** → toute lecture/écriture depuis le navigateur (anon ou authenticated) est refusée. Seules les server functions, via `supabaseAdmin` (service role), y accèdent.

Cron `pg_cron` quotidien : purge `client_auth_codes` > 24 h et `client_sessions` expirées > 7 jours.

## 2. Server functions (`src/lib/client-auth.functions.ts`)

Toutes en `createServerFn`, jamais accessibles côté browser autrement que via RPC.

- **`sendClientLoginCode({ email })`**
  - Normalise email, valide format (Zod).
  - Rate-limit : `rate-limit.server` → 3 codes / 15 min par email + 10 / heure par IP.
  - Invalide tous les codes non utilisés du même email.
  - Génère code aléatoire 6 chiffres via `crypto.getRandomValues`.
  - Hash : `sha256(code + row.id)`.
  - Insert ligne avec IP + UA depuis `getRequest()`.
  - Envoie email via `email.server.ts` (Resend) — template premium dédié.
  - Audit log : `client.login_code_sent` (table `audit_logs`, sans pv_id).
  - **Retour neutre** : `{ ok: true }` même si email inconnu (anti-enumeration).

- **`verifyClientLoginCode({ email, code })`**
  - Rate-limit : 10 verify / 10 min par IP.
  - Cherche dernier code valide (non `used_at`, `expires_at > now()`, `attempts < 5`).
  - Si pas trouvé → audit `client.login_failed` + erreur générique.
  - Compare `sha256(code + row.id)` (timing-safe).
  - Si KO → `attempts++`, audit `client.login_failed`, erreur.
  - Si OK :
    - `used_at = now()`.
    - Cherche `client_id` par email dans `clients` (lowercase match).
    - Crée `client_sessions` row : token = 32 bytes `crypto.randomUUID` × 2 base64url, stocké hashé.
    - Set cookie via `setResponseHeader('set-cookie', …)` :
      `pvia_client_session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`.
    - Audit `client.login_success`.
    - Retour `{ ok: true, hasClient: !!client_id }`.

- **`getClientSession()`**
  - Lit cookie `pvia_client_session` depuis `getRequestHeader('cookie')`.
  - Hash → lookup `client_sessions` non révoquée, non expirée.
  - Update `last_seen_at`.
  - Retour `{ email, clientId, companyId | null }` ou `null`.

- **`logoutClientSession()`**
  - Marque `revoked_at = now()`.
  - Set cookie expiré (`Max-Age=0`).
  - Audit `client.logout`.

- **`getClientPvList()`, `getClientPvDetail({ id })`, `getClientPdfUrl({ id })`** :
  - Reposent sur `getClientSession()` → 401 si null.
  - Filtre strict : `pv.client_id = session.clientId` (ou `pv.sent_to_email = session.email` si pas de client_id, pour les emails orphelins).
  - PDF : génère signed URL Supabase Storage à courte durée (15 min) via `supabaseAdmin`.

## 3. Routes UI (TanStack Start)

```text
/client/login        → src/routes/client.login.tsx       (publique)
/client/verify       → src/routes/client.verify.tsx      (publique, lit ?email=)
/client/dashboard    → src/routes/client.dashboard.tsx   (gated via getClientSession loader)
/client/pv/$id       → src/routes/client.pv.$id.tsx      (gated, signature inline)
```

Pas sous `_authenticated/` (qui est pour les pros). Gating via redirect dans le loader :
```ts
loader: async () => {
  const s = await getClientSession();
  if (!s) throw redirect({ to: '/client/login' });
  return s;
}
```

**UI premium** :
- `client.login.tsx` : champ email seul, gros bouton, branding PVIA, message rassurant ("aucun mot de passe, vous recevrez un code par email").
- `client.verify.tsx` : utilise `<InputOTP>` (shadcn — déjà installé), auto-focus, auto-submit dès 6 chiffres, timer "renvoyer le code" (60 s), animation succès, gestion 5 tentatives.
- `client.dashboard.tsx` : liste PV (status badge), bouton télécharger PDF, lien "signer" pour les PV en attente, header avec email + logout.
- Tout en motion.dev fade-in, responsive mobile-first, palette existante.

## 4. Email Resend

Template HTML inline dans `email.server.ts` (méthode `sendClientLoginCodeEmail`) :
- Sujet : `Votre code de connexion PVIA`.
- Code en très grand (48 px, mono, spacing).
- Mention "valide 10 minutes".
- Ligne discrète : "Connexion depuis IP `1.2.3.4` · Chrome sur macOS".
- Bouton CTA "Se connecter" → lien `https://pvia.fr/client/verify?email=...`.
- Footer "Si vous n'avez pas demandé ce code, ignorez cet email".
- Background blanc, accent `#1e40af` cohérent.

## 5. Sécurité — récap

- Codes **jamais stockés en clair** (SHA-256 + id comme sel).
- Tokens session **jamais stockés en clair** (SHA-256).
- Cookie `HttpOnly + Secure + SameSite=Lax` — non lisible par JS, donc immunisé XSS sur ce vecteur.
- Rate-limit envoi (3/15min/email, 10/h/IP) + verify (10/10min/IP).
- Max 5 tentatives par code → invalidation auto.
- Invalidation des codes précédents à chaque nouveau `sendClientLoginCode`.
- Réponse neutre côté send (anti email enumeration).
- Audit logs détaillés (4 événements).
- RLS deny-all sur les 2 tables (aucun accès direct browser).
- Isolation stricte : queries scoped par `clientId`/`email`, jamais par paramètre client.
- CSP existant déjà compatible (pas de domaine externe ajouté).

## 6. Limitations assumées

- **Pas de WebAuthn / passkeys** — magic code suffisant pour ce use-case.
- **Pas de "remember this device"** explicite — la session 30 j fait office.
- **Pas de SSO inter-entreprises** : un client avec le même email dans 2 entreprises voit les PV des 2 (logique métier : c'est le même destinataire physique).
- **Email orphelin** (pas de ligne `clients` matchant) : on accepte la connexion mais le dashboard sera vide tant qu'aucun PV n'est `sent_to_email = X`.
- **Rate-limit** reste ad-hoc table-based (cf. contrainte stack).

## 7. Tests bout en bout

1. `/client/login` → saisir email d'un client existant → "Code envoyé".
2. Vérifier email Resend reçu avec code 6 chiffres.
3. `/client/verify?email=…` → coller le code → redirection auto `/client/dashboard`.
4. Dashboard liste les PV où `client_id` matche.
5. Cliquer "Télécharger PDF" → signed URL 15 min.
6. Cliquer "Signer" → flux signature existant en mode authentifié client.
7. Logout → cookie effacé, retour `/client/login`.
8. Retenter avec un mauvais code 5× → message "code invalidé, redemandez-en un".
9. Spam send code → 4ème en 15 min refusé (429).
10. Tester depuis 2 devices simultanément → 2 sessions actives, logout d'une seule n'affecte pas l'autre.

## 8. Fichiers à créer / modifier

```text
supabase migration         → 2 tables + cron purge + RLS deny-all
src/lib/client-auth.server.ts        → helpers (hash, cookie parse, IP)
src/lib/client-auth.functions.ts     → 4 server fns auth + 3 fns data
src/lib/email.server.ts              → +sendClientLoginCodeEmail
src/routes/client.login.tsx
src/routes/client.verify.tsx
src/routes/client.dashboard.tsx
src/routes/client.pv.$id.tsx
src/components/client/ClientShell.tsx  (header + logout)
```

Aucune modif aux routes pros existantes, aucun impact sur le système auth Supabase.

**OK pour partir là-dessus ?** Une fois validé j'implémente tout d'un trait (migration → server fns → email → routes → tests).
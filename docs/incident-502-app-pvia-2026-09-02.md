# PVIA — Incident P0 « 502 app.pvia.fr » + audit pages publiques (02/09/2026)

## 1. Incident P0 — https://app.pvia.fr renvoie 502

### Cause exacte

**Le sous-domaine `app.pvia.fr` n'existe pas.** Ce n'est ni un bug de build, ni un
problème de port, de variable d'environnement ou de proxy applicatif.

Preuves runtime (02/09/2026, depuis l'extérieur) :

```
dns.google/resolve  app.pvia.fr  A      -> Status 3 (NXDOMAIN)
dns.google/resolve  app.pvia.fr  CNAME  -> Status 3 (NXDOMAIN)
Autorité SOA renvoyée : ns01.one.com (zone pvia.fr hébergée chez one.com)
curl https://app.pvia.fr/  -> curl (6) Could not resolve host
curl http://app.pvia.fr/   -> curl (6) Could not resolve host

Même NXDOMAIN pour un sous-domaine aléatoire (zzz-nope.pvia.fr)
=> aucun wildcard DNS sur la zone.
```

Domaines réellement rattachés au projet :

```
pvia.fr      status=active  tier=connected  primary=true   (depuis 104 j)
www.pvia.fr  status=active  tier=connected                 (depuis 104 j)
project_published = true
```

Le message « 502 Bad Gateway — [Errno 111] Connection refused » observé côté
utilisateur n'est donc pas émis par l'application PVIA : il provient d'un
intermédiaire côté client (résolveur/proxy d'entreprise, VPN, ou page de
redirection du registrar) qui tente de joindre un backend inexistant. Aucune
requête n'atteint jamais l'infrastructure PVIA.

### Correction appliquée côté code

- `src/components/landing/mockups.tsx` : la barre d'URL de la maquette produit
  affichait `app.pvia.fr`, seul endroit du code qui suggérait ce domaine. Remplacé
  par `pvia.fr`. Aucun CTA, aucun email transactionnel, aucune redirection ni
  aucune variable d'environnement ne pointe vers `app.pvia.fr`
  (`rg "app\.pvia\.fr"` → 1 occurrence, corrigée).

### Ce qui reste à faire par le propriétaire (hors périmètre technique)

Deux options, au choix :

1. **Abandonner `app.pvia.fr`** : rien à faire, `https://pvia.fr` est le domaine
   canonique et fonctionne. C'est l'option recommandée puisque l'application et le
   site marketing partagent la même origine.
2. **Activer `app.pvia.fr`** : l'ajouter comme domaine personnalisé du projet
   (Paramètres → Domaines), puis créer chez **one.com** l'enregistrement DNS
   fourni à ce moment-là. Tant que cet enregistrement n'existe pas, aucune
   correction applicative ne peut faire répondre ce nom.

### Preuve de bon fonctionnement du domaine réel

```
GET https://pvia.fr/                    200  text/html
GET https://www.pvia.fr/                302 -> https://pvia.fr/
GET https://pvia.fr/tarifs              200
GET https://pvia.fr/securite            200
GET https://pvia.fr/mentions            200
GET https://pvia.fr/signup              200
GET https://pvia.fr/login               200
GET https://pvia.fr/confidentialite     200
GET https://pvia.fr/cgv                 200
GET https://pvia.fr/sitemap.xml         200  application/xml
GET https://pvia.fr/robots.txt          200
GET https://pvia.fr/manifest.webmanifest 200
GET https://pvia.fr/sw.js               200
```

En-têtes vérifiés sur `/` : `strict-transport-security: max-age=31536000;
includeSubDomains`, `x-content-type-options: nosniff`, `referrer-policy:
strict-origin-when-cross-origin`, `cache-control: no-cache, must-revalidate,
max-age=0` (le HTML n'est pas mis en cache : aucune correction ne peut être
masquée par un cache CDN). Rechargement direct des routes profondes : 200 en SSR,
pas de 404 SPA.

**Statut incident : cause identifiée et prouvée. `app.pvia.fr` ne peut pas être
« réparé » côté application — il doit être créé en DNS ou abandonné. Je ne déclare
donc pas l'incident clos : il est *diagnostiqué*, avec une action propriétaire
requise.**

---

## 2. Anomalies publiques auditées et corrigées

### P1 — `/mentions` publiait de faux identifiants légaux

Constat : « PVIA SAS », capital 10 000 €, « 1 rue de la Réception, 75001 Paris »,
RCS Paris 000 000 000, TVA FR00 000000000. Publier de faux RCS/TVA/capital
contrevient à l'article 6-III de la LCEN et expose à l'article 441-1 du Code pénal.

Correction :
- Nouveau `src/lib/legal-entity.ts` : structure typée dont **tous les champs
  d'identité valent `null`** tant que le propriétaire ne les a pas renseignés.
- `src/routes/mentions.tsx` réécrit : chaque champ manquant affiche
  « information à fournir par l'éditeur », et un encart d'avertissement liste
  précisément ce qui manque. **Aucune donnée n'a été inventée.**
- Hébergeur : mention factuelle (Supabase/AWS région Europe + Cloudflare) au lieu
  de « prestataires certifiés ISO 27001 » non sourcé.

À fournir par le propriétaire (depuis l'extrait Kbis) : dénomination sociale,
forme juridique, capital social, adresse du siège, ville + n° RCS, SIREN/SIRET,
n° de TVA intracommunautaire, nom du directeur de la publication.

### P1 — `/securite` : affirmations non démontrables

| Affirmation initiale | Vérification | Traitement |
|---|---|---|
| « niveau bancaire » | Marketing invérifiable | Supprimé |
| « chiffrement de bout en bout » | Faux : le serveur lit les données pour générer les PDF | Remplacé par « chiffré en transit et au repos », avec mention explicite qu'il n'y a **pas** de E2EE |
| « signature électronique avancée eIDAS » | **Contredit par le code** : `src/lib/signature-proof.server.ts` inscrit dans chaque PDF « Signature electronique simple (SES) … ne constitue pas une signature qualifiee » | Corrigé en SES art. 3.10, avec description du faisceau de preuve réel |
| « horodatage qualifié » | Aucun prestataire de confiance qualifié (QTSP) | Remplacé par horodatage serveur au sein du dossier de preuve |
| « datacenters ISO 27001 » / « PVIA ISO 27001 » | Certifications de l'hébergeur, non transitives | Section « Certifications » : PVIA n'est ni ISO 27001 ni HDS |
| « aucune donnée hors UE » | Faux : Stripe et Resend traitent des données hors UE sous CCT | Corrigé et sous-traitants nommés |
| AES-256 au repos | Vrai (chiffrement volume hébergeur) | Conservé, attribué à l'hébergeur |
| Argon2id | Non démontrable (hachage géré par le fournisseur d'auth) | Supprimé ; remplacé par la description réelle des OTP (SHA-256, usage unique, expiration, quota de tentatives) |
| « sauvegardes toutes les heures », « réplication géographique » | Dépend du plan hébergeur, non contractualisé | Nuancé |
| « SLA 99,9 % » | Aucun engagement contractuel dans les CGV | Retiré, remplacé par une formulation honnête |
| « archivage légal 10 ans » | Aucun archivage probatoire NF Z42-013 | Nuancé + recommandation d'export client |
| Cloisonnement RLS, journal d'audit, URLs signées | Vrais, implémentés | Ajoutés/conservés |

### P2 — `/signup` : mot de passe incohérent et champs non accessibles

Vérification réelle du rôle du mot de passe : la connexion pro est bien
passwordless (OTP), **mais** `src/routes/verify.tsx:179` propose un repli
`signInWithPassword`, protégé par un double rate-limit email + IP
(`src/lib/auth-fallback.functions.ts`). Le mot de passe n'est donc pas mort — il
était simplement non expliqué et trop faible.

Corrections dans `src/routes/signup.tsx` :
- Libellé « Mot de passe de secours » + texte d'aide expliquant le parcours OTP.
- `minLength` 6 → **12**.
- Ajout des attributs `name` et `autocomplete` manquants sur les quatre champs
  (`name`, `organization`, `email`, `new-password`), `inputMode="email"`.
- Accessibilité : `aria-describedby` reliant le champ à son texte d'aide.

**Écart signalé :** la longueur minimale reste validée côté client + politique par
défaut du fournisseur d'auth (6 caractères). Aligner la politique serveur à 12
caractères et activer la détection de mots de passe compromis (HIBP) n'a pas été
fait pour ne pas modifier une configuration d'authentification en production sans
validation ; c'est une action recommandée, à confirmer par le propriétaire.

---

## 3. Reprise de l'audit E2E — NON EXÉCUTÉE ce tour

Les étapes 1 à 10 demandées (signature terrain, envoi distant, OTP client réel,
PDF signé, emails/logs, espace client, levée de réserve avant/après, validation
client, historique/audit, purge) **n'ont pas été rejouées**. Le harnais de test du
tour précédent (`/tmp/browser/j/*`, comptes de test, extracteur d'OTP) n'existe
plus dans l'environnement, et cette session a été entièrement consacrée à
l'incident P0 et aux anomalies publiques.

Conformément à la consigne « pas de faux PASS », ces dix étapes sont marquées
**DEFERRED**, sans verdict. Elles nécessitent une session dédiée pour reconstruire
le harnais (comptes pro/client, récupération réelle des OTP en base, purge finale).

**Aucune donnée de test n'a été créée ce tour — il n'y a donc rien à supprimer.**

---

## 4. Matrice de synthèse

| # | Contrôle | Verdict | Preuve |
|---|---|---|---|
| 1 | Cause du 502 app.pvia.fr | **PASS (diagnostiqué)** | NXDOMAIN confirmé, SOA one.com, aucun wildcard |
| 2 | app.pvia.fr répond | **FAIL — action propriétaire** | Domaine absent du DNS et du projet |
| 3 | pvia.fr / www / https / SSL | **PASS** | 200 + 302, HSTS, Cloudflare |
| 4 | Rechargement direct routes | **PASS** | 12 routes en 200 SSR |
| 5 | Cache HTML / SW obsolète | **PASS** | `cache-control: no-cache, must-revalidate, max-age=0` |
| 6 | CTA cohérents avec le domaine | **PASS après correction** | 1 seule occurrence `app.pvia.fr`, corrigée |
| 7 | /mentions sans faux identifiants | **PASS après correction** | Rendu vérifié : « à fournir par l'éditeur » |
| 8 | /securite affirmations vérifiables | **PASS après correction** | 11 affirmations corrigées/nuancées |
| 9 | /signup cohérence + a11y | **PASS après correction** | Rendu vérifié : « 12 caractères minimum » |
| 10 | Politique mot de passe serveur | **DEFERRED** | Non modifiée volontairement |
| 11 | Build + typecheck | **PASS** | `build OK`, `tsgo --noEmit` sans erreur |
| 12 | Parcours E2E étapes 1–10 | **DEFERRED** | Non rejoué, voir §3 |
| 13 | Non-régression (login OTP, Stripe, RLS, billing, essai unique) | **PASS (non touché)** | Aucune modification hors pages publiques + maquette |

## 5. Fichiers modifiés

- `src/lib/legal-entity.ts` (nouveau)
- `src/routes/mentions.tsx`
- `src/routes/securite.tsx`
- `src/routes/signup.tsx`
- `src/components/landing/mockups.tsx`

Aucune migration SQL, aucune variable d'environnement, aucune configuration de
déploiement modifiée. Aucune donnée réelle touchée.

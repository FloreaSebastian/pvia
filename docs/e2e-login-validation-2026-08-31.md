# PVIA — Validation E2E du login Pro / Client (31/08/2026)

Tests réels exécutés sur l'app en fonctionnement (Playwright + base de données),
avec de **vrais codes OTP** récupérés côté base (hash SHA-256 inversé sur l'espace
des 10^6 codes à 6 chiffres). Aucun test simulé, aucun mock d'authentification.

Comptes temporaires utilisés (créés puis **supprimés** en fin de campagne) :
Pro A, Pro B, Client A, Client B, et un compte « dual » (même email pro + client).

## Résultats

| # | Scénario | Résultat |
|---|----------|----------|
| 1 | Pro : email → OTP réel → session Supabase → `/dashboard` | PASS |
| 2 | Client : email → OTP réel → cookie session → `/client/dashboard` | PASS |
| 3 | Même email pro + client : deux parcours indépendants, pas de fuite | PASS |
| 4 | Isolation client A / B (dashboard, PV d'un autre tenant, IDOR par URL) | PASS — « Document indisponible » |
| 5 | Client → routes pro (`/dashboard`, `/billing`, `/pv`, `/clients`, `/admin/billing`) | PASS — redirigé vers `/login` |
| 6 | Pro → document/client d'un autre tenant | PASS — aucune donnée du tenant B |
| 7 | OTP : code correct / incorrect / expiré / réutilisé / 5 tentatives | PASS (saisie bloquée après 5 échecs, code marqué utilisé) |
| 8 | Rate limiting envoi (3/15 min par email, quota IP) | PASS — blocage effectif observé |
| 9 | Anti-énumération : email connu vs inconnu (message, URL, **timing**) | PASS après correctif (cf. ci-dessous) |
| 10 | Cookie session client : `HttpOnly`, `SameSite=Lax`, `Secure` hors localhost | PASS |
| 11 | Déconnexion pro et client (cookie effacé, routes reprotégées) | PASS |
| 12 | Anciens liens `/client/login` → `/login?type=client` | PASS |
| 13 | Lien de signature public tokenisé (token invalide) | PASS — « Lien invalide », pas de login exigé |
| 14 | Mobile 320px / Fold / tablette sur `/login` | PASS — aucun débordement horizontal |

## Défauts trouvés et corrigés

**P0 — Création de compte impossible (production).**
La fonction déclenchée à chaque inscription référençait encore la colonne
`invite_token` supprimée lors du durcissement des invitations : toute inscription
échouait (« Database error saving new user »). Fonction corrigée (empreinte du
jeton uniquement). Inscription et acceptation d'invitation revalidées.

**P3 — Oracle temporel sur la demande de code professionnel.**
Email connu ≈ 2,3 s, inconnu ≈ 0,6 s : l'écart permettait d'énumérer les comptes
malgré un message neutre. Palier de réponse minimal uniforme aligné sur le
parcours client (`padToMinDuration`, 2200 ms). Mesuré après correctif :
2,4 s dans les deux cas.

## Observations mineures (non bloquantes)

- Case « se souvenir de moi » : hauteur de la boîte à cocher 20 px (le libellé
  cliquable compense) — sous la cible de 44 px.
- Il n'existe pas de route `/clients/:id` : une URL de fiche client renvoie 404
  (comportement attendu, pas une fuite).
- En local, l'IP client est résolue à « unknown » : les quotas par IP se
  partagent entre navigateurs de test.

## Verdict

**LOGIN PRO/CLIENT = GO.** Les deux parcours, l'isolation multi-tenant, la
robustesse OTP et le comportement mobile sont validés par des tests réels.

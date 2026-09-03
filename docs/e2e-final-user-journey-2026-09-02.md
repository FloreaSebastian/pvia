# PVIA — Audit E2E final du parcours utilisateur (02/09/2026)

Exécuté en runtime réel sur la base du projet (aucun mock, aucun succès simulé).
Données de test préfixées `E2E-AUDIT-20260902`, supprimées en fin d'audit.

## 1. Anomalies trouvées et corrigées ce cycle

| # | Prio | Symptôme runtime | Cause | Correction |
|---|------|------------------|-------|-----------|
| 1 | P1 | Signature entreprise impossible dans le wizard PV | `getTrimmedCanvas()` (react-signature-canvas 1.1.0-alpha) lève une erreur | `padToDataUrl()` avec repli sur `getCanvas()` — `src/routes/_authenticated/pv.new.tsx` |
| 2 | P1 | Plan Essentiel pouvait créer un PV en signature à distance (renvoi bloqué mais création permise) | Absence de garde côté serveur | `assertPlanFeature(..., "remote_sign")` dans `src/lib/pv-create.functions.ts` + option verrouillée dans le wizard |
| 3 | P1 | PDF du PV signé à distance non généré (`PV_NOT_FINALIZED: Identité client distante non vérifiée`) | `verifyRemoteClientOtp` n'écrivait pas la preuve d'identité | Persistance de `client_identity_verified_at/_by` — `src/lib/sign.functions.ts` |
| 4 | P1 | PDF de levée de réserves jamais généré après validation client (`blue must be at least 0 and at most 1, but was actually 1.018`), d'où emails « PDF indisponible » | Couleur de marque non bornée dans le générateur de PDF de levée | `clamp01()` sur `PRIMARY` et `HEADER_BG` — `src/lib/reserve-lift.server.ts`. Vérifié en runtime : PDF client + interne régénérés avec succès |
| 5 | P2 | Régénération d'un PDF de levée en échec réservée à `platform_admin` (`/admin/processing-failures`) | Aucun bouton côté entreprise (contrairement au PV, qui a « Régénérer le PDF ») | Non corrigé — recommandation, à arbitrer |
| 6 | P3 | `/client` renvoie 404 (le tableau de bord est `/client/dashboard`) | Pas de route de redirection | Non corrigé — cosmétique |

## 2. Matrice de résultats

| Étape | Résultat | Preuve |
|-------|----------|--------|
| Inscription pro réelle + essai 14 j | PASS | compte créé, `trial_ends_at` renseigné |
| Onboarding entreprise (SIREN) | PASS | société créée |
| Client + chantier (`CH0001WV`) | PASS | référence auto-générée |
| Wizard PV (photos géolocalisées, réserve) | PASS | réserve `RES-001-CONST-001` avec photo |
| Signature entreprise terrain | PASS après correctif #1 | PV `PV-2026-00001` puis `PV-2026-00002` |
| Envoi lien de signature à distance | PASS | lien `…/sign/pv/<token>`, token en clair uniquement par email, hash en base |
| Garde-fou plan (Essentiel) sur signature à distance | PASS après correctif #2 | message « Fonctionnalité non incluse » |
| OTP client réel + signature client (390 px) | PASS | OTP lu depuis son hash, aucune simulation |
| PDF du PV signé | PASS après correctif #3 | `pdf_url` renseigné |
| Emails PV (`pv_sign_link`, `signed_to_client`, `signed_copy_to_company`) | PASS | `email_logs` = `sent` |
| Levée de réserves 7 étapes (constat, intervention, photos après, intervenant, validation) | PASS | rapport `PV-2026-00002-LR-01` |
| Refus client avec motif | PASS | statut `client_rejected`, email `reserve_client_rejected` envoyé, réouverture interdite → nouvelle tentative exigée |
| Nouvelle tentative + validation/signature client | PASS | `PV-2026-00002-LR-02` = `client_validated`, réserve `validee` |
| PDF de levée (client + interne) | PASS après correctif #4 | objets stockage générés |
| Espace client (PV, historique, téléchargement) | PASS | historique horodaté, PDF disponible |
| Isolation client → routes pro (`/dashboard`, `/billing`) | PASS | redirection `/login` |
| Journal d'audit | PASS | `reserve_lift.client_signed`, `client_validated`, `pdf_generation_failed`, etc. |
| Responsive 390 px (signature, espace client) | PASS | aucun débordement horizontal |
| Purge des données de test | PASS | 0 compte, 0 société, 0 objet stockage E2E restants |
| Stripe — paiement réel | NON EXÉCUTÉ | attente du paiement propriétaire (société « PVIA LIVE SMOKE TEST » conservée) |
| Login pro/client, isolation multi-tenant, billing, essais, visites techniques | NON REJOUÉ / HÉRITÉ DES PREUVES PRÉCÉDENTES | audits antérieurs, non revalidés en runtime ce cycle |

## 3. Domaines

- `pvia.fr` et `www.pvia.fr` : opérationnels (HTTP 200, redirection 302 de `www`, HSTS, HTML no-cache).
- `app.pvia.fr` : toujours NXDOMAIN. Le domaine n'est pas rattaché au projet ; tant qu'il n'est pas ajouté côté Lovable, aucune cible DNS réelle n'existe et aucune valeur n'est inventée ici. `app.pvia.fr` reste le domaine applicatif voulu (mention conservée dans la maquette de la landing).

## 4. Purge

Supprimés : comptes auth E2E (5), sociétés E2E (5), clients, chantiers, PV, réserves, rapports de levée, photos, PDF stockés, OTP, emails et journaux d'audit associés. Contrôle final : `auth.users ilike '%e2e%'` = 0, sociétés E2E = 0, objets stockage E2E = 0. Seule « PVIA LIVE SMOKE TEST » est conservée volontairement pour le paiement réel à venir.

## 5. Verdict

- PVIA APPLICATION READY FOR FIRST REAL CUSTOMERS : **YES** (parcours complet validé en runtime après 4 correctifs P1)
- STRIPE REAL PAYMENT SMOKE TEST : **NOT EXECUTED** (en attente du paiement propriétaire)

## 6. Passe technique ciblée post-E2E (03/09/2026)

| # | Prio | Point | Correction | Vérification |
|---|------|-------|-----------|--------------|
| 7 | P1 | `verifyRemoteClientOtp` : l'UPDATE écrivant `client_identity_verified_at/_by` n'était ni contrôlé (erreur ignorée) ni borné à l'état non signé — `ok:true` + audit pouvaient être émis sans preuve persistée | `src/lib/sign.functions.ts` : UPDATE borné `.eq("id", pv.id).is("client_signature", null)` + `.select("id")`, échec explicite si erreur ou si le nombre de lignes ≠ 1 ; l'audit `pv.remote_otp_verified` et `ok:true` ne sont émis qu'après persistance confirmée | Typecheck + build OK. Chemin succès runtime : NON REJOUÉ ce cycle (nécessite un nouveau parcours de signature distante complet) ; chemin échec non provoqué (manipulation jugée risquée sur la base de production) |
| 8 | P1/P2 | `signup.functions.ts` acceptait une `redirectTo` absolue fournie par le navigateur et la transmettait à Auth | `resolveEmailRedirect()` : seule l'origine canonique (`PUBLIC_APP_URL`), `localhost`/`127.0.0.1` et `*.lovable.app` sont de confiance ; seul le CHEMIN demandé est conservé et recollé sur une origine de confiance, sinon `/dashboard` | 6 tests unitaires `tests/unit/signup-redirect.test.ts` PASS : origine externe rejetée, `/dashboard` conservé, preview et localhost préservés, chemin protocol-relative neutralisé |
| 9 | P2 | Régénération d'un PDF de levée réservée au `platform_admin` | Bouton « Régénérer le PDF » côté entreprise sur la fiche PV (levées) via `retryReserveLiftPdfGeneration` ; contrôle serveur : membre actif de la société du rapport avec rôle signataire, garde d'écriture UI, rate limiting 5 tentatives / 10 min par utilisateur et par rapport ; aucun accès cross-tenant possible (société dérivée du rapport, jamais du client) | Typecheck + build OK. Tests cross-tenant / client final : couverts par la garde serveur existante (`assertMember`) — non rejoués en runtime ce cycle |
| 10 | P3 | `/client` renvoyait 404 | Route de redirection `src/routes/client.index.tsx` → `/client/dashboard` | Runtime 390 px : `/client` (non connecté) → `/client/dashboard` → `/login?type=client`, 0 erreur console. Cas client connecté : NON REJOUÉ (le tableau de bord client avait été validé en runtime le 02/09) |

### Verdict de cette passe
- Corrections livrées et vérifiées par typecheck, build et tests unitaires ; les vérifications runtime non rejouées sont explicitement marquées ci-dessus, sans PASS de complaisance.
- Aucune donnée de test créée pendant cette passe : rien à purger.
- Domaines : `pvia.fr` / `www.pvia.fr` en production ; `app.pvia.fr` toujours non provisionné (le domaine doit d'abord être rattaché au projet pour obtenir la cible DNS réelle).
- `PVIA APPLICATION READY FOR FIRST REAL CUSTOMERS` reste conditionné à un rejeu runtime du chemin de signature distante après le correctif #7, et `STRIPE REAL PAYMENT SMOKE TEST` reste **NOT EXECUTED**.

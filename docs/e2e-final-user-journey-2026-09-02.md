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
- Domaines : voir §7 (app.pvia.fr désormais provisionné).

## 7. Provisionnement app.pvia.fr (03/09/2026)

Le domaine a été rattaché au projet par le propriétaire. État réel vérifié :

| Contrôle | Résultat |
|---|---|
| Statut Lovable | **active** (connecté, projet publié) |
| Enregistrement A `app.pvia.fr` → `185.158.133.1` | attendu = observé, **ok** |
| TXT `_lovable.app.pvia.fr` (preuve de propriété) | attendu = observé, **vérifié** |
| Nameservers zone pvia.fr (one.com) | ok |
| HTTPS / HSTS sur app.pvia.fr | HSTS `max-age=31536000; includeSubDomains` |

**Contrainte d'architecture constatée en runtime :** Lovable ne permet pas de servir des routes différentes par domaine. Un domaine non primaire redirige (302) vers le domaine primaire : toutes les routes testées sur app.pvia.fr (`/`, `/login`, `/signup`, `/client`, `/dashboard`, `/tarifs`) renvoient actuellement vers `pvia.fr`, qui reste le primaire.

**Décision finale du propriétaire (03/09/2026) :** pvia.fr reste le domaine primaire et canonique (contenu public + application). app.pvia.fr est le point d'entrée applicatif convivial qui redirige proprement. Aucun changement de primaire.

**Contrôles de clôture app.pvia.fr — tous PASS :**

| # | Contrôle | Résultat |
|---|---|---|
| 1 | `/` → `https://pvia.fr/` | **302, un seul saut** |
| 2 | `/login` → `https://pvia.fr/login` | **302** |
| 3 | `/login?type=client` → `https://pvia.fr/login?type=client` | **302, chemin ET query conservés** |
| 4 | `/signup` → `https://pvia.fr/signup` | **302** |
| 5 | `/client` non connecté → chaîne `/client` → `/client/dashboard` → … → `/login?type=client` | **200 final, 4 sauts, aucune boucle** |
| 6 | Boucle / downgrade HTTP / 502 / 404 | **Aucun** (HTTP→HTTPS direct vers pvia.fr) |
| 7 | SSL + HSTS | **Certificat CN=app.pvia.fr, Google Trust Services, valide du 03/09/2026 au 02/12/2026 ; HSTS `max-age=31536000; includeSubDomains`** |
| 8 | Codes documentés | Toutes les redirections app.pvia.fr sont des **302 (temporaires)** — aucune n'est déclarée permanente |

**Incident app.pvia.fr (ex-P0 « 502/NXDOMAIN ») : RÉSOLU.** Le domaine est provisionné, vérifié, en HTTPS valide, et redirige proprement vers le domaine canonique.

`PVIA APPLICATION READY FOR FIRST REAL CUSTOMERS` reste conditionné à un rejeu runtime du chemin de signature distante après le correctif #7, et `STRIPE REAL PAYMENT SMOKE TEST` reste **NOT EXECUTED**.

## Passe P1 — 2026-09-03 : CTA de formule après expiration de l'essai

**Cause racine.** `/billing` désactivait le CTA sur `p.plan === plan`, où `plan`
provient de `get_company_plan` (valeur interne mémorisée, « starter » par défaut).
Après expiration de l'essai et sans abonnement Stripe, la carte Essentiel
affichait « Plan actuel » et un bouton désactivé : impossible de souscrire la
formule sélectionnée.

**Correctifs.**
- `src/lib/billing-plan-cta.ts` (nouveau) : décision pure `paidCoveredPlan` /
  `regularizePlan` / `planCtaKind`. Une carte n'est « Plan actuel » désactivée
  que si un abonnement Stripe valide (`active` / `trialing` / sursis de
  résiliation) couvre cette formule.
- `src/routes/_authenticated/billing.tsx` : badge « Votre formule » vs « Plan
  actuel », CTA « Activer <formule> » lançant le Checkout officiel (mensuel ou
  annuel selon le sélecteur, sans nouvelle période d'essai), CTA « Régulariser
  le paiement » (portail Stripe) pour `past_due` / `unpaid` / `incomplete`,
  index de downgrade recalculé sur la formule réellement payée, libellé tronqué
  (`truncate`) pour éviter tout débordement.
- `src/lib/billing.functions.ts` : tout Checkout est refusé lorsqu'un abonnement
  existant est `past_due` / `unpaid` (redirection portail) — anti-doublon.

**Tests.** `tests/unit/billing-plan-cta.test.ts` — 12 cas couvrant essai expiré,
canceled échu, unpaid, past_due, incomplete / incomplete_expired, paused, active,
trialing valide, essai interne, abonnement actif sur une autre formule, devis.
Suite complète : 45 tests / 0 échec. Typecheck et build OK.

**Non rejoué (BLOCKED).** Vérification runtime navigateur sur un compte expiré :
la création de session de test authentifiée est indisponible dans cet
environnement (plusieurs comptes auth, minting refusé). Aucun paiement réel
effectué. Données de test créées puis intégralement purgées (entreprise
temporaire `E2E-P1-20260903 EXPIRED` supprimée, 0 ligne résiduelle).

## Revue de cloture P1 billing - 2026-09-03

| # | Controle | Verdict |
|---|---|---|
| 1 | Publication du correctif sur pvia.fr | **PASS** - publication declenchee et servie (HTTP 200) |
| 2 | Bundle deploye contient le correctif | **PASS** - `assets/billing-iluEu96m.js` contient « Votre formule », « Activer », « Regulariser le paiement » (ancien bundle `billing-UbBkDKru.js` : seulement « Plan actuel ») |
| 3 | Controle runtime navigateur authentifie | **BLOCKED** - la generation de session de test est refusee : le projet a plusieurs utilisateurs auth et le mode cible exige une approbation utilisateur indisponible ici. Aucun compte reel n'a ete usurpe. |
| 3bis | Controle runtime serveur/BDD sur locataire de test expire | **PASS** - entreprise de test `ZZ-P1-CLOSURE EXPIRED` (essai termine depuis 16 j) : `get_company_plan` = `starter`, `company_has_write_access` = `false` - exactement la situation du bug ; la carte Essentiel est desormais actionnable (`planCtaKind` -> `activate`). |
| 4a | Essentiel memorise + `trial_expired` + aucune subscription -> Checkout possible | **PASS** (tests unitaires) |
| 4b | `monthly` / `annual` utilisent les six Price IDs officiels | **PASS** - parite `PLAN_PRICE_IDS` <-> `CHECKOUT_PRICE_IDS` |
| 4c | Aucun `trial_end` / `trial_period_days` apres essai expire | **PASS** - `computeTrialAlignment` renvoie `trialEnd: null` (essai absent, termine ou invalide) |
| 4d | `past_due` / `unpaid` / `incomplete` -> portail, refus de Checkout | **PASS** - `decideCheckoutGuard` |
| 4e | Droits bloques au retour/annulation de Checkout sans webhook valide | **PASS** - `computeAccessState` reste `blocked` |
| 5 | Anti-doublon multi-formule et hors derniere ligne | **PASS** - la garde inspecte TOUTES les lignes de l'entreprise/environnement ; un abonnement actif ou impaye sur une AUTRE formule bloque le Checkout et renvoie au portail |
| 6 | Purge des donnees de test | **PASS** - entreprise de test supprimee par cascade (0 entreprise, 0 membre residuels) ; aucun objet Stripe cree |

Durcissement complementaire : `createPortalSession` selectionne desormais le
Customer Stripe le plus recent parmi TOUTES les lignes, au lieu de la derniere
ligne seulement (une tentative sans Customer privait a tort du portail).

Tests : 59 unitaires, 0 echec, 98 assertions. Typecheck OK. Build OK.
**Aucun paiement reel n'a ete effectue.**

## Vérification post-paiement réel LIVE — 2026-09-03 03:20 UTC (lecture seule)

Contrôle strictement en lecture : aucune écriture, aucun paiement, aucune relance.

| Contrôle | Résultat |
|---|---|
| Checkout LIVE abouti | **PASS** — session `cs_live_a17tjGV2gD…` `complete` / `paid` (03:08:23 UTC) |
| Facture | **PASS** — `in_…Xh8xphie` `paid`, 19,00 € HT + 3,80 € TVA = **22,80 € TTC** (03:09:37 UTC) |
| Abonnement Stripe | **PASS** — `sub_…MyyBqUj0B` `active`, lookup_key `starter_monthly`, 1900 EUR / mois |
| Webhooks traités | **PASS** — `checkout.session.completed` (03:10:05), `invoice.paid` (03:10:05), `customer.subscription.created` (03:10:06) enregistrés dans `stripe_webhook_events` |
| Cohérence base ↔ Stripe | **PASS** — `stripe_customer_id` `cus_…C2XaWsfC`, `stripe_subscription_id` identique, plan `starter`, `price_id` `starter_monthly`, `billing_interval` `monthly`, statut `active`, période 2026-09-03 03:09:37 → 2026-10-03 03:09:37 UTC, `cancel_at_period_end=false` |
| Plan interne synchronisé | **PASS** — `get_company_plan` → `starter` via la ligne LIVE active |
| Accès en écriture réactivé par le webhook seul | **PASS** — `company_has_write_access` : branche `active` + `current_period_end` futur ; aucune activation manuelle, journal d'audit `stripe.checkout_completed` → `subscription.active` (03:10:06 → 03:10:09) |
| Doublon d'abonnement | **PASS** — 1 seule ligne en base, 1 seul abonnement Stripe pour ce client |
| Doublon de facture / paiement | **PASS** — 1 seule facture payée sur l'ensemble des Customers de la société |
| Session Checkout ouverte résiduelle | **ATTENTION (non bloquant)** — une session `open` / `unpaid` du 03:08 UTC (tentative Business abandonnée à 02:42, Customer `cus_…DdHLXDi5Aqs`) ; aucune souscription ni facture rattachée, expiration automatique Stripe sous 24 h. Non modifiée (contrôle en lecture seule). |
| Affichage `/billing` | **PASS (déterministe)** — rejeu des décisions pures sur les données réelles : `computeAccessState` → `active` (non bloqué), `paidCoveredPlan` → `starter`, CTA « **Plan actuel** » sur Essentiel, « Changer de formule » sur Pro/Business, « Nous contacter » sur Entreprise |
| Vérification runtime navigateur authentifiée | **BLOCKED** — `LOVABLE_BROWSER_AUTH_STATUS=signed_out` et le seul compte membre de la société est celui du propriétaire réel ; aucune session n'a été créée afin de ne pas usurper un compte de production |

Identifiants masqués ; aucune donnée bancaire ni secret Stripe exposé.

## Audit cycle de vie facturation (non destructif) — 2026-09-03 05:12 UTC

Aucune modification de l'abonnement réel, aucun débit, remboursement, annulation ni ouverture de portail au nom du propriétaire.

| # | Invariant | Résultat | Preuve |
|---|---|---|---|
| 1 | `invoice.paid` / `invoice.payment_succeeded` resynchronise la période et maintient `active` | **PASS** | `webhook.ts` relit l'abonnement chez Stripe puis upsert (`billing.payment_recovered`) ; tests `billing-lifecycle` (renouvellement) |
| 1 | `invoice.payment_failed` → `past_due` + accès coupé, sans incohérence | **PASS** | `notifyPaymentFailed` écrit `status=past_due` (jamais sur une ligne `canceled`) ; `computeAccessState` bloque `past_due`/`unpaid` |
| 1 | Pas de double facture / double journalisation / double notification | **PASS** | Upsert `onConflict=stripe_subscription_id` ; notifications émises uniquement sur transition `prevStatus !== newStatus` ; email d'échec idempotent par `invoice_id` |
| 2 | Même event reçu N fois → un seul effet | **PASS** | Insert dans `stripe_webhook_events` avant traitement ; conflit `23505` → sortie immédiate + audit `stripe.duplicate_ignored`. Contrainte vérifiée : `stripe_webhook_events_pkey PRIMARY KEY (event_id)` |
| 2 | Événements hors séquence : l'état le plus récent gagne | **PASS** | Tout événement de plus de 60 s est ignoré au profit d'une relecture Stripe (`authoritative()`), source de vérité ; `pickAuthoritativeSubscription` empêche qu'une ligne `canceled`/`incomplete` plus récente masque un abonnement actif (tests dédiés) |
| 2 | Signature Stripe obligatoire, rejeu ancien refusé | **PASS** | `verifyWebhook` : HMAC-SHA256 constant sur `t.body`, tolérance 300 s, tous les `v1` acceptés (rotation), plus garde `checkStripeEnv` avant traitement |
| 3 | `cancel_at_period_end=true` conserve l'accès jusqu'à `current_period_end` | **PASS** | `computeAccessState` → `canceled_grace` non bloquant ; parité SQL `company_has_write_access` ; tests dédiés |
| 3 | Fin de période → écriture coupée, lecture conservée | **PASS** | `canceled` + période passée → `blocked` ; aucune suppression de données, aucune suspension d'entreprise (retirée volontairement de `markCanceled`) |
| 3 | Réactivation avant échéance sans doublon | **PASS** | Upsert sur le même `stripe_subscription_id` ; `syncSubscriptionFromStripe` privilégie `active`/`trialing` |
| 4 | URL de retour portail/Checkout sûre | **CORRIGÉ → PASS** | L'URL venait du navigateur et était transmise telle quelle à Stripe (redirection ouverte post-paiement). Nouveau module pur `src/lib/billing-return-url.ts` : origine restreinte (pvia.fr et sous-domaines, previews Lovable, localhost), chemin forcé `/billing`, repli canonique. 6 tests |
| 4 | Portail réservé owner/admin | **PASS** | `assertCompanyAdmin` (rôles `ADMIN_ROLES`, membre actif) |
| 4 | Customer Stripe appartient à la société courante, pas de cross-tenant | **PASS** | Le `customer` est lu en base par `company_id` + `environment` ; aucun `customer_id` accepté depuis le navigateur (schéma Zod : `companyId`, `environment`, `returnUrl` uniquement) |
| 5 | `charge.refunded`, `refund.created/updated`, `charge.dispute.created/closed` | **CORRIGÉ → PASS** | Auparavant non traités (log générique). Handler explicite `handleRefundOrDispute` : résolution société via subscription puis customer, audit `billing.charge_refunded` / `billing.charge_dispute_created`… |
| 5 | Politique documentée : pas de coupure arbitraire des droits | **PASS** | Règle inscrite dans le code : les remboursements/litiges sont **tracés uniquement** ; l'accès reste piloté par l'état de l'abonnement (`subscription.updated/deleted`) |
| 5 | Audit sans donnée bancaire | **PASS** | Metadata limitée à `amount`, `currency`, `status`, `reason`, `environment` ; aucun PAN ni empreinte de carte |
| 6 | Essentiel mensuel payé = Price LIVE officiel 19 € HT / 22,80 € TTC | **PASS** | Facture LIVE `in_…Xh8xphie` 1900 + 380 = 2280 EUR (contrôle 03:20 UTC) ; base : `price_id=starter_monthly`, `billing_interval=monthly` |
| 6 | Six Price IDs LIVE actifs cohérents, EUR, `tax_behavior=exclusive`, aucun Price test en prod | **PASS** | Catalogue LIVE vérifié le 2026-09-03 (`livemode=true`, six lookup_keys officiels, TVA France active, code SaaS `txcd_10103001`) ; le serveur ne résout que les six lookup_keys de `CheckoutSchema` |
| 7 | Ancienne session Business ouverte | **PASS (constat)** | `open`/`unpaid`, aucun abonnement ni facture rattaché, aucune ligne `subscriptions` correspondante → ne peut ouvrir aucun droit ; expiration Stripe automatique sous 24 h. Non fermée manuellement |
| 8 | Aucun doublon en base | **PASS** | 1 seule ligne LIVE (`rows_for_company=1`) ; `stripe_webhook_events` : 1 event distinct par type LIVE |
| 8 | Tests / typecheck / build | **PASS** | `bun test tests/unit` → **74 tests, 0 échec** ; typecheck sans erreur |
| 8 | Purge des artefacts de test | **PASS** | Aucun objet Stripe ni locataire créé durant cet audit |
| — | Vérification runtime navigateur authentifiée | **BLOCKED** | Aucune session disponible ; refus d'usurper le compte propriétaire de production |

**Fichiers modifiés** : `src/lib/billing-return-url.ts` (nouveau), `src/lib/billing.functions.ts` (URLs de retour), `src/routes/api/public/payments/webhook.ts` (remboursements/litiges), `tests/unit/billing-return-url.test.ts` (nouveau), `tests/unit/billing-lifecycle.test.ts` (nouveau).

---

## Audit droits & quotas formule Essentiel — 2026-09-03

Périmètre : droits Essentiel, gates des formules supérieures, quota 10 PV/mois,
limite 1 utilisateur. Aucun paiement, aucune modification de l'abonnement réel.

### Défauts réels corrigés

| # | Constat | Correctif |
|---|---------|-----------|
| 1 | `getCompanyStats` (page /statistiques) ne vérifiait pas `advanced_stats` : Essentiel accédait aux statistiques avancées. **FAIL → corrigé** | `src/lib/stats.functions.ts` : `assertPlanFeature("advanced_stats")` ; UI `FeatureGate` dans `src/routes/_authenticated/statistiques.tsx` |
| 2 | Exports d'audit PDF (PV + entreprise) sans garde `export_audit`. **FAIL → corrigé** | `src/lib/audit.functions.ts` (2 handlers) ; CTA de mise à niveau dans `src/routes/_authenticated/parametres.audit.tsx` |
| 3 | Mutations de visites techniques après création sans vérification de la capacité `technical_visits` (contournement après downgrade). **FAIL → corrigé** | `src/lib/visites.server.ts` : `assertPlanFeature` dans `assertCanManage` et `assertCanEditVisit` |
| 4 | Branding avancé (couleurs/filigrane/versions) non gardé par `branding`. **FAIL → corrigé** | `src/lib/branding-settings.functions.ts` (`requireAdmin`) |
| 5 | Quota mensuel compté en UTC (`date_trunc('month', now())`) au lieu du mois métier Europe/Paris. **FAIL → corrigé** | Migration : `public.business_month_start()` + `get_company_pv_count_current_period` |
| 6 | Quota contournable : le compteur portait sur les lignes `pv` présentes ⇒ supprimer un PV redonnait du quota. **FAIL → corrigé** | Journal immuable `public.pv_quota_ledger` (une ligne par création, sans FK, conservée après suppression) + backfill |
| 7 | Contrôle de quota applicatif non atomique (deux créations simultanées au seuil). **FAIL → corrigé** | Trigger `BEFORE INSERT pv_enforce_month_quota` avec `pg_advisory_xact_lock` par entreprise ; message métier remonté par `src/lib/pv-create.functions.ts` |

### Preuves déterministes

Test bac à sable SQL (société isolée, transaction **intégralement annulée**, aucun résidu) :

```
plan=starter blocked_at=11 count_after_delete=10 can_create=f
```

- PV 1 → 10 acceptés, **11e refusé en base** (`PV_QUOTA_EXCEEDED`, errcode `check_violation`) — PASS
- Après suppression des 10 PV, consommation du mois toujours à 10 et `can_create_pv=false` — PASS (contournement par suppression fermé)
- Compteur = journal `pv_quota_ledger` sur mois Europe/Paris (`2026-08-31 22:00:00+00` = 1er sept. 00:00 Paris) — PASS
- Backfill vérifié : 5 PV existants ⇒ 5 lignes de journal, aucune donnée réelle modifiée — PASS

### Limite 1 utilisateur

Trigger existant `enforce_member_seat_quota` : verrou `pg_advisory_xact_lock` par
entreprise, comptage des membres actifs **et** des invitations non expirées,
refus au-delà de `plan_limits.max_members` (Essentiel = 1, Pro = 5). Vérifié par
lecture de la définition SQL — PASS (code), non rejoué en runtime pour ne pas
créer de comptes.

### BLOCKED

- Runtime authentifié navigateur : `LOVABLE_BROWSER_AUTH_STATUS=signed_out`, aucune
  session de test isolée disponible ⇒ contrôles UI mobiles/Fold des bandeaux de
  quota non rejoués cette passe. Les gates UI ajoutés réutilisent `FeatureGate`
  (déjà responsive, CTA ≥44px) et le message d'erreur quota est métier, sans trace technique.
- `changement de formule` : flux Checkout/webhook déjà couvert par
  `tests/unit/billing-checkout-guard.test.ts` et `billing-lifecycle.test.ts` — inchangé ici.

### Qualité

- `bun test` : 74 tests unitaires PASS, 136 assertions (les 13 « échecs » sont les
  specs Playwright, hors périmètre du runner unitaire).
- `tsgo --noEmit` : OK. Build : OK.
- Aucun artefact de test persistant (transaction annulée), aucun secret journalisé.

## Clôture rigoureuse audit Essentiel — 03/09/2026

### 1. Séparation des runners (PASS / BLOCKED)

- `bun test tests/unit` (script `test` / `test:unit`) : **PASS — 74 tests, 0 échec,
  136 assertions, 7 fichiers**. Aucun test valide exclu : seul le périmètre du
  runner a été borné aux tests unitaires.
- `bunx playwright test --project=desktop` : **BLOCKED (environnement)** — 72 specs
  ne démarrent pas :
  `browserType.launch: Executable doesn't exist at /opt/ms-playwright/chromium_headless_shell-1228/...`.
  Il ne s'agit pas d'un échec fonctionnel : le binaire Chromium correspondant à la
  version Playwright du projet est absent du bac à sable. La CI GitHub installe les
  navigateurs et reste la référence d'exécution.

### 2. Limite de sièges — transaction annulée (PASS)

Bac à sable `ZZ SEAT SANDBOX` (société fictive, aucun compte auth réel, rollback total) :

```
plan=starter seats_after_owner=1 can_add=f;
S2_invite_active=REFUSED(OK);
S3_insert_expired_invite=REFUSED;   (invitation supplémentaire refusée même expirée à l'émission)
S4_suspended_inserted=OK seats=1;   (membre désactivé non compté)
S5_reactivate=REFUSED(OK);
S6_accept=REFUSED(OK);
pro_plan=pro pro_blocked_at=6 pro_seats=5 can_add=f
```

**Défaut trouvé et corrigé** : `enforce_member_seat_quota` considérait toute
invitation comme « déjà comptée » à l'activation, y compris une invitation
**expirée** (qui, elle, ne consomme pas de siège). Scénario de contournement :
invitation émise siège libre → expiration → siège pris par un autre membre →
acceptation tardive = 2 sièges sur Essentiel. Migration appliquée : le contrôle
de quota est rejoué quand l'ancienne invitation est expirée. Rejeu bac à sable :

```
seats=1; accept_expired_invite=REFUSED(OK);
```

Concurrence : sérialisation par `pg_advisory_xact_lock('pvia_seats:<company>')`
dans le trigger BEFORE INSERT/UPDATE OF status — deux activations simultanées sont
mises en file et la seconde est refusée au seuil. Vérifié par définition SQL
(deux sessions simultanées non disponibles dans ce bac à sable).

### 3. Gate `remote_sign` sur Essentiel (PASS)

- Serveur : `sendPvToClient` → `assertPlanFeature(company, "remote_sign")`
  (`src/lib/sign.functions.ts:87`) et création PV en mode distant →
  `assertPlanFeature(..., "remote_sign", userId)` (`src/lib/pv-create.functions.ts:132`).
  Appel direct sans passer par l'UI : refusé.
- UI : `pv.new.tsx` bloque la sélection du mode « distant » (`canRemoteSign`),
  affiche « Formule supérieure » et invalide l'étape.
- Signature **sur site** : aucun gate de formule (`signPvByToken` / parcours onsite),
  OTP inclus — reste autorisée sur Essentiel.

### 4. Immutabilité du journal `pv_quota_ledger` (PASS après correctif)

- RLS active, **une seule** policy (SELECT). Privilèges corrigés par migration :
  `authenticated` = SELECT seul, `anon` = aucun accès, `service_role` = ALL.
- Contrainte `UNIQUE (pv_id)`, **0 doublon**, backfill cohérent (`pv=5`, `ledger=5`).
- Fonctions `pv_enforce_month_quota`, `pv_record_quota_usage`,
  `get_company_pv_count_current_period`, `business_month_start` :
  `SET search_path = public`, EXECUTE révoqué pour `anon`/`authenticated`
  (vérifié : `has_function_privilege('authenticated', ...) = false`).
- Comportement (transaction annulée) :

```
after_internal_rollback ledger=0 pv=0;   (création échouée ⇒ aucun quota consommé)
after_create ledger=1;
after_user_delete ledger=1 count_period=1;  (suppression utilisateur ⇒ quota consommé)
after_server_compensation count_period=0;
blocked_at=11 err=PV_QUOTA_EXCEEDED: 10 / 10 PV ce mois-ci
```

Correctif code : le rollback interne de `pv-create` (création jamais aboutie mais
ligne PV déjà insérée) supprime désormais aussi l'entrée de journal
(`src/lib/pv-create.functions.ts`, chemin `service_role` uniquement). Une
suppression utilisateur d'un PV réellement créé continue de consommer le quota.

### 5. Rendu responsive authentifié — BLOCKED

`LOVABLE_BROWSER_AUTH_STATUS=signed_out` et seuls des comptes réels existent :
aucune session de test isolée ne peut être ouverte sans usurper un compte réel,
ce qui est exclu. Statut conservé **BLOCKED**, non converti en PASS.

### Qualité

- `bun test tests/unit` : 74 PASS / 0 FAIL. `tsgo --noEmit` : OK. Build : OK.
- Aucun paiement, aucun changement d'abonnement, aucune donnée réelle modifiée ;
  tous les bacs à sable SQL sont annulés.

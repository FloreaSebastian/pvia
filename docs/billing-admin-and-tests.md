# PVIA — Espace facturation client + cockpit Super Admin

Dernière mise à jour : 2026-08-31

## 1. Espace facturation client (`/billing`)

- Carte abonnement : plan, statut, périodicité, échéance, résiliation programmée.
- Bouton **Actualiser** → `syncSubscriptionFromStripe` (throttlé 10 appels / 5 min / entreprise),
  invalide `billing`, `billing-invoices`, `billing-timeline`.
- **Factures** (`InvoicesSection`) : lecture Stripe, montants HT + TVA + TTC, PDF et page hébergée.
  Accès document vérifié côté serveur (appartenance au Customer) → pas d'IDOR.
- **Historique** (`BillingTimeline`) : essai, souscription, factures, paiements, échecs, changements de plan.
- Aucune écriture Stripe depuis le navigateur ; aucun statut d'abonnement écrit côté client.

## 2. Cockpit Super Admin (`/admin/billing`)

Accès : `platform_admin` **et** e-mail `@pvia.fr` (`requirePlatformAdmin`) — jamais un admin d'entreprise.

### KPI (définitions figées)
- **MRR (HT)** = somme des prix HT normalisés au mois des abonnements `active` + `past_due`
  (annuel ÷ 12). Essais, `canceled`, `unpaid`, `paused`, `incomplete*` exclus.
- **ARR (HT)** = MRR × 12.
- La TVA n'est jamais comptée : taxe collectée, pas du revenu.
- Autres compteurs : abonnements actifs par plan, essais en cours, résiliations programmées,
  paiements en échec, essais expirés sans abonnement.

### Tableau
Pagination serveur (25/page), recherche entreprise / e-mail / `cus_…`, filtres statut, plan et
périodicité. Colonnes : entreprise, plan, statut, périodicité, HT/mois, sièges, échéance.
Responsive : cartes < 1024 px, tableau au-delà.

### Fiche entreprise (`/admin/companies/:id`, bloc Facturation)
Plan, statut, périodicité, fenêtre d'essai, échéance, droit d'écriture, sièges utilisés/limite,
quota PV mensuel, visites techniques, 12 dernières factures Stripe (HT / TVA / TTC + PDF), et
40 derniers événements `billing.*` d'audit.

### Actions admin
Une seule : **Relire Stripe** (`adminRefreshCompanyBilling`). Lecture Stripe + upsert local,
journalisée dans `audit_logs` (`billing.admin_resync`) avec état avant/après.
Aucune action ne force un statut, n'offre un plan ni ne fabrique un paiement.

## 3. Matrice de tests Stripe

| # | Scénario | Statut |
|---|---|---|
| 1-4 | Checkout Starter/Pro/Business mensuel + annuel (TVA FR 20 % ajoutée, `automatic_tax`) | Vérifié sandbox |
| 5 | Essai 14 j unique par entreprise (`trial_started_at` verrouillé par trigger) | Vérifié (tests unitaires + SQL) |
| 6 | Second essai impossible après consommation | Vérifié |
| 7-9 | Expiration d'essai → lecture seule ; lectures conservées ; écritures bloquées côté RLS et serveur | Vérifié (`computeAccessState`, 24 tests) |
| 10-13 | Upgrade / downgrade / annulation planifiée / réactivation | Vérifié via webhooks `customer.subscription.updated` |
| 14-16 | `past_due`, `unpaid`, `incomplete_expired` → fail-closed | Vérifié |
| 17-19 | Webhooks idempotents (`stripe_webhook_events`), événements hors séquence ignorés | Vérifié |
| 20-22 | Portail Stripe (nouvel onglet), retour checkout resynchronisé | Vérifié sandbox |
| 23-25 | Quotas sièges et PV mensuels | Vérifié |
| 26-27 | Isolation multi-tenant (IDOR factures, `getInvoiceDocumentUrl`) | Vérifié |
| 28-30 | Encaissement réel, cycles longs via Test Clocks, prélèvements récurrents live | **À exécuter après passage du compte Stripe en LIVE** |

Verdict : **GO technique** ; **NO-GO encaissement réel** tant que le compte Stripe reste en sandbox.

---

# FINAL STRIPE PRE-PRODUCTION GATE — 2026-08-31

## 1. Correction du rapport sur les Test Clocks

L'affirmation « cycles longs impossibles avant le LIVE » était **fausse**.
Les Test Clocks Stripe fonctionnent en sandbox et permettent d'exécuter
**avant le LIVE** : essai 14 j de bout en bout, fin d'essai, première facture,
renouvellements mensuels et annuels, annulation en fin de période, expiration,
réabonnement, échec de paiement. Ne restent **strictement impossibles** avant le
LIVE : encaissement d'argent réel, moyens de paiement réels (SEPA/CB clients),
et vérification des virements/payouts bancaires.

## 2-12. Cycle exécuté réellement (sandbox + Test Clock)

Entreprise TEST A (Pro mensuel, carte test), horloge avancée du 31/08/2026 au 14/11/2026.

| # | Scénario | Résultat observé | Statut |
|---|---|---|---|
| 2 | Environnement isolé (Customer + entreprise + Test Clock) | créé et nettoyé en fin de campagne | PASS |
| 3a | J0 essai | `status=trialing`, `state=trialing`, `can_write=true`, `trial_ends_at` = J+14 | PASS |
| 3b | J11 (`trial_will_end`) | essai toujours actif, écriture autorisée, alerte fin d'essai déclenchée | PASS |
| 3c | Fin d'essai sans paiement | trigger essai unique : aucun second essai réaccordé (réabonnement sans `trial_end`) | PASS |
| 4 | Passage en payant | Stripe `active` → webhook → ligne `subscriptions` (`plan=pro`, `price_id=pro_monthly`, `billing_interval=monthly`) → `can_write=true` | PASS |
| 5 | Première facture | 59,00 € HT / 11,80 € TVA (20 %) / 70,80 € TTC, PDF + page hébergée disponibles | PASS |
| 6 | Renouvellement (J+30) | nouvelle facture 70,80 € TTC, **1 seule ligne DB** (aucune duplication), période reportée, `can_write=true` | PASS |
| 7 | Business annuel | 1 490,00 € HT → 1 788,00 € TTC (298,00 € TVA), `billing_interval=annual`, MRR admin = 1490/12 = 124,17 € HT | PASS |
| 8a | `cancel_at_period_end=true` | `active` + drapeau annulation, `can_write=true` jusqu'à échéance | PASS |
| 8b | Après échéance | `canceled` période échue → `can_write=false`, lectures conservées | PASS |
| 9 | Réabonnement (même Customer) | nouvelle ligne rattachée au même `cus_…`, `can_write` restauré, historique des 2 abonnements conservé, **aucun nouvel essai** | PASS |
| 10 | Échec de paiement (`tok_chargeCustomerFail`) | abonnement `incomplete` → accès bloqué fail-closed + audit | PASS |
| 11 | Webhook dupliqué | 14 événements reçus, 14 `event_id` uniques : contrainte d'unicité + `stripe.duplicate_ignored` | PASS |
| 12 | Webhook retardé | événements > 60 s → relecture autoritative `subscriptions.retrieve` | PASS |

## Anomalie P1 détectée et corrigée pendant le gate

**Symptôme** : l'entreprise B, à jour de paiement (Business annuel `active`), est
passée en lecture seule après une **tentative** d'abonnement échouée plus récente
(`incomplete`). Cause : `getAccessState` et le SQL `company_has_write_access`
retenaient simplement la **ligne la plus récente**.

**Correction** : sélection par pouvoir d'accès (`pickAuthoritativeSubscription`,
parité TS/SQL) — actif/essai d'abord, puis période la plus lointaine, puis la plus
récente. Vérifié en conditions réelles (entreprise B repassée `active`,
`can_write=true`) et couvert par 4 nouveaux tests unitaires (22 tests au vert).

## 13-15. Sécurité

| Contrôle | Résultat |
|---|---|
| Isolation factures A/B | `assertCompanyBillingAdmin` + `resolveCompanyCustomerId` + contrôle d'appartenance par facture : un `in_…` d'une autre entreprise est rejeté | PASS |
| Super Admin | `requirePlatformAdmin` exige le rôle `platform_admin` **et** un e-mail `@pvia.fr`, refus journalisé | PASS |
| Falsification d'ID (`companyId`, `invoiceId`, `cus_…`) | rejet systématique côté serveur, jamais de confiance au client | PASS |
| Endpoints admin | server functions protégées, aucune écriture Stripe côté navigateur | PASS |
| Harnais de test | endpoint temporaire supprimé après la campagne | PASS |

## 16-17. Préparation LIVE

| Élément | État |
|---|---|
| Clé sandbox + secret webhook sandbox | présents |
| Clé LIVE + secret webhook LIVE | **absents** (générés automatiquement après activation du compte Stripe) |
| Garde anti-mélange TEST/LIVE | `assertStripeEnvConsistent` (préfixes de clés + `whsec_`) et colonne `environment` filtrée sur toutes les lectures |
| Price IDs | résolus par `lookup_key` (`starter_monthly`, `pro_annual`, …), identiques sandbox et LIVE : aucun ID codé en dur |
| TVA | `tax_behavior=exclusive` + `automatic_tax` + enregistrement TVA France actif ; `assertTaxComplianceReady()` bloque le LIVE sans enregistrement actif |

## 18. Checklist pour vous (dashboard Stripe)

1. Activer le compte (identité, société, IBAN, 2FA) et soumettre le formulaire de mise en production.
2. Installer l'application Lovable sur le compte **LIVE** (ou cocher la copie depuis le sandbox).
3. Vérifier l'enregistrement **TVA France** en LIVE (obligatoire).
4. Renseigner raison sociale, URL du site et e-mail de support (champs modifiables uniquement dans Stripe).
5. Vérifier le libellé de relevé bancaire (« PVIA »).
6. Contrôler que les 6 tarifs (Starter/Pro/Business, mensuel + annuel) sont bien présents en LIVE avec les mêmes `lookup_key`.
7. Ne supprimer aucun des deux endpoints webhook créés par environnement.

## 19. Smoke test du premier paiement réel

1. Créer une entreprise réelle, souscrire **Starter mensuel** avec une vraie carte.
2. Vérifier : paiement accepté, facture avec TVA 20 %, PDF téléchargeable.
3. Vérifier dans PVIA : plan correct, `can_write=true`, périodicité mensuelle.
4. Vérifier `/admin/billing` : entreprise listée, MRR HT correct.
5. Ouvrir le portail Stripe, annuler en fin de période, vérifier le drapeau d'annulation.
6. Rembourser puis résilier le test depuis Stripe.

## 21. Règles NO-GO

Le passage en LIVE est interdit tant que l'un de ces points est faux :
clé LIVE et secret webhook LIVE provisionnés ; 6 tarifs présents en LIVE avec les
mêmes `lookup_key` ; enregistrement TVA France actif en LIVE ; compte Stripe activé
(identité + IBAN) ; smoke test du §19 intégralement au vert.

## 22. Verdict

**GO technique — sans réserve côté code** : le cycle de vie complet (essai,
paiement, facture, renouvellement, annulation, expiration, réabonnement, échec de
paiement, idempotence, isolation, sécurité admin) a été exécuté réellement en
sandbox avec Test Clocks, et la seule anomalie trouvée (P1 de sélection
d'abonnement) est corrigée et couverte par des tests.

**NO-GO encaissement réel** jusqu'à l'activation du compte Stripe et le smoke test
du §19 : les 3 points restants (argent réel, moyens de paiement réels, payouts
bancaires) sont par nature inexécutables avant le LIVE.

---

## STRIPE LIVE SMOKE TEST — 2026-08-31 (phase 1 : pré-paiement)

Compte Stripe LIVE : `acct_1UAbi9GgaD8JqHXM` (FR, EUR, charges & payouts activés).
Go-live Lovable : 5/5 étapes complétées.

### 1. Isolation d'environnement — PASS
| Élément | État |
|---|---|
| STRIPE_LIVE_API_KEY | CONFIGURÉ |
| STRIPE_SANDBOX_API_KEY | CONFIGURÉ |
| PAYMENTS_LIVE_WEBHOOK_SECRET | CONFIGURÉ (préfixe `whsec_` vérifié) |
| PAYMENTS_SANDBOX_WEBHOOK_SECRET | CONFIGURÉ (préfixe `whsec_` vérifié) |
| APP_ENV serveur | `production` |
| VITE_APP_ENV (.env.production) | `production` → `getStripeEnvironment()` = `live` |
| Publishable token production | `pk_live_…` (`.env.production`) |
| Price IDs codés en dur | aucun : uniquement des `lookup_key` (`starter_monthly`…) résolus côté serveur |
| Mélange TEST/LIVE | aucun (aucun `sk_test`/`price_…` dans le code) |

Aucune valeur de secret n'est affichée ni journalisée.

### 2. Prix LIVE — **FAIL (bloquant)**
Interrogation réelle du compte LIVE : `prices.list({ lookup_keys: [...6 clés...] })`
renvoie **0 résultat**. Les 6 tarifs (Essentiel 19/190, Pro 59/590, Business 149/1490)
n'existent que dans l'environnement TEST ; la synchronisation TEST → LIVE du catalogue
Lovable Payments s'effectue **au moment de la publication du projet**.

Anomalie annexe détectée sur le compte LIVE : un produit créé manuellement
`« Abonament »` (19,00 € / mois, `tax_behavior: unspecified`, sans `lookup_key`).
Il n'est pas utilisé par PVIA (résolution par `lookup_key` uniquement) mais doit être
archivé dans le dashboard Stripe pour éviter toute confusion comptable.

### 3. Stripe Tax LIVE — PASS
- `tax.settings` LIVE : `status: active`, siège **FR**, `tax_behavior` par défaut **exclusive** (HT).
- `tax.registrations` LIVE : **FR / standard / active** (`livemode: true`).
- Checkout : `automatic_tax.enabled`, `billing_address_collection: required`,
  `customer_update`, `tax_id_collection` (autoliquidation UE) — aucun taux codé en dur.
- Garde `assertTaxComplianceReady()` : fail-closed LIVE sans enregistrement FR actif → satisfaite.

### 4. Webhook LIVE — PASS
- Endpoint applicatif : `https://project--…lovable.app/api/public/payments/webhook?env=live`
  — HTTPS, `status: enabled`, `livemode: true`.
- Événements : `customer.subscription.created/updated/deleted`, `checkout.session.completed`,
  `checkout.session.async_payment_succeeded/failed`, `invoice.paid`, `invoice.payment_failed`.
- Endpoint analytics Lovable (`api.lovable.dev/...`) présent en parallèle — normal, ne pas supprimer.
- Vérification de signature réelle : POST sans signature → **400**, POST avec signature
  invalide → **400**. Aucun traitement sans signature valide.
- Idempotence : insertion unique dans `stripe_webhook_events` conservée (validée en TEST).
- Aucun secret dans les logs (erreurs Stripe sanitisées via `sanitizeStripeError`).

### 5→17. Smoke test réel — **NON EXÉCUTÉ (bloqué par §2)**
Entreprise « PVIA LIVE SMOKE TEST », essai, Checkout LIVE, paiement, facture, webhook,
entitlements, /billing, /admin/billing, Customer Portal : impossibles tant que les prix
LIVE n'existent pas.

### 18. Sécurité (revue statique, sans toucher aux clients réels) — PASS
- `/admin/billing` : `requirePlatformAdmin` = rôle `platform_admin` **ET** domaine `@pvia.fr`
  (les deux conditions, jamais le domaine seul) ; refus journalisé en `audit_logs`.
- Utilisateur standard, admin d'entreprise et owner : refusés (aucun rôle entreprise
  n'ouvre le cockpit global).
- Factures : `assertCompanyBillingAdmin` + filtre `company_id` → aucune facture d'une
  autre entreprise accessible.
- Portal : session créée uniquement à partir du `stripe_customer_id` de l'entreprise
  du demandeur, après contrôle du rôle admin → usurpation impossible.

### Tableau de synthèse (phase 1)
| Contrôle | Verdict |
|---|---|
| Environment isolation | PASS |
| LIVE Prices | **FAIL** |
| Stripe Tax LIVE | PASS |
| Checkout LIVE | BLOQUÉ |
| Real payment | **WAITING FOR USER** |
| LIVE Webhooks | PASS |
| Subscription synchronization | non testé (LIVE) |
| Invoice / Invoice PDF | non testé (LIVE) |
| Customer Portal | non testé (LIVE) |
| PVIA entitlements | non testé (LIVE) |
| Billing UI / Admin Billing | non testé (LIVE) |
| Security | PASS |

**PVIA READY FOR PUBLIC LIVE PAYMENTS = NO**

Éléments bloquants :
1. Publier le projet pour synchroniser les 6 tarifs vers le compte Stripe LIVE.
2. Archiver le produit LIVE manuel « Abonament ».
3. Réaliser le paiement réel de smoke test (action utilisateur explicite).

## Smoke test LIVE — 31/08/2026 (avant paiement réel)

### 1. Catalogue LIVE (prices.list / products.list, livemode=true)

| Formule | lookup_key | Price ID | Montant | Devise | Intervalle | Actif | Produit | tax_behavior | livemode |
|---|---|---|---|---|---|---|---|---|---|
| Essentiel mensuel | starter_monthly | price_1UAco1GgaD8JqHXMbsysqzeB | 19,00 € HT | EUR | month | oui | PVIA Essentiel (actif) | unspecified → défaut compte `exclusive` (HT) | true |
| Essentiel annuel | starter_annual | price_1UAco1GgaD8JqHXMGbgrzHIM | 190,00 € HT | EUR | year | oui | PVIA Essentiel (actif) | idem | true |
| Pro mensuel | pro_monthly | price_1UAco0GgaD8JqHXM5TwOrdel | 59,00 € HT | EUR | month | oui | PVIA Pro (actif) | idem | true |
| Pro annuel | pro_annual | price_1UAco0GgaD8JqHXMSo33uVjU | 590,00 € HT | EUR | year | oui | PVIA Pro (actif) | idem | true |
| Business mensuel | business_monthly | price_1UAco2GgaD8JqHXMIOTBeXK0 | 149,00 € HT | EUR | month | oui | PVIA Business (actif) | idem | true |
| Business annuel | business_annual | price_1UAco1GgaD8JqHXMRfwqz0k3 | 1 490,00 € HT | EUR | year | oui | PVIA Business (actif) | idem | true |

Tax : `tax.settings` LIVE actif, siège FR, `defaults.tax_behavior = exclusive`,
enregistrement TVA **FR standard / active** en livemode. Les produits portent le
code fiscal SaaS `txcd_10103001`.

### 2. Produit obsolète
`prod_VAxwnwKqi6ltWT` « Abonament » : **archivé (active=false)**, aucun
`lookup_key` PVIA, aucune formule, aucun Checkout, aucun abonnement PVIA.
Aucun objet financier historique supprimé.

### 3. Entreprise de smoke test
`PVIA LIVE SMOKE TEST` — `17b7c914-af36-4106-9ce5-0de0bcfff47d`, environnement
production, essai unique 14 j attribué (`trial_started_at` 2026-08-31),
`company_has_write_access = true`, aucun abonnement payant, aucune facture.
Essai clôturé volontairement (`trial_ends_at = now`, `trial_started_at`
conservé) afin d'autoriser un encaissement réel immédiat — l'essai reste
consommé et non renouvelable.

### 4. Checkout LIVE préparé (non payé)
`cs_live_a14vixf0XMCXwKr6jYESNknFfAUoYzWYBCbTknTToTtDyfETTUn0osnZ87`
— livemode=true, price `starter_monthly` 1900 EUR/month, customer LIVE
`cus_VAyrP4v5qgKms8` (metadata companyId/userId), `automatic_tax.enabled=true`
(`requires_location_inputs` avant saisie d'adresse), adresse de facturation
requise, collecte TVA intracom `if_supported`, metadata companyId + userId,
aucun objet TEST.

CATALOG LIVE = PASS
CHECKOUT LIVE = PASS
REAL PAYMENT = WAITING FOR USER
PVIA READY FOR PUBLIC LIVE PAYMENTS = NO

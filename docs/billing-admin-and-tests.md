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

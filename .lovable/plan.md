## Sprint Production QA & sécurité finale

### État existant constaté

- **Checklist** : `launch_checklist_items` contient déjà 30 items (auth, onboarding, PV no/with réserves, signatures onsite/remote OTP, PDF, emails client/entreprise, verrouillage, suppression refusée, levée, validation client, webhooks, push, Stripe, monitoring, PWA, CSP…). Les 20 tests demandés sont déjà couverts. `updateLaunchChecklistItem` gère statut + notes + tested_at + tested_by. UI à compléter au besoin (boutons réussi/échec).
- **Monitoring** : `/admin/monitoring` existe avec `app_errors`, stats, health snapshot serveur. À étendre avec emails/webhooks retrying/dead + actions relancer/marquer résolu.
- **Admin guard** : `requirePlatformAdmin` (email `@pvia.fr` + `user_roles.platform_admin`) déjà en place sur toutes les serverFn admin.

### P1 — Compléter la checklist UI

Vérifier que `admin.launch-checklist.tsx` affiche déjà status / notes / date / testeur / boutons réussi-échec. Si manquant, brancher les boutons sur `updateLaunchChecklistItem`. Ajouter 2-3 items manquants si nécessaire (expiration essai, admin support/monitoring couverts). Pas de migration sauf si gaps réels.

### P2 — Page `/admin/go-live`

Fichier : `src/routes/_authenticated/admin.go-live.tsx`
ServerFn : `src/lib/go-live.functions.ts` → `getGoLiveStatus()`

Retourne :

- Score checklist (passed / total, %)
- Emails : retrying, dead (depuis `email_send_log` état `dlq` / `error`)
- Webhooks : retrying, dead (depuis `webhook_deliveries` status `failed` / `dead`)
- `app_errors` critical non résolus
- Crons actifs (lecture `pg_cron.job` via RPC ou skip si non disponible → afficher N/A)
- Stripe configuré (`STRIPE_LIVE_API_KEY` ou sandbox)
- Resend configuré (`RESEND_API_KEY`)
- Domaine email (statut via `email_send_state` ou fallback "à vérifier")
- Nombre d'entreprises, PV signés
- Dernier test réussi (max(`tested_at`) checklist)

Décision serveur :

- **Bloqué** si checklist < 50% ou Stripe absent + emails dead > 0
- **Prêt sous réserve** si checklist 50-99% sans bloquant
- **Prêt publication** si checklist = 100%, emails dead = 0, webhooks dead = 0, critical = 0, Stripe + Resend configurés

UI : carte verdict + grille de métriques + lien vers `report`.

### P3 — Health endpoints publics

- `src/routes/api/public/health.ts` : GET → `{ ok: true, version, ts }` (200, sans secret).
- `src/routes/api/public/health/deep.ts` : GET, protégé par header `x-cron-secret` (`CRON_SECRET`). Renvoie :
  - DB (ping `companies`)
  - Storage (list `pv-assets`)
  - Resend configuré
  - Stripe configuré
  - VAPID configuré
  - Supabase auth (`auth.admin.listUsers` head)
  - cron secret OK
  - 200 si tout OK, 503 sinon.

Version lue depuis `package.json` (constante au build).

### P4 — Monitoring renforcé

Étendre `src/lib/monitoring.functions.ts` :

- `getEmailQueueStats()` : count par status (`queued`, `retrying`, `failed`, `dlq`, `sent`) depuis `email_send_log` derniers 7j + 10 derniers échecs.
- `getWebhookQueueStats()` : count `webhook_deliveries` par status + 10 derniers dead.
- `retryWebhookDelivery({ id })` : remet `status='pending'`, `next_attempt_at=now()`, `error=null`.
- `markEmailResolved({ id })` : tag `resolved=true` (ou note) sur `email_send_log`.
- `retryEmailSend({ id })` : reset `status='queued'`, attempts=0 si la table le permet.

Page `admin.monitoring.tsx` : nouveaux blocs "File emails" et "File webhooks" avec listes + boutons relancer / résolu.

### P5 — Rapport final `/admin/go-live/report`

Fichier : `src/routes/_authenticated/admin.go-live.report.tsx`
Reutilise `getGoLiveStatus` + ajoute `getGoLiveReport()` qui compile :

- État sécurité (RLS via supabase linter count, role admin = 0)
- Conformité (compliance_checklist_items % done)
- Emails (queue + DLQ)
- Webhooks (queue + dead)
- Stripe (clés présentes, subscriptions actives)
- Stockage (taille buckets, échantillon)
- PV/signature (total, signés, verrouillés, signatures à distance vs onsite)
- Risques restants (texte généré à partir des compteurs)
- Décision finale (réutilise verdict de P2)

Bouton "Export Markdown" + version imprimable. Pas de PDF natif (rendu navigateur via `window.print`).

### Sécurité

- Toutes les serverFn nouvelles utilisent `requireSupabaseAuth` + `requirePlatformAdmin`.
- Routes `/admin/go-live*` ont `beforeLoad` avec `isPlatformAdminEmail`.
- `/api/public/health/deep` exige `x-cron-secret === process.env.CRON_SECRET` (timing-safe compare).
- `/api/public/health` reste public mais ne fuite aucun détail.

### Détails techniques

```text
src/lib/go-live.functions.ts        (nouveau)
src/lib/go-live-report.functions.ts (nouveau)
src/lib/monitoring.functions.ts     (étendu : email/webhook stats + retry)
src/routes/_authenticated/admin.go-live.tsx          (nouveau)
src/routes/_authenticated/admin.go-live.report.tsx   (nouveau)
src/routes/_authenticated/admin.monitoring.tsx       (étendu : blocs email/webhook)
src/routes/_authenticated/admin.launch-checklist.tsx (vérif/complément UI)
src/routes/api/public/health.ts                      (nouveau)
src/routes/api/public/health.deep.ts                 (nouveau, x-cron-secret)
```

Aucune migration SQL (toutes les tables existent). `bunx tsc --noEmit` en fin.

### Tests

- `bunx tsc --noEmit` → 0 erreur
- `curl /api/public/health` → 200
- `curl /api/public/health/deep` sans header → 401, avec bon header → 200
- Toutes les routes `/admin/*` redirigent vers `/admin/forbidden` si email ≠ `@pvia.fr`
- GitHub se synchronise automatiquement

### Hors scope ce sprint

- pg_cron job introspection si RPC non dispo (afficher N/A)
- Export PDF natif du rapport (utilisera `window.print`)
- Test automatique end-to-end (Playwright) — checklist reste manuelle

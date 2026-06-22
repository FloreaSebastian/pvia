# Tests E2E PVIA (Playwright)

## Prérequis

Le dev server doit tourner (`bun run dev`) sur le port 8080 (ou définir `E2E_BASE_URL`).

## Variables d'environnement requises

Les tests utilisent des comptes existants définis via variables d'environnement.
Créez un fichier `.env.e2e` (non commité) ou exportez les variables avant de lancer :

```bash
# URL de base (optionnel, défaut http://localhost:8080)
E2E_BASE_URL=http://localhost:8080

# Comptes test (un par rôle)
E2E_DIRECTEUR_EMAIL=...
E2E_DIRECTEUR_PASSWORD=...

E2E_RESPONSABLE_EMAIL=...
E2E_RESPONSABLE_PASSWORD=...

E2E_CONDUCTEUR_EMAIL=...
E2E_CONDUCTEUR_PASSWORD=...

E2E_TECHNICIEN_EMAIL=...
E2E_TECHNICIEN_PASSWORD=...

E2E_ASSISTANT_EMAIL=...
E2E_ASSISTANT_PASSWORD=...

E2E_LECTURE_SEULE_EMAIL=...
E2E_LECTURE_SEULE_PASSWORD=...
```

Tout test dont les variables manquent est automatiquement `skip()`.

## Lancer

```bash
bunx playwright install chromium   # une seule fois
bunx playwright test                # tous les tests
bunx playwright test auth.spec      # un fichier
bunx playwright test --ui           # mode interactif
bunx playwright show-report         # rapport HTML
```

## Scénarios couverts

- `auth.spec.ts` — login / logout / redirection vers /auth quand non connecté.
- `permissions.spec.ts` — guards route-level (/parametres/api, /facturation, /equipe, /entreprise) selon les rôles.
- `chantier-flow.spec.ts` — création chantier, ouverture du dossier, navigation onglets.
- `reserves-flow.spec.ts` — ouverture d'une réserve, passage en cours, levée, validation client.
- `system-health.spec.ts` — accès admin → lancement audit système → vérification résultats.

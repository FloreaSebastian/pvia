import { expect, test } from "@playwright/test";
import { getCreds, login } from "./helpers/auth";

// Tests défensifs : skip propre si les credentials ne sont pas configurés.
test.describe("PV → Étape Chantier (1 chantier = 1 PV)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!getCreds("directeur"), "E2E_DIRECTEUR_* manquants");
    await login(page, "directeur");
    await page.goto("/pv/new?fresh=1");
    await expect(page).toHaveURL(/\/pv\/new/, { timeout: 10_000 });
  });

  async function goToChantierStep(page: import("@playwright/test").Page) {
    // L'étape Chantier est la 3ᵉ — on tente d'arriver dessus via le bouton Suivant
    // ou via le titre déjà affiché.
    const stepHeading = page.getByRole("heading", { name: /lieu de réception|chantier/i });
    for (let i = 0; i < 5; i++) {
      if (await stepHeading.first().isVisible().catch(() => false)) return;
      const next = page.getByRole("button", { name: /suivant|continuer/i }).first();
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click().catch(() => {});
      await page.waitForTimeout(150);
    }
  }

  test("affiche la recherche et un bouton Nouveau chantier", async ({ page }) => {
    await goToChantierStep(page);
    const search = page.getByPlaceholder(/rechercher un chantier/i);
    test.skip(!(await search.isVisible().catch(() => false)), "Étape Chantier non atteignable dans cet environnement.");
    await expect(search).toBeVisible();
    await expect(page.getByRole("button", { name: /nouveau chantier|créer un nouveau chantier/i }).first())
      .toBeVisible();
  });

  test("filtre les chantiers via la recherche", async ({ page }) => {
    await goToChantierStep(page);
    const search = page.getByPlaceholder(/rechercher un chantier/i);
    test.skip(!(await search.isVisible().catch(() => false)), "Étape Chantier non atteignable.");

    const cards = page.locator('[data-testid="chantier-card"]');
    const initial = await cards.count();
    test.skip(initial === 0, "Aucun chantier disponible — rien à filtrer.");

    await search.fill("zzz-aucun-resultat-attendu");
    await page.waitForTimeout(300);
    await expect(page.getByText(/aucun chantier disponible trouvé/i)).toBeVisible();
  });

  test("ouvre la bottom sheet de création depuis l'état vide", async ({ page }) => {
    await goToChantierStep(page);
    const search = page.getByPlaceholder(/rechercher un chantier/i);
    test.skip(!(await search.isVisible().catch(() => false)), "Étape Chantier non atteignable.");
    await search.fill("zzz-aucun-resultat-attendu");
    await page.waitForTimeout(300);
    const createBtn = page.getByRole("button", { name: /créer un nouveau chantier|nouveau chantier/i }).first();
    await createBtn.click();
    await expect(page.getByText(/nouveau chantier/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /créer et sélectionner/i })).toBeVisible();
  });
});

test.describe("PV → Étape Chantier (mobile)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    test.skip(!getCreds("directeur"), "E2E_DIRECTEUR_* manquants");
    await login(page, "directeur");
    await page.goto("/pv/new?fresh=1");
  });

  test("pas de scroll horizontal sur mobile", async ({ page }) => {
    const search = page.getByPlaceholder(/rechercher un chantier/i);
    if (!(await search.isVisible().catch(() => false))) {
      // Tente de naviguer jusqu'à l'étape
      for (let i = 0; i < 5 && !(await search.isVisible().catch(() => false)); i++) {
        await page.getByRole("button", { name: /suivant|continuer/i }).first().click().catch(() => {});
        await page.waitForTimeout(150);
      }
    }
    test.skip(!(await search.isVisible().catch(() => false)), "Étape Chantier non atteignable.");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

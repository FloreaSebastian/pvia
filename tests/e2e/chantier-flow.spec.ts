import { expect, test } from "@playwright/test";
import { getCreds, login } from "./helpers/auth";

test.describe("Flux Chantier", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!getCreds("directeur"), "E2E_DIRECTEUR_* manquants");
    await login(page, "directeur");
  });

  test("liste chantiers accessible", async ({ page }) => {
    await page.goto("/chantiers");
    await expect(page.getByRole("heading", { name: /chantiers/i }).first()).toBeVisible();
  });

  test("création chantier ouvre le formulaire", async ({ page }) => {
    await page.goto("/chantiers");
    const createBtn = page
      .getByRole("button", { name: /nouveau chantier|créer.*chantier|ajouter/i })
      .first();
    if (await createBtn.isVisible().catch(() => false)) {
      await createBtn.click();
      await expect(page.getByLabel(/nom|libellé|intitulé/i).first()).toBeVisible();
    } else {
      test.skip(true, "Bouton création non visible (rôle ou UI)");
    }
  });

  test("ouverture d'un chantier affiche les onglets dossier", async ({ page }) => {
    await page.goto("/chantiers");
    const firstRow = page.locator("a[href*='/chantiers/']").first();
    if (!(await firstRow.isVisible().catch(() => false))) {
      test.skip(true, "Aucun chantier existant pour ce compte");
    }
    await firstRow.click();
    await expect(page.getByRole("tab").first()).toBeVisible({ timeout: 10_000 });
  });
});

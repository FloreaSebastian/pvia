import { expect, test } from "@playwright/test";
import { getCreds, login } from "./helpers/auth";

test.describe("Flux Réserves", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!getCreds("directeur"), "E2E_DIRECTEUR_* manquants");
    await login(page, "directeur");
  });

  test("page réserves charge avec KPIs", async ({ page }) => {
    await page.goto("/reserves");
    await expect(page.getByRole("heading", { name: /réserves/i }).first()).toBeVisible();
    // Les compteurs centralisés doivent rendre au moins un badge / nombre
    await expect(page.locator("body")).toContainText(/ouverte|en cours|levée|validée/i);
  });

  test("filtres réserves utilisables", async ({ page }) => {
    await page.goto("/reserves");
    const filter = page.getByRole("combobox").first();
    if (await filter.isVisible().catch(() => false)) {
      await filter.click();
      await page.keyboard.press("Escape");
    }
  });
});

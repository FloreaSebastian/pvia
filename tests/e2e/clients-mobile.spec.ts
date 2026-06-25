import { expect, test } from "@playwright/test";
import { getCreds, login } from "./helpers/auth";

// Tests mobile-only de la page Clients (compacité, filtres scrollables, menu actions).
test.describe("Clients — Mobile", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Réservé au projet mobile");
    test.skip(!getCreds("directeur"), "E2E_DIRECTEUR_* manquants");
    await login(page, "directeur");
    await page.goto("/clients");
    await page.waitForLoadState("networkidle");
  });

  test("pas de scroll horizontal global", async ({ page }) => {
    const overflow = await page.evaluate(() => {
      const d = document.documentElement;
      return { sw: d.scrollWidth, cw: d.clientWidth };
    });
    expect(overflow.sw).toBeLessThanOrEqual(overflow.cw + 1);
  });

  test("bouton Nouveau accessible", async ({ page }) => {
    await expect(page.getByTestId("clients-new-button")).toBeVisible();
  });

  test("filtres mobile visibles sur une ligne scrollable", async ({ page }) => {
    const filters = page.getByTestId("clients-filters-mobile");
    await expect(filters).toBeVisible();
    await expect(page.getByTestId("clients-type-all")).toBeVisible();
    await expect(page.getByTestId("clients-type-particulier")).toBeVisible();
    await expect(page.getByTestId("clients-type-entreprise")).toBeVisible();
  });

  test("onglet Archives accessible (si visible)", async ({ page }) => {
    const archives = page.getByTestId("clients-scope-archived");
    if (await archives.count()) {
      await archives.first().click();
      await expect(archives.first()).toHaveAttribute("aria-pressed", "true");
    }
  });

  test("menu actions client accessible", async ({ page }) => {
    const menus = page.getByTestId("client-actions-menu");
    if (await menus.count()) {
      await expect(menus.first()).toBeVisible();
    }
  });
});

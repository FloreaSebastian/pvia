import { expect, test } from "@playwright/test";
import { getCreds, login } from "./helpers/auth";

// Tests mobile-only de la page Clients : actions principales toujours visibles,
// filtres scrollables horizontalement, aucun scroll horizontal global.
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

  test("actions Nouveau / Import / Export visibles sans scroll horizontal", async ({ page }) => {
    const actions = page.getByTestId("clients-actions-mobile");
    await expect(actions).toBeVisible();

    const nouveau = page.getByTestId("clients-new-button");
    const importer = page.getByTestId("clients-import-button");
    const exporter = page.getByTestId("clients-export-button");

    for (const btn of [nouveau, importer, exporter]) {
      await expect(btn).toBeVisible();
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        // Le bouton tient dans la largeur du viewport (pas de scroll horizontal nécessaire)
        const vw = page.viewportSize()?.width ?? 0;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(vw + 1);
      }
    }
  });

  test("filtres mobile utilisables", async ({ page }) => {
    const filters = page.getByTestId("clients-filters-mobile");
    await expect(filters).toBeVisible();
    await page.getByTestId("clients-type-particulier").click();
    await page.getByTestId("clients-type-entreprise").click();
    await page.getByTestId("clients-type-all").click();
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

import { expect, test } from "@playwright/test";
import { getCreds, login } from "./helpers/auth";

// Test ciblé sur le mode terrain mobile. Ne s'exécute QUE dans le projet "mobile"
// (émulation Pixel 7 configurée dans playwright.config.ts).
test.describe("Mode terrain — Mobile", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Réservé au projet mobile");
    test.skip(!getCreds("directeur"), "E2E_DIRECTEUR_* manquants");
    await login(page, "directeur");
  });

  test("BottomNav visible sur mobile", async ({ page }) => {
    await page.goto("/dashboard");
    // BottomNav: barre de navigation fixée en bas, généralement nav role
    const bottomNav = page.locator("nav").last();
    await expect(bottomNav).toBeVisible({ timeout: 10_000 });
  });

  test("page PV mobile — cartes au lieu du tableau, pas de scroll horizontal", async ({
    page,
  }) => {
    await page.goto("/pv");
    await expect(page.getByRole("heading", { name: /pv|procès/i }).first()).toBeVisible();

    // Le tableau desktop ne doit pas être visible (ou doit être masqué via md:block)
    const desktopTable = page.locator("table").first();
    const tableVisible = await desktopTable.isVisible().catch(() => false);
    expect(tableVisible, "Tableau desktop masqué sur mobile").toBe(false);

    // Aucun scroll horizontal sur la page
    const hasHScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(hasHScroll, "Pas de scroll horizontal").toBe(false);
  });

  test("viewport mobile respecté (largeur ≤ 480px)", async ({ page }) => {
    await page.goto("/dashboard");
    const width = page.viewportSize()?.width ?? 0;
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThanOrEqual(480);
  });

  test("navigation mobile vers les sections clés", async ({ page }) => {
    await page.goto("/dashboard");
    for (const route of ["/chantiers", "/pv", "/reserves"]) {
      await page.goto(route);
      // Doit charger sans crash (heading visible)
      await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 10_000 });
      const hasHScroll = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(hasHScroll, `Pas de scroll horizontal sur ${route}`).toBe(false);
    }
  });
});

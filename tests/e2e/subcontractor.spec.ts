import { expect, test } from "@playwright/test";

/**
 * Parcours sous-traitant — vérifications non authentifiées.
 * Les scénarios authentifiés (interventions, photos, permissions) nécessitent
 * un compte sous-traitant réel et sont couverts hors CI.
 */
test.describe("Espace sous-traitant", () => {
  test("l'onglet Sous-traitant est disponible sur /login", async ({ page }) => {
    await page.goto("/login?type=subcontractor");
    await expect(page.getByRole("tab", { name: "Sous-traitant" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Espace sous-traitant" })).toBeVisible();
  });

  test("le portail redirige vers la connexion quand non authentifié", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/sous-traitant");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test("une invitation invalide affiche un message clair", async ({ page }) => {
    await page.goto("/sous-traitant/invitation/jeton-invalide-pour-le-test-e2e");
    await expect(page.getByRole("heading", { name: "Invitation indisponible" })).toBeVisible({ timeout: 15_000 });
  });

  test("pas de débordement horizontal en 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/login?type=subcontractor");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);
  });
});

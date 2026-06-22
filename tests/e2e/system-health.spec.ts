import { expect, test } from "@playwright/test";
import { getCreds, login } from "./helpers/auth";

test.describe("Audit système (admin)", () => {
  test("directeur accède /admin/system-health et lance un audit", async ({ page }) => {
    test.skip(!getCreds("directeur"), "E2E_DIRECTEUR_* manquants");
    await login(page, "directeur");
    await page.goto("/admin/system-health");

    // Si l'utilisateur n'est pas platform_admin, la page peut afficher un message d'accès refusé
    const launchBtn = page.getByRole("button", { name: /lancer.*audit|exécuter.*audit/i }).first();
    if (!(await launchBtn.isVisible().catch(() => false))) {
      test.skip(true, "Compte directeur non platform_admin sur cet environnement");
    }
    await launchBtn.click();
    await expect(page.getByText(/contrôles|checks|résultats|status/i).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});

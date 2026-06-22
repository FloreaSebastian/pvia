import { expect, test } from "@playwright/test";
import { getCreds, login } from "./helpers/auth";

test.describe("Authentification", () => {
  test("redirige vers /auth quand non connecté sur route protégée", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/auth/, { timeout: 10_000 });
  });

  test("connexion directeur réussie", async ({ page }) => {
    const creds = getCreds("directeur");
    test.skip(!creds, "E2E_DIRECTEUR_* manquants");
    await login(page, "directeur");
    await expect(page).not.toHaveURL(/\/auth/);
  });
});

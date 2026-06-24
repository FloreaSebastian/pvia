import { expect, test } from "@playwright/test";
import { getCreds, login } from "./helpers/auth";

test.describe("Flux PV — Signature client", () => {
  test("page de signature publique répond (token invalide)", async ({ page, context }) => {
    await context.clearCookies();
    // Token bidon: la route doit gérer proprement (404, message d'erreur, redirection)
    const res = await page.goto("/sign/pv/invalid-token-e2e-test", {
      waitUntil: "domcontentloaded",
    });
    expect(res, "Réponse HTTP reçue").not.toBeNull();
    expect(res!.status(), "Pas de 5xx serveur").toBeLessThan(500);
    // Aucun crash React: un texte significatif est affiché
    await expect(page.locator("body")).toContainText(
      /signature|lien|expiré|invalide|introuvable|erreur|pv/i,
      { timeout: 10_000 },
    );
  });

  test("workflow interne signature accessible depuis fiche PV", async ({ page }) => {
    test.skip(!getCreds("directeur"), "E2E_DIRECTEUR_* manquants");
    await login(page, "directeur");
    await page.goto("/pv");

    const firstPv = page.locator("a[href*='/pv/']").first();
    if (!(await firstPv.isVisible().catch(() => false))) {
      test.skip(true, "Aucun PV existant pour tester la signature");
    }
    await firstPv.click();

    // On cherche un bouton/action de signature (signer, envoyer pour signature, OTP…)
    const signAction = page
      .getByRole("button", { name: /signer|signature|envoyer.*signature/i })
      .first()
      .or(page.getByRole("link", { name: /signer|signature/i }).first());

    if (!(await signAction.isVisible().catch(() => false))) {
      test.skip(true, "Action signature non visible (statut PV ou rôle)");
    }
    await signAction.click();
    // Une modale / page de signature doit s'ouvrir
    await expect(
      page.getByText(/signature|signer|code|otp|envoyer/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});

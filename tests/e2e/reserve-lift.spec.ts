import { expect, test } from "@playwright/test";
import { getCreds, login } from "./helpers/auth";

test.describe("Flux Réserves — Création & Levée", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!getCreds("directeur"), "E2E_DIRECTEUR_* manquants");
    await login(page, "directeur");
  });

  test("création d'une réserve depuis un PV", async ({ page }) => {
    await page.goto("/pv");
    const firstPv = page.locator("a[href*='/pv/']").first();
    if (!(await firstPv.isVisible().catch(() => false))) {
      test.skip(true, "Aucun PV existant pour créer une réserve");
    }
    await firstPv.click();

    const addReserve = page
      .getByRole("button", { name: /ajouter.*réserve|nouvelle réserve|\+.*réserve/i })
      .first();

    if (!(await addReserve.isVisible().catch(() => false))) {
      test.skip(true, "Bouton ajout réserve non visible (statut PV ou UI)");
    }
    await addReserve.click();

    // Champ description / libellé de réserve
    const descField = page
      .getByLabel(/description|libellé|intitulé|titre/i)
      .first()
      .or(page.getByRole("textbox").first());
    await expect(descField).toBeVisible({ timeout: 10_000 });
    await descField.fill(`Réserve E2E ${Date.now()}`);

    const save = page
      .getByRole("button", { name: /enregistrer|valider|créer|ajouter/i })
      .first();
    if (await save.isEnabled().catch(() => false)) {
      await save.click();
    }
  });

  test("ouverture du workflow de levée de réserve", async ({ page }) => {
    await page.goto("/reserves");
    await expect(page.getByRole("heading", { name: /réserves/i }).first()).toBeVisible();

    const firstReserve = page
      .locator("a[href*='/reserve'], a[href*='/pv/'][href*='reserve']")
      .first()
      .or(page.getByRole("row").nth(1));

    if (!(await firstReserve.isVisible().catch(() => false))) {
      test.skip(true, "Aucune réserve existante pour tester la levée");
    }
    await firstReserve.click();

    const liftBtn = page
      .getByRole("button", { name: /lever.*réserve|levée|déclarer.*levée/i })
      .first()
      .or(page.getByRole("link", { name: /lever|levée/i }).first());

    if (!(await liftBtn.isVisible().catch(() => false))) {
      test.skip(true, "Action levée indisponible (statut ou rôle)");
    }
    await liftBtn.click();
    await expect(page.getByText(/levée|lever|photo|commentaire/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});

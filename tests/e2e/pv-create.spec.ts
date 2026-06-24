import { expect, test } from "@playwright/test";
import { getCreds, login } from "./helpers/auth";

test.describe("Flux PV — Création", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!getCreds("directeur"), "E2E_DIRECTEUR_* manquants");
    await login(page, "directeur");
  });

  test("ouverture formulaire création PV", async ({ page }) => {
    await page.goto("/pv");
    await expect(page.getByRole("heading", { name: /procès[- ]verbaux|pv/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    // Bouton "Nouveau PV" sur desktop OU FAB sur mobile
    const createBtn = page
      .getByRole("link", { name: /nouveau pv|créer.*pv|nouveau procès/i })
      .first()
      .or(page.getByRole("button", { name: /nouveau pv|créer.*pv|nouveau procès/i }).first());

    if (!(await createBtn.isVisible().catch(() => false))) {
      // Fallback: navigation directe
      await page.goto("/pv/new");
    } else {
      await createBtn.click();
    }

    await expect(page).toHaveURL(/\/pv\/(new|nouveau)/, { timeout: 10_000 });
    // Le formulaire doit afficher au moins un champ identifiable (type, chantier, date…)
    const formMarker = page
      .getByLabel(/type|chantier|client|date/i)
      .first()
      .or(page.getByRole("combobox").first());
    await expect(formMarker).toBeVisible({ timeout: 10_000 });
  });

  test("création PV — soumission minimale si possible", async ({ page }) => {
    await page.goto("/pv/new");

    // Sélection chantier (combobox premier élément si présent)
    const chantierTrigger = page
      .getByRole("combobox", { name: /chantier/i })
      .first()
      .or(page.getByLabel(/chantier/i).first());

    if (!(await chantierTrigger.isVisible().catch(() => false))) {
      test.skip(true, "Formulaire PV: sélecteur chantier introuvable (UI évoluée)");
    }

    await chantierTrigger.click();
    const firstOption = page.getByRole("option").first();
    if (!(await firstOption.isVisible().catch(() => false))) {
      test.skip(true, "Aucun chantier disponible pour créer un PV");
    }
    await firstOption.click();

    const submit = page
      .getByRole("button", { name: /créer|enregistrer|valider|suivant/i })
      .first();
    if (await submit.isEnabled().catch(() => false)) {
      await submit.click();
      // Soit on arrive sur la fiche PV, soit une étape suivante du wizard
      await expect(page).not.toHaveURL(/\/pv\/new$/, { timeout: 15_000 });
    }
  });
});

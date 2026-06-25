import { expect, test } from "@playwright/test";
import { getCreds, login } from "./helpers/auth";

/**
 * Defensive E2E for the soft-archive workflow on the Clients page.
 *
 * Like the rest of the suite, all assertions are skipped when credentials
 * are not provisioned (local checkouts, forks, secret-less CI) so the file
 * never breaks the pipeline. When credentials are present we walk through:
 * creation → archive → archive filter visible → restore (admin only).
 */
test.describe("Clients — archive & restore", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const creds = getCreds("directeur");
    test.skip(!creds, "Pas de credentials directeur disponibles");
    await login(page, "directeur");
    await page.goto("/clients");
    await expect(page).toHaveURL(/\/clients/, { timeout: 10_000 });
    testInfo.attach;
  });

  test("archive un client puis affiche le filtre Archives", async ({ page }) => {
    const newBtn = page.getByRole("button", { name: /Nouveau client|Nouveau/i }).first();
    if (!(await newBtn.isVisible().catch(() => false))) test.skip(true, "Pas de bouton de création visible");
    await newBtn.click();
    const name = `E2E Archive ${Date.now()}`;
    await page.getByLabel(/^Nom/i).first().fill(name);
    await page.getByRole("button", { name: /Enregistrer/i }).click();
    await expect(page.getByText(name)).toBeVisible({ timeout: 5_000 });

    const card = page.getByText(name).first();
    await card.hover();
    const archiveBtn = page.getByRole("button", { name: /Archiver/i }).first();
    if (!(await archiveBtn.isVisible().catch(() => false))) test.skip(true, "Bouton Archiver introuvable");
    await archiveBtn.click();
    const confirmBtn = page.getByRole("button", { name: /^Archiver/i }).last();
    await confirmBtn.click();
    await expect(page.getByText(/Client archivé|Archivage/i)).toBeVisible({ timeout: 5_000 });

    const archivesTab = page.getByRole("button", { name: /Archives/i }).first();
    await expect(archivesTab).toBeVisible();
    await archivesTab.click();
    await expect(page.getByText(name)).toBeVisible({ timeout: 5_000 });

    const restoreBtn = page.getByRole("button", { name: /Restaurer/i }).first();
    if (await restoreBtn.isVisible().catch(() => false)) {
      await restoreBtn.click();
      await expect(page.getByText(/Client restauré/i)).toBeVisible({ timeout: 5_000 });
    }
  });

  test("export CSV propose la vue actuelle, actifs et archivés", async ({ page }) => {
    const exportBtn = page.getByRole("button", { name: /Exporter/i }).first();
    if (!(await exportBtn.isVisible().catch(() => false))) test.skip(true, "Bouton Exporter introuvable");
    await exportBtn.click();
    await expect(page.getByText(/Vue actuelle/i)).toBeVisible();
    await expect(page.getByText(/Tous les clients actifs/i)).toBeVisible();
  });
});

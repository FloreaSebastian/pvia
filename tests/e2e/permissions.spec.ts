import { expect, test, type Page } from "@playwright/test";
import { getCreds, login, type Role } from "./helpers/auth";

async function expectAllowed(page: Page, path: string) {
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(path.replace(/\//g, "\\/")), { timeout: 10_000 });
}

async function expectDenied(page: Page, path: string) {
  await page.goto(path);
  // Guard redirige vers /dashboard avec toast
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
}

const matrix: Array<{
  path: string;
  allowed: Role[];
  denied: Role[];
}> = [
  {
    path: "/parametres/api",
    allowed: ["directeur", "responsable"],
    denied: ["conducteur", "technicien", "assistant", "lecture_seule"],
  },
  {
    path: "/parametres/integrations",
    allowed: ["directeur", "responsable"],
    denied: ["conducteur", "technicien", "assistant", "lecture_seule"],
  },
  {
    path: "/facturation",
    allowed: ["directeur"],
    denied: ["responsable", "conducteur", "technicien", "assistant", "lecture_seule"],
  },
  {
    path: "/equipe",
    allowed: ["directeur", "responsable"],
    denied: ["conducteur", "technicien", "assistant", "lecture_seule"],
  },
  {
    path: "/entreprise",
    allowed: ["directeur"],
    denied: ["responsable", "conducteur", "technicien", "assistant", "lecture_seule"],
  },
];

for (const { path, allowed, denied } of matrix) {
  test.describe(`Guard route ${path}`, () => {
    for (const role of allowed) {
      test(`${role} → autorisé`, async ({ page }) => {
        test.skip(!getCreds(role), `creds ${role} absents`);
        await login(page, role);
        await expectAllowed(page, path);
      });
    }
    for (const role of denied) {
      test(`${role} → refusé (redirection /dashboard)`, async ({ page }) => {
        test.skip(!getCreds(role), `creds ${role} absents`);
        await login(page, role);
        await expectDenied(page, path);
      });
    }
  });
}

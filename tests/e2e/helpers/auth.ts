import { expect, type Page, test } from "@playwright/test";

export type Role =
  | "directeur"
  | "responsable"
  | "conducteur"
  | "technicien"
  | "assistant"
  | "lecture_seule";

const envMap: Record<Role, { email: string; password: string }> = {
  directeur: {
    email: "E2E_DIRECTEUR_EMAIL",
    password: "E2E_DIRECTEUR_PASSWORD",
  },
  responsable: {
    email: "E2E_RESPONSABLE_EMAIL",
    password: "E2E_RESPONSABLE_PASSWORD",
  },
  conducteur: {
    email: "E2E_CONDUCTEUR_EMAIL",
    password: "E2E_CONDUCTEUR_PASSWORD",
  },
  technicien: {
    email: "E2E_TECHNICIEN_EMAIL",
    password: "E2E_TECHNICIEN_PASSWORD",
  },
  assistant: {
    email: "E2E_ASSISTANT_EMAIL",
    password: "E2E_ASSISTANT_PASSWORD",
  },
  lecture_seule: {
    email: "E2E_LECTURE_SEULE_EMAIL",
    password: "E2E_LECTURE_SEULE_PASSWORD",
  },
};

export function getCreds(role: Role): { email: string; password: string } | null {
  const keys = envMap[role];
  const email = process.env[keys.email];
  const password = process.env[keys.password];
  if (!email || !password) return null;
  return { email, password };
}

export function requireCreds(role: Role): { email: string; password: string } {
  const creds = getCreds(role);
  if (!creds) {
    test.skip(true, `Comptes E2E manquants pour rôle "${role}" (${envMap[role].email}/${envMap[role].password})`);
    // unreachable
    throw new Error("skip");
  }
  return creds;
}

export async function login(page: Page, role: Role): Promise<void> {
  const { email, password } = requireCreds(role);
  await page.goto("/auth");
  await page.getByLabel(/email/i).first().fill(email);
  await page.getByLabel(/mot de passe|password/i).first().fill(password);
  await page.getByRole("button", { name: /se connecter|connexion|sign in/i }).click();
  await expect(page).toHaveURL(/\/(dashboard|chantiers|reserves|$)/, { timeout: 15_000 });
}

export async function logout(page: Page): Promise<void> {
  // Cherche un bouton/menu de déconnexion
  const btn = page.getByRole("button", { name: /déconnexion|se déconnecter|logout/i }).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
  } else {
    // Fallback: vider le storage
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto("/auth");
  }
}

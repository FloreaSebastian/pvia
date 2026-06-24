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
  await page.goto("/login");
  await page.getByLabel(/email/i).first().fill(email);
  // L'app utilise un flux OTP (code email) par défaut. Si un champ "mot de passe"
  // existe (mode test/legacy), on le remplit, sinon on s'arrête au code envoyé.
  const pwd = page.getByLabel(/mot de passe|password/i).first();
  if (await pwd.isVisible().catch(() => false)) {
    await pwd.fill(password);
    await page.getByRole("button", { name: /se connecter|connexion|sign in/i }).click();
    await expect(page).toHaveURL(/\/(dashboard|chantiers|reserves|$)/, { timeout: 15_000 });
  } else {
    test.skip(true, `Auth UI passwordless (OTP) : login E2E par mot de passe indisponible pour "${role}".`);
  }
}

export async function logout(page: Page): Promise<void> {
  const btn = page.getByRole("button", { name: /déconnexion|se déconnecter|logout/i }).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
  } else {
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto("/login");
  }
}

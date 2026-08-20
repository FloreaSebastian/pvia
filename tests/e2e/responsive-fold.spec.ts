import { expect, test } from "@playwright/test";

/**
 * Garde-fou responsive : aucune page ne doit provoquer de scroll horizontal
 * global, y compris aux largeurs atypiques des smartphones pliables.
 */
const WIDTHS = [320, 360, 375, 412, 480, 600, 720, 768, 840, 1024, 1280, 1440];
const PUBLIC_ROUTES = ["/", "/login", "/tarifs", "/client/login"];

test.describe("Responsive — largeurs classiques et pliables", () => {
  for (const width of WIDTHS) {
    test(`aucun overflow horizontal à ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const route of PUBLIC_ROUTES) {
        await page.goto(route);
        await page.waitForLoadState("domcontentloaded");
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${route} @ ${width}px`).toBeLessThanOrEqual(1);
      }
    });
  }

  test("changement de posture Fold fermé → ouvert sans rechargement", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    await page.setViewportSize({ width: 840, height: 900 });
    await page.waitForTimeout(300);
    let overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "Fold ouvert").toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 360, height: 900 });
    await page.waitForTimeout(300);
    overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "Fold refermé").toBeLessThanOrEqual(1);
  });
});

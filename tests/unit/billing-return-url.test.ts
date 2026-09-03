import { describe, expect, it } from "bun:test";
import { isTrustedBillingOrigin, resolveBillingReturnUrl } from "../../src/lib/billing-return-url";

const CANON = "https://pvia.fr";

describe("URL de retour Stripe", () => {
  it("accepte le domaine canonique et les sous-domaines PVIA", () => {
    expect(resolveBillingReturnUrl("https://pvia.fr/billing", CANON)).toBe("https://pvia.fr/billing");
    expect(resolveBillingReturnUrl("https://app.pvia.fr/billing", CANON)).toBe("https://app.pvia.fr/billing");
    expect(resolveBillingReturnUrl("https://www.pvia.fr/billing", CANON)).toBe("https://www.pvia.fr/billing");
  });

  it("accepte les previews Lovable et le local", () => {
    expect(resolveBillingReturnUrl("https://pvia.lovable.app/billing", CANON)).toBe(
      "https://pvia.lovable.app/billing",
    );
    expect(resolveBillingReturnUrl("http://localhost:8080/billing", CANON)).toBe(
      "http://localhost:8080/billing",
    );
  });

  it("refuse toute origine étrangère → repli canonique", () => {
    for (const evil of [
      "https://evil.example.com/billing",
      "https://pvia.fr.evil.com/billing",
      "https://evilpvia.fr/billing",
      "http://pvia.fr/billing",
      "javascript:alert(1)",
      "not-a-url",
      "",
      null,
      undefined,
    ]) {
      expect(resolveBillingReturnUrl(evil as any, CANON)).toBe("https://pvia.fr/billing");
    }
  });

  it("ignore le chemin fourni : toujours /billing", () => {
    expect(resolveBillingReturnUrl("https://pvia.fr/dashboard?x=1", CANON)).toBe("https://pvia.fr/billing");
    expect(resolveBillingReturnUrl("https://app.pvia.fr/", CANON)).toBe("https://app.pvia.fr/billing");
  });

  it("isTrustedBillingOrigin est strict sur le schéma", () => {
    expect(isTrustedBillingOrigin("https://app.pvia.fr", CANON)).toBe(true);
    expect(isTrustedBillingOrigin("http://app.pvia.fr", CANON)).toBe(false);
  });
});

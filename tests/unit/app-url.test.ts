import { describe, expect, it } from "bun:test";
import { normalizeAppUrl } from "../../src/lib/app-url.server";

describe("normalizeAppUrl", () => {
  it("ajoute https:// quand le schéma est absent", () => {
    expect(normalizeAppUrl("pvia.fr")).toBe("https://pvia.fr");
  });

  it("supprime le slash final", () => {
    expect(normalizeAppUrl("https://pvia.fr/")).toBe("https://pvia.fr");
    expect(normalizeAppUrl("pvia.fr///")).toBe("https://pvia.fr");
  });

  it("force https en production", () => {
    expect(normalizeAppUrl("http://pvia.fr")).toBe("https://pvia.fr");
  });

  it("replie sur https://pvia.fr si vide/invalide", () => {
    expect(normalizeAppUrl("")).toBe("https://pvia.fr");
    expect(normalizeAppUrl("   ")).toBe("https://pvia.fr");
    expect(normalizeAppUrl(undefined)).toBe("https://pvia.fr");
    expect(normalizeAppUrl(null)).toBe("https://pvia.fr");
  });

  it("conserve http:// uniquement en local", () => {
    expect(normalizeAppUrl("http://localhost:8080")).toBe("http://localhost:8080");
    expect(normalizeAppUrl("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
  });

  it("ne produit jamais une URL relative", () => {
    for (const v of ["pvia.fr", "https://pvia.fr/", "", "  /pvia.fr "]) {
      expect(normalizeAppUrl(v).startsWith("http")).toBe(true);
    }
  });
});

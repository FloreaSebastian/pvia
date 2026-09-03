import { describe, expect, it } from "bun:test";
import { resolveEmailRedirect } from "../../src/lib/signup.functions";

const CANON = "https://pvia.fr";

describe("resolveEmailRedirect", () => {
  it("garde le chemin d'une origine canonique", () => {
    expect(resolveEmailRedirect("https://pvia.fr/dashboard", "https://pvia.fr", CANON)).toBe(
      "https://pvia.fr/dashboard",
    );
  });

  it("rejette une origine externe et retombe sur /dashboard", () => {
    expect(resolveEmailRedirect("https://evil.example.com/steal", "https://pvia.fr", CANON)).toBe(
      "https://pvia.fr/dashboard",
    );
  });

  it("ignore une origine de requête non fiable", () => {
    expect(resolveEmailRedirect(undefined, "https://evil.example.com", CANON)).toBe(
      "https://pvia.fr/dashboard",
    );
  });

  it("préserve localhost en développement", () => {
    expect(
      resolveEmailRedirect("http://localhost:8080/dashboard", "http://localhost:8080", CANON),
    ).toBe("http://localhost:8080/dashboard");
  });

  it("préserve les previews lovable.app", () => {
    const origin = "https://id-preview--abc.lovable.app";
    expect(resolveEmailRedirect(`${origin}/dashboard`, origin, CANON)).toBe(`${origin}/dashboard`);
  });

  it("neutralise un chemin protocol-relative", () => {
    expect(resolveEmailRedirect("https://pvia.fr//evil.com", "https://pvia.fr", CANON)).toBe(
      "https://pvia.fr/dashboard",
    );
  });
});

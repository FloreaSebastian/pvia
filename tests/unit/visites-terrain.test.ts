import { describe, expect, it } from "vitest";
import { FEATURE_FLAGS, assertFeatureEnabled, isFeatureEnabled, MODULE_UNAVAILABLE_MESSAGE } from "@/lib/feature-flags";
import { QuickClientSchema } from "@/lib/visites/schemas";
import { searchVisits } from "@/lib/visites/search";
import { pdfSafe, VISIT_PDF_SCOPE_NOTE } from "@/lib/visites/report";

const CID = "11111111-1111-4111-8111-111111111111";

describe("module Cahiers des charges masqué", () => {
  it("le module est désactivé par l'interrupteur central", () => {
    expect(FEATURE_FLAGS.studies).toBe(false);
    expect(isFeatureEnabled("studies")).toBe(false);
  });

  it("les gardes serveur refusent avec un message compréhensible", () => {
    expect(() => assertFeatureEnabled("studies")).toThrow(MODULE_UNAVAILABLE_MESSAGE);
  });
});

describe("création rapide de client (visite technique)", () => {
  it("exige un nom", () => {
    expect(QuickClientSchema.safeParse({ companyId: CID, name: "" }).success).toBe(false);
  });

  it("refuse un e-mail, un téléphone ou un code postal invalides", () => {
    expect(QuickClientSchema.safeParse({ companyId: CID, name: "Dupont", email: "pas-un-email" }).success).toBe(false);
    expect(QuickClientSchema.safeParse({ companyId: CID, name: "Dupont", phone: "abc" }).success).toBe(false);
    expect(QuickClientSchema.safeParse({ companyId: CID, name: "Dupont", postal_code: "7500" }).success).toBe(false);
  });

  it("accepte un particulier minimal et n'autorise que les types existants", () => {
    const ok = QuickClientSchema.parse({ companyId: CID, name: "Dupont", postal_code: "75011", phone: "06 12 34 56 78" });
    expect(ok.client_type).toBe("particulier");
    expect(QuickClientSchema.safeParse({ companyId: CID, name: "Dupont", client_type: "professionnel" }).success).toBe(false);
  });
});

describe("recherche des visites", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({
    reference: `VT${String(i).padStart(4, "0")}`,
    chantier: { name: i === 27 ? "Toiture Martin" : `Chantier ${i}`, city: "Lyon", postal_code: "69003" },
    client: { name: i === 27 ? "M. Martin" : `Client ${i}` },
  }));

  it("trouve une visite située au-delà de la première page", () => {
    const r = searchVisits(rows, "martin", 0, 20);
    expect(r.total).toBe(1);
    expect(r.page[0].reference).toBe("VT0027");
  });

  it("pagine les résultats filtrés", () => {
    const r = searchVisits(rows, "lyon", 20, 20);
    expect(r.total).toBe(30);
    expect(r.page).toHaveLength(10);
    expect(r.hasMore).toBe(false);
  });
});

describe("rapport PDF de visite", () => {
  it("ne prétend à aucune conformité réglementaire ni dimensionnement", () => {
    expect(VISIT_PDF_SCOPE_NOTE).toMatch(/ni une attestation de conformité/);
    expect(VISIT_PDF_SCOPE_NOTE).toMatch(/ni une étude de dimensionnement/);
  });

  it("remplace les caractères non imprimables par la police PDF", () => {
    expect(pdfSafe("Pente 30° — l’accès…")).toBe("Pente 30° - l'accès...");
    expect(pdfSafe("☀ OK")).toBe(" OK");
  });
});

/**
 * PVIA Module Database — tests du noyau catalogue.
 * Deux références réelles de géométries différentes doivent produire des
 * encombrements différents, sans aucune dimension générique.
 */
import { describe, expect, it } from "vitest";
import {
  formatModuleDimensions,
  formatModuleMeters,
  hasUsableDimensions,
  isGeometricallyInterchangeable,
  moduleDepthMeters,
  moduleMatchesQuery,
  moduleSizeMeters,
  normalizeModuleText,
  validateCustomModule,
} from "@/lib/solar/module-catalog";

const A = { width_mm: 1134, height_mm: 2278, depth_mm: 30 };
const B = { width_mm: 1134, height_mm: 1762, depth_mm: 30 };

describe("dimensions réelles", () => {
  it("convertit exactement les millimètres en mètres", () => {
    const a = moduleSizeMeters(A, "portrait");
    expect(a.width).toBe(1.134);
    expect(a.length).toBe(2.278);
  });

  it("inverse les côtés en paysage", () => {
    const a = moduleSizeMeters(A, "paysage");
    expect(a.width).toBe(2.278);
    expect(a.length).toBe(1.134);
  });

  it("distingue deux modules de géométries différentes", () => {
    expect(moduleSizeMeters(A, "portrait").length).not.toBe(moduleSizeMeters(B, "portrait").length);
    expect(isGeometricallyInterchangeable(A, B)).toBe(false);
    expect(isGeometricallyInterchangeable(A, { ...A, depth_mm: 35 })).toBe(true);
  });

  it("utilise l'épaisseur publiée", () => {
    expect(moduleDepthMeters(A)).toBeCloseTo(0.03, 6);
    expect(moduleDepthMeters({ ...A, depth_mm: null })).toBeCloseTo(0.035, 6);
    expect(moduleDepthMeters({ ...A, depth_mm: 5000 })).toBeCloseTo(0.035, 6);
  });
});

describe("dimensions manquantes", () => {
  it("refuse une référence sans dimensions", () => {
    expect(hasUsableDimensions({ width_mm: null, height_mm: 2278, depth_mm: null })).toBe(false);
    expect(hasUsableDimensions({ width_mm: 10, height_mm: 2278, depth_mm: null })).toBe(false);
    expect(hasUsableDimensions(A)).toBe(true);
  });

  it("affiche un libellé explicite", () => {
    expect(formatModuleDimensions(A)).toBe("1134 × 2278 × 30 mm");
    expect(formatModuleDimensions({ width_mm: null, height_mm: null, depth_mm: null })).toBe(
      "Dimensions non publiées",
    );
    expect(formatModuleMeters(A)).toBe("1.134 × 2.278 m");
  });
});

describe("recherche", () => {
  it("ignore accents, casse et ponctuation", () => {
    expect(normalizeModuleText("JA Solar JAM54D40-440/LB")).toBe("ja solar jam54d40 440 lb");
    expect(moduleMatchesQuery("JA Solar JAM54D40-440/LB", "ja 440")).toBe(true);
    expect(moduleMatchesQuery("JA Solar JAM54D40-440/LB", "trina")).toBe(false);
  });
});

describe("saisie d'un module entreprise", () => {
  const base = { manufacturer: "Acme", model: "AC-440", power_wc: 440, width_mm: 1134, height_mm: 2278 };

  it("accepte une saisie cohérente", () => {
    expect(validateCustomModule(base)).toEqual([]);
  });

  it("refuse des valeurs aberrantes", () => {
    expect(validateCustomModule({ ...base, width_mm: 12 }).length).toBe(1);
    expect(validateCustomModule({ ...base, power_wc: 99999 }).length).toBe(1);
    expect(validateCustomModule({ ...base, model: "" }).length).toBe(1);
    expect(validateCustomModule({ ...base, depth_mm: 900 }).length).toBe(1);
  });
});

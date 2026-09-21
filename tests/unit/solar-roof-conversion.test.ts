/**
 * P0-B.2 — garde-fous de conversion et cohérence de l'empreinte géométrique.
 * Les règles testées ici sont les mêmes que celles appliquées en base
 * (solar_apply_roof_geometry / solar_geometry_fingerprint).
 */
import { describe, expect, it } from "vitest";
import { conversionKeysMatch, customPlanesFromGeometry } from "@/lib/solar/polygon";
import { fingerprint } from "@/lib/solar/hash";
import type { RoofPlaneGeometry } from "@/lib/solar/types";

function plane(key: string): RoofPlaneGeometry {
  return {
    key,
    name: key.toUpperCase(),
    azimuth_deg: 180,
    tilt_deg: 30,
    area_m2: 40,
    polygon: [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 5 },
      { x: 0, y: 5 },
    ],
    frame: {
      origin: { x: 0, y: 0, z: 3 },
      u: { x: 1, y: 0, z: 0 },
      v: { x: 0, y: 0.87, z: 0.5 },
    },
    eave_height_m: 3,
    ridge_height_m: 5,
  } as RoofPlaneGeometry;
}

describe("conversion explicite en contours (P0-B.2)", () => {
  it("accepte uniquement le jeu de clés existant", () => {
    const geometry = [plane("pan1"), plane("pan2")];
    const custom = customPlanesFromGeometry(geometry);
    expect(
      conversionKeysMatch(
        geometry.map((g) => g.key),
        custom.map((p) => p.key),
      ),
    ).toBe(true);
  });

  it("refuse une clé nouvelle", () => {
    expect(conversionKeysMatch(["pan1", "pan2"], ["pan1", "pan3"])).toBe(false);
    expect(conversionKeysMatch(["pan1", "pan2"], ["pan1", "pan2", "pan3"])).toBe(false);
  });

  it("refuse un pan manquant", () => {
    expect(conversionKeysMatch(["pan1", "pan2"], ["pan1"])).toBe(false);
  });

  it("refuse un doublon de clé", () => {
    expect(conversionKeysMatch(["pan1", "pan2"], ["pan1", "pan1"])).toBe(false);
  });

  it("refuse une toiture sans pan existant", () => {
    expect(conversionKeysMatch([], [])).toBe(false);
  });
});

/**
 * Empreinte : la sémantique SQL agrège TOUJOURS bâtiment + pans + obstacles +
 * origine. On reproduit ici cette structure pour verrouiller la règle :
 * toucher une partie change le hash, les autres parties restent prises en compte.
 */
function fullState(over: Partial<Record<string, unknown>> = {}) {
  return {
    origin: { lat: 48.85, lon: 2.35, alt: 35 },
    building: { mode: "polygon", params: { tilt_deg: 30 }, terrain: null },
    planes: [{ key: "pan1", area_m2: 40, tilt_deg: 30 }],
    obstacles: [{ id: "o1", type: "cheminee", w: 0.6, l: 0.6, h: 1.2 }],
    ...over,
  };
}

describe("empreinte géométrique complète (P0-B.2)", () => {
  it("deux calculs du même état donnent la même empreinte", () => {
    expect(fingerprint(fullState())).toBe(fingerprint(fullState()));
  });

  it("un obstacle modifié change l'empreinte sans effacer la toiture", () => {
    const before = fullState();
    const after = fullState({
      obstacles: [{ id: "o1", type: "cheminee", w: 0.8, l: 0.6, h: 1.2 }],
    });
    expect(fingerprint(after)).not.toBe(fingerprint(before));
    expect(fingerprint(after)).toBe(
      fingerprint({
        ...after,
        planes: [{ key: "pan1", area_m2: 40, tilt_deg: 30 }],
      }),
    );
  });

  it("une toiture modifiée change l'empreinte sans effacer les obstacles", () => {
    const before = fullState();
    const after = fullState({ planes: [{ key: "pan1", area_m2: 44, tilt_deg: 30 }] });
    expect(fingerprint(after)).not.toBe(fingerprint(before));
    expect(fingerprint(after)).not.toBe(fingerprint({ ...after, obstacles: [] }));
  });
});

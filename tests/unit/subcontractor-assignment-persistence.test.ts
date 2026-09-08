import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Non-régression du chemin de PERSISTANCE des affectations sous-traitant.
 *
 * Deux défauts constatés en production le 08/09/2026 :
 *  1. `permission_overrides` était persisté via `normalizePermissions`, qui
 *     supprime les clés à `false` : un droit hérité ne pouvait pas être retiré.
 *  2. La visite technique n'était validée que sur `company_id`, permettant de
 *     rattacher une visite d'un AUTRE chantier de la même entreprise.
 *
 * Ces contrôles portent sur le source réel car la fonction serveur nécessite
 * une session Supabase et ne peut pas être exécutée en test unitaire.
 */
const SOURCE = readFileSync(join(import.meta.dir, "../../src/lib/subcontractors.functions.ts"), "utf8");

describe("saveSubcontractorAssignment — persistance", () => {
  it("persiste les overrides avec le normaliseur qui conserve false", () => {
    expect(SOURCE).toContain("permission_overrides: normalizePermissionOverrides(");
    expect(SOURCE).not.toContain("permission_overrides: normalizePermissions(");
  });

  it("valide la visite technique sur l'entreprise ET le chantier", () => {
    const block = SOURCE.slice(SOURCE.indexOf('.from("technical_visits")'));
    const scoped = block.slice(0, block.indexOf("maybeSingle()"));
    expect(scoped).toContain('.eq("company_id", data.companyId)');
    expect(scoped).toContain('.eq("chantier_id", data.chantierId)');
  });
});

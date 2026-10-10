import { describe, it, expect } from "bun:test";
import { interpretSuspensionRow } from "@/hooks/use-suspension";

describe("Statut de suspension", () => {
  it("ligne absente : erreur (accès non confirmé), jamais non suspendu", () => {
    expect(() => interpretSuspensionRow(null, null)).toThrow();
  });
  it("erreur de lecture : erreur", () => {
    expect(() => interpretSuspensionRow({ name: "A" }, new Error("x"))).toThrow();
  });
  it("suspendue ou bloquée : suspendu", () => {
    expect(interpretSuspensionRow({ suspended_at: "2026-01-01" }, null).suspended).toBe(true);
    expect(interpretSuspensionRow({ support_status: "blocked" }, null).suspended).toBe(true);
  });
  it("ligne normale : non suspendu", () => {
    expect(interpretSuspensionRow({ name: "A", support_status: "ok" }, null).suspended).toBe(false);
  });
});

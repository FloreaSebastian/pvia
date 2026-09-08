import { describe, expect, it } from "bun:test";
import {
  computeCompliance,
  documentStatus,
  daysUntil,
  docTypeLabel,
  formatFrDate,
  milestoneFor,
} from "@/lib/subcontractor-compliance";
import { sniffDocumentMime, decodeBase64 } from "@/lib/file-sniff";

const NOW = new Date("2026-09-08T10:00:00Z");
const iso = (offsetDays: number) =>
  new Date(Date.UTC(2026, 8, 8) + offsetDays * 86400000).toISOString().slice(0, 10);

describe("statut d'une pièce", () => {
  it("classe valide / expire bientôt / expirée / sans échéance", () => {
    expect(documentStatus(iso(90), NOW)).toBe("valid");
    expect(documentStatus(iso(30), NOW)).toBe("expiring_soon");
    expect(documentStatus(iso(0), NOW)).toBe("expiring_soon");
    expect(documentStatus(iso(-1), NOW)).toBe("expired");
    expect(documentStatus(null, NOW)).toBe("no_expiry");
  });

  it("compte les jours restants en jours calendaires", () => {
    expect(daysUntil(iso(7), NOW)).toBe(7);
    expect(daysUntil(iso(-3), NOW)).toBe(-3);
  });
});

describe("conformité globale", () => {
  const rule = (t: string, required = true, blocking = false) => ({
    doc_type: t,
    is_required: required,
    is_blocking: blocking,
  });
  const doc = (t: string, expiry: string | null, id = t) => ({
    id,
    doc_type: t,
    expiry_date: expiry,
  });

  it("est conforme quand toutes les pièces requises sont valides", () => {
    const r = computeCompliance([doc("decennale", iso(200))], [rule("decennale", true, true)], NOW);
    expect(r.status).toBe("compliant");
    expect(r.blockingIssues).toHaveLength(0);
  });

  it("signale une pièce requise manquante", () => {
    const r = computeCompliance([], [rule("kbis")], NOW);
    expect(r.status).toBe("incomplete");
    expect(r.counts.missing).toBe(1);
  });

  it("bloque quand une pièce bloquante est expirée", () => {
    const r = computeCompliance([doc("decennale", iso(-2))], [rule("decennale", true, true)], NOW);
    expect(r.status).toBe("blocking");
    expect(r.blockingIssues[0]).toMatchObject({ docType: "decennale", reason: "expired" });
  });

  it("bloque quand une pièce bloquante est absente", () => {
    const r = computeCompliance([], [rule("rc_pro", true, true)], NOW);
    expect(r.blockingIssues[0]).toMatchObject({ docType: "rc_pro", reason: "missing" });
  });

  it("ne bloque pas une pièce requise mais non bloquante", () => {
    const r = computeCompliance([doc("kbis", iso(-5))], [rule("kbis", true, false)], NOW);
    expect(r.blockingIssues).toHaveLength(0);
    expect(r.status).toBe("incomplete");
  });

  it("ignore les pièces archivées", () => {
    const r = computeCompliance(
      [{ ...doc("decennale", iso(200)), archived_at: "2026-01-01T00:00:00Z" }],
      [rule("decennale", true, true)],
      NOW,
    );
    expect(r.status).toBe("blocking");
  });

  it("retient la pièce active la plus lointaine par type", () => {
    const r = computeCompliance(
      [doc("decennale", iso(-10), "old"), doc("decennale", iso(120), "new")],
      [rule("decennale", true, true)],
      NOW,
    );
    expect(r.status).toBe("compliant");
    expect(r.lines[0].documentId).toBe("new");
  });

  it("expose la prochaine échéance", () => {
    const r = computeCompliance(
      [doc("decennale", iso(120)), doc("rc_pro", iso(20))],
      [rule("decennale"), rule("rc_pro")],
      NOW,
    );
    expect(r.nextExpiry?.docType).toBe("rc_pro");
    expect(r.nextExpiry?.daysToExpiry).toBe(20);
    expect(r.status).toBe("expiring_soon");
  });

  it("priorise la règle de l'entreprise sur les indicateurs du document", () => {
    const r = computeCompliance(
      [{ ...doc("kbis", iso(-1)), is_blocking: true, is_required: true }],
      [rule("kbis", true, false)],
      NOW,
    );
    expect(r.blockingIssues).toHaveLength(0);
  });
});

describe("jalons d'alerte", () => {
  it("n'alerte qu'aux jalons J-60, J-30, J-7 et J", () => {
    expect(milestoneFor(60)).toBe("j-60");
    expect(milestoneFor(30)).toBe("j-30");
    expect(milestoneFor(7)).toBe("j-7");
    expect(milestoneFor(0)).toBe("j-0");
    expect(milestoneFor(45)).toBeNull();
    expect(milestoneFor(1)).toBeNull();
  });

  it("relance une fois par semaine après expiration", () => {
    expect(milestoneFor(-7)).toBe("expired+7");
    expect(milestoneFor(-14)).toBe("expired+14");
    expect(milestoneFor(-3)).toBeNull();
  });
});

describe("validation binaire des fichiers", () => {
  const bytes = (...b: number[]) => new Uint8Array(b);

  it("accepte PDF, JPEG et PNG réels", () => {
    expect(sniffDocumentMime(bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe("application/pdf");
    expect(sniffDocumentMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffDocumentMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
  });

  it("refuse un exécutable ou un SVG déguisé", () => {
    expect(sniffDocumentMime(bytes(0x4d, 0x5a, 0x90))).toBeNull();
    expect(sniffDocumentMime(new TextEncoder().encode("<svg xmlns=..."))).toBeNull();
  });

  it("refuse un fichier au-delà du plafond", () => {
    const big = "A".repeat(200);
    expect(() => decodeBase64(big, 10)).toThrow();
  });
});

describe("libellés", () => {
  it("utilise l'intitulé personnalisé quand il existe", () => {
    expect(docTypeLabel("decennale")).toContain("décennale");
    expect(docTypeLabel("decennale", "Décennale 2026")).toBe("Décennale 2026");
  });

  it("formate les dates en français", () => {
    expect(formatFrDate("2026-09-08")).toBe("08/09/2026");
    expect(formatFrDate(null)).toBe("—");
  });
});

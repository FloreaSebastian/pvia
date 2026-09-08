import { describe, expect, it } from "bun:test";
import { computeCompliance, normalizeReviewStatus } from "../../src/lib/subcontractor-compliance";

const NOW = new Date("2026-09-10T09:00:00Z");
const rule = (doc_type: string, is_blocking = true) => ({
  doc_type,
  is_required: true,
  is_blocking,
});

describe("normalizeReviewStatus — compatibilité historique", () => {
  it("traite null / undefined / valeur inconnue comme validée", () => {
    expect(normalizeReviewStatus(null)).toBe("approved");
    expect(normalizeReviewStatus(undefined)).toBe("approved");
    expect(normalizeReviewStatus("n'importe quoi")).toBe("approved");
    expect(normalizeReviewStatus("approved")).toBe("approved");
  });

  it("conserve les états explicites", () => {
    expect(normalizeReviewStatus("pending_review")).toBe("pending_review");
    expect(normalizeReviewStatus("rejected")).toBe("rejected");
  });
});

describe("computeCompliance — état de revue", () => {
  it("ne dégrade pas un partenaire historique sans review_status", () => {
    const s = computeCompliance(
      [{ id: "d1", doc_type: "decennale", expiry_date: "2027-01-01" }],
      [rule("decennale")],
      NOW,
    );
    expect(s.status).toBe("compliant");
    expect(s.counts.pendingReview).toBe(0);
  });

  it("une pièce déposée par le sous-traitant reste à vérifier et bloque si bloquante", () => {
    const s = computeCompliance(
      [
        {
          id: "d1",
          doc_type: "decennale",
          expiry_date: "2027-01-01",
          review_status: "pending_review",
        },
      ],
      [rule("decennale")],
      NOW,
    );
    expect(s.lines[0]!.status).toBe("pending_review");
    expect(s.counts.pendingReview).toBe(1);
    expect(s.status).toBe("blocking");
    expect(s.blockingIssues[0]!.reason).toBe("pending_review");
  });

  it("une pièce refusée expose son motif et bloque", () => {
    const s = computeCompliance(
      [
        {
          id: "d1",
          doc_type: "rc_pro",
          expiry_date: "2027-01-01",
          review_status: "rejected",
          rejection_reason: "Document illisible",
        },
      ],
      [rule("rc_pro")],
      NOW,
    );
    expect(s.lines[0]!.status).toBe("rejected");
    expect(s.lines[0]!.rejectionReason).toBe("Document illisible");
    expect(s.counts.rejected).toBe(1);
    expect(s.status).toBe("blocking");
  });

  it("une pièce validée encore valable prime sur un nouveau dépôt en attente", () => {
    const s = computeCompliance(
      [
        { id: "old", doc_type: "kbis", expiry_date: "2027-05-01", review_status: "approved" },
        { id: "new", doc_type: "kbis", expiry_date: "2028-05-01", review_status: "pending_review" },
      ],
      [rule("kbis")],
      NOW,
    );
    expect(s.lines[0]!.documentId).toBe("old");
    expect(s.lines[0]!.status).toBe("valid");
    expect(s.counts.pendingReview).toBe(1);
    // Le partenaire n'est pas bloqué : sa pièce validée reste en vigueur.
    expect(s.status).toBe("pending_review");
  });

  it("une pièce non requise en attente ne bloque pas le partenaire", () => {
    const s = computeCompliance(
      [{ id: "d1", doc_type: "rge", review_status: "pending_review" }],
      [{ doc_type: "rge", is_required: false, is_blocking: false }],
      NOW,
    );
    expect(s.blockingIssues).toHaveLength(0);
    expect(s.status).toBe("pending_review");
  });

  it("les pièces archivées sont ignorées, y compris en attente", () => {
    const s = computeCompliance(
      [
        {
          id: "d1",
          doc_type: "decennale",
          expiry_date: "2027-01-01",
          review_status: "pending_review",
          archived_at: "2026-09-01T00:00:00Z",
        },
      ],
      [rule("decennale")],
      NOW,
    );
    expect(s.counts.pendingReview).toBe(0);
    expect(s.lines[0]!.status).toBe("missing");
    expect(s.status).toBe("blocking");
  });

  it("les règles courantes priment sur les indicateurs copiés sur la pièce", () => {
    const s = computeCompliance(
      [
        {
          id: "d1",
          doc_type: "urssaf_vigilance",
          expiry_date: "2027-01-01",
          is_required: true,
          is_blocking: true,
          review_status: "pending_review",
        },
      ],
      [{ doc_type: "urssaf_vigilance", is_required: false, is_blocking: false }],
      NOW,
    );
    expect(s.lines[0]!.blocking).toBe(false);
    expect(s.blockingIssues).toHaveLength(0);
  });
});

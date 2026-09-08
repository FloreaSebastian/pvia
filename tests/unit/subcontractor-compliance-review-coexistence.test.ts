/**
 * Non-régression de la passe corrective « portail de conformité ».
 *
 * Règle métier centrale : un nouveau dépôt « à vérifier » ne doit JAMAIS
 * retirer la couverture d'une pièce déjà validée et encore valable.
 */
import { describe, expect, it } from "bun:test";
import {
  BLOCKING_REASON_LABELS,
  computeCompliance,
  type ComplianceDocInput,
  type ComplianceRuleInput,
} from "../../src/lib/subcontractor-compliance";

const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const rules: ComplianceRuleInput[] = [
  { doc_type: "decennale", is_required: true, is_blocking: true },
];

const approved = (expiry: string): ComplianceDocInput =>
  ({
    id: "doc-approved",
    doc_type: "decennale",
    expiry_date: expiry,
    issue_date: null,
    is_required: true,
    is_blocking: true,
    archived_at: null,
    review_status: "approved",
    rejection_reason: null,
    label: null,
  }) as unknown as ComplianceDocInput;

const pending: ComplianceDocInput = {
  id: "doc-pending",
  doc_type: "decennale",
  expiry_date: inDays(400),
  issue_date: null,
  is_required: true,
  is_blocking: true,
  archived_at: null,
  review_status: "pending_review",
  rejection_reason: null,
  label: null,
} as unknown as ComplianceDocInput;

const rejected: ComplianceDocInput = {
  ...(pending as any),
  id: "doc-rejected",
  review_status: "rejected",
  rejection_reason: "Document illisible",
} as unknown as ComplianceDocInput;

describe("coexistence approved / pending", () => {
  it("une décennale validée encore valable prime sur un nouveau dépôt en attente", () => {
    const s = computeCompliance([approved(inDays(120)), pending], rules);
    // « en revue » est informatif : la couverture validée reste en vigueur.
    expect(s.status).not.toBe("blocking");
    expect(s.blockingIssues).toHaveLength(0);
  });

  it("un refus ne casse pas la couverture d'une version validée encore active", () => {
    const s = computeCompliance([approved(inDays(200)), rejected], rules);
    expect(s.status).not.toBe("blocking");
    expect(s.blockingIssues).toHaveLength(0);
  });

  it("sans version validée, une pièce bloquante en attente bloque l'affectation", () => {
    const s = computeCompliance([pending], rules);
    expect(s.status).toBe("blocking");
    expect(s.blockingIssues.map((b) => b.reason)).toContain("pending_review");
  });

  it("sans version validée, une pièce bloquante refusée bloque l'affectation", () => {
    const s = computeCompliance([rejected], rules);
    expect(s.status).toBe("blocking");
    expect(s.blockingIssues.map((b) => b.reason)).toContain("rejected");
  });

  it("une version validée expirée ne masque pas le défaut", () => {
    const s = computeCompliance([approved(inDays(-3)), pending], rules);
    expect(s.status).toBe("blocking");
  });
});

describe("libellés de blocage", () => {
  it("n'affiche jamais « manquante » pour une pièce en revue ou refusée", () => {
    expect(BLOCKING_REASON_LABELS.missing).toBe("manquante");
    expect(BLOCKING_REASON_LABELS.expired).toBe("expirée");
    expect(BLOCKING_REASON_LABELS.pending_review).toBe("à vérifier");
    expect(BLOCKING_REASON_LABELS.rejected).toBe("refusée");
  });
});

import { describe, expect, it } from "vitest";
import {
  QUOTE_STATUSES,
  QUOTE_STATUS_META,
  STUDY_STATUS_FILTERS,
  assertConversionAllowed,
  computeNextAction,
  isProjectWon,
  isQuoteStatus,
} from "@/lib/etudes/workflow";

const base = {
  status: "sent",
  quote_status: "to_prepare" as string | null,
  completion_percent: 100,
  missingCount: 0,
  converted_chantier_id: null as string | null,
  converted_visit_id: null as string | null,
};

describe("axes de statut séparés", () => {
  it("le filtre du cahier des charges n'expose aucun statut commercial", () => {
    expect(STUDY_STATUS_FILTERS).not.toContain("accepted");
    expect(STUDY_STATUS_FILTERS).not.toContain("refused");
  });

  it("tous les statuts de devis ont un libellé", () => {
    for (const s of QUOTE_STATUSES) expect(QUOTE_STATUS_META[s].label.length).toBeGreaterThan(3);
  });

  it("reconnaît uniquement les statuts commerciaux valides", () => {
    expect(isQuoteStatus("accepted")).toBe(true);
    expect(isQuoteStatus("draft")).toBe(false);
    expect(isQuoteStatus(null)).toBe(false);
  });
});

describe("garde de conversion", () => {
  it("refuse la création de chantier sans devis accepté", () => {
    for (const s of ["to_prepare", "prepared", "sent", "follow_up", "refused", "expired", null]) {
      expect(() => assertConversionAllowed(s)).toThrow(/accept/i);
    }
  });

  it("autorise la conversion quand le devis est accepté", () => {
    expect(isProjectWon("accepted")).toBe(true);
    expect(() => assertConversionAllowed("accepted")).not.toThrow();
  });
});

describe("prochaine action", () => {
  it("demande de compléter tant qu'il manque des éléments", () => {
    expect(computeNextAction({ ...base, status: "in_progress", missingCount: 4 }).key).toBe("complete_study");
  });

  it("propose de préparer le devis une fois la pré-étude finalisée", () => {
    expect(computeNextAction({ ...base, status: "completed" }).key).toBe("prepare_quote");
  });

  it("propose la visite technique dès que le devis est accepté", () => {
    expect(computeNextAction({ ...base, quote_status: "accepted" }).key).toBe("plan_visit");
  });

  it("ne redemande pas de chantier quand il existe déjà", () => {
    expect(
      computeNextAction({ ...base, quote_status: "accepted", converted_chantier_id: "c1" }).key,
    ).toBe("plan_visit_only");
  });

  it("bascule en relance puis en affaire perdue", () => {
    expect(computeNextAction({ ...base, quote_status: "follow_up" }).key).toBe("follow_up");
    expect(computeNextAction({ ...base, quote_status: "refused" }).key).toBe("lost");
  });

  it("un dossier archivé n'a plus d'action", () => {
    expect(computeNextAction({ ...base, status: "archived", quote_status: "accepted" }).key).toBe("archived");
  });
});

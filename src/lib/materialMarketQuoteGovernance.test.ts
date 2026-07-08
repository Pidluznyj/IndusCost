import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canApproveMaterialMarketQuote,
  canShowApproveRejectActions,
  canShowSetOfficialAction,
  canShowSubmitForApprovalAction,
  isCriticalMaterialForQuoteApproval,
  MATERIAL_MARKET_QUOTE_APPROVE_PERMISSION,
  validateApproveMaterialMarketQuote,
  validateRejectMaterialMarketQuote,
  validateSetMaterialMarketQuoteOfficial,
  validateSubmitMaterialQuoteForApproval,
} from "./materialMarketQuoteGovernance.js";
import { planSetMaterialOfficialQuote } from "./materialOfficialQuote.js";

const materialId = "mat-1";
const quoteA = { id: "q-a", materialId, officialStatus: "DRAFT", isOfficialReference: false };
const quoteB = { id: "q-b", materialId, officialStatus: "DRAFT", isOfficialReference: false };
const quoteOfficial = {
  id: "q-official",
  materialId,
  officialStatus: "OFFICIAL",
  isOfficialReference: true,
};

describe("materialMarketQuoteGovernance", () => {
  it("identifica matérias HIGH/CRITICAL como críticas para aprovação", () => {
    assert.equal(isCriticalMaterialForQuoteApproval("HIGH"), true);
    assert.equal(isCriticalMaterialForQuoteApproval("CRITICAL"), true);
    assert.equal(isCriticalMaterialForQuoteApproval("MEDIUM"), false);
    assert.equal(isCriticalMaterialForQuoteApproval("LOW"), false);
  });

  it("CRITICAL: bloqueia set-official direto em rascunho", () => {
    const result = validateSetMaterialMarketQuoteOfficial({
      materialId,
      quoteId: quoteA.id,
      marketCriticality: "CRITICAL",
      quotes: [quoteA],
    });
    assert.equal(result.ok, false);
    if (result.ok === false) {
      assert.equal(result.code, "APPROVAL_REQUIRED");
    }
  });

  it("MEDIUM/LOW: permite set-official direto em rascunho", () => {
    for (const criticality of ["MEDIUM", "LOW"] as const) {
      const result = validateSetMaterialMarketQuoteOfficial({
        materialId,
        quoteId: quoteA.id,
        marketCriticality: criticality,
        quotes: [quoteA],
      });
      assert.equal(result.ok, true, criticality);
    }
  });

  it("rejeição sem motivo retorna REJECTION_REASON_REQUIRED", () => {
    const pending = {
      id: "q-pending",
      materialId,
      officialStatus: "PENDING_APPROVAL",
      isOfficialReference: false,
    };
    const result = validateRejectMaterialMarketQuote({
      materialId,
      quoteId: pending.id,
      reason: "   ",
      quotes: [pending],
    });
    assert.equal(result.ok, false);
    if (result.ok === false) {
      assert.equal(result.code, "REJECTION_REASON_REQUIRED");
      assert.equal(result.field, "reason");
    }
  });

  it("rejeição com motivo é válida", () => {
    const pending = {
      id: "q-pending",
      materialId,
      officialStatus: "PENDING_APPROVAL",
      isOfficialReference: false,
    };
    const result = validateRejectMaterialMarketQuote({
      materialId,
      quoteId: pending.id,
      reason: "Preço acima do mercado.",
      quotes: [pending],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.reason, "Preço acima do mercado.");
    }
  });

  it("aprovação exige status PENDING_APPROVAL e planeja substituição", () => {
    const pending = {
      id: "q-pending",
      materialId,
      officialStatus: "PENDING_APPROVAL",
      isOfficialReference: false,
    };
    const result = validateApproveMaterialMarketQuote({
      materialId,
      quoteId: pending.id,
      quotes: [quoteOfficial, pending],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.plan.previousQuoteId, quoteOfficial.id);
      assert.equal(result.plan.newQuoteId, pending.id);
    }
  });

  it("substituição oficial A por B marca A como candidato a REPLACED", () => {
    const plan = planSetMaterialOfficialQuote({
      materialId,
      quoteId: quoteB.id,
      quotes: [quoteOfficial, quoteB],
    });
    assert.equal(plan.ok, true);
    if (plan.ok) {
      assert.equal(plan.plan.previousQuoteId, quoteOfficial.id);
      assert.equal(plan.plan.newQuoteId, quoteB.id);
    }
  });

  it("envio para aprovação só em matéria crítica e rascunho", () => {
    const nonCritical = validateSubmitMaterialQuoteForApproval({
      materialId,
      quoteId: quoteA.id,
      marketCriticality: "LOW",
      quotes: [quoteA],
    });
    assert.equal(nonCritical.ok, false);

    const critical = validateSubmitMaterialQuoteForApproval({
      materialId,
      quoteId: quoteA.id,
      marketCriticality: "CRITICAL",
      quotes: [quoteA],
    });
    assert.equal(critical.ok, true);
  });

  it("permissão de aprovação usa materials.market_quote.approve", () => {
    assert.equal(
      MATERIAL_MARKET_QUOTE_APPROVE_PERMISSION,
      "materials.market_quote.approve"
    );
    assert.equal(
      canApproveMaterialMarketQuote({
        hasPermission: (p) => p === "materials.market_quote.approve",
      }),
      true
    );
  });

  it("ações de UI respeitam status e permissões", () => {
    assert.equal(
      canShowSubmitForApprovalAction({
        officialStatus: "DRAFT",
        marketCriticality: "CRITICAL",
        canEdit: true,
      }),
      true
    );
    assert.equal(
      canShowApproveRejectActions({
        officialStatus: "PENDING_APPROVAL",
        canApprove: true,
      }),
      true
    );
    assert.equal(
      canShowSetOfficialAction({
        officialStatus: "DRAFT",
        marketCriticality: "LOW",
        canEdit: true,
        canApprove: false,
      }),
      true
    );
    assert.equal(
      canShowSetOfficialAction({
        officialStatus: "DRAFT",
        marketCriticality: "CRITICAL",
        canEdit: true,
        canApprove: true,
      }),
      false
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeSupplierOrderEvaluation } from "./supplierPerformance.js";
import {
  describeNomusPurchaseOrderSupplierEvaluationEligibility,
  isNomusPurchaseOrderSupplierEvaluationEligible,
  isSupplierIdentitySafeForEvaluation,
  nomusSupplierEvaluationStatus,
  previewNomusPurchaseOrderEvaluation,
  suggestNomusPurchaseOrderEvaluationScores,
} from "./nomusPurchaseOrderEvaluation.js";

describe("elegibilidade Nomus", () => {
  it("toda a base Nomus é elegível, inclusive pedidos novos e cancelados", () => {
    for (const stage of ["OPEN", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELED", "UNKNOWN"]) {
      assert.equal(isNomusPurchaseOrderSupplierEvaluationEligible(stage, false), true, stage);
    }
    assert.equal(isNomusPurchaseOrderSupplierEvaluationEligible("RECEIVED", true), true);
    assert.equal(isNomusPurchaseOrderSupplierEvaluationEligible(null, null), true);
  });

  it("não bloqueia por status do pedido", () => {
    const d = describeNomusPurchaseOrderSupplierEvaluationEligibility("OPEN", false);
    assert.equal(d.eligible, true);
    assert.equal(d.eligibilityReason, null);
  });
});

describe("identidade do fornecedor", () => {
  it("EXACT e HIGH com id são seguros", () => {
    assert.equal(
      isSupplierIdentitySafeForEvaluation({
        matchConfidence: "EXACT",
        financialSupplierId: "fs-1",
      }),
      true
    );
    assert.equal(
      isSupplierIdentitySafeForEvaluation({
        matchConfidence: "HIGH",
        financialSupplierId: "fs-1",
      }),
      true
    );
  });

  it("FALLBACK, UNRESOLVED ou id ausente são inseguros", () => {
    assert.equal(
      isSupplierIdentitySafeForEvaluation({
        matchConfidence: "FALLBACK",
        financialSupplierId: "fs-1",
      }),
      false
    );
    assert.equal(
      isSupplierIdentitySafeForEvaluation({
        matchConfidence: "UNRESOLVED",
        financialSupplierId: "fs-1",
      }),
      false
    );
    assert.equal(
      isSupplierIdentitySafeForEvaluation({
        matchConfidence: "HIGH",
        financialSupplierId: null,
      }),
      false
    );
  });
});

describe("notas e sugestões", () => {
  it("reusa o motor OP-26 — 8+9+10+9 = 9", () => {
    const preview = previewNomusPurchaseOrderEvaluation({
      qualityScore: 8,
      deliveryScore: 9,
      conformityScore: 10,
      serviceScore: 9,
    });
    assert.equal(preview.overallScore, computeSupplierOrderEvaluation({
      qualityScore: 8,
      deliveryScore: 9,
      conformityScore: 10,
      serviceScore: 9,
    }).overallScore);
    assert.equal(preview.overallScore, 9);
  });

  it("0 e 10 são válidos; <0 e >10 inválidos; null não vira 0", () => {
    assert.equal(
      previewNomusPurchaseOrderEvaluation({
        qualityScore: 0,
        deliveryScore: 0,
        conformityScore: 0,
        serviceScore: 0,
      }).overallScore,
      0
    );
    assert.equal(
      previewNomusPurchaseOrderEvaluation({
        qualityScore: 10,
        deliveryScore: 10,
        conformityScore: 10,
        serviceScore: 10,
      }).overallScore,
      10
    );
    assert.throws(() =>
      previewNomusPurchaseOrderEvaluation({
        qualityScore: -0.1,
        deliveryScore: 8,
        conformityScore: 8,
        serviceScore: 8,
      })
    );
    assert.throws(() =>
      previewNomusPurchaseOrderEvaluation({
        qualityScore: 10.1,
        deliveryScore: 8,
        conformityScore: 8,
        serviceScore: 8,
      })
    );
    assert.throws(() =>
      previewNomusPurchaseOrderEvaluation({
        qualityScore: null,
        deliveryScore: 8,
        conformityScore: 8,
        serviceScore: 8,
      })
    );
  });

  it("sugestões do MVP são null — desconhecido não vira 0", () => {
    const s = suggestNomusPurchaseOrderEvaluationScores();
    assert.equal(s.quality, null);
    assert.equal(s.delivery, null);
    assert.equal(s.conformity, null);
    assert.equal(s.service, null);
  });

  it("status de avaliação não mistura com status do pedido", () => {
    assert.equal(nomusSupplierEvaluationStatus({ eligible: true, hasEvaluation: false }), "PENDING");
    assert.equal(nomusSupplierEvaluationStatus({ eligible: true, hasEvaluation: true }), "EVALUATED");
    assert.equal(nomusSupplierEvaluationStatus({ eligible: false, hasEvaluation: false }), "INELIGIBLE");
  });
});
